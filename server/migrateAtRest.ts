import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface AtRestCiphertextEnvelope {
  encrypted: true;
  v: 1;
  algorithm: 'AES-256-GCM';
  iv: string;
  ciphertext: string;
  keyId: string;
  migratedAt: number;
}

const FORBIDDEN_PRIVATE_KEY_KEYS = new Set([
  'privatekey',
  'privatekeys',
  'secretkey',
  'privkey',
  'signingprivatekey',
  'dhprivatekey',
  'kemprivatekey',
  'prekeyprivatekeys',
  'seed',
  'chainingkey',
  'mastersecret',
  'rootkey'
]);

function isForbiddenKeyName(key: string): boolean {
  const norm = key.toLowerCase().replace(/[-_]/g, '');
  return FORBIDDEN_PRIVATE_KEY_KEYS.has(norm);
}

/**
 * Derives a dedicated Domain 2 at-rest key for dev vault file encryption using PBKDF2.
 */
function deriveDevAtRestKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
}

/**
 * Encrypts arbitrary serializable data using AES-256-GCM (Domain 2 Local At-Rest).
 */
export function encryptAtRestLocal(data: any, devUnlockSecret: string = 'ychat-dev-local-vault-unlock-secret'): AtRestCiphertextEnvelope {
  const salt = crypto.randomBytes(16);
  const key = deriveDevAtRestKey(devUnlockSecret, salt);
  const iv = crypto.randomBytes(12); // 96-bit standard GCM IV

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  return {
    encrypted: true,
    v: 1,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([salt, ciphertext]).toString('base64'),
    keyId: `dev-vault-${Date.now()}`,
    migratedAt: Date.now()
  };
}

/**
 * Decrypts data encrypted under AES-256-GCM (Domain 2 Local At-Rest).
 */
export function decryptAtRestLocal(envelope: AtRestCiphertextEnvelope, devUnlockSecret: string = 'ychat-dev-local-vault-unlock-secret'): any {
  if (!envelope.encrypted || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error('Invalid at-rest ciphertext envelope');
  }

  const rawBytes = Buffer.from(envelope.ciphertext, 'base64');
  const salt = rawBytes.subarray(0, 16);
  const ciphertextAndTag = rawBytes.subarray(16);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);

  const key = deriveDevAtRestKey(devUnlockSecret, salt);
  const iv = Buffer.from(envelope.iv, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}

export interface MigrationSummary {
  scannedFiles: string[];
  filesSanitized: string[];
  filesReencrypted: string[];
  privateKeysPurgedCount: number;
  status: 'clean' | 're-encrypted' | 'sanitized';
}

/**
 * Recursively inspects and purges/re-encrypts any plaintext private key material found in JSON structures.
 */
function sanitizeObject(obj: any): { sanitized: any; purgedCount: number } {
  if (!obj || typeof obj !== 'object') {
    return { sanitized: obj, purgedCount: 0 };
  }

  if (Array.isArray(obj)) {
    let totalPurged = 0;
    const sanitizedArray = obj.map(item => {
      const { sanitized, purgedCount } = sanitizeObject(item);
      totalPurged += purgedCount;
      return sanitized;
    });
    return { sanitized: sanitizedArray, purgedCount: totalPurged };
  }

  let totalPurged = 0;
  const sanitizedObj: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isForbiddenKeyName(key)) {
      totalPurged++;
      // Purge plaintext private key material from persistent file
      continue;
    }

    const { sanitized, purgedCount } = sanitizeObject(value);
    totalPurged += purgedCount;
    sanitizedObj[key] = sanitized;
  }

  return { sanitized: sanitizedObj, purgedCount: totalPurged };
}

/**
 * Audits all JSON files in the .data directory.
 * If any plaintext key material is detected:
 * - Server database files are purged of forbidden private keys to enforce zero-knowledge.
 * - Local client vaults/caches containing private keys are encrypted under AES-256-GCM.
 * No plaintext key material is left in .data/ going forward.
 */
export function migrateAtRestDevData(dataDirPath: string = path.resolve(process.cwd(), '.data')): MigrationSummary {
  const summary: MigrationSummary = {
    scannedFiles: [],
    filesSanitized: [],
    filesReencrypted: [],
    privateKeysPurgedCount: 0,
    status: 'clean'
  };

  if (!fs.existsSync(dataDirPath)) {
    return summary;
  }

  const files = fs.readdirSync(dataDirPath).filter(f => f.endsWith('.json'));

  for (const fileName of files) {
    const filePath = path.join(dataDirPath, fileName);
    summary.scannedFiles.push(fileName);

    let content: any;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      content = JSON.parse(raw);
    } catch {
      continue;
    }

    // Check if file is already an encrypted at-rest vault
    if (content && content.encrypted === true && content.algorithm === 'AES-256-GCM') {
      continue;
    }

    // If this is a client key storage / client vault file containing private keys
    if (fileName.startsWith('client_') || fileName.startsWith('vault_') || fileName.startsWith('device_keys_')) {
      // Re-encrypt the entire client file under AES-256-GCM
      const encryptedEnvelope = encryptAtRestLocal(content);
      fs.writeFileSync(filePath, JSON.stringify(encryptedEnvelope, null, 2), 'utf8');
      summary.filesReencrypted.push(fileName);
      summary.status = 're-encrypted';
      continue;
    }

    // For server database files, scan and sanitize any leaked private keys
    const { sanitized, purgedCount } = sanitizeObject(content);
    if (purgedCount > 0) {
      summary.privateKeysPurgedCount += purgedCount;
      summary.filesSanitized.push(fileName);
      summary.status = 'sanitized';
      fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2), 'utf8');
      console.log(`[Domain 2 At-Rest Migration] Purged ${purgedCount} plaintext private keys from ${fileName}`);
    }
  }

  return summary;
}

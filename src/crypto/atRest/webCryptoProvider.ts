import { AtRestCiphertext, AtRestKeyMetadata, AtRestStorageDriver } from './types';
import { argon2id } from '@noble/hashes/argon2.js';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const META_STORAGE_PREFIX = 'ychat_atrest_meta_v1_';
const DEVICE_SECRET_PREFIX = 'ychat_device_unlock_secret_';

/**
 * WebAtRestProvider implements Domain 2 local at-rest storage encryption for web browsers.
 *
 * It uses WebCrypto to derive an AES-KW wrapping key from a device unlock secret via PBKDF2 or Argon2id,
 * wraps an AES-256-GCM Data Encryption Key (DEK) with subtle.wrapKey, and holds the unwrapped DEK
 * strictly in volatile memory.
 */
export class WebAtRestProvider implements AtRestStorageDriver {
  readonly platform = 'web';
  private userId: string | null = null;
  private dek: CryptoKey | null = null;
  private keyMetadata: AtRestKeyMetadata | null = null;

  async initialize(userId: string, customUnlockSecret?: string): Promise<void> {
    this.userId = userId;

    // 1. Resolve or generate device unlock secret
    let unlockSecret = customUnlockSecret;
    if (!unlockSecret) {
      const storageKey = `${DEVICE_SECRET_PREFIX}${userId}`;
      const existing = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      if (existing) {
        unlockSecret = existing;
      } else {
        const randomSecretBytes = crypto.getRandomValues(new Uint8Array(32));
        unlockSecret = bytesToBase64(randomSecretBytes);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(storageKey, unlockSecret);
          } catch {}
        }
      }
    }

    // 2. Load existing metadata or create fresh wrapping key pair
    const metaStorageKey = `${META_STORAGE_PREFIX}${userId}`;
    const rawMeta = typeof window !== 'undefined' ? localStorage.getItem(metaStorageKey) : null;
    let meta: AtRestKeyMetadata | null = null;
    if (rawMeta) {
      try {
        meta = JSON.parse(rawMeta);
      } catch {
        meta = null;
      }
    }

    const secretBytes = new TextEncoder().encode(unlockSecret);

    if (meta) {
      // Unwrap existing DEK using derived wrapping key
      const salt = base64ToBytes(meta.salt);
      const wrappingKey = await this.deriveWrappingKey(secretBytes, salt, meta.kdf);
      const wrappedDekBytes = base64ToBytes(meta.wrappedDek);

      try {
        this.dek = await crypto.subtle.unwrapKey(
          'raw',
          wrappedDekBytes as unknown as BufferSource,
          wrappingKey,
          'AES-KW',
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
        this.keyMetadata = meta;
        return;
      } catch (err) {
        console.warn('Failed to unwrap existing DEK, rotating at-rest key:', err);
      }
    }

    // Generate fresh DEK and wrap it
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kdf = 'PBKDF2-SHA256';
    const wrappingKey = await this.deriveWrappingKey(secretBytes, salt, kdf);

    const freshDek = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // extractable only during wrap
      ['encrypt', 'decrypt']
    );

    const wrappedDekBuffer = await crypto.subtle.wrapKey('raw', freshDek, wrappingKey, 'AES-KW');
    const wrappedDekBytes = new Uint8Array(wrappedDekBuffer);

    // Re-import DEK as non-extractable in memory
    const rawDekBytes = await crypto.subtle.exportKey('raw', freshDek);
    this.dek = await crypto.subtle.importKey(
      'raw',
      rawDekBytes,
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable in volatile memory
      ['encrypt', 'decrypt']
    );

    this.keyMetadata = {
      userId,
      platform: 'web',
      salt: bytesToBase64(salt),
      wrappedDek: bytesToBase64(wrappedDekBytes),
      kdf,
      createdAt: Date.now(),
      keyId: `dek-${userId.slice(0, 8)}-${Date.now()}`
    };

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(metaStorageKey, JSON.stringify(this.keyMetadata));
      } catch {}
    }
  }

  private async deriveWrappingKey(
    secretBytes: Uint8Array,
    salt: Uint8Array,
    kdf: 'PBKDF2-SHA256' | 'Argon2id'
  ): Promise<CryptoKey> {
    if (kdf === 'Argon2id') {
      const derivedBytes = argon2id(secretBytes, salt, { t: 2, m: 19456, p: 1, dkLen: 32 });
      return await crypto.subtle.importKey(
        'raw',
        derivedBytes,
        { name: 'AES-KW', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
      );
    }

    // Default: WebCrypto native PBKDF2 (100,000 iterations of SHA-256)
    const baseKey = await crypto.subtle.importKey(
      'raw',
      secretBytes as unknown as BufferSource,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations: 100000,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey']
    );
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  async encryptPayload<T>(payload: T): Promise<AtRestCiphertext> {
    if (!this.dek) {
      throw new Error('AtRestStorageDriver is locked. Call initialize() first.');
    }

    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const jsonString = JSON.stringify(payload);
    const plaintextBytes = new TextEncoder().encode(jsonString);

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.dek,
      plaintextBytes
    );

    return {
      encrypted: true,
      v: 1,
      algorithm: 'AES-256-GCM',
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
      keyId: this.keyMetadata?.keyId
    };
  }

  async decryptPayload<T>(record: AtRestCiphertext): Promise<T> {
    if (!this.dek) {
      throw new Error('AtRestStorageDriver is locked. Call initialize() first.');
    }

    if (record.algorithm !== 'AES-256-GCM' || !record.encrypted) {
      throw new Error(`Unsupported at-rest ciphertext record or invalid format`);
    }

    const iv = base64ToBytes(record.iv);
    const ciphertextBytes = base64ToBytes(record.ciphertext);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      this.dek,
      ciphertextBytes as unknown as BufferSource
    );

    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decryptedText) as T;
  }

  getKeyMetadata(): AtRestKeyMetadata | null {
    return this.keyMetadata;
  }

  lock(): void {
    this.dek = null;
    this.userId = null;
    this.keyMetadata = null;
  }
}

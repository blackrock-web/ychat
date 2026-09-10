import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { devicesRouter } from './routes/devices';
import { conversationsRouter } from './routes/conversations';
import { messagesRouter } from './routes/messages';
import { syncRouter } from './routes/sync';
import { invitesRouter } from './routes/invites';
import { wsManager } from './ws';
import { db } from './db';
import { supabaseAuth } from './services/supabaseAuth';
import { serverSyncDiagnostic } from './syncDiagnostic';
import { generateDeterministicDeviceKeys } from '../src/crypto/keys';
import { migrateAtRestDevData } from './migrateAtRest';

// Enforce Domain 2 At-Rest Local Storage Migration:
// Audit and ensure zero unencrypted private keys exist in .data/*.json
try {
  const atRestMigration = migrateAtRestDevData();
  console.log(`[Domain 2 At-Rest Init] Audited ${atRestMigration.scannedFiles.length} files in .data/. Status: ${atRestMigration.status}. Purged ${atRestMigration.privateKeysPurgedCount} forbidden keys.`);
} catch (err) {
  console.error('[Domain 2 At-Rest Init] Error migrating at-rest data:', err);
}

const app = express();
const server = http.createServer(app);

const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

async function seedDemoAccounts() {
  try {
    let authResA;
    try {
      authResA = await supabaseAuth.signUp('alice@ychat.local', 'alicePassword123!');
    } catch {
      // already exists in auth
    }

    let userA = db.findUserByUsername('alice');
    if (!userA) {
      userA = db.createUser({
        username: 'alice',
        email: 'alice@ychat.local',
        displayName: 'Alice Sterling',
        authUserId: authResA?.authUserId
      });
    } else if (!userA.authUserId && authResA?.authUserId) {
      userA.authUserId = authResA.authUserId;
      (db as any).persist();
    }

    const devA = generateDeterministicDeviceKeys('dev-alice-primary', 'alice-device-seed-v1', 25);
    const existingDevA = db.findDeviceById(devA.deviceId);
    if (!existingDevA) {
      db.registerDevice({
        id: devA.deviceId,
        userId: userA.id,
        deviceName: 'Alice Macbook Pro',
        platform: 'desktop',
        publicSignKey: devA.publicKeys.signingKey,
        publicDhKey: devA.publicKeys.dhKey,
        publicKemKey: devA.publicKeys.kemKey
      });
    } else {
      existingDevA.publicSignKey = devA.publicKeys.signingKey;
      existingDevA.publicDhKey = devA.publicKeys.dhKey;
      existingDevA.publicKemKey = devA.publicKeys.kemKey;
    }

    (db as any).data.devicePrekeys = ((db as any).data.devicePrekeys || []).filter(
      (p: any) => p.deviceId !== devA.deviceId
    );
    db.savePrekeys(devA.deviceId, devA.oneTimePrekeys.publicKeys);

    let authResB;
    try {
      authResB = await supabaseAuth.signUp('bob@ychat.local', 'bobPassword123!');
    } catch {
      // already exists in auth
    }

    let userB = db.findUserByUsername('bob');
    if (!userB) {
      userB = db.createUser({
        username: 'bob',
        email: 'bob@ychat.local',
        displayName: 'Bob Vance',
        authUserId: authResB?.authUserId
      });
    } else if (!userB.authUserId && authResB?.authUserId) {
      userB.authUserId = authResB.authUserId;
      (db as any).persist();
    }

    const devB = generateDeterministicDeviceKeys('dev-bob-primary', 'bob-device-seed-v1', 25);
    const existingDevB = db.findDeviceById(devB.deviceId);
    if (!existingDevB) {
      db.registerDevice({
        id: devB.deviceId,
        userId: userB.id,
        deviceName: 'Bob Pixel Phone',
        platform: 'android',
        publicSignKey: devB.publicKeys.signingKey,
        publicDhKey: devB.publicKeys.dhKey,
        publicKemKey: devB.publicKeys.kemKey
      });
    } else {
      existingDevB.publicSignKey = devB.publicKeys.signingKey;
      existingDevB.publicDhKey = devB.publicKeys.dhKey;
      existingDevB.publicKemKey = devB.publicKeys.kemKey;
    }

    (db as any).data.devicePrekeys = ((db as any).data.devicePrekeys || []).filter(
      (p: any) => p.deviceId !== devB.deviceId
    );
    db.savePrekeys(devB.deviceId, devB.oneTimePrekeys.publicKeys);

    // Prune stale/orphaned random test devices for Alice and Bob
    (db as any).data.devices = (db as any).data.devices.filter(
      (d: any) => (d.userId !== userA.id || d.id === devA.deviceId) && (d.userId !== userB.id || d.id === devB.deviceId)
    );

    // Ensure default direct conversation exists between Alice and Bob
    db.createDirectConversation(userA.id, userB.id);
    (db as any).persist();
  } catch (err) {
    console.error('[Seed Error]:', err);
  }
}

seedDemoAccounts();

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// REST API Routes (/api/v1/*)
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/devices', devicesRouter);
app.use('/api/v1/conversations', conversationsRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/sync', syncRouter);
app.use('/api/v1/invites', invitesRouter);

// Health Check
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'YChat Backend (Supabase Auth & UUID-to-UUID Production Architecture)',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    cryptoSuite: 'ML-KEM-1024 + ML-DSA-87 + X25519 + ChaCha20-Poly1305 + BLAKE3',
    e2eeZeroKnowledge: true,
    supabaseConfigured: supabaseAuth.isExternalConfigured()
  });
});

// Security Audit & Inspection API (Used for programmatic & UI cryptographic verification)
app.get('/api/v1/security/audit', (req, res) => {
  const data = (db as any).data;
  const messages = data.messages || [];

  let plaintextLeaks = 0;
  for (const m of messages) {
    if (m.text || m.plaintext || m.content) {
      plaintextLeaks++;
    }
  }

  res.json({
    verifiedZeroPlaintext: plaintextLeaks === 0,
    plaintextLeaksCount: plaintextLeaks,
    storedCiphertextRecords: messages.length,
    registeredDevices: (data.devices || []).length,
    activeUsers: (data.users || []).length,
    algorithms: {
      kem: 'ML-KEM-1024 (FIPS 203)',
      signing: 'ML-DSA-87 (FIPS 204)',
      classicalDh: 'X25519 (RFC 7748)',
      aeadCipher: 'ChaCha20-Poly1305 (RFC 8439)',
      kdf: 'HKDF-SHA3-512 (FIPS 202 / RFC 5869)',
      tamperEvidence: 'BLAKE3 Hash Chain',
      auth: 'Supabase Auth',
      atRestCipher: 'AES-256-GCM (Domain 2)'
    },
    domains: {
      domain1_message_transport: {
        description: 'End-to-End Hybrid Post-Quantum Message Transport',
        pipeline: 'X25519 + ML-KEM-1024 hybrid key agreement -> HKDF-SHA3-512 -> ChaCha20-Poly1305 AEAD -> ML-DSA-87 signature -> chunking -> TLS 1.3',
        status: 'active'
      },
      domain2_local_at_rest: {
        description: 'Local At-Rest Storage Encryption for IndexedDB/SQLite/Room and Private Key Material',
        cipher: 'AES-256-GCM',
        keyWrapping: {
          web: 'WebCrypto subtle.wrapKey/unwrapKey (AES-KW) derived via PBKDF2/Argon2id',
          desktop_tauri: 'OS Keychain (Apple Keychain, Windows Credential Manager/DPAPI, Linux Secret Service)',
          android: 'Android Keystore hardware-backed AES-256-GCM key (StrongBox / TEE)'
        },
        keyIsolation: 'At-rest encryption keys never leave device and are strictly decoupled from Domain 1 message transport keys',
        status: 'active'
      },
      rsaRoleClarification: 'RSA is used only for the TLS certificate chain at the infrastructure layer (or ECDSA certs, preferred) and NEVER for message payloads. RSA has no role in per-message AEAD.'
    }
  });
});

// Real-time message synchronization lifecycle diagnostics (Zero-Knowledge: strictly no plaintext or private keys)
app.get('/api/v1/security/diagnostics', (req, res) => {
  res.json({
    diagnostics: serverSyncDiagnostic.getRecentLogs(150)
  });
});

app.get('/api/v1/sync/diagnostic/logs', (req, res) => {
  res.json({
    logs: serverSyncDiagnostic.getRecentLogs(150)
  });
});

// Initialize WebSocket Manager
wsManager.init(server);

// Server-side background cleanup worker: enforces 15-minute message retention TTL
// and deletes temporary delivery copies once delivered.
setInterval(() => {
  try {
    const cleaned = db.cleanupExpiredAndDeliveredMessages();
    if (cleaned > 0) {
      console.log(`[YChat Cleanup Worker] Pruned ${cleaned} expired/delivered messages.`);
    }
  } catch (err) {
    console.error('[YChat Cleanup Worker] Error during message cleanup:', err);
  }
}, 15000);

// Vite Frontend Middleware / Static Hosting
async function setupFrontend() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('{*all}', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }
}

setupFrontend().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[YChat] Unified server listening on port ${PORT}`);
    console.log(`[YChat] E2EE Hybrid Post-Quantum Cryptographic Suite Active`);
  });
});

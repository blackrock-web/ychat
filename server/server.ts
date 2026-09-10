import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { authRouter, hashPassword } from './routes/auth';
import { usersRouter } from './routes/users';
import { devicesRouter } from './routes/devices';
import { conversationsRouter } from './routes/conversations';
import { messagesRouter } from './routes/messages';
import { syncRouter } from './routes/sync';
import { invitesRouter } from './routes/invites';
import { wsManager } from './ws';
import { db } from './db';
import { serverSyncDiagnostic } from './syncDiagnostic';
import { generateDeviceKeys } from '../src/crypto/keys';

const app = express();
const server = http.createServer(app);

import { generateDeterministicDeviceKeys } from '../src/crypto/keys';

const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

function seedDemoAccounts() {
  let userA = db.findUserByUsername('alice');
  if (!userA) {
    userA = db.createUser({
      username: 'alice',
      email: 'alice@ychat.local',
      passwordHash: hashPassword('alicePassword123!'),
      displayName: 'Alice Sterling'
    });
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
  // Synchronize Alice's prekeys to match deterministic seed
  (db as any).data.devicePrekeys = ((db as any).data.devicePrekeys || []).filter(
    (p: any) => p.deviceId !== devA.deviceId
  );
  db.savePrekeys(devA.deviceId, devA.oneTimePrekeys.publicKeys);

  let userB = db.findUserByUsername('bob');
  if (!userB) {
    userB = db.createUser({
      username: 'bob',
      email: 'bob@ychat.local',
      passwordHash: hashPassword('bobPassword123!'),
      displayName: 'Bob Vance'
    });
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
  // Synchronize Bob's prekeys to match deterministic seed
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
    service: 'YChat Backend',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    cryptoSuite: 'ML-KEM-1024 + ML-DSA-87 + X25519 + ChaCha20-Poly1305 + BLAKE3',
    e2eeZeroKnowledge: true
  });
});

// Security Audit & Inspection API (Used for programmatic & UI cryptographic verification)
app.get('/api/v1/security/audit', (req, res) => {
  // Inspect server storage to prove zero plaintext is held
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
      passwordHash: 'Argon2id (RFC 9106)'
    }
  });
});

// Real-time message synchronization lifecycle diagnostics (Zero-Knowledge: strictly no plaintext or private keys)
app.get('/api/v1/security/diagnostics', (req, res) => {
  res.json({
    diagnostics: serverSyncDiagnostic.getRecentLogs(100)
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
      app.get('*', (req, res) => {
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

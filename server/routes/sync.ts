import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';
import { PostgresRLSQueryLayer } from '../middleware/rls';
import { serverSyncDiagnostic } from '../syncDiagnostic';

export const syncRouter = express.Router();

// POST /api/v1/sync/push
// Bulk encrypted sync queue for multi-device clients
syncRouter.post('/push', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { messages } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const results = [];
  for (const item of messages) {
    // 1. Strict zero-knowledge plaintext rejection
    if (item.text || item.plaintext || item.content) {
      return res.status(400).json({ error: 'SECURITY VIOLATION: Plaintext rejected in sync batch' });
    }

    // 2. Strict conversation participant authorization via RLS
    if (!PostgresRLSQueryLayer.isParticipant(userId, item.conversationId)) {
      return res.status(403).json({
        error: `Forbidden: User is not authorized to submit messages to conversation ${item.conversationId} under RLS policy`
      });
    }

    // 3. Strict device ownership authorization
    if (!db.isDeviceOwnedByUser(item.senderDeviceId, userId)) {
      return res.status(403).json({
        error: `Forbidden: Device ${item.senderDeviceId} does not belong to authenticated user or is revoked`
      });
    }

    // 4. Strict recipient device authorization
    const recipientDevice = db.findDeviceById(item.recipientDeviceId);
    if (!recipientDevice || !PostgresRLSQueryLayer.isParticipant(recipientDevice.userId, item.conversationId)) {
      return res.status(403).json({
        error: `Forbidden: Recipient device owner is not an authorized participant in conversation ${item.conversationId}`
      });
    }

    const record = db.storeMessage({
      conversationId: item.conversationId,
      senderDeviceId: item.senderDeviceId,
      recipientDeviceId: item.recipientDeviceId,
      clientMessageId: item.clientMessageId,
      ciphertext: item.ciphertext,
      nonce: item.nonce,
      signature: item.signature,
      encryptionVersion: item.encryptionVersion || 'hybrid-x25519-mlkem1024-v1',
      sequence: item.sequence || 1,
      handshakePacket: item.handshakePacket,
      expiresAt: item.expiresAt,
      chunkIndex: item.chunkIndex,
      chunkCount: item.chunkCount
    });

    wsManager.sendEnvelopeToDevice(item.recipientDeviceId, {
      ...item,
      sequence: record.sequence,
      serverSequence: record.serverSequence,
      handshakePacket: record.handshakePacket,
      expiresAt: record.expiresAt
    }, record.id, record.serverSequence);

    results.push({
      clientMessageId: record.clientMessageId,
      serverSequence: record.serverSequence,
      status: 'synced'
    });
  }

  return res.status(200).json({ synced: results });
});

// GET /api/v1/sync/pull?deviceId=...&sinceSequence=...
// Multi-device sync pull: STRICTLY restricted to authorized devices owned by the caller
syncRouter.get('/pull', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const deviceId = req.query.deviceId as string;
  const sinceSeq = parseInt(req.query.sinceSequence as string || '0', 10);

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId parameter required' });
  }

  // Strict device authorization & RLS verification
  try {
    const pending = PostgresRLSQueryLayer.getAuthorizedUndelivered(userId, deviceId, sinceSeq);

    for (const p of pending) {
      serverSyncDiagnostic.log('LOGIN_SYNC_PULL', {
        clientMessageId: p.clientMessageId,
        conversationId: p.conversationId,
        messageId: p.id,
        senderDeviceId: p.senderDeviceId,
        recipientDeviceId: p.recipientDeviceId,
        serverSequence: p.serverSequence,
        details: {
          requestedByUserId: userId,
          sinceSequence: sinceSeq
        }
      });
    }

    return res.status(200).json({
      deviceId,
      messages: pending.map(p => ({
        id: p.id,
        clientMessageId: p.clientMessageId,
        conversationId: p.conversationId,
        senderDeviceId: p.senderDeviceId,
        recipientDeviceId: p.recipientDeviceId,
        ciphertext: p.ciphertext,
        nonce: p.nonce,
        signature: p.signature,
        encryptionVersion: p.encryptionVersion,
        sequence: p.sequence,
        serverSequence: p.serverSequence,
        handshakePacket: p.handshakePacket,
        expiresAt: p.expiresAt,
        chunkIndex: p.chunkIndex,
        chunkCount: p.chunkCount,
        createdAt: p.createdAt
      }))
    });
  } catch (err: any) {
    return res.status(403).json({ error: err.message || 'RLS authorization error' });
  }
});


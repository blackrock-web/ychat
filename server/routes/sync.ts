import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';
import { serverSyncDiagnostic } from '../syncDiagnostic';

export const syncRouter = express.Router();

// POST /api/v1/sync/push
// Bulk encrypted sync queue for messages.
// Explicitly validates the authenticated user's participation in each conversation
// by querying the database for every single item in the sync batch!
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

    if (!item.conversationId || !item.ciphertext || !item.clientMessageId) {
      return res.status(400).json({ error: 'Invalid envelope in sync batch' });
    }

    if (!item.signature || typeof item.signature !== 'string' || item.signature.length < 1000) {
      return res.status(400).json({ error: 'SECURITY VIOLATION: Invalid ML-DSA-87 signature in sync batch' });
    }

    // 2. Strict conversation participant authorization: Query database for every message
    serverSyncDiagnostic.log('DB_MEMBERSHIP_CHECK', {
      clientMessageId: item.clientMessageId,
      conversationId: item.conversationId,
      senderUserId: userId,
      details: { table: 'conversation_members', endpoint: '/api/v1/sync/push' }
    });

    const isMember = db.isUserMemberOfConversation(userId, item.conversationId);
    if (!isMember) {
      serverSyncDiagnostic.log('DB_MEMBERSHIP_CHECK', {
        clientMessageId: item.clientMessageId,
        conversationId: item.conversationId,
        senderUserId: userId,
        details: { checkResult: 'DENIED', reason: 'User not in conversation_members' }
      });
      return res.status(403).json({
        error: `Forbidden: User is not authorized to submit messages to conversation ${item.conversationId} under RLS policy`
      });
    }

    serverSyncDiagnostic.log('DB_MEMBERSHIP_VERIFIED', {
      clientMessageId: item.clientMessageId,
      conversationId: item.conversationId,
      senderUserId: userId,
      details: { table: 'conversation_members', verifiedParticipantUserId: userId, checkResult: 'SUCCESS' }
    });

    // 3. Resolve recipient MyChat UUID
    let recipientUserId: string | undefined = item.recipientUserId || item.recipientUuid;
    if (!recipientUserId && item.recipientDeviceId) {
      const recipientDev = db.findDeviceById(item.recipientDeviceId);
      if (recipientDev) recipientUserId = recipientDev.userId;
    }
    if (!recipientUserId) {
      const members = db.getConversationMembers(item.conversationId);
      recipientUserId = members.find(m => m !== userId);
    }

    if (!recipientUserId || !db.isUserMemberOfConversation(recipientUserId, item.conversationId)) {
      return res.status(403).json({
        error: `Forbidden: Recipient is not an authorized participant in conversation ${item.conversationId}`
      });
    }

    const record = db.storeMessage({
      conversationId: item.conversationId,
      senderUserId: userId,
      recipientUserId,
      senderDeviceId: item.senderDeviceId || `dev-${userId.slice(0, 8)}`,
      recipientDeviceId: item.recipientDeviceId || `dev-${recipientUserId.slice(0, 8)}`,
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

    // UUID-to-UUID real-time forwarding to recipient if connected
    wsManager.sendEnvelopeToUser(recipientUserId, {
      ...item,
      senderUserId: userId,
      recipientUserId,
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

// GET /api/v1/sync/pull
// Recipient Login & Sync Retrieval Endpoint
// Tracks the message lifecycle from sender dispatch to backend storage and final retrieval,
// specifically verifying that the database conversation membership check succeeds when the recipient logs in.
syncRouter.get('/pull', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const recipientUserId = req.user!.userId;
  const deviceId = req.query.deviceId as string;
  const sinceSeq = parseInt((req.query.sinceSequence as string) || '0', 10);

  // 1. Log recipient login sync initiation
  serverSyncDiagnostic.log('RECIPIENT_LOGIN_SYNC_PULL', {
    clientMessageId: 'sync-pull-init',
    conversationId: 'all',
    recipientUserId,
    recipientDeviceId: deviceId,
    details: {
      event: 'RECIPIENT_LOGGED_IN_SYNC_REQUEST',
      sinceSequence: sinceSeq
    }
  });

  try {
    // 2. Query database for pending undelivered messages addressed to recipient
    const pending = deviceId
      ? db.getUndeliveredForDevice(deviceId, sinceSeq, recipientUserId)
      : db.getUndeliveredForUser(recipientUserId, sinceSeq);

    const authorizedMessages = [];

    // 3. For EVERY message, execute database conversation membership check for the recipient
    for (const p of pending) {
      serverSyncDiagnostic.log('RECIPIENT_DB_MEMBERSHIP_CHECK', {
        clientMessageId: p.clientMessageId,
        conversationId: p.conversationId,
        messageId: p.id,
        recipientUserId,
        senderUserId: p.senderUserId,
        serverSequence: p.serverSequence,
        details: {
          check: 'database_query',
          table: 'conversation_members',
          evaluatingUser: recipientUserId
        }
      });

      const isParticipant = db.isUserMemberOfConversation(recipientUserId, p.conversationId);

      if (isParticipant) {
        // Specifically verifying that the database conversation membership check succeeds when the recipient logs in!
        serverSyncDiagnostic.log('RECIPIENT_DB_MEMBERSHIP_VERIFIED', {
          clientMessageId: p.clientMessageId,
          conversationId: p.conversationId,
          messageId: p.id,
          recipientUserId,
          senderUserId: p.senderUserId,
          serverSequence: p.serverSequence,
          details: {
            checkResult: 'SUCCESS',
            verifiedRecipientUserId: recipientUserId,
            table: 'conversation_members',
            status: 'authorized_for_retrieval',
            verifiedAt: new Date().toISOString()
          }
        });

        authorizedMessages.push(p);
      } else {
        serverSyncDiagnostic.log('RECIPIENT_DB_MEMBERSHIP_CHECK', {
          clientMessageId: p.clientMessageId,
          conversationId: p.conversationId,
          messageId: p.id,
          recipientUserId,
          senderUserId: p.senderUserId,
          serverSequence: p.serverSequence,
          details: {
            checkResult: 'DENIED',
            reason: 'Recipient not recorded in conversation_members'
          }
        });
      }
    }

    return res.status(200).json({
      recipientUserId,
      deviceId: deviceId || `dev-${recipientUserId.slice(0, 8)}`,
      messages: authorizedMessages.map(p => ({
        id: p.id,
        clientMessageId: p.clientMessageId,
        conversationId: p.conversationId,
        senderUserId: p.senderUserId,
        recipientUserId: p.recipientUserId,
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

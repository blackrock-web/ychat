import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';
import { validateConversationParticipation, validateMessageAccess, PostgresRLSQueryLayer } from '../middleware/rls';
import { serverSyncDiagnostic } from '../syncDiagnostic';

export const messagesRouter = express.Router();

// POST /api/v1/messages
// Explicitly validates the authenticated user's participation in the requested conversation
// by querying the database for every message request via validateConversationParticipation middleware.
messagesRouter.post(
  '/',
  requireAuth,
  validateConversationParticipation('body', 'conversationId'),
  (req: AuthenticatedRequest, res: Response) => {
    // 1. Authoritative sender UUID: Derived strictly from verified session token, NEVER trusted from client!
    const senderUserId = req.user!.userId;

    serverSyncDiagnostic.log('INGESTION', {
      clientMessageId: req.body?.clientMessageId || 'unknown',
      conversationId: req.body?.conversationId || 'unknown',
      senderUserId,
      recipientUserId: req.body?.recipientUserId || req.body?.recipientUuid,
      senderDeviceId: req.body?.senderDeviceId,
      recipientDeviceId: req.body?.recipientDeviceId,
      details: { transport: 'rest' }
    });

    // 2. CRITICAL ZERO-KNOWLEDGE SECURITY ENFORCEMENT:
    // Server must NEVER accept or process plaintext. Drop immediately.
    if (req.body.text || req.body.plaintext || req.body.content || req.body.message) {
      return res.status(400).json({
        error: 'SECURITY VIOLATION: Plaintext is strictly forbidden! All messages must be transmitted as encrypted ciphertext envelopes.'
      });
    }

    const {
      clientMessageId,
      conversationId,
      senderDeviceId,
      recipientDeviceId,
      ciphertext,
      nonce,
      signature,
      encryptionVersion,
      sequence,
      handshakePacket,
      expiresAt,
      chunkIndex,
      chunkCount,
      allowOfflineStorage
    } = req.body;

    if (!clientMessageId || !conversationId || !ciphertext || !nonce || !signature) {
      return res.status(400).json({
        error: 'Missing required envelope parameters: clientMessageId, conversationId, ciphertext, nonce, signature'
      });
    }

    if (typeof signature !== 'string' || signature.length < 1000) {
      return res.status(400).json({
        error: 'SECURITY VIOLATION: Invalid ML-DSA-87 signature. Signature must meet NIST FIPS 204 specification.'
      });
    }

    // 3. Resolve and validate recipient UUID
    let recipientUserId: string | undefined = req.body.recipientUserId || req.body.recipientUuid;
    if (!recipientUserId && recipientDeviceId) {
      const recipientDevice = db.findDeviceById(recipientDeviceId);
      if (recipientDevice) {
        recipientUserId = recipientDevice.userId;
      }
    }
    if (!recipientUserId) {
      // Find the conversation partner
      const members = db.getConversationMembers(conversationId);
      recipientUserId = members.find(m => m !== senderUserId);
    }

    if (!recipientUserId) {
      return res.status(400).json({ error: 'Recipient UUID could not be resolved for conversation' });
    }

    // Verify recipient UUID belongs to a registered MyChat user
    const recipientUser = db.findUserById(recipientUserId);
    if (!recipientUser) {
      return res.status(404).json({ error: 'Recipient user does not exist' });
    }

    // Explicitly verify recipient is an authorized member of conversation_members
    if (!db.isUserMemberOfConversation(recipientUserId, conversationId)) {
      return res.status(403).json({
        error: 'Forbidden: Recipient is not an authorized participant in conversation_members'
      });
    }

    // 4. OFFLINE RECIPIENT POLICY ENFORCEMENT (15-Minute TTL)
    const isRecipientOnline = wsManager.isUserOnline(recipientUserId);
    if (!isRecipientOnline && allowOfflineStorage !== true && allowOfflineStorage !== 'true') {
      serverSyncDiagnostic.log('OFFLINE_HOLD_15MIN', {
        clientMessageId,
        conversationId,
        senderUserId,
        recipientUserId,
        details: { status: 'rejected_offline_unauthorized' }
      });
      return res.status(409).json({
        error: `${recipientUser.displayName || recipientUser.username} is currently offline. Store this encrypted message for up to 15 minutes?`,
        requiresOfflineConfirmation: true,
        recipientUuid: recipientUserId,
        recipientName: recipientUser.displayName || recipientUser.username
      });
    }

    // Calculate 15-minute maximum TTL for temporary delivery queue
    const now = new Date();
    const computedExpiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    // 5. Store ciphertext envelope with authoritative sender_uuid and recipient_uuid (idempotent on clientMessageId)
    const record = db.storeMessage({
      conversationId,
      senderUserId,
      recipientUserId,
      senderDeviceId: senderDeviceId || `dev-${senderUserId.slice(0, 8)}`,
      recipientDeviceId: recipientDeviceId || `dev-${recipientUserId.slice(0, 8)}`,
      clientMessageId,
      ciphertext,
      nonce,
      signature,
      encryptionVersion: encryptionVersion || 'hybrid-x25519-mlkem1024-v1',
      sequence: sequence || 1,
      handshakePacket,
      expiresAt: computedExpiresAt,
      chunkIndex,
      chunkCount
    });

    if (!isRecipientOnline) {
      serverSyncDiagnostic.log('OFFLINE_HOLD_15MIN', {
        clientMessageId,
        conversationId,
        messageId: record.id,
        senderUserId,
        recipientUserId,
        details: { status: 'stored_temporary_queue_15min_ttl', expiresAt: computedExpiresAt }
      });
    }

    // 6. Relay via WebSocket to recipient UUID's active connection if online
    wsManager.sendEnvelopeToUser(recipientUserId, {
      clientMessageId,
      conversationId,
      senderUserId,
      recipientUserId,
      senderDeviceId: record.senderDeviceId,
      recipientDeviceId: record.recipientDeviceId,
      ciphertext,
      nonce,
      signature,
      encryptionVersion: record.encryptionVersion,
      sequence: record.sequence,
      serverSequence: record.serverSequence,
      handshakePacket: record.handshakePacket,
      expiresAt: record.expiresAt,
      chunkIndex: record.chunkIndex,
      chunkCount: record.chunkCount
    }, record.id, record.serverSequence);

    return res.status(201).json({
      messageId: record.id,
      clientMessageId: record.clientMessageId,
      serverSequence: record.serverSequence,
      createdAt: record.createdAt,
      status: record.deliveredAt ? 'delivered' : (isRecipientOnline ? 'dispatched' : 'stored_offline_15m_ttl')
    });
  }
);

// GET /api/v1/messages/:messageId
// Direct message retrieval guarded by validateMessageAccess
messagesRouter.get('/:messageId', requireAuth, validateMessageAccess('messageId'), (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const messageId = String(req.params.messageId);

  const msg = PostgresRLSQueryLayer.getAuthorizedMessageById(userId, messageId);
  if (!msg) {
    return res.status(404).json({ error: 'Message not found' });
  }

  return res.status(200).json({
    id: msg.id,
    clientMessageId: msg.clientMessageId,
    conversationId: msg.conversationId,
    senderUserId: msg.senderUserId,
    recipientUserId: msg.recipientUserId,
    senderDeviceId: msg.senderDeviceId,
    recipientDeviceId: msg.recipientDeviceId,
    ciphertext: msg.ciphertext,
    nonce: msg.nonce,
    signature: msg.signature,
    encryptionVersion: msg.encryptionVersion,
    serverSequence: msg.serverSequence,
    createdAt: msg.createdAt,
    deliveredAt: msg.deliveredAt,
    readAt: msg.readAt
  });
});

// POST /api/v1/messages/:messageId/receipt
messagesRouter.post('/:messageId/receipt', requireAuth, validateMessageAccess('messageId'), (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const messageId = String(req.params.messageId);
  const { clientMessageId, status } = req.body;

  const targetMsg = db.getMessageByIdOrClientId(messageId) || (clientMessageId ? db.getMessageByIdOrClientId(clientMessageId) : undefined);
  if (!targetMsg) {
    return res.status(404).json({ error: 'Message not found' });
  }

  if (status === 'delivered') {
    db.markDelivered(messageId);
  } else if (status === 'read') {
    db.markRead(messageId);
  }

  // Notify ONLY the participants in this specific conversation
  wsManager.sendReceiptToConversation(targetMsg.conversationId, String(clientMessageId || messageId), String(status || 'delivered'));

  return res.status(200).json({ status: 'receipt_recorded' });
});

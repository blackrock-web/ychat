import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';
import { PostgresRLSQueryLayer } from '../middleware/rls';
import { serverSyncDiagnostic } from '../syncDiagnostic';

export const messagesRouter = express.Router();

// POST /api/v1/messages
messagesRouter.post('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;

  serverSyncDiagnostic.log('INGESTION', {
    clientMessageId: req.body?.clientMessageId || 'unknown',
    conversationId: req.body?.conversationId || 'unknown',
    senderDeviceId: req.body?.senderDeviceId,
    recipientDeviceId: req.body?.recipientDeviceId,
    details: { transport: 'rest' }
  });

  // 1. CRITICAL ZERO-KNOWLEDGE SECURITY ENFORCEMENT:
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
    chunkCount
  } = req.body;

  if (!clientMessageId || !conversationId || !senderDeviceId || !recipientDeviceId || !ciphertext || !nonce || !signature) {
    return res.status(400).json({
      error: 'Missing required envelope parameters: clientMessageId, conversationId, senderDeviceId, recipientDeviceId, ciphertext, nonce, signature'
    });
  }

  // 2. CONVERSATION EXISTENCE & RLS AUTHORIZATION CHECK
  const conv = db.getConversationById(conversationId);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (!PostgresRLSQueryLayer.isParticipant(userId, conversationId)) {
    return res.status(403).json({
      error: 'Forbidden: Row Level Security (RLS) check failed. Authenticated user is not an authorized participant in conversation_members.'
    });
  }

  // 3. SENDER DEVICE OWNERSHIP CHECK
  if (!db.isDeviceOwnedByUser(senderDeviceId, userId)) {
    return res.status(403).json({
      error: 'Forbidden: Sender device does not belong to authenticated user or has been revoked.'
    });
  }

  // 4. RECIPIENT DEVICE AUTHORIZATION CHECK
  const recipientDevice = db.findDeviceById(recipientDeviceId);
  if (!recipientDevice) {
    return res.status(404).json({ error: 'Recipient device not found or revoked' });
  }

  if (!PostgresRLSQueryLayer.isParticipant(recipientDevice.userId, conversationId)) {
    return res.status(403).json({
      error: 'Forbidden: Recipient device owner is not a member of this conversation.'
    });
  }

  // 5. Store ciphertext envelope with server sequence (idempotent on clientMessageId)
  const record = db.storeMessage({
    conversationId,
    senderDeviceId,
    recipientDeviceId,
    clientMessageId,
    ciphertext,
    nonce,
    signature,
    encryptionVersion: encryptionVersion || 'hybrid-x25519-mlkem1024-v1',
    sequence: sequence || 1,
    handshakePacket,
    expiresAt,
    chunkIndex,
    chunkCount
  });

  // 6. Relay via WebSocket if recipient is actively connected
  wsManager.sendEnvelopeToDevice(recipientDeviceId, {
    clientMessageId,
    conversationId,
    senderDeviceId,
    recipientDeviceId,
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
    status: record.deliveredAt ? 'delivered' : 'stored'
  });
});

// GET /api/v1/messages/:messageId
// Direct message retrieval guarded by PostgresRLSQueryLayer
messagesRouter.get('/:messageId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const messageId = String(req.params.messageId);

  try {
    const msg = PostgresRLSQueryLayer.getAuthorizedMessageById(userId, messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }
    return res.status(200).json({
      id: msg.id,
      clientMessageId: msg.clientMessageId,
      conversationId: msg.conversationId,
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
  } catch (err: any) {
    return res.status(403).json({ error: err.message || 'Row Level Security violation' });
  }
});

// POST /api/v1/messages/:messageId/receipt
messagesRouter.post('/:messageId/receipt', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const messageId = String(req.params.messageId);
  const { clientMessageId, status, conversationId } = req.body;

  // Strict participant verification: NEVER trust unverified conversationId or accept cross-user receipts
  const targetMsg = db.getMessageByIdOrClientId(messageId) || (clientMessageId ? db.getMessageByIdOrClientId(clientMessageId) : undefined);
  const targetConvId = conversationId || targetMsg?.conversationId;

  if (!targetConvId || !PostgresRLSQueryLayer.isParticipant(userId, targetConvId)) {
    return res.status(403).json({ error: 'Forbidden: Authenticated user is not an active participant in this conversation_members' });
  }

  if (status === 'delivered') {
    db.markDelivered(messageId);
  } else if (status === 'read') {
    db.markRead(messageId);
  }

  // Notify ONLY the participants in this specific conversation
  wsManager.sendReceiptToConversation(targetConvId, String(clientMessageId || messageId), String(status || 'delivered'));

  return res.status(200).json({ status: 'receipt_recorded' });
});


import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { PostgresRLSQueryLayer, requireConversationMember } from '../middleware/rls';

export const conversationsRouter = express.Router();

// POST /api/v1/conversations
// Create or retrieve direct conversation with a recipient
conversationsRouter.post('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { recipientUuid } = req.body;

  if (!recipientUuid || typeof recipientUuid !== 'string') {
    return res.status(400).json({ error: 'recipientUuid is required' });
  }

  if (recipientUuid === userId) {
    return res.status(400).json({ error: 'Cannot create conversation with yourself' });
  }

  const recipient = db.findUserById(recipientUuid);
  if (!recipient) {
    return res.status(404).json({ error: 'Recipient user not found' });
  }

  const conv = db.createDirectConversation(userId, recipientUuid);

  return res.status(200).json({
    conversationId: conv.id,
    type: conv.conversationType,
    members: [
      { uuid: userId, username: req.user!.username },
      { uuid: recipient.id, username: recipient.username, displayName: recipient.displayName }
    ],
    createdAt: conv.createdAt
  });
});

// GET /api/v1/conversations
// Strict RLS query: Get only conversations where authenticated user is in conversation_members
conversationsRouter.get('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const list = PostgresRLSQueryLayer.getAuthorizedConversations(userId);

  return res.status(200).json({
    conversations: list
  });
});

// GET /api/v1/conversations/:id
// Strict RLS check: verify conversation_members participation via middleware
conversationsRouter.get('/:id', requireAuth, requireConversationMember('id'), (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const convId = String(req.params.id);

  const conv = PostgresRLSQueryLayer.getAuthorizedConversationById(userId, convId, true);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const memberIds = db.getConversationMembers(convId);
  const members = memberIds.map(mId => {
    const u = db.findUserById(mId);
    return {
      uuid: mId,
      username: u?.username || 'unknown',
      displayName: u?.displayName || 'Unknown'
    };
  });

  return res.status(200).json({
    conversationId: conv.id,
    type: conv.conversationType,
    members,
    createdAt: conv.createdAt
  });
});

// GET /api/v1/conversations/:id/messages
// Strict RLS verification: verifies conversation_members participation before returning messages
conversationsRouter.get('/:id/messages', requireAuth, requireConversationMember('id'), (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const convId = String(req.params.id);

  const messages = PostgresRLSQueryLayer.getAuthorizedMessages(userId, convId);

  return res.status(200).json({
    conversationId: convId,
    messages: messages.map(m => ({
      id: m.id,
      clientMessageId: m.clientMessageId,
      senderDeviceId: m.senderDeviceId,
      recipientDeviceId: m.recipientDeviceId,
      ciphertext: m.ciphertext,
      nonce: m.nonce,
      signature: m.signature,
      encryptionVersion: m.encryptionVersion,
      sequence: m.sequence,
      serverSequence: m.serverSequence,
      handshakePacket: m.handshakePacket,
      expiresAt: m.expiresAt,
      chunkIndex: m.chunkIndex,
      chunkCount: m.chunkCount,
      createdAt: m.createdAt,
      deliveredAt: m.deliveredAt,
      readAt: m.readAt
    }))
  });
});


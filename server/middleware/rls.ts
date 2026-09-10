import { Request, Response, NextFunction } from 'express';
import { db, DBConversation, DBMsgRecord } from '../db';
import { AuthenticatedRequest } from '../routes/auth';

/**
 * Row Level Security (RLS) & Query Authorization Layer
 *
 * Enforces strict participant-level verification for every conversation query
 * and message retrieval query across PostgreSQL-compatible models and data services.
 * Ensures users can ONLY access data for which they are explicitly recorded in `conversation_members`.
 */

export class RlsAuthorizationError extends Error {
  public readonly statusCode: number = 403;
  constructor(message: string = 'Forbidden: Row Level Security (RLS) violation. Caller is not an authorized conversation member.') {
    super(message);
    this.name = 'RlsAuthorizationError';
  }
}

/**
 * PostgresRLSQueryLayer provides query methods guaranteed to enforce
 * conversation_members participation on every query execution.
 */
export class PostgresRLSQueryLayer {
  /**
   * Verifies explicit participant membership in conversation_members.
   */
  static isParticipant(userId: string, conversationId: string): boolean {
    if (!userId || !conversationId) return false;
    return db.isUserMemberOfConversation(userId, conversationId);
  }

  /**
   * Retrieves conversations for a user, guaranteeing RLS isolation:
   * Only returns rows where userId exists in conversation_members.
   */
  static getAuthorizedConversations(userId: string) {
    if (!userId) return [];
    return db.getUserConversations(userId);
  }

  /**
   * Retrieves a single conversation by ID with strict RLS membership check.
   * If caller is not in conversation_members, throws RlsAuthorizationError or returns null.
   */
  static getAuthorizedConversationById(userId: string, conversationId: string, throwOnUnauthorized: boolean = false): DBConversation | null {
    if (!this.isParticipant(userId, conversationId)) {
      if (throwOnUnauthorized) {
        throw new RlsAuthorizationError(
          `User ${userId} is not authorized to access conversation ${conversationId} under RLS policy.`
        );
      }
      return null;
    }
    const conv = db.getConversationById(conversationId);
    return conv || null;
  }

  /**
   * Retrieves ciphertext messages with strict RLS participation verification.
   * Evaluates: conversation_members.user_id = $userId AND conversation_members.conversation_id = $conversationId.
   */
  static getAuthorizedMessages(userId: string, conversationId: string): DBMsgRecord[] {
    if (!this.isParticipant(userId, conversationId)) {
      throw new RlsAuthorizationError(
        `RLS Security Violation: User ${userId} is not a member of conversation ${conversationId}. Message retrieval blocked.`
      );
    }
    return db.getConversationMessages(conversationId, userId);
  }

  /**
   * Retrieves a single message by ID or clientMessageId with RLS authorization.
   * Checks that the authenticated user is an active participant in the message's conversation.
   */
  static getAuthorizedMessageById(userId: string, messageId: string): DBMsgRecord | null {
    const msg = db.getMessageByIdOrClientId(messageId);
    if (!msg) return null;

    if (!this.isParticipant(userId, msg.conversationId)) {
      throw new RlsAuthorizationError(
        `RLS Security Violation: User ${userId} is not authorized to read message ${messageId}.`
      );
    }
    return msg;
  }

  /**
   * Retrieves undelivered messages for a device with double RLS verification:
   * 1. Device must belong to userId.
   * 2. userId must be in conversation_members for the message.
   */
  static getAuthorizedUndelivered(userId: string, deviceId: string, sinceSequence: number = 0): DBMsgRecord[] {
    if (!db.isDeviceOwnedByUser(deviceId, userId)) {
      throw new RlsAuthorizationError(
        `RLS Security Violation: Device ${deviceId} is not registered to user ${userId}.`
      );
    }
    return db.getUndeliveredForDevice(deviceId, sinceSequence, userId);
  }
}

/**
 * Express Middleware:
 * Validates that the authenticated user is an active member in conversation_members
 * for the conversation specified in req.params (e.g. :id or :conversationId) or req.body.conversationId.
 */
export function requireConversationMember(paramKey: string = 'id') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required for conversation access' });
    }

    const convId = req.params[paramKey] || req.body?.conversationId || req.query?.conversationId;
    if (!convId || typeof convId !== 'string') {
      return res.status(400).json({ error: 'Conversation identifier is required' });
    }

    const conv = db.getConversationById(convId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const isMember = PostgresRLSQueryLayer.isParticipant(userId, convId);
    if (!isMember) {
      return res.status(403).json({
        error: 'Forbidden: Row Level Security (RLS) check failed. Authenticated user is not an authorized participant in conversation_members.'
      });
    }

    next();
  };
}

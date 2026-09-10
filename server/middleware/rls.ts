import { Response, NextFunction } from 'express';
import { db, DBConversation, DBMsgRecord } from '../db';
import { AuthenticatedRequest } from '../routes/auth';
import { serverSyncDiagnostic } from '../syncDiagnostic';

/**
 * Row Level Security (RLS) & Query Authorization Middleware Layer
 *
 * Explicitly validates the authenticated user's participation in the requested conversation
 * by querying the database for EVERY message and sync request.
 * Ensures users can ONLY access conversations and messages where they are explicitly
 * recorded in `conversation_members`.
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
   * Verifies explicit participant membership in conversation_members by querying the database.
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
   * Retrieves undelivered messages for a device/user with double RLS verification:
   * 1. Device must belong to userId.
   * 2. userId must be in conversation_members for each message.
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
 * Express Middleware: validateConversationParticipation
 *
 * Explicitly validates the authenticated user's participation in the requested conversation
 * by querying the database for every message and sync request.
 */
export function validateConversationParticipation(
  source: 'body' | 'params' | 'query' = 'body',
  paramName: string = 'conversationId'
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required for conversation access' });
    }

    let convId: string | undefined;
    if (source === 'body') {
      convId = req.body?.[paramName] || req.body?.conversationId;
    } else if (source === 'params') {
      convId = (req.params?.[paramName] as string) || (req.params?.id as string) || (req.params?.conversationId as string);
    } else if (source === 'query') {
      convId = (req.query?.[paramName] as string) || (req.query?.conversationId as string);
    }

    // Fallback search across all request containers
    if (!convId) {
      convId = req.body?.conversationId || (req.params?.conversationId as string) || (req.params?.id as string) || (req.query?.conversationId as string);
    }

    if (!convId || typeof convId !== 'string') {
      return res.status(400).json({ error: 'Conversation identifier is required' });
    }

    // 1. Verify conversation exists in database
    const conv = db.getConversationById(convId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // 2. Query database conversation_members table for authenticated user
    serverSyncDiagnostic.log('DB_MEMBERSHIP_CHECK', {
      clientMessageId: req.body?.clientMessageId || 'auth-check',
      conversationId: convId,
      senderUserId: userId,
      details: {
        table: 'conversation_members',
        queryingUserId: userId,
        endpoint: req.originalUrl
      }
    });

    const isMember = db.isUserMemberOfConversation(userId, convId);
    if (!isMember) {
      serverSyncDiagnostic.log('DB_MEMBERSHIP_CHECK', {
        clientMessageId: req.body?.clientMessageId || 'auth-fail',
        conversationId: convId,
        senderUserId: userId,
        details: {
          table: 'conversation_members',
          queryingUserId: userId,
          checkResult: 'DENIED',
          reason: 'User not in conversation_members'
        }
      });

      return res.status(403).json({
        error: 'Forbidden: Row Level Security (RLS) check failed. Authenticated user is not an authorized participant in conversation_members.'
      });
    }

    // 3. Log verified membership
    serverSyncDiagnostic.log('DB_MEMBERSHIP_VERIFIED', {
      clientMessageId: req.body?.clientMessageId || 'auth-verified',
      conversationId: convId,
      senderUserId: userId,
      details: {
        table: 'conversation_members',
        verifiedParticipantUserId: userId,
        checkResult: 'SUCCESS'
      }
    });

    next();
  };
}

/**
 * Middleware: validateMessageAccess
 * Explicitly validates conversation membership for individual message queries and receipts
 */
export function validateMessageAccess(paramName: string = 'messageId') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const messageId = req.params[paramName] || req.body?.messageId || req.body?.clientMessageId;
    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'Message identifier required' });
    }

    const msg = db.getMessageByIdOrClientId(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Query database conversation_members for the message's conversation
    const isMember = db.isUserMemberOfConversation(userId, msg.conversationId);
    if (!isMember) {
      serverSyncDiagnostic.log('DB_MEMBERSHIP_CHECK', {
        clientMessageId: msg.clientMessageId,
        conversationId: msg.conversationId,
        messageId: msg.id,
        senderUserId: userId,
        details: {
          checkResult: 'DENIED',
          table: 'conversation_members',
          reason: 'User not member of message conversation'
        }
      });
      return res.status(403).json({
        error: 'Forbidden: Row Level Security (RLS) check failed. User is not an authorized member of this message conversation.'
      });
    }

    serverSyncDiagnostic.log('DB_MEMBERSHIP_VERIFIED', {
      clientMessageId: msg.clientMessageId,
      conversationId: msg.conversationId,
      messageId: msg.id,
      senderUserId: userId,
      details: {
        table: 'conversation_members',
        verifiedParticipantUserId: userId,
        checkResult: 'SUCCESS'
      }
    });

    next();
  };
}

/**
 * Convenience alias for conversation routes
 */
export const requireConversationMember = (paramKey: string = 'id') => validateConversationParticipation('params', paramKey);

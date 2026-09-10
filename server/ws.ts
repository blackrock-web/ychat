import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { db } from './db';
import { serverSyncDiagnostic } from './syncDiagnostic';

const JWT_SECRET = process.env.JWT_SECRET || 'ychat_supabase_default_secret_production_ready';

interface ClientSocket {
  ws: WebSocket;
  userId: string; // MyChat permanent User UUID
  deviceId: string;
  isAlive: boolean;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientSocket>();
  // In-memory routing structure: authenticated_user_uuid -> authorized active connection
  private userSockets = new Map<string, WebSocket>();

  init(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const deviceId = url.searchParams.get('deviceId') || `dev-web`;

        if (!token) {
          ws.close(4001, 'Unauthorized: token required');
          return;
        }

        // 1. Verify token signature and expiration
        const payload = jwt.verify(token, JWT_SECRET) as { sub: string; username?: string };
        
        // Resolve MyChat permanent User UUID
        let user = db.findUserById(payload.sub);
        if (!user) {
          user = db.findUserByAuthUserId(payload.sub);
        }
        if (!user && payload.username) {
          user = db.findUserByUsername(payload.username);
        }

        if (!user) {
          ws.close(4003, 'Forbidden: User not found');
          return;
        }

        const userId = user.id; // Authoritative MyChat User UUID

        const client: ClientSocket = {
          ws,
          userId,
          deviceId,
          isAlive: true
        };

        this.clients.set(ws, client);
        // Logical destination mapping: authenticated_user_uuid -> authorized active connection
        this.userSockets.set(userId, ws);

        ws.send(JSON.stringify({
          type: 'connected',
          userUuid: userId,
          username: user.username,
          deviceId
        }));

        this.broadcastPresence(userId, 'online');

        // Recipient login sync check: verify pending offline messages for this user upon connection
        this.deliverPendingMessagesOnLogin(userId, ws);

        ws.on('message', (messageRaw) => {
          try {
            const data = JSON.parse(messageRaw.toString());
            this.handleMessage(client, data);
          } catch (err) {
            console.error('[WS] Message error:', err);
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          if (this.userSockets.get(userId) === ws) {
            this.userSockets.delete(userId);
          }
          this.broadcastPresence(userId, 'offline');
        });

        ws.on('pong', () => {
          client.isAlive = true;
        });

      } catch {
        ws.close(4002, 'Authentication failed');
      }
    });

    // Heartbeat check every 30s
    setInterval(() => {
      this.clients.forEach((client, ws) => {
        if (!client.isAlive) return ws.terminate();
        client.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  /**
   * Specifically verifies that the database conversation membership check succeeds
   * when the recipient logs in or establishes WebSocket connection, then delivers authorized messages.
   */
  private deliverPendingMessagesOnLogin(recipientUserId: string, ws: WebSocket) {
    const pending = db.getUndeliveredForUser(recipientUserId, 0);
    if (pending.length === 0) return;

    serverSyncDiagnostic.log('RECIPIENT_LOGIN_SYNC_PULL', {
      clientMessageId: 'ws-login-connect',
      conversationId: 'all',
      recipientUserId,
      details: {
        pendingCount: pending.length,
        transport: 'websocket'
      }
    });

    for (const msg of pending) {
      serverSyncDiagnostic.log('RECIPIENT_DB_MEMBERSHIP_CHECK', {
        clientMessageId: msg.clientMessageId,
        conversationId: msg.conversationId,
        messageId: msg.id,
        recipientUserId,
        senderUserId: msg.senderUserId,
        details: { table: 'conversation_members', transport: 'websocket' }
      });

      const isParticipant = db.isUserMemberOfConversation(recipientUserId, msg.conversationId);
      if (isParticipant) {
        serverSyncDiagnostic.log('RECIPIENT_DB_MEMBERSHIP_VERIFIED', {
          clientMessageId: msg.clientMessageId,
          conversationId: msg.conversationId,
          messageId: msg.id,
          recipientUserId,
          senderUserId: msg.senderUserId,
          serverSequence: msg.serverSequence,
          details: {
            checkResult: 'SUCCESS',
            verifiedRecipientUserId: recipientUserId,
            table: 'conversation_members',
            status: 'authorized_for_retrieval'
          }
        });

        ws.send(JSON.stringify({
          type: 'message',
          envelope: {
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
            sequence: msg.sequence,
            serverSequence: msg.serverSequence,
            handshakePacket: msg.handshakePacket,
            expiresAt: msg.expiresAt,
            chunkIndex: msg.chunkIndex,
            chunkCount: msg.chunkCount
          },
          messageId: msg.id,
          serverSequence: msg.serverSequence
        }));
      }
    }
  }

  private handleMessage(client: ClientSocket, data: any) {
    if (data.type === 'ping') {
      client.ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (data.type === 'message' && data.envelope) {
      const env = data.envelope;

      // Authoritative sender UUID: Derived strictly from client's authenticated session
      const senderUserId = client.userId;

      // 1. Resolve recipient MyChat UUID
      let recipientUserId: string | undefined = data.recipientUserId || env.recipientUserId || env.recipientUuid;
      if (!recipientUserId && env.recipientDeviceId) {
        const recipientDev = db.findDeviceById(env.recipientDeviceId);
        if (recipientDev) recipientUserId = recipientDev.userId;
      }
      if (!recipientUserId) {
        const members = db.getConversationMembers(env.conversationId);
        recipientUserId = members.find(m => m !== senderUserId);
      }

      serverSyncDiagnostic.log('INGESTION', {
        clientMessageId: env.clientMessageId,
        conversationId: env.conversationId,
        senderUserId,
        recipientUserId,
        senderDeviceId: client.deviceId,
        recipientDeviceId: env.recipientDeviceId,
        details: { transport: 'websocket' }
      });

      // 2. Strict zero-knowledge plaintext rejection
      if (env.text || env.plaintext || env.content) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 400,
          message: 'SECURITY VIOLATION: Plaintext messages are forbidden'
        }));
        return;
      }

      if (!recipientUserId) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 400,
          message: 'Recipient UUID could not be determined'
        }));
        return;
      }

      // 3. Strict conversation membership verification querying database
      serverSyncDiagnostic.log('DB_MEMBERSHIP_CHECK', {
        clientMessageId: env.clientMessageId,
        conversationId: env.conversationId,
        senderUserId,
        details: { table: 'conversation_members' }
      });

      if (!db.isUserMemberOfConversation(senderUserId, env.conversationId)) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 403,
          message: 'Forbidden: You are not an authorized member of this conversation'
        }));
        return;
      }

      if (!db.isUserMemberOfConversation(recipientUserId, env.conversationId)) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 403,
          message: 'Forbidden: Recipient is not an authorized member of this conversation'
        }));
        return;
      }

      serverSyncDiagnostic.log('DB_MEMBERSHIP_VERIFIED', {
        clientMessageId: env.clientMessageId,
        conversationId: env.conversationId,
        senderUserId,
        details: { checkResult: 'SUCCESS', verifiedParticipantUserId: senderUserId }
      });

      // 4. Offline recipient policy & 15-minute TTL
      const isRecipientOnline = this.isUserOnline(recipientUserId);
      if (!isRecipientOnline && env.allowOfflineStorage !== true) {
        const recipientUser = db.findUserById(recipientUserId);
        client.ws.send(JSON.stringify({
          type: 'offline_warning',
          code: 409,
          requiresOfflineConfirmation: true,
          recipientUuid: recipientUserId,
          recipientName: recipientUser?.displayName || recipientUser?.username || 'Recipient',
          message: 'Recipient is offline. Sender authorization required for 15-minute temporary queue.'
        }));
        return;
      }

      // 5. Store in DB with 15-minute expiration
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

      const record = db.storeMessage({
        conversationId: env.conversationId,
        senderUserId,
        recipientUserId,
        senderDeviceId: client.deviceId,
        recipientDeviceId: env.recipientDeviceId || `dev-${recipientUserId.slice(0, 8)}`,
        clientMessageId: env.clientMessageId,
        ciphertext: env.ciphertext,
        nonce: env.nonce,
        signature: env.signature,
        encryptionVersion: env.encryptionVersion || 'hybrid-x25519-mlkem1024-v1',
        sequence: env.sequence,
        handshakePacket: env.handshakePacket,
        expiresAt,
        chunkIndex: env.chunkIndex,
        chunkCount: env.chunkCount
      });

      // 6. Acknowledge back to sender
      client.ws.send(JSON.stringify({
        type: 'receipt',
        clientMessageId: record.clientMessageId,
        messageId: record.id,
        serverSequence: record.serverSequence,
        status: 'sent',
        conversationId: record.conversationId
      }));

      // 7. Authoritative routing operation: UUID-B -> UUID-A
      // Send ONLY to the validated recipient UUID's active connection!
      const completeEnvelope = {
        ...env,
        senderUserId,
        recipientUserId,
        sequence: record.sequence,
        serverSequence: record.serverSequence,
        handshakePacket: record.handshakePacket,
        expiresAt: record.expiresAt
      };

      this.sendEnvelopeToUser(recipientUserId, completeEnvelope, record.id, record.serverSequence);
    } else if (data.type === 'receipt') {
      const targetMsg = db.getMessageByIdOrClientId(data.messageId) || (data.clientMessageId ? db.getMessageByIdOrClientId(data.clientMessageId) : undefined);
      const convId = data.conversationId || targetMsg?.conversationId;

      if (!convId || !db.isUserMemberOfConversation(client.userId, convId)) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 403,
          message: 'Forbidden: You are not authorized to send receipts for this conversation'
        }));
        return;
      }

      if (data.status === 'delivered') {
        db.markDelivered(data.messageId);
      } else if (data.status === 'read') {
        db.markRead(data.messageId);
      }
      this.sendReceiptToConversation(convId, data.clientMessageId || data.messageId, data.status);
    }
  }

  /**
   * Authoritative UUID-to-UUID delivery:
   * Looks up recipient's verified UUID in memory and forwards directly to their active connection.
   * Completely eliminates global broadcasting and multi-device fan-out.
   */
  sendEnvelopeToUser(recipientUserId: string, envelope: any, messageId: string, serverSequence: number): boolean {
    const socket = this.userSockets.get(recipientUserId);
    const forwardedRealtime = !!socket && socket.readyState === WebSocket.OPEN;

    serverSyncDiagnostic.log('WS_FORWARD', {
      clientMessageId: envelope.clientMessageId,
      conversationId: envelope.conversationId,
      messageId,
      senderUserId: envelope.senderUserId,
      recipientUserId,
      serverSequence,
      details: {
        forwardedRealtime,
        destination: forwardedRealtime ? 'direct_uuid_websocket_push' : 'temporary_queue_15min_ttl'
      }
    });

    if (forwardedRealtime && socket) {
      socket.send(JSON.stringify({
        type: 'message',
        envelope,
        messageId,
        serverSequence
      }));
      return true;
    }
    return false;
  }

  sendReceiptToConversation(conversationId: string, clientMessageId: string, status: string) {
    const memberIds = new Set(db.getConversationMembers(conversationId));
    const payload = JSON.stringify({
      type: 'receipt',
      conversationId,
      clientMessageId,
      status
    });

    this.clients.forEach((c) => {
      if (memberIds.has(c.userId) && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    });
  }

  private broadcastPresence(userId: string, status: 'online' | 'offline') {
    const sharedUserIds = new Set(db.getUserSharedParticipantIds(userId));
    const payload = JSON.stringify({
      type: 'presence',
      userUuid: userId,
      status
    });

    this.clients.forEach((client) => {
      // Only notify users who actually share an active conversation with this user
      if (sharedUserIds.has(client.userId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    });
  }

  isUserOnline(userId: string): boolean {
    const socket = this.userSockets.get(userId);
    return !!socket && socket.readyState === WebSocket.OPEN;
  }
}

export const wsManager = new WebSocketManager();

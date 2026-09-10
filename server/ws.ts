import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { db } from './db';
import { serverSyncDiagnostic } from './syncDiagnostic';

const JWT_SECRET = process.env.JWT_SECRET || 'ychat_default_insecure_dev_secret_replace_in_prod';

interface ClientSocket {
  ws: WebSocket;
  userId: string;
  deviceId: string;
  isAlive: boolean;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientSocket>();
  private deviceSockets = new Map<string, WebSocket>();

  init(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const deviceId = url.searchParams.get('deviceId');

        if (!token || !deviceId) {
          ws.close(4001, 'Unauthorized: token and deviceId required');
          return;
        }

        // 1. Verify token signature and expiration
        const payload = jwt.verify(token, JWT_SECRET) as { sub: string; username: string };
        const userId = payload.sub;

        // 2. Strict device authorization check: Device must exist, belong to user, and not be revoked
        // If device isn't registered yet, we check if user exists
        const device = db.findDeviceById(deviceId);
        if (device && (device.userId !== userId || !!device.revokedAt)) {
          ws.close(4003, 'Forbidden: Device unauthorized or revoked');
          return;
        }

        const client: ClientSocket = {
          ws,
          userId,
          deviceId,
          isAlive: true
        };

        this.clients.set(ws, client);
        this.deviceSockets.set(deviceId, ws);

        ws.send(JSON.stringify({
          type: 'connected',
          userUuid: userId,
          deviceId
        }));

        this.broadcastPresence(userId, 'online');

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
          if (this.deviceSockets.get(deviceId) === ws) {
            this.deviceSockets.delete(deviceId);
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

  private handleMessage(client: ClientSocket, data: any) {
    if (data.type === 'ping') {
      client.ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (data.type === 'message' && data.envelope) {
      const env = data.envelope;

      serverSyncDiagnostic.log('INGESTION', {
        clientMessageId: env.clientMessageId,
        conversationId: env.conversationId,
        senderDeviceId: client.deviceId,
        recipientDeviceId: env.recipientDeviceId,
        details: { transport: 'websocket' }
      });

      // 1. Plaintext rejection
      if (env.text || env.plaintext || env.content) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 400,
          message: 'SECURITY VIOLATION: Plaintext messages are forbidden'
        }));
        return;
      }

      // 2. Strict conversation membership check
      if (!db.isUserMemberOfConversation(client.userId, env.conversationId)) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 403,
          message: 'Forbidden: You are not an authorized member of this conversation'
        }));
        return;
      }

      // 3. Sender device check
      if (env.senderDeviceId !== client.deviceId) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 403,
          message: 'Forbidden: Sender device ID does not match active authenticated socket device'
        }));
        return;
      }

      // 3b. Recipient device authorization check
      const recipientDevice = db.findDeviceById(env.recipientDeviceId);
      if (!recipientDevice || !db.isUserMemberOfConversation(recipientDevice.userId, env.conversationId)) {
        client.ws.send(JSON.stringify({
          type: 'error',
          code: 403,
          message: 'Forbidden: Recipient device owner is not an authorized participant in this conversation'
        }));
        return;
      }

      // 4. Store in DB
      const record = db.storeMessage({
        conversationId: env.conversationId,
        senderDeviceId: client.deviceId,
        recipientDeviceId: env.recipientDeviceId,
        clientMessageId: env.clientMessageId,
        ciphertext: env.ciphertext,
        nonce: env.nonce,
        signature: env.signature,
        encryptionVersion: env.encryptionVersion || 'hybrid-x25519-mlkem1024-v1',
        sequence: env.sequence,
        handshakePacket: env.handshakePacket,
        expiresAt: env.expiresAt,
        chunkIndex: env.chunkIndex,
        chunkCount: env.chunkCount
      });

      // 5. Acknowledge back to sender
      client.ws.send(JSON.stringify({
        type: 'receipt',
        clientMessageId: record.clientMessageId,
        messageId: record.id,
        serverSequence: record.serverSequence,
        status: 'sent',
        conversationId: record.conversationId
      }));

      // 6. Forward to recipient device if connected
      const completeEnvelope = {
        ...env,
        sequence: record.sequence,
        serverSequence: record.serverSequence,
        handshakePacket: record.handshakePacket,
        expiresAt: record.expiresAt
      };
      this.sendEnvelopeToDevice(env.recipientDeviceId, completeEnvelope, record.id, record.serverSequence);
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

  sendEnvelopeToDevice(recipientDeviceId: string, envelope: any, messageId: string, serverSequence: number) {
    const socket = this.deviceSockets.get(recipientDeviceId);
    const forwardedRealtime = !!socket && socket.readyState === WebSocket.OPEN;

    serverSyncDiagnostic.log('WS_FORWARD', {
      clientMessageId: envelope.clientMessageId,
      conversationId: envelope.conversationId,
      messageId,
      recipientDeviceId,
      serverSequence,
      details: {
        forwardedRealtime,
        destination: forwardedRealtime ? 'direct_websocket_push' : 'queued_for_login_sync'
      }
    });

    if (forwardedRealtime) {
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
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  isDeviceOnline(deviceId: string): boolean {
    const socket = this.deviceSockets.get(deviceId);
    return !!socket && socket.readyState === WebSocket.OPEN;
  }
}

export const wsManager = new WebSocketManager();

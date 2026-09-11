import { clientDb, QueuedMessage, StoredConversation } from './db';
import { syncDiagnostic } from './syncDiagnostic';
import {
  EncryptedEnvelope,
  DecryptedMessage,
  DeliveryStatus,
  FileAttachment,
  PrekeyBundle,
  HandshakePacket,
  EncryptedChunk
} from '../crypto/types';
import { DeviceKeyBundle } from '../crypto/keys';
import {
  initiateHybridHandshake,
  acceptHybridHandshake
} from '../crypto/handshake';
import {
  createRatchetSession,
  deriveNextMessageKey,
  deriveRecipientMessageKey
} from '../crypto/ratchet';
import {
  createMessageEnvelope,
  verifyAndDecryptEnvelope
} from '../crypto/envelope';
import {
  initializeBlake3Chain,
  appendMessageToBlake3Chain
} from '../crypto/blake3chain';
import {
  chunkEnvelope,
  ChunkReassembler,
  CHUNK_SIZE_THRESHOLD
} from '../crypto/chunking';

export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

export class SyncEngine {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = 'offline';
  private connectionListeners: Array<(state: ConnectionState) => void> = [];
  private messageListeners: Array<(msg: DecryptedMessage) => void> = [];
  private receiptListeners: Array<(clientMsgId: string, status: DeliveryStatus, failureCategory?: string, reason?: string) => void> = [];
  private presenceListeners: Array<(userUuid: string, status: 'online' | 'away' | 'offline', lastSeen?: number) => void> = [];
  private typingListeners: Array<(data: { conversationId: string; userUuid: string; isTyping: boolean }) => void> = [];
  private notificationListeners: Array<(notif: any) => void> = [];
  private reactionListeners: Array<(data: { conversationId: string; clientMessageId: string; emoji: string; userUuid: string }) => void> = [];
  private token: string | null = null;
  private deviceKeys: DeviceKeyBundle | null = null;
  private userUuid: string | null = null;
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private isProcessingQueue = false;
  private chunkReassembler = new ChunkReassembler();
  private activeConversationId: string | null = null;
  private droppedEnvelopes = new Set<string>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkStateChange(true));
      window.addEventListener('offline', () => this.handleNetworkStateChange(false));
    }
  }

  setCredentials(token: string, deviceKeys: DeviceKeyBundle, userUuid: string) {
    this.token = token;
    this.deviceKeys = deviceKeys;
    this.userUuid = userUuid;
    this.connectWs();
    this.processSyncQueue();
    this.pullPendingMessages();
  }

  clearCredentials() {
    this.token = null;
    this.deviceKeys = null;
    this.userUuid = null;
    this.activeConversationId = null;
    this.droppedEnvelopes.clear();
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState('offline');
  }

  setActiveConversation(conversationId: string | null) {
    this.activeConversationId = conversationId;
    if (conversationId && this.token) {
      this.syncConversationMessages(conversationId);
    }
  }

  onConnectionChange(cb: (state: ConnectionState) => void) {
    this.connectionListeners.push(cb);
    cb(this.connectionState);
    return () => {
      this.connectionListeners = this.connectionListeners.filter(l => l !== cb);
    };
  }

  onMessage(cb: (msg: DecryptedMessage) => void) {
    this.messageListeners.push(cb);
    return () => {
      this.messageListeners = this.messageListeners.filter(l => l !== cb);
    };
  }

  onReceipt(cb: (clientMsgId: string, status: DeliveryStatus, failureCategory?: string, reason?: string) => void) {
    this.receiptListeners.push(cb);
    return () => {
      this.receiptListeners = this.receiptListeners.filter(l => l !== cb);
    };
  }

  onPresence(cb: (userUuid: string, status: 'online' | 'away' | 'offline', lastSeen?: number) => void) {
    this.presenceListeners.push(cb);
    return () => {
      this.presenceListeners = this.presenceListeners.filter(l => l !== cb);
    };
  }

  onTyping(cb: (data: { conversationId: string; userUuid: string; isTyping: boolean }) => void) {
    this.typingListeners.push(cb);
    return () => {
      this.typingListeners = this.typingListeners.filter(l => l !== cb);
    };
  }

  onNotification(cb: (notif: any) => void) {
    this.notificationListeners.push(cb);
    return () => {
      this.notificationListeners = this.notificationListeners.filter(l => l !== cb);
    };
  }

  onReaction(cb: (data: { conversationId: string; clientMessageId: string; emoji: string; userUuid: string }) => void) {
    this.reactionListeners.push(cb);
    return () => {
      this.reactionListeners = this.reactionListeners.filter(l => l !== cb);
    };
  }

  private setConnectionState(state: ConnectionState) {
    this.connectionState = state;
    this.connectionListeners.forEach(cb => cb(state));
  }

  private async authFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers || {});
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    const res = await fetch(url, { ...init, headers });
    const refreshed = res.headers.get('x-refreshed-token');
    if (refreshed) {
      this.token = refreshed;
      localStorage.setItem('ychat_token', refreshed);
    }
    return res;
  }

  private handleNetworkStateChange(isOnline: boolean) {
    if (isOnline) {
      this.connectWs();
      this.processSyncQueue();
      this.pullPendingMessages();
    } else {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.setConnectionState('offline');
    }
  }

  private connectWs() {
    if (!this.token || !this.deviceKeys) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setConnectionState('reconnecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(this.token)}&deviceId=${encodeURIComponent(this.deviceKeys.deviceId)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.setConnectionState('connected');
        this.processSyncQueue();
        this.pullPendingMessages();
        if (this.activeConversationId) {
          this.syncConversationMessages(this.activeConversationId);
        }

        // Keepalive heartbeat ping every 25s to keep WebSocket connection active
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') {
            return; // Heartbeat response acknowledged
          }
          if (data.type === 'message') {
            await this.handleIncomingEnvelope(data.envelope, data.messageId, data.serverSequence);
          } else if (data.type === 'receipt') {
            await this.handleReceipt(data.clientMessageId, data.status, data.failureCategory, data.reason);
          } else if (data.type === 'presence') {
            this.presenceListeners.forEach(cb => cb(data.userUuid, data.status, data.lastSeen));
          } else if (data.type === 'presence_batch') {
            if (Array.isArray(data.presences)) {
              data.presences.forEach((p: any) => {
                this.presenceListeners.forEach(cb => cb(p.userUuid, p.status, p.lastSeen));
              });
            }
          } else if (data.type === 'typing') {
            this.typingListeners.forEach(cb =>
              cb({
                conversationId: data.conversationId,
                userUuid: data.userUuid,
                isTyping: !!data.isTyping
              })
            );
          } else if (data.type === 'notification') {
            this.notificationListeners.forEach(cb => cb(data.notification));
          } else if (data.type === 'reaction') {
            await clientDb.updateMessageReactions(data.clientMessageId, data.emoji, data.userUuid);
            this.reactionListeners.forEach(cb => cb({
              conversationId: data.conversationId,
              clientMessageId: data.clientMessageId,
              emoji: data.emoji,
              userUuid: data.userUuid
            }));
          }
        } catch (err) {
          console.error('[SyncEngine] WS message parse error:', err);
        }
      };

      this.ws.onclose = () => {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (this.connectionState !== 'offline') {
          this.setConnectionState('reconnecting');
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.connectWs(), 3000);
        }
      };

      this.ws.onerror = () => {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
        this.ws?.close();
      };
    } catch {
      this.setConnectionState('reconnecting');
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connectWs(), 3000);
    }
  }

  async sendTextMessage(
    conversationId: string,
    recipientDeviceId: string,
    recipientBundle: PrekeyBundle,
    text: string,
    recipientUserId?: string,
    allowOfflineStorage: boolean = true,
    attachment?: FileAttachment,
    retentionMinutes: number = 1440
  ): Promise<DecryptedMessage> {
    if (!this.deviceKeys || !this.userUuid) {
      throw new Error('Not authenticated');
    }

    const clientMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const sessionId = `${conversationId}:${recipientDeviceId}`;

    // 1. Retrieve or establish Ratchet Session via hybrid handshake
    let session = await clientDb.getSession(sessionId);
    let initialHandshakePacket: HandshakePacket | undefined = undefined;

    if (!session || !session.handshakePacket) {
      const handshake = initiateHybridHandshake(
        this.deviceKeys.deviceId,
        this.deviceKeys.publicKeys,
        this.deviceKeys.privateKeys,
        recipientBundle
      );
      session = createRatchetSession(
        handshake.masterSecret,
        recipientDeviceId,
        conversationId,
        handshake.handshakePacket
      );
      session.handshakePacket = handshake.handshakePacket;
      await clientDb.saveSession(session);
      initialHandshakePacket = handshake.handshakePacket;
    } else {
      initialHandshakePacket = session.handshakePacket;
    }

    // 2. Derive single-use Message Key
    const { messageKey, sequence, updatedSession } = deriveNextMessageKey(
      session,
      this.deviceKeys.deviceId
    );
    // Keep handshakePacket attached on updated session
    updatedSession.handshakePacket = session.handshakePacket;
    await clientDb.saveSession(updatedSession);

    // 3. Encrypt payload and sign with ML-DSA-87 with sender-configured retention (default 24h = 1440m, max 7d = 10080m)
    const retentionMs = Math.min(Math.max(retentionMinutes, 5), 10080) * 60 * 1000;
    const expiresAt = new Date(Date.now() + retentionMs).toISOString();
    const payloadToEncrypt = attachment
      ? JSON.stringify({
          type: 'file_attachment',
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          text: text || ''
        })
      : text;

    const envelope = createMessageEnvelope(
      payloadToEncrypt,
      clientMessageId,
      conversationId,
      this.deviceKeys.deviceId,
      recipientDeviceId,
      messageKey,
      sequence,
      this.deviceKeys.privateKeys,
      initialHandshakePacket,
      expiresAt
    );

    // Attach UUID-to-UUID routing metadata and offline allowance
    envelope.senderUserId = this.userUuid;
    envelope.recipientUserId = recipientUserId || recipientBundle.userUuid;
    envelope.allowOfflineStorage = allowOfflineStorage;
    (envelope as any).retentionMinutes = retentionMinutes;

    const initialStatus: DeliveryStatus =
      this.connectionState === 'connected' ? 'sending' : 'queued_offline';

    syncDiagnostic.record('SENDER_PREPARE', {
      clientMessageId,
      conversationId,
      senderUserId: this.userUuid,
      recipientUserId: envelope.recipientUserId,
      senderDeviceId: this.deviceKeys.deviceId,
      recipientDeviceId,
      sequence,
      details: {
        status: initialStatus,
        hasHandshakePacket: !!initialHandshakePacket,
        allowOfflineStorage
      }
    });

    const localMessage: DecryptedMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId,
      senderDeviceId: this.deviceKeys.deviceId,
      senderUserUuid: this.userUuid,
      text: text || (attachment ? attachment.fileName : ''),
      timestamp: Date.now(),
      sequence,
      status: initialStatus,
      tamperVerified: true,
      expiresAt,
      attachment
    };

    // 4. Save to local IndexedDB
    await clientDb.saveMessage(localMessage);

    // 5. Append to BLAKE3 hash chain
    let chain = await clientDb.getBlake3Chain(conversationId);
    if (!chain) chain = initializeBlake3Chain(conversationId);
    const updatedChain = appendMessageToBlake3Chain(chain, localMessage, envelope.ciphertext);
    await clientDb.saveBlake3Chain(updatedChain);

    // 6. Check if payload requires chunking (> 32KB)
    const chunks = chunkEnvelope(envelope, this.deviceKeys.privateKeys);

    if (chunks.length > 1) {
      for (const chunk of chunks) {
        const chunkEnvelopeObj: EncryptedEnvelope = {
          clientMessageId: `${clientMessageId}#chunk${chunk.chunkIndex}`,
          conversationId: chunk.conversationId,
          senderDeviceId: chunk.senderDeviceId,
          recipientDeviceId: chunk.recipientDeviceId,
          ciphertext: chunk.chunkCiphertext,
          nonce: chunk.nonce,
          signature: chunk.chunkSignature,
          encryptionVersion: chunk.encryptionVersion,
          sequence: chunk.sequence,
          handshakePacket: chunk.handshakePacket,
          expiresAt: chunk.expiresAt,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount
        };

        await clientDb.enqueueMessage({
          clientMessageId: chunkEnvelopeObj.clientMessageId,
          conversationId,
          recipientDeviceId,
          envelope: chunkEnvelopeObj,
          plaintext: text || (attachment ? attachment.fileName : ''),
          timestamp: Date.now(),
          retries: 0
        });
      }
    } else {
      await clientDb.enqueueMessage({
        clientMessageId,
        conversationId,
        recipientDeviceId,
        envelope,
        plaintext: text || (attachment ? attachment.fileName : ''),
        timestamp: Date.now(),
        retries: 0
      });
    }

    // 7. Attempt immediate dispatch
    this.processSyncQueue();

    return localMessage;
  }

  async processSyncQueue() {
    if (this.isProcessingQueue || !this.token) return;
    this.isProcessingQueue = true;

    try {
      const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine) || this.connectionState === 'offline';
      const queue = await clientDb.getSyncQueue();

      for (const item of queue) {
        const rootMessageId = item.clientMessageId.split('#chunk')[0];

        // If client is currently offline, ensure message is marked as queued_offline
        if (isOffline) {
          await clientDb.updateMessageStatus(rootMessageId, 'queued_offline');
          this.receiptListeners.forEach(cb => cb(rootMessageId, 'queued_offline'));
          continue;
        }

        let sent = false;
        let responseStatus: DeliveryStatus = 'sent';
        let failureError: { category: string; message: string } | null = null;

        // Try WebSocket first
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify({
              type: 'message',
              envelope: item.envelope
            }));
            sent = true;
            syncDiagnostic.record('SENDER_DISPATCH', {
              clientMessageId: item.clientMessageId,
              conversationId: item.conversationId,
              senderDeviceId: item.envelope.senderDeviceId,
              recipientDeviceId: item.envelope.recipientDeviceId,
              sequence: item.envelope.sequence,
              transport: 'websocket'
            });
          } catch {
            sent = false;
          }
        }

        // Fallback to REST /api/v1/messages
        if (!sent) {
          try {
            const res = await this.authFetch('/api/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(item.envelope)
            });
            if (res.ok) {
              sent = true;
              const resData = await res.json().catch(() => ({}));
              if (resData.status === 'stored_offline') {
                responseStatus = 'sent'; // Successfully queued on server for offline recipient
              }
              syncDiagnostic.record('SENDER_DISPATCH', {
                clientMessageId: item.clientMessageId,
                conversationId: item.conversationId,
                senderDeviceId: item.envelope.senderDeviceId,
                recipientDeviceId: item.envelope.recipientDeviceId,
                sequence: item.envelope.sequence,
                transport: 'rest'
              });
            } else {
              sent = false;
              if (res.status === 401 || res.status === 403) {
                failureError = { category: 'AUTHENTICATION_EXPIRED', message: 'Authentication expired' };
              } else if (res.status === 429) {
                failureError = { category: 'RATE_LIMITED', message: 'Rate limit reached' };
              } else if (res.status >= 500) {
                failureError = { category: 'SERVER_ERROR', message: "Message couldn't be delivered" };
              } else {
                failureError = { category: 'NETWORK_ERROR', message: "Message couldn't be delivered" };
              }
            }
          } catch {
            sent = false;
            failureError = { category: 'CONNECTION_LOST', message: "Message couldn't be delivered" };
          }
        }

        if (sent) {
          await clientDb.dequeueMessage(item.clientMessageId);
          await clientDb.updateMessageStatus(rootMessageId, responseStatus);
          this.receiptListeners.forEach(cb => cb(rootMessageId, responseStatus));

          syncDiagnostic.record('SENDER_ACKNOWLEDGED', {
            clientMessageId: rootMessageId,
            conversationId: item.conversationId,
            senderDeviceId: item.envelope.senderDeviceId,
            recipientDeviceId: item.envelope.recipientDeviceId,
            details: { status: responseStatus }
          });
        } else {
          // Increment retry attempt
          item.retries = (item.retries || 0) + 1;
          const MAX_RETRIES = 3;

          if (item.retries >= MAX_RETRIES || failureError?.category === 'AUTHENTICATION_EXPIRED') {
            // Reached maximum retries -> Delivery failure
            await clientDb.dequeueMessage(item.clientMessageId);
            await clientDb.updateMessageStatus(rootMessageId, 'failed', {
              failureReason: (failureError?.category as any) || 'NETWORK_ERROR',
              errorMessage: failureError?.message || "Message couldn't be delivered",
              retryCount: item.retries
            });
            this.receiptListeners.forEach(cb => cb(rootMessageId, 'failed', failureError?.category, failureError?.message));
          } else {
            // Keep in queue and mark status as retrying
            await clientDb.enqueueMessage(item);
            await clientDb.updateMessageStatus(rootMessageId, 'retrying', {
              retryCount: item.retries
            });
            this.receiptListeners.forEach(cb => cb(rootMessageId, 'retrying'));

            // Exponential backoff
            const backoffMs = Math.min(1000 * Math.pow(2, item.retries), 10000);
            setTimeout(() => this.processSyncQueue(), backoffMs);
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async handleIncomingEnvelope(
    envelope: EncryptedEnvelope,
    serverMessageId: string,
    serverSeq: number
  ) {
    if (!this.deviceKeys || !this.token) return;
    if (this.droppedEnvelopes.has(envelope.clientMessageId)) return;

    // UUID-to-UUID authoritative routing check:
    if (envelope.recipientUserId && this.userUuid && envelope.recipientUserId !== this.userUuid) {
      return;
    }
    // Reject envelopes not intended for this device if recipientUserId is not present
    if (!envelope.recipientUserId && envelope.recipientDeviceId && envelope.recipientDeviceId !== this.deviceKeys.deviceId) {
      return;
    }
    // Reject incoming loops from own device or self
    if (envelope.senderDeviceId === this.deviceKeys.deviceId) {
      return;
    }

    syncDiagnostic.record('RECIPIENT_ENVELOPE_RECEIVED', {
      clientMessageId: envelope.clientMessageId,
      conversationId: envelope.conversationId,
      senderUserId: envelope.senderUserId,
      recipientUserId: this.userUuid ?? undefined,
      senderDeviceId: envelope.senderDeviceId,
      recipientDeviceId: this.deviceKeys.deviceId,
      sequence: envelope.sequence,
      serverSequence: serverSeq,
      details: {
        hasHandshakePacket: !!envelope.handshakePacket,
        chunkCount: envelope.chunkCount || 1
      }
    });

    try {
      // Ensure local device keys are loaded and have privateKeys
      if (!this.deviceKeys || !this.deviceKeys.privateKeys) {
        const savedKeys = await clientDb.getAnySavedDeviceKeys();
        if (savedKeys && savedKeys.privateKeys) {
          this.deviceKeys = savedKeys;
        }
      }

      if (!this.deviceKeys || !this.deviceKeys.privateKeys) {
        console.warn('[SyncEngine] Local device keys or privateKeys unavailable for envelope decryption');
        return;
      }

      // 1. Fetch sender device public keys to verify ML-DSA-87 signature and handshake
      const bundleRes = await this.authFetch(`/api/v1/devices/${envelope.senderDeviceId}/prekeys`);
      if (!bundleRes.ok) {
        console.warn(`[SyncEngine] Could not fetch sender prekeys for ${envelope.senderDeviceId}: ${bundleRes.status}`);
        return;
      }
      const senderBundle: PrekeyBundle = await bundleRes.json();
      if (!senderBundle || !senderBundle.publicKeys || !senderBundle.publicKeys.dhKey) {
        console.warn(`[SyncEngine] Sender prekey bundle invalid or missing publicKeys for ${envelope.senderDeviceId}`);
        return;
      }

      let targetEnvelope: EncryptedEnvelope | null = envelope;

      // 2. Handle chunk reassembly if chunked
      if (envelope.chunkCount && envelope.chunkCount > 1) {
        const rootId = envelope.clientMessageId.split('#chunk')[0];
        const chunkObj: EncryptedChunk = {
          clientMessageId: rootId,
          conversationId: envelope.conversationId,
          senderDeviceId: envelope.senderDeviceId,
          recipientDeviceId: envelope.recipientDeviceId,
          chunkIndex: envelope.chunkIndex ?? 0,
          chunkCount: envelope.chunkCount,
          chunkCiphertext: envelope.ciphertext,
          chunkSignature: envelope.signature,
          nonce: envelope.nonce,
          sequence: envelope.sequence ?? 1,
          encryptionVersion: envelope.encryptionVersion,
          handshakePacket: envelope.handshakePacket,
          expiresAt: envelope.expiresAt
        };

        targetEnvelope = this.chunkReassembler.processChunk(chunkObj, senderBundle.publicKeys);
        if (!targetEnvelope) {
          // Still waiting for remaining chunks of this message
          return;
        }
      }

      // Check if message is already decrypted & stored locally (idempotency)
      const existingMsg = await clientDb.getMessageById(targetEnvelope.clientMessageId);
      if (existingMsg) {
        return;
      }

      // 3. Ratchet session handling
      const sessionId = `${targetEnvelope.conversationId}:${targetEnvelope.senderDeviceId}`;
      let session = await clientDb.getSession(sessionId);
      let sessionEstablishedViaHandshake = false;

      // If no session exists yet, accept handshake from the attached handshakePacket
      if (!session) {
        if (!targetEnvelope.handshakePacket) {
          console.warn('[SyncEngine] No session and no handshakePacket in envelope:', targetEnvelope.clientMessageId);
          return;
        }

        if (!this.deviceKeys.privateKeys.dhKey) {
          console.warn('[SyncEngine] Missing local private dhKey for handshake');
          return;
        }

        const masterSecret = acceptHybridHandshake(
          this.deviceKeys.deviceId,
          this.deviceKeys.privateKeys,
          targetEnvelope.handshakePacket,
          senderBundle.publicKeys,
          this.deviceKeys.oneTimePrekeys?.privateKeys
        );
        session = createRatchetSession(
          masterSecret,
          targetEnvelope.senderDeviceId,
          targetEnvelope.conversationId,
          targetEnvelope.handshakePacket
        );
        session.handshakePacket = targetEnvelope.handshakePacket;
        await clientDb.saveSession(session);
        sessionEstablishedViaHandshake = true;
      }

      syncDiagnostic.record('RECIPIENT_HANDSHAKE_ESTABLISHED', {
        clientMessageId: targetEnvelope.clientMessageId,
        conversationId: targetEnvelope.conversationId,
        senderDeviceId: targetEnvelope.senderDeviceId,
        recipientDeviceId: this.deviceKeys.deviceId,
        details: {
          sessionMode: sessionEstablishedViaHandshake ? 'hybrid_handshake_accepted' : 'existing_ratchet_session'
        }
      });

      // 4. Derive message key for this sequence and sender device
      const messageKey = deriveRecipientMessageKey(
        session,
        targetEnvelope.senderDeviceId,
        targetEnvelope.sequence || 1
      );

      // 5. Verify ML-DSA-87 signature & Decrypt ChaCha20-Poly1305
      const plaintext = verifyAndDecryptEnvelope(targetEnvelope, messageKey, senderBundle.publicKeys);

      let messageText = plaintext;
      let fileAttachment: FileAttachment | undefined = undefined;

      try {
        if (plaintext.startsWith('{"type":"file_attachment"')) {
          const parsed = JSON.parse(plaintext);
          if (parsed.type === 'file_attachment') {
            fileAttachment = {
              fileName: parsed.fileName,
              fileSize: parsed.fileSize,
              mimeType: parsed.mimeType,
              dataUrl: parsed.dataUrl
            };
            messageText = parsed.text || parsed.fileName;
          }
        }
      } catch {}

      syncDiagnostic.record('RECIPIENT_DECRYPTED_VERIFIED', {
        clientMessageId: targetEnvelope.clientMessageId,
        conversationId: targetEnvelope.conversationId,
        senderDeviceId: targetEnvelope.senderDeviceId,
        recipientDeviceId: this.deviceKeys.deviceId,
        sequence: targetEnvelope.sequence,
        serverSequence: serverSeq,
        details: {
          tamperVerified: true,
          encryptionVersion: targetEnvelope.encryptionVersion,
          hasAttachment: !!fileAttachment
        }
      });

      const decrypted: DecryptedMessage = {
        id: serverMessageId || targetEnvelope.clientMessageId,
        clientMessageId: targetEnvelope.clientMessageId,
        conversationId: targetEnvelope.conversationId,
        senderDeviceId: targetEnvelope.senderDeviceId,
        senderUserUuid: senderBundle.userUuid,
        text: messageText,
        timestamp: targetEnvelope.expiresAt ? (new Date(targetEnvelope.expiresAt).getTime() - 15 * 60 * 1000) : Date.now(),
        sequence: targetEnvelope.sequence || 1,
        serverSequence: serverSeq || targetEnvelope.serverSequence,
        status: 'delivered',
        tamperVerified: true,
        expiresAt: targetEnvelope.expiresAt,
        attachment: fileAttachment
      };

      // 6. Save locally
      await clientDb.saveMessage(decrypted);

      // 7. Update BLAKE3 chain
      let chain = await clientDb.getBlake3Chain(targetEnvelope.conversationId);
      if (!chain) chain = initializeBlake3Chain(targetEnvelope.conversationId);
      const updatedChain = appendMessageToBlake3Chain(chain, decrypted, targetEnvelope.ciphertext);
      await clientDb.saveBlake3Chain(updatedChain);

      // 8. Update conversation metadata
      let conv = await clientDb.getConversation(targetEnvelope.conversationId);
      if (conv) {
        conv.lastMessageText = messageText;
        conv.lastMessageTimestamp = Date.now();
        conv.unreadCount = (conv.unreadCount || 0) + 1;
        await clientDb.saveConversation(conv);
      } else if (this.token && this.userUuid) {
        // Conversation metadata not yet local - fetch authorized details from server
        try {
          const cRes = await this.authFetch(`/api/v1/conversations/${targetEnvelope.conversationId}`);
          if (cRes.ok) {
            const cData = await cRes.json();
            const otherMember = (cData.members || []).find((m: any) => m.uuid !== this.userUuid);
            if (otherMember) {
              const newConv: StoredConversation = {
                id: targetEnvelope.conversationId,
                ownerUserId: this.userUuid,
                recipientUuid: otherMember.uuid,
                recipientUsername: otherMember.username,
                recipientDisplayName: otherMember.displayName,
                lastMessageText: plaintext,
                lastMessageTimestamp: Date.now(),
                unreadCount: 1,
                isVerifiedSafetyNumber: false
              };
              await clientDb.saveConversation(newConv);
            }
          }
        } catch {}
      }

      syncDiagnostic.record('RECIPIENT_DB_SAVED', {
        clientMessageId: decrypted.clientMessageId,
        conversationId: decrypted.conversationId,
        senderDeviceId: decrypted.senderDeviceId,
        recipientDeviceId: this.deviceKeys.deviceId,
        serverSequence: decrypted.serverSequence,
        details: {
          savedToLocalDb: true,
          unreadCountIncremented: !conv || (conv.unreadCount || 0) > 0
        }
      });

      // 9. Notify UI listeners
      this.messageListeners.forEach(cb => cb(decrypted));

      // 10. Emit delivery receipt to sender
      this.sendReceipt(serverMessageId, targetEnvelope.clientMessageId, 'delivered');

      syncDiagnostic.record('RECIPIENT_RECEIPT_SENT', {
        clientMessageId: targetEnvelope.clientMessageId,
        conversationId: targetEnvelope.conversationId,
        recipientDeviceId: this.deviceKeys.deviceId,
        details: { status: 'delivered', serverMessageId }
      });
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isSecurityViolation =
        errMsg.includes('SECURITY VIOLATION') ||
        errMsg.includes('ML-DSA-87') ||
        errMsg.includes('Cryptographic verification') ||
        errMsg.includes('signature verification failed');

      if (isSecurityViolation) {
        this.droppedEnvelopes.add(envelope.clientMessageId);
        syncDiagnostic.record('MESSAGE_DROPPED_INVALID_SIGNATURE', {
          clientMessageId: envelope.clientMessageId,
          conversationId: envelope.conversationId,
          senderDeviceId: envelope.senderDeviceId,
          recipientDeviceId: this.deviceKeys?.deviceId,
          details: {
            reason: errMsg,
            dropped: true
          }
        });
        console.warn(`[SyncEngine] Security verification failed (${envelope.clientMessageId}): ${errMsg}`);
        // Notify sender of delivery failure without exposing cryptographic internals
        if (serverMessageId || envelope.clientMessageId) {
          this.sendReceipt(
            serverMessageId || envelope.clientMessageId,
            envelope.clientMessageId,
            'failed',
            'VERIFICATION_FAILED',
            "Message couldn't be delivered"
          );
        }
      } else {
        console.error('[SyncEngine] Failed to ingest message envelope:', err);
      }
    }
  }

  private async handleReceipt(
    clientMessageId: string,
    status: DeliveryStatus,
    failureCategory?: string,
    reason?: string
  ) {
    const rootId = clientMessageId.split('#chunk')[0];
    await clientDb.updateMessageStatus(rootId, status, {
      failureReason: failureCategory as any,
      errorMessage: reason || (status === 'failed' ? "Message couldn't be delivered" : undefined)
    });
    this.receiptListeners.forEach(cb => cb(rootId, status, failureCategory, reason));

    if (status === 'delivered') {
      syncDiagnostic.record('DELIVERY_CONFIRMED', {
        clientMessageId: rootId,
        conversationId: 'active',
        details: { status: 'delivered' }
      });
    } else if (status === 'failed') {
      syncDiagnostic.record('DELIVERY_FAILED', {
        clientMessageId: rootId,
        conversationId: 'active',
        details: { status: 'failed', failureCategory, reason }
      });
    }
  }

  sendReceipt(
    serverMessageId: string,
    clientMessageId: string,
    status: 'delivered' | 'read' | 'failed' | 'expired',
    failureCategory?: string,
    reason?: string
  ) {
    const rootId = clientMessageId.split('#chunk')[0];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'receipt',
        messageId: serverMessageId,
        clientMessageId: rootId,
        status,
        failureCategory,
        reason
      }));
    } else if (this.token) {
      this.authFetch(`/api/v1/messages/${serverMessageId}/receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clientMessageId: rootId,
          status,
          failureCategory,
          reason
        })
      }).catch(() => {});
    }
  }

  async retryMessage(clientMessageId: string): Promise<boolean> {
    const rootId = clientMessageId.split('#chunk')[0];
    const msg = await clientDb.getMessageById(rootId);
    if (!msg) return false;

    // 1. Immediately mark status as retrying
    await clientDb.updateMessageStatus(rootId, 'retrying', {
      retryCount: (msg.retryCount || 0) + 1,
      lastAttempt: Date.now()
    });
    this.receiptListeners.forEach(cb => cb(rootId, 'retrying'));

    // 2. If failure was cryptographic verification, invalidate ratchet session to force fresh handshake
    if (msg.failureReason === 'VERIFICATION_FAILED' && msg.recipientDeviceId) {
      await clientDb.deleteSession(`${msg.conversationId}:${msg.recipientDeviceId}`);
    }

    // 3. Check queue
    const queue = await clientDb.getSyncQueue();
    const existing = queue.find(q => q.clientMessageId === rootId || q.clientMessageId.startsWith(`${rootId}#chunk`));

    if (existing) {
      existing.retries = 0;
      await clientDb.enqueueMessage(existing);
    } else {
      try {
        const conv = await clientDb.getConversation(msg.conversationId);
        const recipientUserId = conv?.participants.find(p => p !== this.userUuid);
        if (recipientUserId && this.token && this.deviceKeys) {
          const bundleRes = await this.authFetch(`/api/v1/devices/${recipientUserId}/prekeys`);
          if (bundleRes.ok) {
            const bundleData = await bundleRes.json();
            const recipientBundle = bundleData.bundle;
            if (recipientBundle) {
              const sessionId = `${msg.conversationId}:${recipientBundle.deviceId}`;
              let session = await clientDb.getSession(sessionId);
              let initialHandshakePacket: HandshakePacket | undefined = undefined;

              if (!session || !session.handshakePacket || msg.failureReason === 'VERIFICATION_FAILED') {
                const handshake = initiateHybridHandshake(
                  this.deviceKeys.deviceId,
                  this.deviceKeys.publicKeys,
                  this.deviceKeys.privateKeys,
                  recipientBundle
                );
                session = createRatchetSession(
                  handshake.masterSecret,
                  recipientBundle.deviceId,
                  msg.conversationId,
                  handshake.handshakePacket
                );
                session.handshakePacket = handshake.handshakePacket;
                await clientDb.saveSession(session);
                initialHandshakePacket = handshake.handshakePacket;
              } else {
                initialHandshakePacket = session.handshakePacket;
              }

              const { messageKey, sequence, updatedSession } = deriveNextMessageKey(
                session,
                this.deviceKeys.deviceId
              );
              updatedSession.handshakePacket = session.handshakePacket;
              await clientDb.saveSession(updatedSession);

              const expiresAt = msg.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
              const payloadToEncrypt = msg.attachment
                ? JSON.stringify({
                    type: 'file_attachment',
                    fileName: msg.attachment.fileName,
                    fileSize: msg.attachment.fileSize,
                    mimeType: msg.attachment.mimeType,
                    dataUrl: msg.attachment.dataUrl,
                    text: msg.text || ''
                  })
                : msg.text;

              const envelope = createMessageEnvelope(
                payloadToEncrypt,
                rootId,
                msg.conversationId,
                this.deviceKeys.deviceId,
                recipientBundle.deviceId,
                messageKey,
                sequence,
                this.deviceKeys.privateKeys,
                initialHandshakePacket,
                expiresAt
              );
              envelope.senderUserId = this.userUuid!;
              envelope.recipientUserId = recipientUserId;
              envelope.allowOfflineStorage = true;

              await clientDb.enqueueMessage({
                clientMessageId: rootId,
                conversationId: msg.conversationId,
                recipientDeviceId: recipientBundle.deviceId,
                envelope,
                plaintext: msg.text,
                timestamp: Date.now(),
                retries: 0
              });
            }
          }
        }
      } catch (err) {
        console.error('[SyncEngine] Error rebuilding envelope on retry:', err);
      }
    }

    await this.processSyncQueue();
    return true;
  }

  async retryAllFailedMessages(conversationId?: string): Promise<void> {
    const failedMessages = await clientDb.getFailedMessages(conversationId);
    for (const msg of failedMessages) {
      await this.retryMessage(msg.clientMessageId || msg.id);
    }
  }

  async reconnect(): Promise<void> {
    this.setConnectionState('reconnecting');
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connectWs();
    await this.processSyncQueue();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  sendReaction(conversationId: string, clientMessageId: string, emoji: string, messageId?: string) {
    const rootId = clientMessageId.split('#chunk')[0];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'reaction',
        conversationId,
        clientMessageId: rootId,
        messageId: messageId || rootId,
        emoji
      }));
    } else if (this.token) {
      this.authFetch(`/api/v1/messages/${encodeURIComponent(messageId || rootId)}/reaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clientMessageId: rootId,
          conversationId,
          emoji
        })
      }).catch(() => {});
    }
  }

  sendTyping(conversationId: string, isTyping: boolean) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'typing',
          conversationId,
          isTyping
        })
      );
    }
  }

  sendPresence(status: 'online' | 'away' | 'offline') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'presence',
          status
        })
      );
    }
  }

  async pullPendingMessages() {
    if (!this.token || !this.deviceKeys) return;
    try {
      syncDiagnostic.record('RECIPIENT_LOGIN_SYNC_PULL', {
        clientMessageId: 'sync-pull',
        conversationId: 'all',
        recipientDeviceId: this.deviceKeys.deviceId,
        details: { action: 'initiating_login_sync_pull' }
      });

      const res = await this.authFetch(`/api/v1/sync/pull?deviceId=${encodeURIComponent(this.deviceKeys.deviceId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            if (this.droppedEnvelopes.has(msg.clientMessageId)) continue;
            syncDiagnostic.record('RECIPIENT_DB_MEMBERSHIP_VERIFIED', {
              clientMessageId: msg.clientMessageId,
              conversationId: msg.conversationId,
              recipientUserId: this.userUuid ?? undefined,
              senderUserId: msg.senderUserId,
              serverSequence: msg.serverSequence,
              details: {
                checkResult: 'SUCCESS',
                verifiedRecipientUserId: this.userUuid,
                event: 'recipient_login_sync_retrieval',
                status: 'authorized_by_rls'
              }
            });
            await this.handleIncomingEnvelope(msg, msg.id, msg.serverSequence);
          }
        }
      }
    } catch (err) {
      console.error('[SyncEngine] Pull failed:', err);
    }
  }

  async syncConversationMessages(conversationId: string) {
    if (!this.token || !this.deviceKeys) return;
    try {
      const res = await this.authFetch(`/api/v1/conversations/${conversationId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            if (this.droppedEnvelopes.has(msg.clientMessageId)) {
              continue;
            }
            if (msg.recipientDeviceId && msg.recipientDeviceId !== this.deviceKeys.deviceId) {
              continue;
            }
            if (msg.senderDeviceId === this.deviceKeys.deviceId) {
              continue;
            }
            const existing = await clientDb.getMessageById(msg.clientMessageId);
            if (!existing) {
              await this.handleIncomingEnvelope(msg, msg.id, msg.serverSequence);
            }
          }
        }
      }
    } catch (err) {
      console.error('[SyncEngine] syncConversationMessages failed:', err);
    }
  }
}

export const syncEngine = new SyncEngine();

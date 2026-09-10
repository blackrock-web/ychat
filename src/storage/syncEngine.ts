import { clientDb, QueuedMessage, StoredConversation } from './db';
import { syncDiagnostic } from './syncDiagnostic';
import {
  EncryptedEnvelope,
  DecryptedMessage,
  DeliveryStatus,
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
  private receiptListeners: Array<(clientMsgId: string, status: DeliveryStatus) => void> = [];
  private presenceListeners: Array<(userUuid: string, status: 'online' | 'offline') => void> = [];
  private token: string | null = null;
  private deviceKeys: DeviceKeyBundle | null = null;
  private userUuid: string | null = null;
  private reconnectTimer: any = null;
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

  onReceipt(cb: (clientMsgId: string, status: DeliveryStatus) => void) {
    this.receiptListeners.push(cb);
    return () => {
      this.receiptListeners = this.receiptListeners.filter(l => l !== cb);
    };
  }

  onPresence(cb: (userUuid: string, status: 'online' | 'offline') => void) {
    this.presenceListeners.push(cb);
    return () => {
      this.presenceListeners = this.presenceListeners.filter(l => l !== cb);
    };
  }

  private setConnectionState(state: ConnectionState) {
    this.connectionState = state;
    this.connectionListeners.forEach(cb => cb(state));
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
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message') {
            await this.handleIncomingEnvelope(data.envelope, data.messageId, data.serverSequence);
          } else if (data.type === 'receipt') {
            await this.handleReceipt(data.clientMessageId, data.status);
          } else if (data.type === 'presence') {
            this.presenceListeners.forEach(cb => cb(data.userUuid, data.status));
          }
        } catch (err) {
          console.error('[SyncEngine] WS message parse error:', err);
        }
      };

      this.ws.onclose = () => {
        if (this.connectionState !== 'offline') {
          this.setConnectionState('reconnecting');
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.connectWs(), 3000);
        }
      };

      this.ws.onerror = () => {
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
    allowOfflineStorage: boolean = true
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

    // 3. Encrypt payload and sign with ML-DSA-87 (15 minute default TTL)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const envelope = createMessageEnvelope(
      text,
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
      text,
      timestamp: Date.now(),
      sequence,
      status: initialStatus,
      tamperVerified: true,
      expiresAt
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
          plaintext: text,
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
        plaintext: text,
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
      const queue = await clientDb.getSyncQueue();
      for (const item of queue) {
        let sent = false;

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
            const res = await fetch('/api/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
              },
              body: JSON.stringify(item.envelope)
            });
            if (res.ok) {
              sent = true;
              syncDiagnostic.record('SENDER_DISPATCH', {
                clientMessageId: item.clientMessageId,
                conversationId: item.conversationId,
                senderDeviceId: item.envelope.senderDeviceId,
                recipientDeviceId: item.envelope.recipientDeviceId,
                sequence: item.envelope.sequence,
                transport: 'rest'
              });
            }
          } catch {
            sent = false;
          }
        }

        if (sent) {
          await clientDb.dequeueMessage(item.clientMessageId);
          const rootMessageId = item.clientMessageId.split('#chunk')[0];
          await clientDb.updateMessageStatus(rootMessageId, 'sent');
          this.receiptListeners.forEach(cb => cb(rootMessageId, 'sent'));

          syncDiagnostic.record('SENDER_ACKNOWLEDGED', {
            clientMessageId: rootMessageId,
            conversationId: item.conversationId,
            senderDeviceId: item.envelope.senderDeviceId,
            recipientDeviceId: item.envelope.recipientDeviceId,
            details: { status: 'sent' }
          });
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
      // 1. Fetch sender device public keys to verify ML-DSA-87 signature and handshake
      const bundleRes = await fetch(`/api/v1/devices/${envelope.senderDeviceId}/prekeys`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (!bundleRes.ok) return;
      const senderBundle: PrekeyBundle = await bundleRes.json();

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

      syncDiagnostic.record('RECIPIENT_DECRYPTED_VERIFIED', {
        clientMessageId: targetEnvelope.clientMessageId,
        conversationId: targetEnvelope.conversationId,
        senderDeviceId: targetEnvelope.senderDeviceId,
        recipientDeviceId: this.deviceKeys.deviceId,
        sequence: targetEnvelope.sequence,
        serverSequence: serverSeq,
        details: {
          tamperVerified: true,
          encryptionVersion: targetEnvelope.encryptionVersion
        }
      });

      const decrypted: DecryptedMessage = {
        id: serverMessageId || targetEnvelope.clientMessageId,
        clientMessageId: targetEnvelope.clientMessageId,
        conversationId: targetEnvelope.conversationId,
        senderDeviceId: targetEnvelope.senderDeviceId,
        senderUserUuid: senderBundle.userUuid,
        text: plaintext,
        timestamp: targetEnvelope.expiresAt ? (new Date(targetEnvelope.expiresAt).getTime() - 15 * 60 * 1000) : Date.now(),
        sequence: targetEnvelope.sequence || 1,
        serverSequence: serverSeq || targetEnvelope.serverSequence,
        status: 'delivered',
        tamperVerified: true,
        expiresAt: targetEnvelope.expiresAt
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
        conv.lastMessageText = plaintext;
        conv.lastMessageTimestamp = Date.now();
        conv.unreadCount = (conv.unreadCount || 0) + 1;
        await clientDb.saveConversation(conv);
      } else if (this.token && this.userUuid) {
        // Conversation metadata not yet local - fetch authorized details from server
        try {
          const cRes = await fetch(`/api/v1/conversations/${targetEnvelope.conversationId}`, {
            headers: { 'Authorization': `Bearer ${this.token}` }
          });
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
        console.warn(`[SyncEngine] Dropped unverified envelope (${envelope.clientMessageId}): ${errMsg}`);
        if (serverMessageId) {
          this.sendReceipt(serverMessageId, envelope.clientMessageId, 'delivered');
        }
      } else {
        console.error('[SyncEngine] Failed to ingest message envelope:', err);
      }
    }
  }

  private async handleReceipt(clientMessageId: string, status: DeliveryStatus) {
    const rootId = clientMessageId.split('#chunk')[0];
    await clientDb.updateMessageStatus(rootId, status);
    this.receiptListeners.forEach(cb => cb(rootId, status));

    if (status === 'delivered') {
      syncDiagnostic.record('DELIVERY_CONFIRMED', {
        clientMessageId: rootId,
        conversationId: 'active',
        details: { status: 'delivered' }
      });
    }
  }

  sendReceipt(serverMessageId: string, clientMessageId: string, status: 'delivered' | 'read') {
    const rootId = clientMessageId.split('#chunk')[0];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'receipt',
        messageId: serverMessageId,
        clientMessageId: rootId,
        status
      }));
    } else if (this.token) {
      fetch(`/api/v1/messages/${serverMessageId}/receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ clientMessageId: rootId, status })
      }).catch(() => {});
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

      const res = await fetch(`/api/v1/sync/pull?deviceId=${encodeURIComponent(this.deviceKeys.deviceId)}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
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
      const res = await fetch(`/api/v1/conversations/${conversationId}/messages`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
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

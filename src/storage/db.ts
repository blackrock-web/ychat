import {
  DecryptedMessage,
  RatchetSession,
  Blake3ChainState,
  EncryptedEnvelope
} from '../crypto/types';
import { DeviceKeyBundle } from '../crypto/keys';
import { createAtRestDriver, isEncryptedAtRest, AtRestStorageDriver } from '../crypto/atRest';

const DB_VERSION = 2;

export interface StoredConversation {
  id: string;
  ownerUserId?: string; // Strict user isolation: scopes conversation cache strictly to the authenticated user
  recipientUuid: string;
  recipientUsername: string;
  recipientDisplayName: string;
  recipientAvatarUrl?: string;
  lastMessageText?: string;
  lastMessageTimestamp?: number;
  unreadCount: number;
  isVerifiedSafetyNumber?: boolean;
}

export interface QueuedMessage {
  clientMessageId: string;
  conversationId: string;
  recipientDeviceId: string;
  envelope: EncryptedEnvelope;
  plaintext: string;
  timestamp: number;
  retries: number;
  lastAttempt?: number;
  failureReason?: string;
}

class ClientStorage {
  private activeUserId: string | null = null;
  private dbInstance: IDBDatabase | null = null;
  private dbOpeningPromise: Promise<IDBDatabase | null> | null = null;
  private atRestDriver: AtRestStorageDriver | null = null;

  private memoryStore = {
    deviceKeys: new Map<string, DeviceKeyBundle>(),
    sessions: new Map<string, RatchetSession>(),
    conversations: new Map<string, StoredConversation>(),
    messages: new Map<string, DecryptedMessage>(),
    blake3Chains: new Map<string, Blake3ChainState>(),
    syncQueue: new Map<string, QueuedMessage>()
  };

  /**
   * Initializes user-scoped storage and Domain 2 AES-256-GCM at-rest encryption.
   * Each user gets their own dedicated, isolated IndexedDB database named `ychat_client_storage_${userId}`.
   * The local storage driver derives a wrapping key via WebCrypto (or OS keychain / Android Keystore)
   * to wrap the AES-256-GCM data encryption key protecting decrypted caches and private keys at rest.
   */
  async initUserScope(userId: string, unlockSecret?: string): Promise<void> {
    // If already scoped to this user and connection is alive, reuse
    if (this.activeUserId === userId && this.atRestDriver?.isUnlocked()) {
      if (this.dbInstance) return;
      if (this.dbOpeningPromise) {
        await this.dbOpeningPromise;
        return;
      }
    }

    // Safely release previous connection reference if switching users
    const previousDb = this.dbInstance;
    this.dbInstance = null;
    this.dbOpeningPromise = null;
    if (previousDb) {
      try {
        previousDb.close();
      } catch {}
    }

    this.clearMemoryStore();
    this.activeUserId = userId;

    // Initialize Domain 2 At-Rest Storage Driver
    try {
      this.atRestDriver = createAtRestDriver();
      await this.atRestDriver.initialize(userId, unlockSecret);
    } catch (err) {
      console.error('Failed to initialize Domain 2 at-rest encryption driver:', err);
    }

    await this.getDB(true);
  }

  /**
   * Resets active session credentials, locks the at-rest encryption driver,
   * and purges all in-memory caches upon sign-out.
   */
  clearUserScope(): void {
    const previousDb = this.dbInstance;
    this.dbInstance = null;
    this.dbOpeningPromise = null;
    this.activeUserId = null;
    this.clearMemoryStore();
    if (this.atRestDriver) {
      this.atRestDriver.lock();
      this.atRestDriver = null;
    }
    if (previousDb) {
      try {
        previousDb.close();
      } catch {}
    }
  }

  getAtRestDriver(): AtRestStorageDriver | null {
    return this.atRestDriver;
  }

  getActiveUserId(): string | null {
    return this.activeUserId;
  }

  private clearMemoryStore(): void {
    this.memoryStore.deviceKeys.clear();
    this.memoryStore.sessions.clear();
    this.memoryStore.conversations.clear();
    this.memoryStore.messages.clear();
    this.memoryStore.blake3Chains.clear();
    this.memoryStore.syncQueue.clear();
  }

  private openUserDB(userId: string): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return Promise.resolve(null);
    }

    const dbName = `ychat_client_storage_${userId}`;

    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(dbName, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('deviceKeys')) db.createObjectStore('deviceKeys', { keyPath: 'deviceId' });
          if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'sessionId' });
          if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('messages')) {
            const msgStore = db.createObjectStore('messages', { keyPath: 'clientMessageId' });
            msgStore.createIndex('conversationId', 'conversationId', { unique: false });
          }
          if (!db.objectStoreNames.contains('blake3Chains')) db.createObjectStore('blake3Chains', { keyPath: 'conversationId' });
          if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'clientMessageId' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async getDB(forceRefresh: boolean = false): Promise<IDBDatabase | null> {
    if (!this.activeUserId) return null;

    if (!forceRefresh && this.dbInstance) {
      return this.dbInstance;
    }

    if (!forceRefresh && this.dbOpeningPromise) {
      return this.dbOpeningPromise;
    }

    const currentUserId = this.activeUserId;
    const promise = this.openUserDB(currentUserId)
      .then((db) => {
        if (this.activeUserId === currentUserId) {
          this.dbInstance = db;
          if (db) {
            db.onclose = () => {
              if (this.dbInstance === db) {
                this.dbInstance = null;
              }
            };
            db.onversionchange = () => {
              try {
                db.close();
              } catch {}
              if (this.dbInstance === db) {
                this.dbInstance = null;
              }
            };
          }
        } else {
          try {
            db?.close();
          } catch {}
        }
        return this.activeUserId === currentUserId ? db : null;
      })
      .catch(() => null);

    this.dbOpeningPromise = promise;
    try {
      const result = await promise;
      return result;
    } finally {
      if (this.dbOpeningPromise === promise) {
        this.dbOpeningPromise = null;
      }
    }
  }

  /**
   * Resilient transaction runner that protects against 'The database connection is closing'
   * by catching connection invalidation, forcing an automatic reconnection, and falling back
   * safely to the in-memory cache if IndexedDB is in an invalid state.
   */
  private async runTransaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<T>
  ): Promise<T | null> {
    const attempt = async (isRetry: boolean): Promise<T | null> => {
      const db = await this.getDB(isRetry);
      if (!db) return null;

      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, mode);
      } catch (err: any) {
        const isClosing =
          err?.name === 'InvalidStateError' ||
          (err?.message && String(err.message).toLowerCase().includes('closing'));

        if (isClosing && !isRetry) {
          this.dbInstance = null;
          return attempt(true);
        }
        return null;
      }

      return new Promise<T | null>((resolve) => {
        let finished = false;

        tx.onerror = () => {
          if (!finished) {
            finished = true;
            resolve(null);
          }
        };

        tx.onabort = () => {
          if (!finished) {
            finished = true;
            resolve(null);
          }
        };

        try {
          const store = tx.objectStore(storeName);
          operation(store)
            .then((val) => {
              if (!finished) {
                finished = true;
                resolve(val);
              }
            })
            .catch(() => {
              if (!finished) {
                finished = true;
                resolve(null);
              }
            });
        } catch {
          if (!finished) {
            finished = true;
            resolve(null);
          }
        }
      });
    };

    try {
      return await attempt(false);
    } catch {
      return null;
    }
  }

  // ==========================================
  // Device Keys Storage (Encrypted at rest with AES-256-GCM)
  // ==========================================
  async saveDeviceKeys(bundle: DeviceKeyBundle): Promise<void> {
    this.memoryStore.deviceKeys.set(bundle.deviceId, bundle);

    let recordToStore: any = bundle;
    if (this.atRestDriver?.isUnlocked()) {
      try {
        const encrypted = await this.atRestDriver.encryptPayload(bundle);
        recordToStore = {
          deviceId: bundle.deviceId,
          ...encrypted
        };
      } catch (err) {
        console.warn('Failed to encrypt device keys at rest, storing fallback:', err);
      }
    }

    await this.runTransaction('deviceKeys', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(recordToStore);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  private async ensureAtRestUnlocked(): Promise<boolean> {
    if (this.atRestDriver?.isUnlocked()) return true;
    if (this.activeUserId) {
      try {
        if (!this.atRestDriver) this.atRestDriver = createAtRestDriver();
        await this.atRestDriver.initialize(this.activeUserId);
        return this.atRestDriver.isUnlocked();
      } catch {
        return false;
      }
    }
    return false;
  }

  async getDeviceKeys(deviceId: string): Promise<DeviceKeyBundle | null> {
    const mem = this.memoryStore.deviceKeys.get(deviceId);
    if (mem && mem.publicKeys && mem.privateKeys) return mem;

    const result = await this.runTransaction('deviceKeys', 'readonly', (store) => {
      return new Promise<any>((resolve) => {
        const req = store.get(deviceId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      let resolved: DeviceKeyBundle | null = null;
      if (isEncryptedAtRest(result)) {
        await this.ensureAtRestUnlocked();
        if (this.atRestDriver?.isUnlocked()) {
          try {
            resolved = await this.atRestDriver.decryptPayload<DeviceKeyBundle>(result);
          } catch (err) {
            console.error('Failed to decrypt device keys with at-rest key:', err);
            return null;
          }
        } else {
          return null;
        }
      } else {
        resolved = result;
      }

      if (resolved && resolved.publicKeys && resolved.privateKeys) {
        this.memoryStore.deviceKeys.set(resolved.deviceId, resolved);
        return resolved;
      }
      return null;
    }
    return null;
  }

  async getAnySavedDeviceKeys(): Promise<DeviceKeyBundle | null> {
    for (const mem of this.memoryStore.deviceKeys.values()) {
      if (mem && mem.publicKeys && mem.privateKeys) return mem;
    }

    const result = await this.runTransaction('deviceKeys', 'readonly', (store) => {
      return new Promise<any>((resolve) => {
        const req = store.getAll(undefined, 1);
        req.onsuccess = () => resolve(req.result?.[0] || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      let resolved: DeviceKeyBundle | null = null;
      if (isEncryptedAtRest(result)) {
        await this.ensureAtRestUnlocked();
        if (this.atRestDriver?.isUnlocked()) {
          try {
            resolved = await this.atRestDriver.decryptPayload<DeviceKeyBundle>(result);
          } catch (err) {
            console.error('Failed to decrypt device keys with at-rest key:', err);
            return null;
          }
        } else {
          return null;
        }
      } else {
        resolved = result;
      }

      if (resolved && resolved.publicKeys && resolved.privateKeys) {
        this.memoryStore.deviceKeys.set(resolved.deviceId, resolved);
        return resolved;
      }
      return null;
    }
    return null;
  }

  // ==========================================
  // Ratchet Session Storage (Encrypted at rest with AES-256-GCM)
  // ==========================================
  async saveSession(session: RatchetSession): Promise<void> {
    this.memoryStore.sessions.set(session.sessionId, session);

    let recordToStore: any = session;
    if (this.atRestDriver?.isUnlocked()) {
      try {
        const encrypted = await this.atRestDriver.encryptPayload(session);
        recordToStore = {
          sessionId: session.sessionId,
          ...encrypted
        };
      } catch (err) {
        console.warn('Failed to encrypt session at rest, storing fallback:', err);
      }
    }

    await this.runTransaction('sessions', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(recordToStore);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getSession(sessionId: string): Promise<RatchetSession | null> {
    const mem = this.memoryStore.sessions.get(sessionId);
    if (mem && (mem.masterSecret || mem.sessionKey)) return mem;

    const result = await this.runTransaction('sessions', 'readonly', (store) => {
      return new Promise<any>((resolve) => {
        const req = store.get(sessionId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      let resolved: RatchetSession | null = null;
      if (isEncryptedAtRest(result)) {
        await this.ensureAtRestUnlocked();
        if (this.atRestDriver?.isUnlocked()) {
          try {
            resolved = await this.atRestDriver.decryptPayload<RatchetSession>(result);
          } catch (err) {
            console.error('Failed to decrypt session with at-rest key:', err);
            return null;
          }
        } else {
          return null;
        }
      } else {
        resolved = result;
      }

      if (resolved && resolved.sessionId) {
        this.memoryStore.sessions.set(resolved.sessionId, resolved);
        return resolved;
      }
      return null;
    }
    return null;
  }

  // ==========================================
  // Conversations Storage (Isolated per participant)
  // ==========================================
  async saveConversation(conv: StoredConversation): Promise<void> {
    const scopedConv: StoredConversation = {
      ...conv,
      ownerUserId: this.activeUserId || conv.ownerUserId
    };
    this.memoryStore.conversations.set(scopedConv.id, scopedConv);

    await this.runTransaction('conversations', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(scopedConv);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getConversation(convId: string): Promise<StoredConversation | null> {
    const mem = this.memoryStore.conversations.get(convId);
    if (mem) return mem;

    const result = await this.runTransaction('conversations', 'readonly', (store) => {
      return new Promise<StoredConversation | null>((resolve) => {
        const req = store.get(convId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memoryStore.conversations.set(result.id, result);
      return result;
    }
    return null;
  }

  async getAllConversations(expectedUserId?: string): Promise<StoredConversation[]> {
    const targetUserId = expectedUserId || this.activeUserId;

    const dbResult = await this.runTransaction('conversations', 'readonly', (store) => {
      return new Promise<StoredConversation[]>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []) as StoredConversation[]);
        req.onerror = () => resolve([]);
      });
    });

    if (dbResult && dbResult.length > 0) {
      dbResult.forEach(c => this.memoryStore.conversations.set(c.id, c));
      if (targetUserId) {
        return dbResult.filter(c => !c.ownerUserId || c.ownerUserId === targetUserId);
      }
      return dbResult;
    }

    const list = Array.from(this.memoryStore.conversations.values());
    if (targetUserId) {
      return list.filter(c => !c.ownerUserId || c.ownerUserId === targetUserId);
    }
    return list;
  }

  async pruneUnauthorizedConversations(ownerUserId: string, authorizedConvIds: Set<string>): Promise<void> {
    for (const [id, conv] of this.memoryStore.conversations.entries()) {
      if (conv.ownerUserId === ownerUserId && !authorizedConvIds.has(id)) {
        this.memoryStore.conversations.delete(id);
      }
    }

    await this.runTransaction('conversations', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const list = (req.result || []) as StoredConversation[];
          for (const item of list) {
            if (item.ownerUserId === ownerUserId && !authorizedConvIds.has(item.id)) {
              store.delete(item.id);
            }
          }
          resolve();
        };
        req.onerror = () => resolve();
      });
    });
  }

  // ==========================================
  // Messages Storage (Encrypted at rest with AES-256-GCM)
  // ==========================================
  async saveMessage(msg: DecryptedMessage): Promise<void> {
    this.memoryStore.messages.set(msg.clientMessageId, msg);

    let recordToStore: any = msg;
    if (this.atRestDriver?.isUnlocked()) {
      try {
        const encrypted = await this.atRestDriver.encryptPayload(msg);
        recordToStore = {
          clientMessageId: msg.clientMessageId,
          conversationId: msg.conversationId,
          timestamp: msg.timestamp,
          serverSequence: msg.serverSequence,
          status: msg.status,
          ...encrypted
        };
      } catch (err) {
        console.warn('Failed to encrypt message at rest, storing fallback:', err);
      }
    }

    await this.runTransaction('messages', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(recordToStore);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getMessageById(clientMessageId: string): Promise<DecryptedMessage | null> {
    const mem = this.memoryStore.messages.get(clientMessageId);
    if (mem) return mem;

    const result = await this.runTransaction('messages', 'readonly', (store) => {
      return new Promise<any>((resolve) => {
        const req = store.get(clientMessageId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      let resolved: DecryptedMessage | null = null;
      if (isEncryptedAtRest(result)) {
        await this.ensureAtRestUnlocked();
        if (this.atRestDriver?.isUnlocked()) {
          try {
            resolved = await this.atRestDriver.decryptPayload<DecryptedMessage>(result);
          } catch (err) {
            console.error('Failed to decrypt message at rest:', err);
            return null;
          }
        } else {
          return null;
        }
      } else {
        resolved = result;
      }

      if (resolved && resolved.clientMessageId) {
        this.memoryStore.messages.set(resolved.clientMessageId, resolved);
        return resolved;
      }
      return null;
    }
    return null;
  }

  async getMessagesForConversation(convId: string): Promise<DecryptedMessage[]> {
    const sortFn = (a: DecryptedMessage, b: DecryptedMessage) => {
      if (a.serverSequence !== undefined && b.serverSequence !== undefined) {
        return a.serverSequence - b.serverSequence;
      }
      return a.timestamp - b.timestamp;
    };

    const dbResult = await this.runTransaction('messages', 'readonly', (store) => {
      return new Promise<any[]>((resolve) => {
        try {
          const index = store.index('conversationId');
          const req = index.getAll(convId);
          req.onsuccess = () => resolve((req.result || []) as any[]);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    });

    if (dbResult && dbResult.length > 0) {
      await this.ensureAtRestUnlocked();
      const decryptedList: DecryptedMessage[] = [];
      for (const raw of dbResult) {
        if (isEncryptedAtRest(raw)) {
          if (this.atRestDriver?.isUnlocked()) {
            try {
              const dec = await this.atRestDriver.decryptPayload<DecryptedMessage>(raw);
              if (dec && dec.clientMessageId) decryptedList.push(dec);
            } catch (err) {
              console.warn('Failed to decrypt at-rest message record:', err);
            }
          }
        } else if (raw && raw.clientMessageId) {
          decryptedList.push(raw as DecryptedMessage);
        }
      }

      decryptedList.sort(sortFn);
      decryptedList.forEach(m => this.memoryStore.messages.set(m.clientMessageId, m));
      return decryptedList;
    }

    return Array.from(this.memoryStore.messages.values())
      .filter(m => m.conversationId === convId)
      .sort(sortFn);
  }

  async getFailedMessages(convId?: string): Promise<DecryptedMessage[]> {
    const all = Array.from(this.memoryStore.messages.values());
    return all.filter(m => m.status === 'failed' && (!convId || m.conversationId === convId));
  }

  async updateMessageStatus(
    clientMessageId: string,
    status: DecryptedMessage['status'],
    meta?: { failureReason?: string; errorMessage?: string; retryCount?: number }
  ): Promise<void> {
    const mem = this.memoryStore.messages.get(clientMessageId);
    if (mem) {
      mem.status = status;
      if (meta?.failureReason) mem.failureReason = meta.failureReason as any;
      if (meta?.errorMessage) mem.errorMessage = meta.errorMessage;
      if (meta?.retryCount !== undefined) mem.retryCount = meta.retryCount;
    }

    await this.runTransaction('messages', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.get(clientMessageId);
        req.onsuccess = async () => {
          if (req.result) {
            let record = req.result;
            if (isEncryptedAtRest(record) && this.atRestDriver?.isUnlocked()) {
              try {
                const dec = await this.atRestDriver.decryptPayload<DecryptedMessage>(record);
                dec.status = status;
                if (meta?.failureReason) dec.failureReason = meta.failureReason as any;
                if (meta?.errorMessage) dec.errorMessage = meta.errorMessage;
                if (meta?.retryCount !== undefined) dec.retryCount = meta.retryCount;
                const encrypted = await this.atRestDriver.encryptPayload(dec);
                record = {
                  clientMessageId: dec.clientMessageId,
                  conversationId: dec.conversationId,
                  timestamp: dec.timestamp,
                  serverSequence: dec.serverSequence,
                  status,
                  ...encrypted
                };
              } catch {}
            } else {
              record.status = status;
              if (meta?.failureReason) record.failureReason = meta.failureReason;
              if (meta?.errorMessage) record.errorMessage = meta.errorMessage;
              if (meta?.retryCount !== undefined) record.retryCount = meta.retryCount;
            }
            store.put(record);
          }
          resolve();
        };
        req.onerror = () => resolve();
      });
    });
  }

  async updateMessageReactions(clientMessageId: string, emoji: string, userUuid: string): Promise<DecryptedMessage | null> {
    const mem = this.memoryStore.messages.get(clientMessageId);
    let updatedMessage: DecryptedMessage | null = null;
    if (mem) {
      const reactions = { ...(mem.reactions || {}) };
      const users = new Set(reactions[emoji] || []);
      if (users.has(userUuid)) {
        users.delete(userUuid);
      } else {
        users.add(userUuid);
      }
      if (users.size === 0) {
        delete reactions[emoji];
      } else {
        reactions[emoji] = Array.from(users);
      }
      mem.reactions = reactions;
      updatedMessage = mem;
    }

    await this.runTransaction('messages', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.get(clientMessageId);
        req.onsuccess = async () => {
          if (req.result) {
            let record = req.result;
            if (isEncryptedAtRest(record) && this.atRestDriver?.isUnlocked()) {
              try {
                const dec = await this.atRestDriver.decryptPayload<DecryptedMessage>(record);
                const reactions = { ...(dec.reactions || {}) };
                const users = new Set(reactions[emoji] || []);
                if (users.has(userUuid)) {
                  users.delete(userUuid);
                } else {
                  users.add(userUuid);
                }
                if (users.size === 0) {
                  delete reactions[emoji];
                } else {
                  reactions[emoji] = Array.from(users);
                }
                dec.reactions = reactions;
                const encrypted = await this.atRestDriver.encryptPayload(dec);
                record = {
                  clientMessageId: dec.clientMessageId,
                  conversationId: dec.conversationId,
                  timestamp: dec.timestamp,
                  serverSequence: dec.serverSequence,
                  status: dec.status,
                  ...encrypted
                };
                if (!updatedMessage) updatedMessage = dec;
              } catch {}
            } else {
              const reactions = { ...(record.reactions || {}) };
              const users = new Set(reactions[emoji] || []);
              if (users.has(userUuid)) {
                users.delete(userUuid);
              } else {
                users.add(userUuid);
              }
              if (users.size === 0) {
                delete reactions[emoji];
              } else {
                reactions[emoji] = Array.from(users);
              }
              record.reactions = reactions;
              if (!updatedMessage) updatedMessage = record;
            }
            store.put(record);
          }
          resolve();
        };
        req.onerror = () => resolve();
      });
    });

    return updatedMessage;
  }

  async deleteMessage(clientMessageId: string): Promise<void> {
    this.memoryStore.messages.delete(clientMessageId);
    await this.runTransaction('messages', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.delete(clientMessageId);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  async clearMessagesForConversation(convId: string): Promise<void> {
    for (const [id, msg] of this.memoryStore.messages.entries()) {
      if (msg.conversationId === convId) {
        this.memoryStore.messages.delete(id);
      }
    }
    await this.runTransaction('messages', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        try {
          const index = store.index('conversationId');
          const req = index.getAllKeys(convId);
          req.onsuccess = () => {
            const keys = req.result || [];
            keys.forEach((k) => store.delete(k));
            resolve();
          };
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    });
  }

  // ==========================================
  // BLAKE3 Chain Storage
  // ==========================================
  async saveBlake3Chain(chain: Blake3ChainState): Promise<void> {
    this.memoryStore.blake3Chains.set(chain.conversationId, chain);

    await this.runTransaction('blake3Chains', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.put(chain);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  async getBlake3Chain(convId: string): Promise<Blake3ChainState | null> {
    const mem = this.memoryStore.blake3Chains.get(convId);
    if (mem) return mem;

    const result = await this.runTransaction('blake3Chains', 'readonly', (store) => {
      return new Promise<Blake3ChainState | null>((resolve) => {
        const req = store.get(convId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memoryStore.blake3Chains.set(result.conversationId, result);
      return result;
    }
    return null;
  }

  // ==========================================
  // Sync Queue Storage (Encrypted at rest with AES-256-GCM)
  // ==========================================
  async enqueueMessage(item: QueuedMessage): Promise<void> {
    this.memoryStore.syncQueue.set(item.clientMessageId, item);

    let recordToStore: any = item;
    if (this.atRestDriver?.isUnlocked()) {
      try {
        const encrypted = await this.atRestDriver.encryptPayload(item);
        recordToStore = {
          clientMessageId: item.clientMessageId,
          conversationId: item.conversationId,
          timestamp: item.timestamp,
          ...encrypted
        };
      } catch (err) {
        console.warn('Failed to encrypt queued message at rest:', err);
      }
    }

    await this.runTransaction('syncQueue', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.put(recordToStore);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  async dequeueMessage(clientMessageId: string): Promise<void> {
    this.memoryStore.syncQueue.delete(clientMessageId);

    await this.runTransaction('syncQueue', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.delete(clientMessageId);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  async getSyncQueue(): Promise<QueuedMessage[]> {
    const dbResult = await this.runTransaction('syncQueue', 'readonly', (store) => {
      return new Promise<any[]>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []) as any[]);
        req.onerror = () => resolve([]);
      });
    });

    if (dbResult && dbResult.length > 0) {
      const decryptedList: QueuedMessage[] = [];
      for (const raw of dbResult) {
        if (isEncryptedAtRest(raw) && this.atRestDriver?.isUnlocked()) {
          try {
            const dec = await this.atRestDriver.decryptPayload<QueuedMessage>(raw);
            decryptedList.push(dec);
          } catch (err) {
            console.warn('Failed to decrypt queued message at rest:', err);
          }
        } else {
          decryptedList.push(raw as QueuedMessage);
        }
      }
      return decryptedList;
    }
    return Array.from(this.memoryStore.syncQueue.values());
  }
}

export const clientDb = new ClientStorage();

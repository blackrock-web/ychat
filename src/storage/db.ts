import {
  DecryptedMessage,
  RatchetSession,
  Blake3ChainState,
  EncryptedEnvelope
} from '../crypto/types';
import { DeviceKeyBundle } from '../crypto/keys';

const DB_VERSION = 2;

export interface StoredConversation {
  id: string;
  ownerUserId?: string; // Strict user isolation: scopes conversation cache strictly to the authenticated user
  recipientUuid: string;
  recipientUsername: string;
  recipientDisplayName: string;
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
}

class ClientStorage {
  private activeUserId: string | null = null;
  private dbInstance: IDBDatabase | null = null;
  private dbOpeningPromise: Promise<IDBDatabase | null> | null = null;

  private memoryStore = {
    deviceKeys: new Map<string, DeviceKeyBundle>(),
    sessions: new Map<string, RatchetSession>(),
    conversations: new Map<string, StoredConversation>(),
    messages: new Map<string, DecryptedMessage>(),
    blake3Chains: new Map<string, Blake3ChainState>(),
    syncQueue: new Map<string, QueuedMessage>()
  };

  /**
   * Initializes user-scoped storage. Each user gets their own dedicated, isolated IndexedDB
   * database named `ychat_client_storage_${userId}`. This enforces strict participant isolation
   * and prevents any data from leaking across user sessions.
   */
  async initUserScope(userId: string): Promise<void> {
    // If already scoped to this user and connection is alive or opening, do not close
    if (this.activeUserId === userId) {
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
    await this.getDB(true);
  }

  /**
   * Resets active session credentials and purges all in-memory caches upon sign-out.
   */
  clearUserScope(): void {
    const previousDb = this.dbInstance;
    this.dbInstance = null;
    this.dbOpeningPromise = null;
    this.activeUserId = null;
    this.clearMemoryStore();
    if (previousDb) {
      try {
        previousDb.close();
      } catch {}
    }
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
  // Device Keys Storage
  // ==========================================
  async saveDeviceKeys(bundle: DeviceKeyBundle): Promise<void> {
    this.memoryStore.deviceKeys.set(bundle.deviceId, bundle);
    await this.runTransaction('deviceKeys', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(bundle);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getDeviceKeys(deviceId: string): Promise<DeviceKeyBundle | null> {
    const mem = this.memoryStore.deviceKeys.get(deviceId);
    if (mem) return mem;

    const result = await this.runTransaction('deviceKeys', 'readonly', (store) => {
      return new Promise<DeviceKeyBundle | null>((resolve) => {
        const req = store.get(deviceId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memoryStore.deviceKeys.set(result.deviceId, result);
      return result;
    }
    return null;
  }

  async getAnySavedDeviceKeys(): Promise<DeviceKeyBundle | null> {
    if (this.memoryStore.deviceKeys.size > 0) {
      return this.memoryStore.deviceKeys.values().next().value || null;
    }

    const result = await this.runTransaction('deviceKeys', 'readonly', (store) => {
      return new Promise<DeviceKeyBundle | null>((resolve) => {
        const req = store.getAll(undefined, 1);
        req.onsuccess = () => resolve(req.result?.[0] || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memoryStore.deviceKeys.set(result.deviceId, result);
      return result;
    }
    return null;
  }

  // ==========================================
  // Ratchet Session Storage
  // ==========================================
  async saveSession(session: RatchetSession): Promise<void> {
    this.memoryStore.sessions.set(session.sessionId, session);
    await this.runTransaction('sessions', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(session);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getSession(sessionId: string): Promise<RatchetSession | null> {
    const mem = this.memoryStore.sessions.get(sessionId);
    if (mem) return mem;

    const result = await this.runTransaction('sessions', 'readonly', (store) => {
      return new Promise<RatchetSession | null>((resolve) => {
        const req = store.get(sessionId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memoryStore.sessions.set(result.sessionId, result);
      return result;
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
  // Messages Storage
  // ==========================================
  async saveMessage(msg: DecryptedMessage): Promise<void> {
    this.memoryStore.messages.set(msg.clientMessageId, msg);

    await this.runTransaction('messages', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(msg);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getMessageById(clientMessageId: string): Promise<DecryptedMessage | null> {
    const mem = this.memoryStore.messages.get(clientMessageId);
    if (mem) return mem;

    return await this.runTransaction('messages', 'readonly', (store) => {
      return new Promise<DecryptedMessage | null>((resolve) => {
        const req = store.get(clientMessageId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });
  }

  async getMessagesForConversation(convId: string): Promise<DecryptedMessage[]> {
    const sortFn = (a: DecryptedMessage, b: DecryptedMessage) => {
      if (a.serverSequence !== undefined && b.serverSequence !== undefined) {
        return a.serverSequence - b.serverSequence;
      }
      return a.timestamp - b.timestamp;
    };

    const dbResult = await this.runTransaction('messages', 'readonly', (store) => {
      return new Promise<DecryptedMessage[]>((resolve) => {
        try {
          const index = store.index('conversationId');
          const req = index.getAll(convId);
          req.onsuccess = () => resolve((req.result || []) as DecryptedMessage[]);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    });

    if (dbResult && dbResult.length > 0) {
      dbResult.sort(sortFn);
      dbResult.forEach(m => this.memoryStore.messages.set(m.clientMessageId, m));
      return dbResult;
    }

    return Array.from(this.memoryStore.messages.values())
      .filter(m => m.conversationId === convId)
      .sort(sortFn);
  }

  async updateMessageStatus(clientMessageId: string, status: DecryptedMessage['status']): Promise<void> {
    const mem = this.memoryStore.messages.get(clientMessageId);
    if (mem) {
      mem.status = status;
    }

    await this.runTransaction('messages', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.get(clientMessageId);
        req.onsuccess = () => {
          if (req.result) {
            req.result.status = status;
            store.put(req.result);
          }
          resolve();
        };
        req.onerror = () => resolve();
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
  // Sync Queue Storage
  // ==========================================
  async enqueueMessage(item: QueuedMessage): Promise<void> {
    this.memoryStore.syncQueue.set(item.clientMessageId, item);

    await this.runTransaction('syncQueue', 'readwrite', (store) => {
      return new Promise<void>((resolve) => {
        const req = store.put(item);
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
      return new Promise<QueuedMessage[]>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []) as QueuedMessage[]);
        req.onerror = () => resolve([]);
      });
    });

    if (dbResult && dbResult.length > 0) {
      return dbResult;
    }
    return Array.from(this.memoryStore.syncQueue.values());
  }
}

export const clientDb = new ClientStorage();

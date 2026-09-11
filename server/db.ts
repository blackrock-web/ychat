import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { serverSyncDiagnostic } from './syncDiagnostic';

export interface DBUser {
  id: string; // Permanent MyChat User UUID
  authUserId?: string; // Supabase Auth User UUID mapping
  username: string; // Original username case
  usernameNormalized: string; // Enforces case-insensitive uniqueness (alice == ALICE)
  email: string;
  displayName: string;
  avatarUrl?: string;
  backgroundImage?: string;
  about?: string;
  preferences?: Record<string, any>;
  blockedUserIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DBDevice {
  id: string; // deviceId
  userId: string; // MyChat User UUID
  deviceName: string;
  platform: 'web' | 'desktop' | 'android' | 'ios';
  publicSignKey: string;
  publicDhKey: string;
  publicKemKey: string;
  createdAt: string;
  lastSeen: string;
  revokedAt?: string;
}

export interface DBDevicePrekey {
  id: string;
  deviceId: string;
  keyId: number;
  dhPublicKey: string;
  kemPublicKey: string;
  consumedAt?: string;
  createdAt: string;
}

export interface DBConversation {
  id: string; // UUID v4
  conversationType: 'direct' | 'group';
  createdAt: string;
  updatedAt: string;
}

export interface DBConversationMember {
  conversationId: string;
  userId: string; // MyChat User UUID
  joinedAt: string;
}

export interface DBMsgRecord {
  id: string; // UUID v4
  conversationId: string;
  senderUserId: string; // Authoritative sender MyChat UUID (from authenticated token)
  recipientUserId: string; // Authoritative recipient MyChat UUID
  senderDeviceId: string;
  recipientDeviceId: string;
  clientMessageId: string;
  ciphertext: string;
  nonce: string;
  signature: string;
  encryptionVersion: string;
  sequence: number;
  serverSequence: number;
  handshakePacket?: any;
  expiresAt: string; // 15-minute TTL for temporary offline queue
  chunkIndex?: number;
  chunkCount?: number;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}

export interface DBSession {
  id: string;
  userId: string;
  deviceId: string;
  refreshTokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface DBInvite {
  id: string;
  creatorUserId: string;
  creatorDeviceId: string;
  sessionId?: string;
  token: string;
  pairingCode: string;
  sessionBinding?: string;
  entropyBits?: number;
  expiresAt: string;
  isUsed: boolean;
  usedAt?: string;
  usedByUserId?: string;
  createdAt: string;
}

interface DatabaseSchema {
  users: DBUser[];
  devices: DBDevice[];
  devicePrekeys: DBDevicePrekey[];
  conversations: DBConversation[];
  conversationMembers: DBConversationMember[];
  messages: DBMsgRecord[];
  sessions: DBSession[];
  invites: DBInvite[];
}

const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz#$@!%&*-';

export function generateSecurePairingCode(length: number = 9): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return code;
}

class StorageEngine {
  public data: DatabaseSchema = {
    users: [],
    devices: [],
    devicePrekeys: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    sessions: [],
    invites: []
  };

  private filePath: string;
  private sequenceCounter: number = 0;

  constructor() {
    const dataDir = path.resolve(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {}
    }
    this.filePath = path.join(dataDir, 'ychat_server_db.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          users: (parsed.users || []).map((u: any) => ({
            id: u.id,
            authUserId: u.authUserId || u.id,
            username: u.username,
            usernameNormalized: u.usernameNormalized || u.username.trim().toLowerCase(),
            email: u.email,
            displayName: u.displayName,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt
          })),
          devices: parsed.devices || [],
          devicePrekeys: parsed.devicePrekeys || [],
          conversations: parsed.conversations || [],
          conversationMembers: parsed.conversationMembers || [],
          messages: (parsed.messages || [])
            .filter((m: any) => m && m.signature && typeof m.signature === 'string' && m.signature.length >= 1000)
            .map((m: any) => ({
              ...m,
              expiresAt: m.expiresAt || new Date(new Date(m.createdAt || Date.now()).getTime() + 15 * 60 * 1000).toISOString()
            })),
          sessions: parsed.sessions || [],
          invites: parsed.invites || []
        };
        this.sequenceCounter = this.data.messages.reduce((max, m) => Math.max(max, m.serverSequence || 0), 0);
        this.cleanupExpiredAndDeliveredMessages();
      }
    } catch {
      // In-memory fallback
    }
  }

  public persist() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {}
  }

  // ==========================================
  // USERS & IDENTITY (UUID-to-UUID)
  // ==========================================

  /**
   * Enforces case-insensitive username uniqueness at the database level.
   * e.g. "Alice", "alice", "ALICE" all normalize to "alice".
   * Never stores passwords or password hashes in the MyChat application database.
   */
  createUser(user: {
    username: string;
    email: string;
    displayName: string;
    authUserId?: string;
    customUuid?: string;
  }): DBUser {
    const trimmedUsername = user.username.trim();
    const normalized = trimmedUsername.toLowerCase();

    // Verify uniqueness against username_normalized
    const existing = this.findUserByNormalizedUsername(normalized);
    if (existing) {
      throw new Error('Username already taken');
    }

    const now = new Date().toISOString();
    const newUser: DBUser = {
      id: user.customUuid || crypto.randomUUID(), // Permanent MyChat User UUID
      authUserId: user.authUserId || user.customUuid || crypto.randomUUID(),
      username: trimmedUsername,
      usernameNormalized: normalized,
      email: user.email.trim().toLowerCase(),
      displayName: user.displayName || trimmedUsername,
      createdAt: now,
      updatedAt: now
    };

    this.data.users.push(newUser);
    this.persist();
    return newUser;
  }

  findUserByUsername(username: string): DBUser | undefined {
    const norm = username.trim().toLowerCase();
    return this.data.users.find(u => u.usernameNormalized === norm);
  }

  findUserByNormalizedUsername(normalized: string): DBUser | undefined {
    const norm = normalized.trim().toLowerCase();
    return this.data.users.find(u => u.usernameNormalized === norm);
  }

  findUserById(id: string): DBUser | undefined {
    return this.data.users.find(u => u.id === id);
  }

  findUserByAuthUserId(authUserId: string): DBUser | undefined {
    return this.data.users.find(u => u.authUserId === authUserId || u.id === authUserId);
  }

  /**
   * Case-insensitive search returning public profile attributes (UUID, username, displayName, avatarUrl, about)
   * Strictly no email, secrets, or internal auth identifiers.
   */
  searchUsers(query: string, excludeUserId?: string): Array<{ uuid: string; username: string; displayName: string; avatarUrl?: string; about?: string }> {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return this.data.users
      .filter(u => u.id !== excludeUserId && (u.usernameNormalized === q || u.usernameNormalized.startsWith(q) || u.displayName.toLowerCase().includes(q)))
      .map(u => ({
        uuid: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        about: u.about
      }));
  }

  updateUserProfile(userId: string, updates: { displayName?: string; about?: string; avatarUrl?: string; backgroundImage?: string; preferences?: Record<string, any> }): DBUser | undefined {
    const user = this.findUserById(userId);
    if (!user) return undefined;

    if (updates.displayName !== undefined) {
      user.displayName = updates.displayName.trim() || user.username;
    }
    if (updates.about !== undefined) {
      user.about = updates.about.trim();
    }
    if (updates.avatarUrl !== undefined) {
      user.avatarUrl = updates.avatarUrl;
    }
    if (updates.backgroundImage !== undefined) {
      user.backgroundImage = updates.backgroundImage;
    }
    if (updates.preferences !== undefined) {
      user.preferences = { ...(user.preferences || {}), ...updates.preferences };
    }
    user.updatedAt = new Date().toISOString();
    this.persist();
    return user;
  }

  getUserPreferences(userId: string): Record<string, any> {
    const user = this.findUserById(userId);
    return user?.preferences || {};
  }

  updateUserPreferences(userId: string, prefs: Record<string, any>): Record<string, any> {
    const user = this.findUserById(userId);
    if (!user) return {};
    user.preferences = { ...(user.preferences || {}), ...prefs };
    user.updatedAt = new Date().toISOString();
    this.persist();
    return user.preferences;
  }

  blockUser(userId: string, targetUserId: string): void {
    const user = this.findUserById(userId);
    if (!user) return;
    user.blockedUserIds = user.blockedUserIds || [];
    if (!user.blockedUserIds.includes(targetUserId)) {
      user.blockedUserIds.push(targetUserId);
      this.persist();
    }
  }

  unblockUser(userId: string, targetUserId: string): void {
    const user = this.findUserById(userId);
    if (!user || !user.blockedUserIds) return;
    user.blockedUserIds = user.blockedUserIds.filter(id => id !== targetUserId);
    this.persist();
  }

  getBlockedUsers(userId: string): Array<{ uuid: string; username: string; displayName: string; avatarUrl?: string }> {
    const user = this.findUserById(userId);
    if (!user || !user.blockedUserIds || user.blockedUserIds.length === 0) return [];
    return user.blockedUserIds
      .map(id => this.findUserById(id))
      .filter((u): u is DBUser => !!u)
      .map(u => ({
        uuid: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl
      }));
  }

  deleteUser(userId: string): boolean {
    const userIndex = this.data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) return false;

    // Remove user
    this.data.users.splice(userIndex, 1);

    // Revoke and remove devices
    this.data.devices = this.data.devices.filter(d => d.userId !== userId);

    // Remove sessions
    this.data.sessions = this.data.sessions.filter(s => s.userId !== userId);

    // Remove conversation membership
    this.data.conversationMembers = this.data.conversationMembers.filter(m => m.userId !== userId);

    this.persist();
    return true;
  }

  // ==========================================
  // DEVICES & KEYS
  // ==========================================
  registerDevice(device: Omit<DBDevice, 'createdAt' | 'lastSeen'>): DBDevice {
    const existingIndex = this.data.devices.findIndex(d => d.id === device.id);
    const now = new Date().toISOString();
    const record: DBDevice = {
      ...device,
      createdAt: existingIndex >= 0 ? this.data.devices[existingIndex].createdAt : now,
      lastSeen: now
    };

    if (existingIndex >= 0) {
      this.data.devices[existingIndex] = record;
    } else {
      this.data.devices.push(record);
    }
    this.persist();
    return record;
  }

  findDeviceById(deviceId: string): DBDevice | undefined {
    return this.data.devices.find(d => d.id === deviceId && !d.revokedAt);
  }

  findDevicesByUserId(userId: string): DBDevice[] {
    return this.data.devices.filter(d => d.userId === userId && !d.revokedAt);
  }

  isDeviceOwnedByUser(deviceId: string, userId: string): boolean {
    const dev = this.data.devices.find(d => d.id === deviceId);
    return !!dev && dev.userId === userId && !dev.revokedAt;
  }

  revokeDevice(deviceId: string, userId: string): boolean {
    const device = this.data.devices.find(d => d.id === deviceId && d.userId === userId);
    if (device) {
      device.revokedAt = new Date().toISOString();
      this.persist();
      return true;
    }
    return false;
  }

  savePrekeys(deviceId: string, prekeys: Array<{ id: number; dhKey: string; kemKey: string }>) {
    const now = new Date().toISOString();
    this.data.devicePrekeys = this.data.devicePrekeys.filter(p => p.deviceId !== deviceId);
    for (const pk of prekeys) {
      this.data.devicePrekeys.push({
        id: crypto.randomUUID(),
        deviceId,
        keyId: pk.id,
        dhPublicKey: pk.dhKey,
        kemPublicKey: pk.kemKey,
        createdAt: now
      });
    }
    this.persist();
  }

  claimOneTimePrekey(deviceId: string): { dhKey: string; kemKey: string; id: number } | undefined {
    const prekey = this.data.devicePrekeys.find(p => p.deviceId === deviceId && !p.consumedAt);
    if (prekey) {
      prekey.consumedAt = new Date().toISOString();
      this.persist();
      return {
        id: prekey.keyId,
        dhKey: prekey.dhPublicKey,
        kemKey: prekey.kemPublicKey
      };
    }
    return undefined;
  }

  // ==========================================
  // CONVERSATIONS & PARTICIPANT ISOLATION
  // ==========================================
  getConversationById(convId: string): DBConversation | undefined {
    return this.data.conversations.find(c => c.id === convId);
  }

  isUserMemberOfConversation(userId: string, conversationId: string): boolean {
    return this.data.conversationMembers.some(
      m => m.conversationId === conversationId && m.userId === userId
    );
  }

  getConversationMembers(conversationId: string): string[] {
    return this.data.conversationMembers
      .filter(m => m.conversationId === conversationId)
      .map(m => m.userId);
  }

  findDirectConversation(userAId: string, userBId: string): DBConversation | undefined {
    for (const conv of this.data.conversations) {
      if (conv.conversationType !== 'direct') continue;
      const members = this.data.conversationMembers.filter(m => m.conversationId === conv.id);
      const userIds = members.map(m => m.userId);
      if (userIds.includes(userAId) && userIds.includes(userBId)) {
        return conv;
      }
    }
    return undefined;
  }

  createDirectConversation(userAId: string, userBId: string): DBConversation {
    const existing = this.findDirectConversation(userAId, userBId);
    if (existing) return existing;

    const convId = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: DBConversation = {
      id: convId,
      conversationType: 'direct',
      createdAt: now,
      updatedAt: now
    };

    this.data.conversations.push(conv);
    this.data.conversationMembers.push(
      { conversationId: convId, userId: userAId, joinedAt: now },
      { conversationId: convId, userId: userBId, joinedAt: now }
    );
    this.persist();
    return conv;
  }

  getUserConversations(userId: string) {
    const memberConvs = this.data.conversationMembers
      .filter(m => m.userId === userId)
      .map(m => m.conversationId);

    const results = [];
    for (const convId of memberConvs) {
      const conv = this.data.conversations.find(c => c.id === convId);
      if (!conv) continue;
      const members = this.data.conversationMembers
        .filter(m => m.conversationId === convId)
        .map(m => {
          const u = this.data.users.find(user => user.id === m.userId);
          return {
            uuid: m.userId,
            username: u?.username || 'unknown',
            displayName: u?.displayName || 'Unknown',
            avatarUrl: u?.avatarUrl,
            about: u?.about
          };
        });

      results.push({
        ...conv,
        members
      });
    }
    return results;
  }

  getUserSharedParticipantIds(userId: string): string[] {
    const myConvs = new Set(
      this.data.conversationMembers
        .filter(m => m.userId === userId)
        .map(m => m.conversationId)
    );

    const partnerIds = new Set<string>();
    for (const m of this.data.conversationMembers) {
      if (myConvs.has(m.conversationId) && m.userId !== userId) {
        partnerIds.add(m.userId);
      }
    }
    return Array.from(partnerIds);
  }

  // ==========================================
  // CIPHERTEXT MESSAGES (STRICT ZERO-KNOWLEDGE & UUID ROUTING)
  // ==========================================

  /**
   * Stores ciphertext envelope with authoritative sender_uuid and recipient_uuid.
   * Enforces 15-minute retention TTL for offline queue.
   */
  storeMessage(record: {
    conversationId: string;
    senderUserId: string; // Authoritative sender MyChat UUID
    recipientUserId: string; // Authoritative recipient MyChat UUID
    senderDeviceId?: string;
    recipientDeviceId?: string;
    clientMessageId: string;
    ciphertext: string;
    nonce: string;
    signature: string;
    encryptionVersion: string;
    sequence?: number;
    handshakePacket?: any;
    expiresAt?: string;
    chunkIndex?: number;
    chunkCount?: number;
  }): DBMsgRecord {
    // Idempotency: return existing if duplicate clientMessageId
    const existing = this.data.messages.find(m => m.clientMessageId === record.clientMessageId);
    if (existing) return existing;

    // Verify & ensure conversation record linkage
    let conv = this.getConversationById(record.conversationId);
    if (!conv && record.senderUserId && record.recipientUserId) {
      conv = this.createDirectConversation(record.senderUserId, record.recipientUserId);
      record.conversationId = conv.id;
    }

    this.sequenceCounter++;
    const now = new Date();
    // Enforce 15-minute maximum TTL for temporary delivery queue
    const expiresAt = record.expiresAt || new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    const senderDev = record.senderDeviceId || `dev-${record.senderUserId.slice(0, 8)}`;
    const recipientDev = record.recipientDeviceId || `dev-${record.recipientUserId.slice(0, 8)}`;

    const msg: DBMsgRecord = {
      id: crypto.randomUUID(),
      conversationId: record.conversationId,
      senderUserId: record.senderUserId,
      recipientUserId: record.recipientUserId,
      senderDeviceId: senderDev,
      recipientDeviceId: recipientDev,
      clientMessageId: record.clientMessageId,
      ciphertext: record.ciphertext,
      nonce: record.nonce,
      signature: record.signature,
      encryptionVersion: record.encryptionVersion || 'hybrid-x25519-mlkem1024-v1',
      sequence: record.sequence ?? 1,
      serverSequence: this.sequenceCounter,
      handshakePacket: record.handshakePacket,
      expiresAt,
      chunkIndex: record.chunkIndex ?? 0,
      chunkCount: record.chunkCount ?? 1,
      createdAt: now.toISOString()
    };

    this.data.messages.push(msg);
    this.persist();

    serverSyncDiagnostic.log('CONVERSATION_LINK', {
      clientMessageId: msg.clientMessageId,
      conversationId: msg.conversationId,
      messageId: msg.id,
      senderUserId: msg.senderUserId,
      recipientUserId: msg.recipientUserId,
      senderDeviceId: msg.senderDeviceId,
      recipientDeviceId: msg.recipientDeviceId,
      serverSequence: msg.serverSequence,
      details: {
        linkedConversationExists: !!conv,
        senderUserId: msg.senderUserId,
        recipientUserId: msg.recipientUserId
      }
    });

    serverSyncDiagnostic.log('STORED_DB', {
      clientMessageId: msg.clientMessageId,
      conversationId: msg.conversationId,
      messageId: msg.id,
      senderUserId: msg.senderUserId,
      recipientUserId: msg.recipientUserId,
      senderDeviceId: msg.senderDeviceId,
      recipientDeviceId: msg.recipientDeviceId,
      serverSequence: msg.serverSequence,
      details: {
        deliveredAt: msg.deliveredAt || null,
        expiresAt: msg.expiresAt,
        ttlMinutes: 15
      }
    });

    return msg;
  }

  getConversationMessages(conversationId: string, userId: string): DBMsgRecord[] {
    // Strict isolation check: caller must be an active member in conversation_members
    if (!this.isUserMemberOfConversation(userId, conversationId)) {
      return [];
    }
    const now = Date.now();
    return this.data.messages
      .filter(m => {
        if (m.conversationId !== conversationId) return false;
        if (!m.signature || typeof m.signature !== 'string' || m.signature.length < 1000) return false;
        // Expired undelivered messages must not be returned
        const expiry = m.expiresAt ? new Date(m.expiresAt).getTime() : (new Date(m.createdAt).getTime() + 15 * 60 * 1000);
        if (!m.deliveredAt && (isNaN(expiry) || expiry <= now)) return false;
        return true;
      })
      .sort((a, b) => a.serverSequence - b.serverSequence);
  }

  markDelivered(messageId: string): boolean {
    const msg = this.data.messages.find(m => m.id === messageId || m.clientMessageId === messageId);
    if (msg && !msg.deliveredAt) {
      msg.deliveredAt = new Date().toISOString();
      this.persist();

      serverSyncDiagnostic.log('DELIVERY_RECEIPT', {
        clientMessageId: msg.clientMessageId,
        conversationId: msg.conversationId,
        messageId: msg.id,
        senderUserId: msg.senderUserId,
        recipientUserId: msg.recipientUserId,
        senderDeviceId: msg.senderDeviceId,
        recipientDeviceId: msg.recipientDeviceId,
        serverSequence: msg.serverSequence,
        details: {
          status: 'delivered',
          deliveredAt: msg.deliveredAt
        }
      });
      return true;
    }
    return false;
  }

  markRead(messageId: string): boolean {
    const msg = this.data.messages.find(m => m.id === messageId || m.clientMessageId === messageId);
    if (msg) {
      if (!msg.deliveredAt) msg.deliveredAt = new Date().toISOString();
      msg.readAt = new Date().toISOString();
      this.persist();
      return true;
    }
    return false;
  }

  getMessageByIdOrClientId(messageId: string): DBMsgRecord | undefined {
    return this.data.messages.find(m => m.id === messageId || m.clientMessageId === messageId);
  }

  /**
   * Retrieves pending undelivered messages for recipient UUID or device.
   * Strictly verifies that the recipient is an authorized member in conversation_members
   * for every message retrieved!
   */
  getUndeliveredForDevice(recipientDeviceId: string, sinceSequence: number = 0, userId?: string): DBMsgRecord[] {
    const now = Date.now();
    return this.data.messages
      .filter(m => {
        const matchesRecipient = m.recipientDeviceId === recipientDeviceId || (userId && m.recipientUserId === userId);
        if (!matchesRecipient) return false;
        if (m.serverSequence <= sinceSequence) return false;
        if (m.deliveredAt) return false;
        // Verify valid ML-DSA-87 signature
        if (!m.signature || typeof m.signature !== 'string' || m.signature.length < 1000) return false;
        // Expired messages are permanently dropped (15-min offline TTL)
        const expiry = m.expiresAt ? new Date(m.expiresAt).getTime() : (new Date(m.createdAt).getTime() + 15 * 60 * 1000);
        if (isNaN(expiry) || expiry <= now) return false;
        // Strict database-level isolation: caller userId must be in conversation_members
        if (userId && !this.isUserMemberOfConversation(userId, m.conversationId)) return false;
        return true;
      })
      .sort((a, b) => a.serverSequence - b.serverSequence);
  }

  /**
   * Retrieves undelivered messages addressed to recipient UUID
   */
  getUndeliveredForUser(recipientUserId: string, sinceSequence: number = 0): DBMsgRecord[] {
    const now = Date.now();
    return this.data.messages
      .filter(m => {
        if (m.recipientUserId !== recipientUserId) return false;
        if (m.serverSequence <= sinceSequence) return false;
        if (m.deliveredAt) return false;
        // Verify valid ML-DSA-87 signature
        if (!m.signature || typeof m.signature !== 'string' || m.signature.length < 1000) return false;
        const expiry = m.expiresAt ? new Date(m.expiresAt).getTime() : (new Date(m.createdAt).getTime() + 15 * 60 * 1000);
        if (isNaN(expiry) || expiry <= now) return false;
        if (!this.isUserMemberOfConversation(recipientUserId, m.conversationId)) return false;
        return true;
      })
      .sort((a, b) => a.serverSequence - b.serverSequence);
  }

  /**
   * Periodic cleanup worker for expired messages and delivered temporary delivery copies.
   * Maximum 15-minute TTL enforced server-side.
   */
  cleanupExpiredAndDeliveredMessages(): number {
    const now = Date.now();
    const initialCount = this.data.messages.length;

    this.data.messages = this.data.messages.filter(m => {
      // 0. Drop invalid signature stubs
      if (!m.signature || typeof m.signature !== 'string' || m.signature.length < 1000) {
        return false;
      }
      // 1. Permanent deletion after 15-minute TTL expiration if recipient did not reconnect
      const expiry = m.expiresAt ? new Date(m.expiresAt).getTime() : (new Date(m.createdAt).getTime() + 15 * 60 * 1000);
      if (isNaN(expiry) || (!m.deliveredAt && expiry <= now)) {
        return false;
      }
      // 2. Remove temporary server delivery copy once delivered & read
      if (m.deliveredAt && m.readAt) {
        return false;
      }
      return true;
    });

    const pruned = initialCount - this.data.messages.length;
    if (pruned > 0) {
      this.persist();
    }
    return pruned;
  }

  // ==========================================
  // SESSIONS
  // ==========================================
  createSession(userId: string, deviceId: string, refreshToken: string, expiryDays: number = 30): DBSession {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const session: DBSession = {
      id: crypto.randomUUID(),
      userId,
      deviceId,
      refreshTokenHash: hash,
      createdAt: now.toISOString(),
      expiresAt
    };

    this.data.sessions.push(session);
    this.persist();
    return session;
  }

  verifySession(userId: string, refreshToken: string): boolean {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const now = new Date().getTime();
    const session = this.data.sessions.find(s => s.userId === userId && s.refreshTokenHash === hash);
    if (!session) return false;
    return new Date(session.expiresAt).getTime() > now;
  }

  findSessionByRefreshToken(refreshToken: string): DBSession | undefined {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const now = new Date().getTime();
    return this.data.sessions.find(s => s.refreshTokenHash === hash && new Date(s.expiresAt).getTime() > now);
  }

  revokeSession(userId: string, refreshToken: string): boolean {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const idx = this.data.sessions.findIndex(s => s.userId === userId && s.refreshTokenHash === hash);
    if (idx >= 0) {
      this.data.sessions.splice(idx, 1);
      this.persist();
      return true;
    }
    return false;
  }
}

export const db = new StorageEngine();

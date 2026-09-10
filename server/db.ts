import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { serverSyncDiagnostic } from './syncDiagnostic';

export interface DBUser {
  id: string; // UUID v4
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DBDevice {
  id: string; // deviceId
  userId: string; // UUID v4
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
  userId: string;
  joinedAt: string;
}

export interface DBMsgRecord {
  id: string; // UUID v4
  conversationId: string;
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
  expiresAt: string;
  chunkIndex?: number;
  chunkCount?: number;
  senderUserId?: string;
  recipientUserId?: string;
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
  id: string; // UUID v4
  creatorUserId: string;
  creatorDeviceId: string;
  sessionId?: string; // initiating session identifier
  token: string; // Long CSPRNG token for QR payloads
  pairingCode: string; // Cryptographically secure 60-bit alphanumeric pairing code
  sessionBinding?: string; // Cryptographic HMAC binding invite to initiator session
  entropyBits?: number; // 60 bits
  expiresAt: string; // ISO Date string
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

// Unambiguous 64-character alphabet for CSPRNG pairing codes
// Excludes confusing visual characters: '0', 'O', '1', 'I', 'l'
// Contains: A-Z (24 chars), a-z (24 chars), 2-9 (8 chars), safe special symbols (8 chars)
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
  private data: DatabaseSchema = {
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
          users: parsed.users || [],
          devices: parsed.devices || [],
          devicePrekeys: parsed.devicePrekeys || [],
          conversations: parsed.conversations || [],
          conversationMembers: parsed.conversationMembers || [],
          messages: parsed.messages || [],
          sessions: parsed.sessions || [],
          invites: parsed.invites || []
        };
        this.sequenceCounter = this.data.messages.reduce((max, m) => Math.max(max, m.serverSequence || 0), 0);
      }
    } catch {
      // Use in-memory defaults if load fails
    }
  }

  private persist() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {}
  }

  // ==========================================
  // USERS
  // ==========================================
  createUser(user: Omit<DBUser, 'id' | 'createdAt' | 'updatedAt'>): DBUser {
    const now = new Date().toISOString();
    const newUser: DBUser = {
      id: crypto.randomUUID(),
      username: user.username.toLowerCase(),
      email: user.email.toLowerCase(),
      passwordHash: user.passwordHash,
      displayName: user.displayName,
      createdAt: now,
      updatedAt: now
    };
    this.data.users.push(newUser);
    this.persist();
    return newUser;
  }

  findUserByUsername(username: string): DBUser | undefined {
    return this.data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  }

  findUserById(id: string): DBUser | undefined {
    return this.data.users.find(u => u.id === id);
  }

  // Exact or prefix username lookup: returns ONLY public profile attributes (never email or secrets)
  searchUsers(query: string, excludeUserId?: string): Array<{ uuid: string; username: string; displayName: string }> {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return this.data.users
      .filter(u => u.id !== excludeUserId && (u.username.toLowerCase() === q || u.username.toLowerCase().startsWith(q)))
      .map(u => ({
        uuid: u.id,
        username: u.username,
        displayName: u.displayName
      }));
  }

  // ==========================================
  // DEVICES
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

  // ==========================================
  // PREKEYS (X3DH)
  // ==========================================
  savePrekeys(deviceId: string, prekeys: Array<{ id: number; dhKey: string; kemKey: string }>) {
    const now = new Date().toISOString();
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
            displayName: u?.displayName || 'Unknown'
          };
        });

      results.push({
        ...conv,
        members
      });
    }
    return results;
  }

  // ==========================================
  // CIPHERTEXT MESSAGES (STRICT ZERO-KNOWLEDGE)
  // ==========================================
  storeMessage(record: {
    conversationId: string;
    senderDeviceId: string;
    recipientDeviceId: string;
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

    const senderDev = this.findDeviceById(record.senderDeviceId);
    const recipientDev = this.findDeviceById(record.recipientDeviceId);

    // Verify & ensure conversation record linkage
    let conv = this.getConversationById(record.conversationId);
    if (!conv && senderDev?.userId && recipientDev?.userId) {
      conv = this.createDirectConversation(senderDev.userId, recipientDev.userId);
      record.conversationId = conv.id;
    }

    this.sequenceCounter++;
    const now = new Date();
    // Default 15 minutes TTL for temporary queue
    const expiresAt = record.expiresAt || new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    const msg: DBMsgRecord = {
      ...record,
      id: crypto.randomUUID(),
      serverSequence: this.sequenceCounter,
      createdAt: now.toISOString(),
      expiresAt,
      sequence: record.sequence ?? 1,
      handshakePacket: record.handshakePacket,
      chunkIndex: record.chunkIndex ?? 0,
      chunkCount: record.chunkCount ?? 1,
      senderUserId: senderDev?.userId,
      recipientUserId: recipientDev?.userId
    };

    this.data.messages.push(msg);
    this.persist();

    serverSyncDiagnostic.log('CONVERSATION_LINK', {
      clientMessageId: msg.clientMessageId,
      conversationId: msg.conversationId,
      messageId: msg.id,
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
      senderDeviceId: msg.senderDeviceId,
      recipientDeviceId: msg.recipientDeviceId,
      serverSequence: msg.serverSequence,
      details: {
        deliveredAt: msg.deliveredAt || null,
        expiresAt: msg.expiresAt
      }
    });

    return msg;
  }

  getConversationMessages(conversationId: string, userId: string): DBMsgRecord[] {
    // Strict isolation check: caller must be a member
    if (!this.isUserMemberOfConversation(userId, conversationId)) {
      return [];
    }
    const now = Date.now();
    return this.data.messages
      .filter(m => {
        if (m.conversationId !== conversationId) return false;
        // Expired undelivered messages must not be returned
        if (!m.deliveredAt && new Date(m.expiresAt).getTime() <= now) return false;
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

  getUndeliveredForDevice(recipientDeviceId: string, sinceSequence: number = 0, userId?: string): DBMsgRecord[] {
    const now = Date.now();
    return this.data.messages
      .filter(m => {
        if (m.recipientDeviceId !== recipientDeviceId) return false;
        if (m.serverSequence <= sinceSequence) return false;
        if (m.deliveredAt) return false;
        // Expired messages are permanently dropped (15-min offline TTL)
        if (new Date(m.expiresAt).getTime() <= now) return false;
        // Strict database-level isolation: if caller userId is provided, must be a member
        if (userId && !this.isUserMemberOfConversation(userId, m.conversationId)) return false;
        return true;
      })
      .sort((a, b) => a.serverSequence - b.serverSequence);
  }

  /**
   * Periodic cleanup worker for expired messages and delivered temporary delivery copies.
   * Default 15 minute TTL enforced server-side.
   */
  cleanupExpiredAndDeliveredMessages(): number {
    const now = Date.now();
    const initialCount = this.data.messages.length;

    this.data.messages = this.data.messages.filter(m => {
      // 1. Permanent deletion after 15-minute TTL expiration if recipient did not reconnect
      const expiry = new Date(m.expiresAt).getTime();
      if (!isNaN(expiry) && expiry <= now) {
        return false;
      }
      // 2. Remove temporary server delivery copy once delivered & read
      if (m.deliveredAt && m.readAt) {
        return false;
      }
      return true;
    });

    if (this.data.messages.length !== initialCount) {
      this.persist();
    }
    return initialCount - this.data.messages.length;
  }

  getUserSharedParticipantIds(userId: string): string[] {
    const userConvIds = this.data.conversationMembers
      .filter(m => m.userId === userId)
      .map(m => m.conversationId);
    const sharedUsers = new Set<string>();
    for (const convId of userConvIds) {
      const members = this.data.conversationMembers.filter(m => m.conversationId === convId);
      for (const m of members) {
        if (m.userId !== userId) sharedUsers.add(m.userId);
      }
    }
    return Array.from(sharedUsers);
  }

  // ==========================================
  // INVITES & SECURE SHORT PAIRING CODES
  // ==========================================
  createInvite(creatorUserId: string, creatorDeviceId: string, ttlMinutes: number = 15): DBInvite {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const token = crypto.randomBytes(24).toString('hex');
    const pairingCode = generateSecurePairingCode(9);

    const invite: DBInvite = {
      id: crypto.randomUUID(),
      creatorUserId,
      creatorDeviceId,
      token,
      pairingCode,
      expiresAt,
      isUsed: false,
      createdAt: now.toISOString()
    };

    this.data.invites.push(invite);
    this.persist();
    return invite;
  }

  findInviteByTokenOrCode(tokenOrCode: string): DBInvite | undefined {
    const trimmed = tokenOrCode.trim();
    const now = new Date().toISOString();
    return this.data.invites.find(
      inv => !inv.isUsed && inv.expiresAt > now && (inv.token === trimmed || inv.pairingCode === trimmed)
    );
  }

  consumeInvite(inviteId: string, usedByUserId: string): { success: boolean; invite?: DBInvite; error?: string } {
    const invite = this.data.invites.find(inv => inv.id === inviteId);
    if (!invite) {
      return { success: false, error: 'Invite not found' };
    }
    const now = new Date().toISOString();
    if (invite.isUsed) {
      return { success: false, error: 'Invite code has already been used (single-use)' };
    }
    if (invite.expiresAt <= now) {
      return { success: false, error: 'Invite code has expired' };
    }
    if (invite.creatorUserId === usedByUserId) {
      return { success: false, error: 'Cannot accept your own invite code' };
    }

    invite.isUsed = true;
    invite.usedAt = now;
    invite.usedByUserId = usedByUserId;
    this.persist();
    return { success: true, invite };
  }

  // ==========================================
  // SESSIONS & REFRESH TOKENS
  // ==========================================
  createSession(userId: string, deviceId: string, refreshToken: string, expiresInDays: number = 30): DBSession {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const session: DBSession = {
      id: crypto.randomUUID(),
      userId,
      deviceId,
      refreshTokenHash: hash,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString()
    };
    this.data.sessions.push(session);
    this.persist();
    return session;
  }

  verifySession(userId: string, refreshToken: string): boolean {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const now = new Date().toISOString();
    const session = this.data.sessions.find(
      s => s.userId === userId && s.refreshTokenHash === hash && s.expiresAt > now
    );
    return !!session;
  }

  revokeSession(userId: string, refreshToken: string) {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    this.data.sessions = this.data.sessions.filter(s => !(s.userId === userId && s.refreshTokenHash === hash));
    this.persist();
  }
}

export const db = new StorageEngine();

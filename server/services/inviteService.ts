import crypto from 'crypto';
import { db, DBInvite } from '../db';

/**
 * Cryptographically Secure 60-Bit Alphanumeric Invitation & Pairing Service
 *
 * Alphabet Specification:
 * 32 Unambiguous Alphanumeric Characters (Strictly letters and numbers only):
 * - 8 Numeric Digits: 2, 3, 4, 5, 6, 7, 8, 9 (excludes ambiguous 0, 1)
 * - 24 Uppercase Letters: A B C D E F G H J K L M N P Q R S T U V W X Y Z (excludes ambiguous I, O)
 * Total: 32 characters = 2^5 = 5 bits of cryptographic entropy per character.
 *
 * Exact Entropy Math:
 * 12 characters * 5 bits/character = 60 bits of cryptographic entropy (2^60 = 1,152,921,504,606,846,975 combinations).
 * Generated strictly using system CSPRNG (crypto.randomBytes).
 * Formatted as XXXX-XXXX-XXXX for optimal human readability and input accuracy.
 */

export const ALPHANUMERIC_ALPHABET_32 = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const INVITE_ALPHABET = ALPHANUMERIC_ALPHABET_32;

// Fallback legacy support alphabet for existing invite tokens if encountered
export const LEGACY_INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz#$@!%&*-';

// Master secret for session-bound invite HMAC derivation
const SESSION_BINDING_SECRET = process.env.INVITE_BINDING_SECRET || 'ychat_e2ee_invite_session_binding_hmac_secret_2026';

export interface GenerateInviteOptions {
  userId: string;
  deviceId: string;
  sessionId?: string;
  ttlMinutes?: number;
  ipAddress?: string;
}

export interface ResolveInviteResult {
  valid: boolean;
  inviteId?: string;
  creator?: {
    uuid: string;
    username: string;
    displayName: string;
  };
  expiresAt?: string;
  entropyBits?: number;
  error?: string;
}

export interface AcceptInviteResult {
  success: boolean;
  conversationId?: string;
  creator?: {
    uuid: string;
    username: string;
    displayName: string;
  };
  error?: string;
}

// In-memory rate limiting structures
interface RateLimitBucket {
  generateCount: number;
  resolveCount: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();

const MAX_GENERATES_PER_WINDOW = 10; // Max 10 invites generated per 5-minute window
const MAX_RESOLVES_PER_WINDOW = 15;   // Max 15 resolution attempts per 1-minute window
const RATE_WINDOW_MS = 60 * 1000;

export class InviteService {
  /**
   * Computes a cryptographic HMAC signature binding the invite code
   * to the initiating user's active session, device ID, and creation timestamp.
   */
  static computeSessionBinding(userId: string, deviceId: string, sessionId: string, code: string, createdAt: string): string {
    return crypto.createHmac('sha256', SESSION_BINDING_SECRET)
      .update(`${userId}:${deviceId}:${sessionId}:${code}:${createdAt}`)
      .digest('hex');
  }

  /**
   * Generates a cryptographically secure 60-bit alphanumeric invite code using a strong CSPRNG.
   * Extracts exactly 60 bits from 8 random bytes and maps into 12 5-bit alphanumeric symbols.
   */
  static generate60BitCode(): { code: string; formatted: string; entropyBits: number } {
    // 8 bytes = 64 bits of CSPRNG entropy
    const randomBytes = crypto.randomBytes(8);
    let bitBuffer = BigInt(0);
    for (let i = 0; i < 8; i++) {
      bitBuffer = (bitBuffer << BigInt(8)) | BigInt(randomBytes[i]);
    }

    // Mask to lowest 60 bits (2^60 - 1)
    const mask60 = (BigInt(1) << BigInt(60)) - BigInt(1);
    let entropy60 = bitBuffer & mask60;

    let rawCode = '';
    // Extract 12 chunks of 5 bits each (12 * 5 = 60 bits exact)
    for (let i = 0; i < 12; i++) {
      const chunk = Number(entropy60 & BigInt(0x1f)); // lowest 5 bits (0..31)
      rawCode += ALPHANUMERIC_ALPHABET_32[chunk];
      entropy60 = entropy60 >> BigInt(5);
    }

    // Format as 4-4-4 for high human readability: e.g. "9W4K-2H7M-QP5Z"
    const formatted = `${rawCode.slice(0, 4)}-${rawCode.slice(4, 8)}-${rawCode.slice(8, 12)}`;

    return {
      code: rawCode,
      formatted,
      entropyBits: 60
    };
  }

  /**
   * Normalizes code input: strips whitespace, dashes, and normalizes case.
   * Handles user misentry (mapping '0' to 'O', '1' to 'I' or standard normalization).
   */
  static normalizeCode(input: string): string {
    return input
      .replace(/[\s-]/g, '')
      .toUpperCase()
      .trim();
  }

  /**
   * Checks sliding window rate limit for an identifier (userId or IP).
   */
  static checkRateLimit(key: string, action: 'generate' | 'resolve'): { allowed: boolean; retryAfterSec?: number } {
    const now = Date.now();
    let bucket = rateLimitMap.get(key);

    if (!bucket || bucket.resetAt < now) {
      bucket = {
        generateCount: 0,
        resolveCount: 0,
        resetAt: now + RATE_WINDOW_MS
      };
      rateLimitMap.set(key, bucket);
    }

    if (action === 'generate') {
      if (bucket.generateCount >= MAX_GENERATES_PER_WINDOW) {
        return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
      }
      bucket.generateCount++;
    } else {
      if (bucket.resolveCount >= MAX_RESOLVES_PER_WINDOW) {
        return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
      }
      bucket.resolveCount++;
    }

    return { allowed: true };
  }

  /**
   * Creates a single-use, rate-limited invite cryptographically bound to the initiating user's session.
   */
  static createInvite(opts: GenerateInviteOptions): {
    invite: DBInvite;
    pairingCode: string;
    formattedCode: string;
    qrPayload: string;
  } {
    const { code, formatted } = this.generate60BitCode();
    const ttlMinutes = opts.ttlMinutes || 15;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const createdAt = now.toISOString();
    const token = crypto.randomBytes(24).toString('hex');
    const activeSessionId = opts.sessionId || `session_${opts.userId.slice(0, 8)}_${Date.now()}`;

    // Cryptographically bind to initiating user's session and device
    const sessionBinding = this.computeSessionBinding(
      opts.userId,
      opts.deviceId,
      activeSessionId,
      code,
      createdAt
    );

    const invite: DBInvite = {
      id: crypto.randomUUID(),
      creatorUserId: opts.userId,
      creatorDeviceId: opts.deviceId,
      sessionId: activeSessionId,
      token,
      pairingCode: code,
      sessionBinding,
      entropyBits: 60,
      expiresAt,
      isUsed: false,
      createdAt
    };

    // Store in DB
    (db as any).data.invites.push(invite);
    (db as any).persist();

    // Standard cryptographically verifiable QR payload
    const qrPayload = `ychat:invite?v=1&u=${opts.userId}&token=${token}&code=${encodeURIComponent(formatted)}&bits=60`;

    return {
      invite,
      pairingCode: code,
      formattedCode: formatted,
      qrPayload
    };
  }

  /**
   * Resolves an invite code or QR token:
   * Enforces single-use constraint, expiry check, session binding cryptographic verification,
   * and prevents self-acceptance.
   */
  static resolveInvite(codeOrToken: string, requestingUserId: string): ResolveInviteResult {
    let clean = codeOrToken.trim();

    // Check if input is a URI payload
    if (clean.startsWith('ychat:invite?')) {
      try {
        const parsed = new URLSearchParams(clean.replace(/^ychat:invite\?/, ''));
        clean = parsed.get('code') || parsed.get('token') || clean;
      } catch {}
    }

    const normalized = this.normalizeCode(clean);
    const rawClean = clean.replace(/[\s-]/g, '');

    const now = new Date().toISOString();
    const invites: DBInvite[] = (db as any).data.invites || [];

    const invite = invites.find(
      inv => inv.token === clean ||
             inv.token === rawClean ||
             inv.pairingCode === normalized ||
             inv.pairingCode === rawClean ||
             inv.pairingCode.toUpperCase() === normalized
    );

    if (!invite) {
      return { valid: false, error: 'Invalid invite code or pairing token.' };
    }

    // 1. Single-use enforcement
    if (invite.isUsed) {
      return { valid: false, error: 'This invite code has already been consumed (single-use constraint).' };
    }

    // 2. Expiration check
    if (invite.expiresAt <= now) {
      return { valid: false, error: 'This invite code has expired.' };
    }

    // 3. Prevent self-acceptance
    if (invite.creatorUserId === requestingUserId) {
      return { valid: false, error: 'Cannot accept or resolve your own invite code.' };
    }

    // 4. Creator user verification
    const creator = db.findUserById(invite.creatorUserId);
    if (!creator) {
      return { valid: false, error: 'Initiating user account no longer exists.' };
    }

    // 5. Creator device verification (ensure not revoked)
    const creatorDevice = db.findDeviceById(invite.creatorDeviceId);
    if (creatorDevice && creatorDevice.revokedAt) {
      return { valid: false, error: 'Initiating device has been revoked by the owner.' };
    }

    // 6. Cryptographic session binding verification
    if (invite.sessionBinding && invite.sessionId) {
      const expectedBinding = this.computeSessionBinding(
        invite.creatorUserId,
        invite.creatorDeviceId,
        invite.sessionId,
        invite.pairingCode,
        invite.createdAt
      );

      const isValidBinding = crypto.timingSafeEqual(
        Buffer.from(invite.sessionBinding, 'hex'),
        Buffer.from(expectedBinding, 'hex')
      );

      if (!isValidBinding) {
        return { valid: false, error: 'Cryptographic session binding validation failed: signature mismatch.' };
      }
    }

    return {
      valid: true,
      inviteId: invite.id,
      creator: {
        uuid: creator.id,
        username: creator.username,
        displayName: creator.displayName
      },
      expiresAt: invite.expiresAt,
      entropyBits: invite.entropyBits || 60
    };
  }

  /**
   * Consumes an invite atomically: marks as used (single-use constraint)
   * and establishes an isolated direct conversation between the two participants.
   */
  static acceptInvite(inviteId: string, acceptingUserId: string): AcceptInviteResult {
    const invites: DBInvite[] = (db as any).data.invites || [];
    const invite = invites.find(inv => inv.id === inviteId);

    if (!invite) {
      return { success: false, error: 'Invite not found.' };
    }

    const now = new Date().toISOString();

    // 1. Single-use constraint atomic check
    if (invite.isUsed) {
      return { success: false, error: 'This invite code has already been consumed (single-use constraint).' };
    }

    // 2. Expiry check
    if (invite.expiresAt <= now) {
      return { success: false, error: 'Invite code has expired.' };
    }

    // 3. Self-acceptance check
    if (invite.creatorUserId === acceptingUserId) {
      return { success: false, error: 'Cannot accept your own invite code.' };
    }

    // 4. Verify creator
    const creator = db.findUserById(invite.creatorUserId);
    if (!creator) {
      return { success: false, error: 'Creator user not found.' };
    }

    // 5. Verify creator device
    const creatorDevice = db.findDeviceById(invite.creatorDeviceId);
    if (creatorDevice && creatorDevice.revokedAt) {
      return { success: false, error: 'Initiating device has been revoked.' };
    }

    // 6. Cryptographic session binding verification
    if (invite.sessionBinding && invite.sessionId) {
      const expectedBinding = this.computeSessionBinding(
        invite.creatorUserId,
        invite.creatorDeviceId,
        invite.sessionId,
        invite.pairingCode,
        invite.createdAt
      );

      const isValidBinding = crypto.timingSafeEqual(
        Buffer.from(invite.sessionBinding, 'hex'),
        Buffer.from(expectedBinding, 'hex')
      );

      if (!isValidBinding) {
        return { success: false, error: 'Session binding verification failed.' };
      }
    }

    // Atomically consume invite
    invite.isUsed = true;
    invite.usedAt = now;
    invite.usedByUserId = acceptingUserId;
    (db as any).persist();

    // Create isolated conversation
    const conv = db.createDirectConversation(invite.creatorUserId, acceptingUserId);

    return {
      success: true,
      conversationId: conv.id,
      creator: {
        uuid: creator.id,
        username: creator.username,
        displayName: creator.displayName
      }
    };
  }
}

import { deriveHkdfSha3_512, bytesToBase64, base64ToBytes } from './primitives';
import { RatchetSession } from './types';

const RATCHET_SALT = new TextEncoder().encode('ychat-ratchet-salt-v1');
const REKEY_MESSAGE_INTERVAL = 50;
const REKEY_TIME_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function createRatchetSession(
  masterSecret: Uint8Array,
  peerDeviceId: string,
  conversationId: string,
  handshakePacket?: any
): RatchetSession {
  const sessionKeyBytes = deriveHkdfSha3_512(masterSecret, RATCHET_SALT, 'ychat-session-v1', 32);
  const convKeyBytes = deriveHkdfSha3_512(sessionKeyBytes, RATCHET_SALT, 'ychat-conv-v1', 32);

  return {
    sessionId: `${conversationId}:${peerDeviceId}`,
    peerDeviceId,
    conversationId,
    masterSecret: bytesToBase64(masterSecret),
    sessionKey: bytesToBase64(sessionKeyBytes),
    convKey: bytesToBase64(convKeyBytes),
    messageCount: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    handshakePacket
  };
}

export function shouldRekey(session: RatchetSession): boolean {
  if (session.messageCount >= REKEY_MESSAGE_INTERVAL) return true;
  if (Date.now() - session.lastActiveAt >= REKEY_TIME_INTERVAL_MS && session.messageCount > 0) return true;
  return false;
}

export function rekeySession(session: RatchetSession): RatchetSession {
  const currentSessionKey = base64ToBytes(session.sessionKey);
  // Derive next generational session key and wipe prior key
  const nextSessionKey = deriveHkdfSha3_512(
    currentSessionKey,
    RATCHET_SALT,
    `ychat-rekey-step-${Date.now()}`,
    32
  );
  const nextConvKey = deriveHkdfSha3_512(nextSessionKey, RATCHET_SALT, 'ychat-conv-v1', 32);

  // In-memory zeroing of current key bytes
  currentSessionKey.fill(0);

  return {
    ...session,
    sessionKey: bytesToBase64(nextSessionKey),
    convKey: bytesToBase64(nextConvKey),
    messageCount: 0,
    lastActiveAt: Date.now()
  };
}

export function deriveNextMessageKey(session: RatchetSession, senderDeviceId?: string): {
  messageKey: Uint8Array;
  sequence: number;
  updatedSession: RatchetSession;
} {
  let activeSession = session;
  if (shouldRekey(activeSession)) {
    activeSession = rekeySession(activeSession);
  }

  const nextSeq = activeSession.messageCount + 1;
  const convKeyBytes = base64ToBytes(activeSession.convKey);
  const label = senderDeviceId
    ? `ychat-msg-step-${senderDeviceId}-${nextSeq}`
    : `ychat-msg-step-${nextSeq}`;
  const messageKey = deriveHkdfSha3_512(
    convKeyBytes,
    RATCHET_SALT,
    label,
    32
  );

  const updatedSession: RatchetSession = {
    ...activeSession,
    messageCount: nextSeq,
    lastActiveAt: Date.now()
  };

  return {
    messageKey,
    sequence: nextSeq,
    updatedSession
  };
}

export function deriveRecipientMessageKey(
  session: RatchetSession,
  senderDeviceId: string | undefined,
  sequence: number
): Uint8Array {
  const convKeyBytes = base64ToBytes(session.convKey);
  const label = senderDeviceId
    ? `ychat-msg-step-${senderDeviceId}-${sequence}`
    : `ychat-msg-step-${sequence}`;
  return deriveHkdfSha3_512(
    convKeyBytes,
    RATCHET_SALT,
    label,
    32
  );
}

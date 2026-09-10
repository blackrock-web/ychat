import { sha3_512 } from '@noble/hashes/sha3.js';
import { DevicePublicKeys } from './types';
import { getRandomBytes } from './primitives';

export interface SafetyNumberResult {
  numericCode: string;          // 12 groups of 5 digits (60 digits total)
  formattedBlocks: string[];     // Array of 12 blocks of 5 digits
  fingerprintHex: string;       // Raw hex string (SHA3-512)
  visualMatrix: boolean[][];    // 8x8 matrix for visual identification
  bits60: string;               // 60-bit binary string (60 chars of '0' or '1')
  formattedBitsBlocks: string[];// Array of 12 blocks of 5 bits each (60 bits total)
  qrPayload: string;            // Standard scannable QR verification payload
  nonceHex?: string;            // Optional CSPRNG nonce for dynamic sessions
  timestamp?: number;
}

export interface DetailedDiffItem {
  index: number;
  expected: string;
  actual: string;
  isMatch: boolean;
}

export interface ComparisonResult {
  isMatch: boolean;
  matchType: 'digits' | 'bits' | 'qr_payload' | 'dynamic_qr' | 'mismatch' | 'invalid';
  message: string;
  matchedCount: number;
  totalCount: number;
  similarityPercent: number;
  detailedDiff: DetailedDiffItem[];
  securityAlert?: string;
}

// Global registry of consumed verification nonces to prevent replay attacks
const consumedVerificationNonces = new Set<string>();

/**
 * Computes a static identity safety number for two participants.
 */
export function computeSafetyNumber(
  userAKeys: DevicePublicKeys,
  userBKeys: DevicePublicKeys,
  userAUuid?: string,
  userBUuid?: string
): SafetyNumberResult {
  // Sort keys lexicographically to ensure symmetric output regardless of who computes it
  const identityA = `${userAKeys.signingKey}:${userAKeys.dhKey}:${userAKeys.kemKey}`;
  const identityB = `${userBKeys.signingKey}:${userBKeys.dhKey}:${userBKeys.kemKey}`;

  const sortedIdentities = [identityA, identityB].sort();
  const rawInput = new TextEncoder().encode(`ychat-safety-number:${sortedIdentities[0]}||${sortedIdentities[1]}`);

  const digest = sha3_512(rawInput); // 64 bytes = 512 bits
  return digestToSafetyResult(digest);
}

/**
 * Computes an interactive, fresh dynamic verification session.
 * Generates a new cryptographically secure 128-bit nonce every time.
 * Strictly bound to the conversation ID and participant identities to prevent
 * cross-conversation substitution, session confusion, and replay.
 */
export function computeDynamicVerificationSession(
  conversationId: string,
  userAKeys: DevicePublicKeys,
  userBKeys: DevicePublicKeys,
  nonceOverride?: Uint8Array
): SafetyNumberResult {
  // Fresh 128-bit (16-byte) CSPRNG nonce
  const nonce = nonceOverride || getRandomBytes(16);
  let nonceHex = '';
  for (let i = 0; i < nonce.length; i++) {
    nonceHex += nonce[i].toString(16).padStart(2, '0');
  }

  const identityA = `${userAKeys.signingKey}:${userAKeys.dhKey}:${userAKeys.kemKey}`;
  const identityB = `${userBKeys.signingKey}:${userBKeys.dhKey}:${userBKeys.kemKey}`;
  const sortedIdentities = [identityA, identityB].sort();

  // Cryptographic binding: (conversationId || sortedIdentities || nonce)
  const bindingData = new TextEncoder().encode(
    `ychat-dynamic-verification-v2:${conversationId}:${sortedIdentities[0]}||${sortedIdentities[1]}:${nonceHex}`
  );

  const digest = sha3_512(bindingData);
  const result = digestToSafetyResult(digest);
  result.nonceHex = nonceHex;
  result.timestamp = Date.now();

  const rawDigits = result.formattedBlocks.join('');
  const tagHex = result.fingerprintHex.slice(0, 32);

  // Dynamic QR payload strictly bound to conversationId, nonce, 60 bits, 60 digits, and auth tag
  result.qrPayload = `ychat:verify?v=2&cid=${encodeURIComponent(conversationId)}&nonce=${nonceHex}&code=${rawDigits}&bits=${result.bits60}&tag=${tagHex}&ts=${result.timestamp}`;

  return result;
}

function digestToSafetyResult(digest: Uint8Array): SafetyNumberResult {
  // 1. Generate 60 decimal digits by extracting 5-digit chunks from 16-bit integer words
  const blocks: string[] = [];
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);

  for (let i = 0; i < 12; i++) {
    const uint16 = view.getUint16(i * 2, false);
    // Map to 5-digit number (00000 - 99999)
    const val = (uint16 * 100000) >>> 16;
    blocks.push(String(val % 100000).padStart(5, '0'));
  }

  // 2. Generate 60 random bits from the cryptographic digest (CSPRNG)
  const bitArray: string[] = [];
  for (let byteIdx = 0; byteIdx < 8 && bitArray.length < 60; byteIdx++) {
    const byteVal = digest[byteIdx];
    for (let bitIdx = 7; bitIdx >= 0 && bitArray.length < 60; bitIdx--) {
      const bit = (byteVal >> bitIdx) & 1;
      bitArray.push(bit.toString());
    }
  }
  const bits60 = bitArray.join('');

  // Format 60 bits into 12 groups of 5 bits each
  const formattedBitsBlocks: string[] = [];
  for (let i = 0; i < 12; i++) {
    formattedBitsBlocks.push(bits60.slice(i * 5, (i + 1) * 5));
  }

  // 3. Generate an 8x8 boolean matrix from first 8 bytes for visual identification
  const visualMatrix: boolean[][] = [];
  for (let r = 0; r < 8; r++) {
    const byte = digest[r];
    const row: boolean[] = [];
    for (let c = 0; c < 8; c++) {
      row.push(((byte >> c) & 1) === 1);
    }
    visualMatrix.push(row);
  }

  let hex = '';
  for (let i = 0; i < 32; i++) {
    hex += digest[i].toString(16).padStart(2, '0');
  }

  const numericCode = blocks.join(' ');
  const rawDigits = blocks.join('');
  const qrPayload = `ychat:verify?v=1&code=${rawDigits}&bits=${bits60}&fp=${hex.toUpperCase()}`;

  return {
    numericCode,
    formattedBlocks: blocks,
    fingerprintHex: hex.toUpperCase(),
    visualMatrix,
    bits60,
    formattedBitsBlocks,
    qrPayload
  };
}

/**
 * Validates a peer's input code or QR payload against expected safety numbers.
 * Enforces cross-conversation verification rejection, replay rejection, and tampering rejection.
 */
export function verifySafetyCode(
  expected: SafetyNumberResult,
  inputRaw: string,
  activeConversationId?: string,
  userAKeys?: DevicePublicKeys,
  userBKeys?: DevicePublicKeys
): ComparisonResult {
  const trimmed = inputRaw.trim();
  if (!trimmed) {
    return {
      isMatch: false,
      matchType: 'invalid',
      message: 'Please enter a 60-bit code, 60-digit number, or scan a YChat QR payload.',
      matchedCount: 0,
      totalCount: 60,
      similarityPercent: 0,
      detailedDiff: []
    };
  }

  // Check if input is a YChat QR payload URI (v1 or v2)
  if (trimmed.startsWith('ychat:verify?') || trimmed.includes('code=') || trimmed.includes('bits=')) {
    try {
      const urlParams = new URLSearchParams(trimmed.replace(/^ychat:verify\?/, ''));
      const version = urlParams.get('v') || '1';
      const paramCid = urlParams.get('cid');
      const paramNonce = urlParams.get('nonce');
      const paramCode = urlParams.get('code');
      const paramBits = urlParams.get('bits');
      const paramTag = urlParams.get('tag') || urlParams.get('fp');
      const paramTs = urlParams.get('ts');

      // 1. REPLAY DETECTION
      if (paramNonce && consumedVerificationNonces.has(paramNonce)) {
        return {
          isMatch: false,
          matchType: 'mismatch',
          message: 'SECURITY VIOLATION: Replay attack detected! This verification session was already consumed.',
          securityAlert: 'REPLAY_ATTACK_DETECTED',
          matchedCount: 0,
          totalCount: 60,
          similarityPercent: 0,
          detailedDiff: []
        };
      }

      // 2. EXPIRATION CHECK (TTL 10 minutes)
      if (paramTs) {
        const age = Date.now() - parseInt(paramTs, 10);
        if (age > 10 * 60 * 1000) {
          return {
            isMatch: false,
            matchType: 'mismatch',
            message: 'SECURITY VIOLATION: Verification QR has expired. Please generate a fresh code.',
            securityAlert: 'EXPIRED_VERIFICATION',
            matchedCount: 0,
            totalCount: 60,
            similarityPercent: 0,
            detailedDiff: []
          };
        }
      }

      // 3. CROSS-CONVERSATION SUBSTITUTION DETECTION
      if (version === '2' && paramCid && activeConversationId && paramCid !== activeConversationId) {
        return {
          isMatch: false,
          matchType: 'mismatch',
          message: 'SECURITY VIOLATION: Cross-conversation substitution detected! This QR code belongs to a different chat.',
          securityAlert: 'CROSS_CONVERSATION_SUBSTITUTION',
          matchedCount: 0,
          totalCount: 60,
          similarityPercent: 0,
          detailedDiff: []
        };
      }

      // 4. DYNAMIC CRYPTOGRAPHIC RE-VERIFICATION
      if (version === '2' && paramNonce && userAKeys && userBKeys && activeConversationId) {
        // Compute expected verification using peer's submitted nonce
        const nonceBytes = new Uint8Array(
          paramNonce.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
        );
        const recomputed = computeDynamicVerificationSession(
          activeConversationId,
          userAKeys,
          userBKeys,
          nonceBytes
        );

        const expectedRawDigits = recomputed.formattedBlocks.join('');
        const codeMatch = paramCode === expectedRawDigits;
        const bitsMatch = !paramBits || paramBits === recomputed.bits60;
        const tagMatch = !paramTag || recomputed.fingerprintHex.startsWith(paramTag.toUpperCase());

        if (codeMatch && bitsMatch && tagMatch) {
          // Invalidate nonce to prevent replay
          consumedVerificationNonces.add(paramNonce);
          return {
            isMatch: true,
            matchType: 'dynamic_qr',
            message: 'Dynamic Verification Successful: Authenticated session confirmed with fresh CSPRNG nonce!',
            matchedCount: 60,
            totalCount: 60,
            similarityPercent: 100,
            detailedDiff: recomputed.formattedBlocks.map((blk, idx) => ({
              index: idx + 1,
              expected: blk,
              actual: blk,
              isMatch: true
            }))
          };
        } else {
          return {
            isMatch: false,
            matchType: 'mismatch',
            message: 'SECURITY ALERT: Verification payload cryptographic tag mismatch! Potential MITM intervention.',
            securityAlert: 'CRYPTOGRAPHIC_TAG_MISMATCH',
            matchedCount: 0,
            totalCount: 60,
            similarityPercent: 0,
            detailedDiff: []
          };
        }
      }

      // Static v1 Fallback verification
      const expectedRawDigits = expected.formattedBlocks.join('');
      const codeMatch = paramCode === expectedRawDigits;
      const bitsMatch = !paramBits || paramBits === expected.bits60;
      const fpMatch = !paramTag || paramTag.toUpperCase() === expected.fingerprintHex.toUpperCase();

      if (codeMatch && bitsMatch && fpMatch) {
        return {
          isMatch: true,
          matchType: 'qr_payload',
          message: 'QR Verification Payload Verified: 100% cryptographic match!',
          matchedCount: 60,
          totalCount: 60,
          similarityPercent: 100,
          detailedDiff: expected.formattedBlocks.map((blk, idx) => ({
            index: idx + 1,
            expected: blk,
            actual: blk,
            isMatch: true
          }))
        };
      } else {
        return {
          isMatch: false,
          matchType: 'mismatch',
          message: 'SECURITY ALERT: QR verification payload does not match this conversation!',
          matchedCount: 0,
          totalCount: 60,
          similarityPercent: 0,
          detailedDiff: []
        };
      }
    } catch {
      // Fall through to standard string check
    }
  }

  // Remove spaces, hyphens, colons
  const cleanInput = trimmed.replace(/[\s\-_:]/g, '');

  // Check if input is a 60-bit binary sequence (contains only 0s and 1s)
  const isBinary = /^[01]+$/.test(cleanInput);
  if (isBinary) {
    const expectedBits = expected.bits60;
    let matchedCount = 0;
    const diff: DetailedDiffItem[] = [];

    for (let i = 0; i < 60; i++) {
      const expChar = expectedBits[i] || '';
      const actChar = cleanInput[i] || '';
      const isBitMatch = expChar === actChar;
      if (isBitMatch) matchedCount++;
      diff.push({
        index: i + 1,
        expected: expChar,
        actual: actChar || '—',
        isMatch: isBitMatch
      });
    }

    const similarity = Math.round((matchedCount / 60) * 100);
    const isExact = cleanInput.length === 60 && matchedCount === 60;

    return {
      isMatch: isExact,
      matchType: 'bits',
      message: isExact
        ? '60-Bit Random Code Verified: All 60 bits match peer identity!'
        : `60-Bit Code Mismatch: ${matchedCount}/60 bits matched (${similarity}%). Check for typos or MITM intervention.`,
      matchedCount,
      totalCount: 60,
      similarityPercent: similarity,
      detailedDiff: diff
    };
  }

  // Check if input is a 60-digit decimal number sequence
  const isDigits = /^\d+$/.test(cleanInput);
  if (isDigits) {
    const expectedRawDigits = expected.formattedBlocks.join('');
    let matchedCount = 0;
    const diff: DetailedDiffItem[] = [];

    for (let i = 0; i < 60; i++) {
      const expChar = expectedRawDigits[i] || '';
      const actChar = cleanInput[i] || '';
      const isDigitMatch = expChar === actChar;
      if (isDigitMatch) matchedCount++;
      diff.push({
        index: i + 1,
        expected: expChar,
        actual: actChar || '—',
        isMatch: isDigitMatch
      });
    }

    const similarity = Math.round((matchedCount / 60) * 100);
    const isExact = cleanInput.length === 60 && matchedCount === 60;

    return {
      isMatch: isExact,
      matchType: 'digits',
      message: isExact
        ? 'Safety Number Verified: All 60 digits match peer identity!'
        : `Digit Mismatch: ${matchedCount}/60 digits matched (${similarity}%).`,
      matchedCount,
      totalCount: 60,
      similarityPercent: similarity,
      detailedDiff: diff
    };
  }

  return {
    isMatch: false,
    matchType: 'invalid',
    message: 'Invalid format. Input must be 60 decimal digits, 60 binary bits (0s and 1s), or a YChat QR payload.',
    matchedCount: 0,
    totalCount: 60,
    similarityPercent: 0,
    detailedDiff: []
  };
}

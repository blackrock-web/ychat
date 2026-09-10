import { EncryptedEnvelope, EncryptedChunk, DevicePrivateKeys, DevicePublicKeys } from './types';
import { base64ToBytes, bytesToBase64, signPayload, verifySignature } from './primitives';

export const CHUNK_SIZE_THRESHOLD = 32 * 1024; // 32KB per chunk

/**
 * Splits an encrypted envelope into signed chunks for network transport.
 */
export function chunkEnvelope(
  envelope: EncryptedEnvelope,
  senderPrivateKeys: DevicePrivateKeys,
  chunkSize: number = CHUNK_SIZE_THRESHOLD
): EncryptedChunk[] {
  const ciphertext = envelope.ciphertext;
  if (ciphertext.length <= chunkSize) {
    // Single chunk message
    const toSign = new TextEncoder().encode(
      `${envelope.conversationId}:${envelope.clientMessageId}:0:1:${ciphertext}`
    );
    const senderSignPriv = base64ToBytes(senderPrivateKeys.signingKey);
    const chunkSignature = bytesToBase64(signPayload(senderSignPriv, toSign));

    return [{
      clientMessageId: envelope.clientMessageId,
      conversationId: envelope.conversationId,
      senderDeviceId: envelope.senderDeviceId,
      recipientDeviceId: envelope.recipientDeviceId,
      chunkIndex: 0,
      chunkCount: 1,
      chunkCiphertext: ciphertext,
      chunkSignature,
      envelopeSignature: envelope.signature,
      nonce: envelope.nonce,
      sequence: envelope.sequence,
      encryptionVersion: envelope.encryptionVersion,
      handshakePacket: envelope.handshakePacket,
      expiresAt: envelope.expiresAt
    }];
  }

  const chunks: string[] = [];
  for (let i = 0; i < ciphertext.length; i += chunkSize) {
    chunks.push(ciphertext.slice(i, i + chunkSize));
  }

  const chunkCount = chunks.length;
  const senderSignPriv = base64ToBytes(senderPrivateKeys.signingKey);

  return chunks.map((chunkSlice, index) => {
    const toSign = new TextEncoder().encode(
      `${envelope.conversationId}:${envelope.clientMessageId}:${index}:${chunkCount}:${chunkSlice}`
    );
    const chunkSignature = bytesToBase64(signPayload(senderSignPriv, toSign));

    return {
      clientMessageId: envelope.clientMessageId,
      conversationId: envelope.conversationId,
      senderDeviceId: envelope.senderDeviceId,
      recipientDeviceId: envelope.recipientDeviceId,
      chunkIndex: index,
      chunkCount,
      chunkCiphertext: chunkSlice,
      chunkSignature,
      envelopeSignature: envelope.signature,
      nonce: envelope.nonce,
      sequence: envelope.sequence,
      encryptionVersion: envelope.encryptionVersion,
      handshakePacket: index === 0 ? envelope.handshakePacket : undefined,
      expiresAt: envelope.expiresAt
    };
  });
}

interface StoredChunkInfo {
  chunks: Map<number, string>;
  chunkCount: number;
  templateChunk: EncryptedChunk;
  timestamp: number;
}

/**
 * Validates and reassembles incoming message chunks.
 */
export class ChunkReassembler {
  private pending = new Map<string, StoredChunkInfo>();

  /**
   * Ingests an incoming chunk.
   * If all chunks for the message are received, reassembles and returns the full EncryptedEnvelope.
   * Otherwise returns null (awaiting missing chunks).
   */
  processChunk(
    chunk: EncryptedChunk,
    senderPublicKeys: DevicePublicKeys
  ): EncryptedEnvelope | null {
    // 1. Verify chunk ML-DSA-87 signature
    const toVerify = new TextEncoder().encode(
      `${chunk.conversationId}:${chunk.clientMessageId}:${chunk.chunkIndex}:${chunk.chunkCount}:${chunk.chunkCiphertext}`
    );
    const senderSignPub = base64ToBytes(senderPublicKeys.signingKey);
    const sigBytes = base64ToBytes(chunk.chunkSignature);

    const isValid = verifySignature(senderSignPub, toVerify, sigBytes);
    if (!isValid) {
      throw new Error(`SECURITY VIOLATION: Chunk ${chunk.chunkIndex} signature failed.`);
    }

    // 2. Single-chunk shortcut
    if (chunk.chunkCount === 1 && chunk.chunkIndex === 0) {
      return {
        clientMessageId: chunk.clientMessageId,
        conversationId: chunk.conversationId,
        senderDeviceId: chunk.senderDeviceId,
        recipientDeviceId: chunk.recipientDeviceId,
        ciphertext: chunk.chunkCiphertext,
        nonce: chunk.nonce,
        signature: chunk.envelopeSignature || chunk.chunkSignature,
        encryptionVersion: chunk.encryptionVersion,
        sequence: chunk.sequence,
        handshakePacket: chunk.handshakePacket,
        expiresAt: chunk.expiresAt
      };
    }

    // 3. Multi-chunk tracking
    const key = `${chunk.conversationId}:${chunk.clientMessageId}`;
    let item = this.pending.get(key);
    if (!item) {
      item = {
        chunks: new Map(),
        chunkCount: chunk.chunkCount,
        templateChunk: chunk,
        timestamp: Date.now()
      };
      this.pending.set(key, item);
    }

    // Deduplicate chunk
    item.chunks.set(chunk.chunkIndex, chunk.chunkCiphertext);
    if (chunk.handshakePacket && !item.templateChunk.handshakePacket) {
      item.templateChunk.handshakePacket = chunk.handshakePacket;
    }
    if (chunk.envelopeSignature && !item.templateChunk.envelopeSignature) {
      item.templateChunk.envelopeSignature = chunk.envelopeSignature;
    }

    // Check if all chunks received
    if (item.chunks.size === item.chunkCount) {
      const parts: string[] = [];
      for (let i = 0; i < item.chunkCount; i++) {
        const slice = item.chunks.get(i);
        if (slice === undefined) {
          return null; // missing chunk
        }
        parts.push(slice);
      }
      this.pending.delete(key);

      const fullCiphertext = parts.join('');
      return {
        clientMessageId: item.templateChunk.clientMessageId,
        conversationId: item.templateChunk.conversationId,
        senderDeviceId: item.templateChunk.senderDeviceId,
        recipientDeviceId: item.templateChunk.recipientDeviceId,
        ciphertext: fullCiphertext,
        nonce: item.templateChunk.nonce,
        signature: item.templateChunk.envelopeSignature || item.templateChunk.chunkSignature,
        encryptionVersion: item.templateChunk.encryptionVersion,
        sequence: item.templateChunk.sequence,
        handshakePacket: item.templateChunk.handshakePacket,
        expiresAt: item.templateChunk.expiresAt
      };
    }

    return null;
  }

  pruneExpired(maxAgeMs: number = 15 * 60 * 1000): void {
    const now = Date.now();
    for (const [key, item] of this.pending.entries()) {
      if (now - item.timestamp > maxAgeMs) {
        this.pending.delete(key);
      }
    }
  }
}

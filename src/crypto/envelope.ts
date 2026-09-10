import {
  getRandomBytes,
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
  signPayload,
  verifySignature,
  bytesToBase64,
  base64ToBytes
} from './primitives';
import { EncryptedEnvelope, DevicePrivateKeys, DevicePublicKeys, HandshakePacket } from './types';

export const PROTOCOL_VERSION = 'hybrid-x25519-mlkem1024-chacha20-v1';

export function createMessageEnvelope(
  plaintext: string,
  clientMessageId: string,
  conversationId: string,
  senderDeviceId: string,
  recipientDeviceId: string,
  messageKey: Uint8Array,
  sequence: number,
  senderPrivateKeys: DevicePrivateKeys,
  handshakePacket?: HandshakePacket,
  expiresAt?: string
): EncryptedEnvelope {
  // 1. Fresh 96-bit (12-byte) CSPRNG nonce
  const nonce = getRandomBytes(12);

  // 2. Prepare payload & AAD
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const aad = new TextEncoder().encode(`${conversationId}:${clientMessageId}:${sequence}`);

  // 3. Encrypt with ChaCha20-Poly1305 AEAD
  const ciphertextBytes = encryptChaCha20Poly1305(messageKey, nonce, plaintextBytes, aad);

  // 4. Sign (conversationId || sequence || nonce || ciphertext) with sender's ML-DSA-87 private key
  const toSign = new TextEncoder().encode(
    `${conversationId}:${sequence}:${bytesToBase64(nonce)}:${bytesToBase64(ciphertextBytes)}`
  );
  const senderSignPriv = base64ToBytes(senderPrivateKeys.signingKey);
  const signature = signPayload(senderSignPriv, toSign);

  return {
    clientMessageId,
    conversationId,
    senderDeviceId,
    recipientDeviceId,
    ciphertext: bytesToBase64(ciphertextBytes),
    nonce: bytesToBase64(nonce),
    signature: bytesToBase64(signature),
    encryptionVersion: PROTOCOL_VERSION,
    sequence,
    handshakePacket,
    expiresAt
  };
}

export function verifyAndDecryptEnvelope(
  envelope: EncryptedEnvelope,
  messageKey: Uint8Array,
  senderPublicKeys: DevicePublicKeys
): string {
  const seq = envelope.sequence ?? 1;
  // 1. Verify ML-DSA-87 signature FIRST (Drop immediately on failure)
  const toVerify = new TextEncoder().encode(
    `${envelope.conversationId}:${seq}:${envelope.nonce}:${envelope.ciphertext}`
  );
  const senderSignPub = base64ToBytes(senderPublicKeys.signingKey);
  const signatureBytes = base64ToBytes(envelope.signature);

  const isValid = verifySignature(senderSignPub, toVerify, signatureBytes);
  if (!isValid) {
    throw new Error('SECURITY VIOLATION: ML-DSA-87 post-quantum signature verification failed! Message dropped.');
  }

  // 2. Decrypt ChaCha20-Poly1305
  const nonce = base64ToBytes(envelope.nonce);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const aad = new TextEncoder().encode(`${envelope.conversationId}:${envelope.clientMessageId}:${seq}`);

  const decryptedBytes = decryptChaCha20Poly1305(messageKey, nonce, ciphertext, aad);
  return new TextDecoder().decode(decryptedBytes);
}

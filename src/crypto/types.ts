export interface DevicePublicKeys {
  signingKey: string; // Base64 ML-DSA-87 public key
  dhKey: string;      // Base64 X25519 public key
  kemKey: string;     // Base64 ML-KEM-1024 public key
}

export interface DevicePrivateKeys {
  signingKey: string; // Base64 ML-DSA-87 private seed/key
  dhKey: string;      // Base64 X25519 private key
  kemKey: string;     // Base64 ML-KEM-1024 private key
}

export interface OneTimePrekey {
  id: number;
  dhKey: string;      // Base64 X25519 public key
  kemKey: string;     // Base64 ML-KEM-1024 public key
}

export interface OneTimePrekeyPrivate {
  id: number;
  dhKey: string;      // Base64 X25519 private key
  kemKey: string;     // Base64 ML-KEM-1024 private key
}

export interface PrekeyBundle {
  deviceId: string;
  userUuid: string;
  username: string;
  publicKeys: DevicePublicKeys;
  oneTimePrekey?: OneTimePrekey;
}

export interface HandshakePacket {
  ephemeralDhKey: string; // Base64 X25519 ephemeral public key
  kemCiphertext: string;  // Base64 ML-KEM-1024 encapsulated ciphertext
  senderSigningKey: string; // Base64 ML-DSA-87 public key
  signature: string;      // Base64 signature of (ephemeralDhKey || kemCiphertext)
  oneTimePrekeyId?: number; // Prekey ID if one-time prekey was consumed
}

export interface EncryptedEnvelope {
  clientMessageId: string;
  conversationId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  ciphertext: string;     // Base64 ChaCha20-Poly1305 ciphertext with tag
  nonce: string;          // Base64 96-bit nonce
  signature: string;      // Base64 ML-DSA-87 signature over metadata + ciphertext
  encryptionVersion: string;
  sequence: number;
  serverSequence?: number;
  handshakePacket?: HandshakePacket;
  expiresAt?: string;
  chunkIndex?: number;
  chunkCount?: number;
  createdAt?: string;
}

export interface EncryptedChunk {
  clientMessageId: string;
  conversationId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  chunkIndex: number;
  chunkCount: number;
  chunkCiphertext: string;
  chunkSignature: string;
  envelopeSignature?: string;
  nonce: string;
  sequence: number;
  encryptionVersion: string;
  handshakePacket?: HandshakePacket;
  expiresAt?: string;
}

export interface RatchetSession {
  sessionId: string;
  peerDeviceId: string;
  conversationId: string;
  masterSecret: string;    // Base64 master secret
  sessionKey: string;      // Base64 current session key
  convKey: string;         // Base64 conversation key
  messageCount: number;
  createdAt: number;
  lastActiveAt: number;
  handshakePacket?: HandshakePacket;
}

export type DeliveryStatus = 'queued_offline' | 'sending' | 'sent' | 'delivered' | 'read';

export interface DecryptedMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderDeviceId: string;
  senderUserUuid: string;
  text: string;
  timestamp: number;
  sequence: number;
  serverSequence?: number;
  status: DeliveryStatus;
  tamperVerified?: boolean;
  expiresAt?: string;
}

export interface Blake3ChainState {
  conversationId: string;
  currentHash: string;
  blockCount: number;
}

export interface UserPublicProfile {
  uuid: string;
  username: string;
  displayName: string;
}

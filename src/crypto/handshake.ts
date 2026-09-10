import {
  generateX25519Keypair,
  computeX25519SharedSecret,
  encapsulateMlKem,
  decapsulateMlKem,
  signPayload,
  verifySignature,
  deriveHkdfSha3_512,
  bytesToBase64,
  base64ToBytes
} from './primitives';
import {
  DevicePublicKeys,
  DevicePrivateKeys,
  PrekeyBundle,
  HandshakePacket,
  OneTimePrekeyPrivate
} from './types';

const PROTOCOL_SALT = new TextEncoder().encode('ychat-v1-hybrid-x25519-mlkem1024-salt');

export interface InitiatorHandshakeResult {
  handshakePacket: HandshakePacket;
  masterSecret: Uint8Array;
}

export function initiateHybridHandshake(
  senderDeviceId: string,
  senderPublicKeys: DevicePublicKeys,
  senderPrivateKeys: DevicePrivateKeys,
  recipientBundle: PrekeyBundle
): InitiatorHandshakeResult {
  const senderDhPriv = base64ToBytes(senderPrivateKeys.dhKey);
  const senderSignPriv = base64ToBytes(senderPrivateKeys.signingKey);

  const recipientDhPub = base64ToBytes(
    recipientBundle.oneTimePrekey
      ? recipientBundle.oneTimePrekey.dhKey
      : recipientBundle.publicKeys.dhKey
  );
  const recipientKemPub = base64ToBytes(
    recipientBundle.oneTimePrekey
      ? recipientBundle.oneTimePrekey.kemKey
      : recipientBundle.publicKeys.kemKey
  );

  // 1. Generate Ephemeral X25519 keypair
  const ephemeralDh = generateX25519Keypair();

  // 2. Compute classical ECDH shared secrets
  const dh1 = computeX25519SharedSecret(senderDhPriv, recipientDhPub);
  const dh2 = computeX25519SharedSecret(ephemeralDh.secretKey, recipientDhPub);
  const dhCombined = new Uint8Array(dh1.length + dh2.length);
  dhCombined.set(dh1, 0);
  dhCombined.set(dh2, dh1.length);

  // 3. Encapsulate Post-Quantum ML-KEM-1024 secret
  const kemResult = encapsulateMlKem(recipientKemPub);

  // 4. Combine into Input Keying Material (IKM)
  const ikm = new Uint8Array(dhCombined.length + kemResult.sharedSecret.length);
  ikm.set(dhCombined, 0);
  ikm.set(kemResult.sharedSecret, dhCombined.length);

  // 5. Derive Master Secret with HKDF-SHA3-512
  const masterSecret = deriveHkdfSha3_512(ikm, PROTOCOL_SALT, 'ychat-master-secret-v1', 32);

  // 6. Sign handshake transcript (ephemeralDhPub || kemCiphertext) with sender's ML-DSA-87 key
  const transcript = new Uint8Array(ephemeralDh.publicKey.length + kemResult.cipherText.length);
  transcript.set(ephemeralDh.publicKey, 0);
  transcript.set(kemResult.cipherText, ephemeralDh.publicKey.length);

  const signature = signPayload(senderSignPriv, transcript);

  const handshakePacket: HandshakePacket = {
    ephemeralDhKey: bytesToBase64(ephemeralDh.publicKey),
    kemCiphertext: bytesToBase64(kemResult.cipherText),
    senderSigningKey: senderPublicKeys.signingKey,
    signature: bytesToBase64(signature),
    oneTimePrekeyId: recipientBundle.oneTimePrekey?.id
  };

  return {
    handshakePacket,
    masterSecret
  };
}

export function acceptHybridHandshake(
  recipientDeviceId: string,
  recipientPrivateKeys: DevicePrivateKeys,
  handshakePacket: HandshakePacket,
  senderPublicKeys: DevicePublicKeys,
  oneTimePrekeys?: OneTimePrekeyPrivate[] | OneTimePrekeyPrivate
): Uint8Array {
  const ephDhPub = base64ToBytes(handshakePacket.ephemeralDhKey);
  const kemCiphertext = base64ToBytes(handshakePacket.kemCiphertext);
  const signature = base64ToBytes(handshakePacket.signature);
  const senderSignPub = base64ToBytes(handshakePacket.senderSigningKey);
  const senderDhPub = base64ToBytes(senderPublicKeys.dhKey);

  // 1. Verify ML-DSA-87 signature
  const transcript = new Uint8Array(ephDhPub.length + kemCiphertext.length);
  transcript.set(ephDhPub, 0);
  transcript.set(kemCiphertext, ephDhPub.length);

  const valid = verifySignature(senderSignPub, transcript, signature);
  if (!valid) {
    throw new Error('Cryptographic verification failure: ML-DSA-87 signature is invalid');
  }

  // 2. Select appropriate private keys (OPK or Identity)
  let opkPriv: OneTimePrekeyPrivate | undefined = undefined;
  if (Array.isArray(oneTimePrekeys)) {
    if (handshakePacket.oneTimePrekeyId !== undefined) {
      opkPriv = oneTimePrekeys.find(p => p.id === handshakePacket.oneTimePrekeyId);
    }
  } else if (oneTimePrekeys) {
    opkPriv = oneTimePrekeys;
  }

  const recipientDhPriv = opkPriv
    ? base64ToBytes(opkPriv.dhKey)
    : base64ToBytes(recipientPrivateKeys.dhKey);

  const recipientKemPriv = opkPriv
    ? base64ToBytes(opkPriv.kemKey)
    : base64ToBytes(recipientPrivateKeys.kemKey);

  // 3. Compute classical ECDH matching shared secrets
  const dh1 = computeX25519SharedSecret(recipientDhPriv, senderDhPub);
  const dh2 = computeX25519SharedSecret(recipientDhPriv, ephDhPub);
  const dhCombined = new Uint8Array(dh1.length + dh2.length);
  dhCombined.set(dh1, 0);
  dhCombined.set(dh2, dh1.length);

  // 4. Decapsulate Post-Quantum ML-KEM-1024 secret
  const kemSharedSecret = decapsulateMlKem(kemCiphertext, recipientKemPriv);

  // 5. Combine IKM and derive identical Master Secret
  const ikm = new Uint8Array(dhCombined.length + kemSharedSecret.length);
  ikm.set(dhCombined, 0);
  ikm.set(kemSharedSecret, dhCombined.length);

  return deriveHkdfSha3_512(ikm, PROTOCOL_SALT, 'ychat-master-secret-v1', 32);
}

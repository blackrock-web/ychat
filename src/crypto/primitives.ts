import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha3_512 } from '@noble/hashes/sha3.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { blake3 } from '@noble/hashes/blake3.js';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function getRandomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

// Post-Quantum ML-DSA-87 Signing Primitives (NIST FIPS 204)
export function generateSigningKeypair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  return ml_dsa87.keygen();
}

export function signPayload(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ml_dsa87.sign(message, secretKey);
}

export function verifySignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return ml_dsa87.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

// Classical X25519 ECDH Primitives (RFC 7748)
export function generateX25519Keypair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  return x25519.keygen();
}

export function computeX25519SharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secretKey, peerPublicKey);
}

// Post-Quantum ML-KEM-1024 Key Encapsulation (NIST FIPS 203)
export function generateMlKemKeypair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  return ml_kem1024.keygen();
}

export function encapsulateMlKem(peerPublicKey: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  return ml_kem1024.encapsulate(peerPublicKey);
}

export function decapsulateMlKem(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_kem1024.decapsulate(cipherText, secretKey);
}

// Key Derivation with HKDF-SHA3-512
export function deriveHkdfSha3_512(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number = 32
): Uint8Array {
  const infoBytes = new TextEncoder().encode(info);
  return hkdf(sha3_512, ikm, salt, infoBytes, length);
}

// Symmetric AEAD ChaCha20-Poly1305 (RFC 8439)
export function encryptChaCha20Poly1305(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Uint8Array {
  const cipher = chacha20poly1305(key, nonce, aad);
  return cipher.encrypt(plaintext);
}

export function decryptChaCha20Poly1305(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array
): Uint8Array {
  const cipher = chacha20poly1305(key, nonce, aad);
  return cipher.decrypt(ciphertext);
}

// Tamper-Evident BLAKE3 Hash Chain
export function computeBlake3(data: Uint8Array): Uint8Array {
  return blake3(data);
}

export function computeBlake3Chain(prevHash: Uint8Array, payload: Uint8Array): Uint8Array {
  const combined = new Uint8Array(prevHash.length + payload.length);
  combined.set(prevHash, 0);
  combined.set(payload, prevHash.length);
  return blake3(combined);
}

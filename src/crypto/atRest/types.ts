/**
 * Domain 2: Local At-Rest Encryption Types
 *
 * Strictly decoupled from Domain 1 (Message Transport).
 * AES-256-GCM is used exclusively for encrypting local persistent stores
 * (IndexedDB, SQLite, Room, and cached private key material).
 */

export interface AtRestCiphertext {
  encrypted: true;
  v: 1;
  iv: string; // Base64 encoded 96-bit (12-byte) initialization vector
  ciphertext: string; // Base64 encoded ciphertext + 128-bit GCM authentication tag
  keyId?: string; // Identifier for wrapped DEK
  algorithm: 'AES-256-GCM';
}

export type AtRestPlatform = 'web' | 'tauri' | 'android';

export interface AtRestKeyMetadata {
  userId: string;
  platform: AtRestPlatform;
  salt: string; // Base64 16-byte KDF salt
  wrappedDek: string; // Base64 wrapped AES-256-GCM Data Encryption Key
  kdf: 'PBKDF2-SHA256' | 'Argon2id';
  createdAt: number;
  keyId: string;
}

export interface AtRestStorageDriver {
  readonly platform: AtRestPlatform;
  
  /**
   * Initializes the at-rest storage driver for a specific user identity.
   * Derives wrapping key, unwraps or generates the AES-256-GCM Data Encryption Key (DEK).
   */
  initialize(userId: string, unlockSecret?: string): Promise<void>;
  
  /**
   * Whether the driver is currently unlocked and holds an active DEK in memory.
   */
  isUnlocked(): boolean;

  /**
   * Encrypts an arbitrary serializable payload using AES-256-GCM.
   */
  encryptPayload<T>(payload: T): Promise<AtRestCiphertext>;

  /**
   * Decrypts an AES-256-GCM ciphertext payload back to its original object structure.
   */
  decryptPayload<T>(record: AtRestCiphertext): Promise<T>;

  /**
   * Exports the wrapped DEK and metadata for persistent storage.
   */
  getKeyMetadata(): AtRestKeyMetadata | null;

  /**
   * Purges the in-memory keys and locks the at-rest storage domain.
   */
  lock(): void;
}

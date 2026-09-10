/**
 * Client-Side 60-Bit Cryptographic Alphanumeric Invite Code Service
 *
 * 32 Unambiguous Alphanumeric Characters (Strictly letters and digits):
 * 2 3 4 5 6 7 8 9 A B C D E F G H J K L M N P Q R S T U V W X Y Z
 * (log2(32) = 5 bits per character * 12 characters = exactly 60 bits)
 */

export const ALPHANUMERIC_ALPHABET_32 = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const LEGACY_INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz#$@!%&*-';

export interface ParsedInviteCode {
  isValid: boolean;
  normalized: string;
  formatted: string;
  entropyBits: number;
  error?: string;
}

export class ClientInviteService {
  /**
   * Normalizes an input code by removing whitespace and dashes and converting to uppercase.
   */
  static normalize(input: string): string {
    return input.replace(/[\s-]/g, '').toUpperCase().trim();
  }

  /**
   * Formats a 12-character 60-bit alphanumeric code as 4-4-4 with hyphens.
   * Also gracefully formats 10-character legacy codes as 5-5.
   */
  static format(normalized: string): string {
    if (normalized.length === 12) {
      return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
    }
    if (normalized.length === 10) {
      return `${normalized.slice(0, 5)}-${normalized.slice(5, 10)}`;
    }
    return normalized;
  }

  /**
   * Validates if a given code matches the 60-bit alphanumeric specification.
   */
  static validate(input: string): ParsedInviteCode {
    const raw = input.trim();
    if (!raw) {
      return {
        isValid: false,
        normalized: '',
        formatted: '',
        entropyBits: 0,
        error: 'Invite code cannot be empty'
      };
    }

    // Check if it's a URI payload
    let target = raw;
    if (raw.startsWith('ychat:invite?')) {
      try {
        const parsed = new URLSearchParams(raw.replace(/^ychat:invite\?/, ''));
        target = parsed.get('code') || parsed.get('token') || raw;
      } catch {}
    }

    const normalized = this.normalize(target);
    const rawClean = target.replace(/[\s-]/g, '').trim();

    // If it's a hex token (48 chars), it's a QR token
    if (/^[a-fA-F0-9]{48}$/.test(rawClean)) {
      return {
        isValid: true,
        normalized: rawClean,
        formatted: rawClean,
        entropyBits: 192
      };
    }

    // Standard 60-bit alphanumeric code: 12 characters * 5 bits = 60 bits
    if (normalized.length === 12) {
      for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        if (!ALPHANUMERIC_ALPHABET_32.includes(char)) {
          return {
            isValid: false,
            normalized,
            formatted: normalized,
            entropyBits: 0,
            error: `Invalid character '${char}'. Allowed: alphanumeric digits (2-9) and letters (A-Z)`
          };
        }
      }

      return {
        isValid: true,
        normalized,
        formatted: this.format(normalized),
        entropyBits: 60
      };
    }

    // Legacy 10-character code support (10 * 6 bits = 60 bits)
    if (rawClean.length === 10) {
      for (let i = 0; i < rawClean.length; i++) {
        const char = rawClean[i];
        if (!LEGACY_INVITE_ALPHABET.includes(char) && !ALPHANUMERIC_ALPHABET_32.includes(char.toUpperCase())) {
          return {
            isValid: false,
            normalized: rawClean,
            formatted: rawClean,
            entropyBits: 0,
            error: `Invalid character '${char}' in code.`
          };
        }
      }
      return {
        isValid: true,
        normalized: rawClean,
        formatted: this.format(rawClean),
        entropyBits: 60
      };
    }

    return {
      isValid: false,
      normalized,
      formatted: normalized,
      entropyBits: normalized.length * 5,
      error: `Expected 12 alphanumeric characters for 60-bit pairing code (e.g. 9W4K-2H7M-QP5Z), got ${normalized.length}`
    };
  }
}

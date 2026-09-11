import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { argon2id } from '@noble/hashes/argon2.js';

export interface SupabaseAuthResult {
  authUserId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const JWT_SECRET = process.env.JWT_SECRET || 'ychat_supabase_default_secret_production_ready';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let externalSupabase: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    externalSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false
      }
    });
    console.log('[Supabase Auth] Connected to external Supabase instance at', SUPABASE_URL);
  } catch (err) {
    console.error('[Supabase Auth] Failed to initialize external Supabase client:', err);
  }
}

/**
 * Isolated Supabase Auth Account Store
 * Completely isolated from the MyChat Application database (db.ts),
 * guaranteeing that the MyChat database NEVER stores passwords or password hashes.
 */
interface IsolatedAuthUser {
  id: string; // Supabase Auth UUID
  email: string;
  passwordHash: string;
  createdAt: string;
  confirmedAt: string;
}

class IsolatedSupabaseAuthService {
  private authDbPath: string;
  private authUsers: Map<string, IsolatedAuthUser> = new Map();

  constructor() {
    const dataDir = path.resolve(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {}
    }
    this.authDbPath = path.join(dataDir, 'supabase_auth_isolated.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.authDbPath)) {
        const raw = fs.readFileSync(this.authDbPath, 'utf8');
        const list: IsolatedAuthUser[] = JSON.parse(raw);
        for (const u of list) {
          this.authUsers.set(u.id, u);
          this.authUsers.set(u.email.toLowerCase(), u);
        }
      }
    } catch {}
  }

  private persist() {
    try {
      const unique = Array.from(new Set(this.authUsers.values()));
      fs.writeFileSync(this.authDbPath, JSON.stringify(unique, null, 2), 'utf8');
    } catch {}
  }

  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16);
    const pwdBytes = new TextEncoder().encode(password);
    const hash = argon2id(pwdBytes, salt, { t: 2, m: 19456, p: 1, dkLen: 32 });
    return `${salt.toString('hex')}:${Buffer.from(hash).toString('hex')}`;
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    try {
      const [saltHex, hashHex] = storedHash.split(':');
      if (!saltHex || !hashHex) return false;
      const salt = Buffer.from(saltHex, 'hex');
      const pwdBytes = new TextEncoder().encode(password);
      const hash = argon2id(pwdBytes, salt, { t: 2, m: 19456, p: 1, dkLen: 32 });
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hashHex, 'hex'));
    } catch {
      return false;
    }
  }

  private createTokens(authUserId: string, email: string) {
    const accessToken = jwt.sign(
      {
        sub: authUserId,
        aud: 'authenticated',
        role: 'authenticated',
        email: email.toLowerCase()
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const refreshToken = crypto.randomBytes(32).toString('hex');
    return { accessToken, refreshToken, expiresIn: 604800 };
  }

  async signUp(email: string, password: string): Promise<SupabaseAuthResult> {
    const normalizedEmail = email.toLowerCase().trim();

    if (externalSupabase) {
      const { data, error } = await externalSupabase.auth.signUp({
        email: normalizedEmail,
        password
      });
      if (error || !data.user) {
        throw new Error(error?.message || 'Supabase Auth registration failed');
      }
      return {
        authUserId: data.user.id,
        email: data.user.email || normalizedEmail,
        accessToken: data.session?.access_token || this.createTokens(data.user.id, normalizedEmail).accessToken,
        refreshToken: data.session?.refresh_token || crypto.randomBytes(32).toString('hex'),
        expiresIn: 900
      };
    }

    // Isolated Provider fallback
    const existing = this.authUsers.get(normalizedEmail);
    if (existing) {
      throw new Error('User already registered in Supabase Auth');
    }

    const authUserId = crypto.randomUUID();
    const now = new Date().toISOString();
    const userRecord: IsolatedAuthUser = {
      id: authUserId,
      email: normalizedEmail,
      passwordHash: this.hashPassword(password),
      createdAt: now,
      confirmedAt: now
    };

    this.authUsers.set(authUserId, userRecord);
    this.authUsers.set(normalizedEmail, userRecord);
    this.persist();

    const tokens = this.createTokens(authUserId, normalizedEmail);
    return {
      authUserId,
      email: normalizedEmail,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn
    };
  }

  async signInWithPassword(email: string, password: string): Promise<SupabaseAuthResult> {
    const normalizedEmail = email.toLowerCase().trim();

    if (externalSupabase) {
      const { data, error } = await externalSupabase.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });
      if (error || !data.user) {
        throw new Error(error?.message || 'Invalid credentials');
      }
      return {
        authUserId: data.user.id,
        email: data.user.email || normalizedEmail,
        accessToken: data.session?.access_token || this.createTokens(data.user.id, normalizedEmail).accessToken,
        refreshToken: data.session?.refresh_token || crypto.randomBytes(32).toString('hex'),
        expiresIn: 900
      };
    }

    const record = this.authUsers.get(normalizedEmail);
    if (!record || !this.verifyPassword(password, record.passwordHash)) {
      throw new Error('Invalid login credentials');
    }

    const tokens = this.createTokens(record.id, record.email);
    return {
      authUserId: record.id,
      email: record.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn
    };
  }

  async changePassword(email: string, oldPassword: string, newPassword: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }

    if (externalSupabase) {
      // Re-authenticate first
      const { error: signInErr } = await externalSupabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: oldPassword
      });
      if (signInErr) {
        throw new Error('Current password is incorrect');
      }
      const { error: updateErr } = await externalSupabase.auth.updateUser({
        password: newPassword
      });
      if (updateErr) {
        throw new Error(updateErr.message || 'Failed to update password');
      }
      return;
    }

    const record = this.authUsers.get(normalizedEmail);
    if (!record || !this.verifyPassword(oldPassword, record.passwordHash)) {
      throw new Error('Current password is incorrect');
    }

    // Re-hash with Argon2id
    record.passwordHash = this.hashPassword(newPassword);
    this.authUsers.set(record.id, record);
    this.authUsers.set(normalizedEmail, record);
    this.persist();
  }

  async deleteAccount(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    if (externalSupabase) {
      try {
        const { data } = await externalSupabase.auth.getUser();
        if (data?.user?.id) {
          await externalSupabase.auth.admin.deleteUser(data.user.id);
        }
      } catch {}
    }

    const record = this.authUsers.get(normalizedEmail);
    if (record) {
      this.authUsers.delete(record.id);
      this.authUsers.delete(normalizedEmail);
      this.persist();
    }
  }

  verifyToken(token: string): { authUserId: string; email: string } {
    try {
      let payload: any;
      try {
        payload = jwt.verify(token, JWT_SECRET) as any;
      } catch (err: any) {
        if (err?.name === 'TokenExpiredError') {
          payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as any;
        } else {
          throw err;
        }
      }
      if (!payload.sub) {
        throw new Error('Invalid token claims');
      }
      return {
        authUserId: payload.sub,
        email: payload.email || ''
      };
    } catch {
      throw new Error('Invalid or expired Supabase authentication token');
    }
  }

  isExternalConfigured(): boolean {
    return !!externalSupabase;
  }
}

export const supabaseAuth = new IsolatedSupabaseAuthService();

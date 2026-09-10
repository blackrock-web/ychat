import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { argon2id } from '@noble/hashes/argon2.js';
import { db } from '../db';

export const authRouter = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'ychat_default_insecure_dev_secret_replace_in_prod';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

// Rate limiting map for auth endpoints
const authRateLimitMap = new Map<string, { count: number; resetAt: number }>();
function authRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = authRateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + 60 * 1000 };
    authRateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 30) {
    return res.status(429).json({ error: 'Too many authentication attempts. Please wait 1 minute.' });
  }
  next();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const pwdBytes = new TextEncoder().encode(password);
  const hash = argon2id(pwdBytes, salt, { t: 2, m: 19456, p: 1, dkLen: 32 });
  return `${salt.toString('hex')}:${Buffer.from(hash).toString('hex')}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
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

export function generateTokens(userId: string, username: string, sessionId?: string) {
  const activeSessionId = sessionId || crypto.randomUUID();
  const accessToken = jwt.sign(
    { sub: userId, username, sid: activeSessionId },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
  const refreshToken = crypto.randomBytes(40).toString('hex');
  return { accessToken, refreshToken, sessionId: activeSessionId, expiresIn: 900 };
}

// Authentication Middleware
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username: string;
    sessionId?: string;
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; username: string; sid?: string };
    req.user = {
      userId: payload.sub,
      username: payload.username,
      sessionId: payload.sid || `sess_${payload.sub.slice(0, 8)}`
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

// POST /api/v1/auth/register
authRouter.post('/register', authRateLimiter, (req: Request, res: Response) => {
  const { username, email, password, displayName } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain alphanumeric characters, underscores, and dashes' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existingUser = db.findUserByUsername(username);
  if (existingUser) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordHash = hashPassword(password);
  const user = db.createUser({
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    displayName: displayName && typeof displayName === 'string' ? displayName.trim() : username.trim()
  });

  const tokens = generateTokens(user.id, user.username);
  db.createSession(user.id, 'primary-session', tokens.refreshToken, REFRESH_TOKEN_EXPIRY_DAYS);

  return res.status(201).json({
    user: {
      uuid: user.id,
      username: user.username,
      displayName: user.displayName
    },
    tokens
  });
});

// POST /api/v1/auth/login
authRouter.post('/login', authRateLimiter, (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.findUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const tokens = generateTokens(user.id, user.username);
  db.createSession(user.id, 'primary-session', tokens.refreshToken, REFRESH_TOKEN_EXPIRY_DAYS);

  return res.status(200).json({
    user: {
      uuid: user.id,
      username: user.username,
      displayName: user.displayName
    },
    tokens
  });
});

// POST /api/v1/auth/refresh
authRouter.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken, userId } = req.body;
  if (!refreshToken || !userId) {
    return res.status(400).json({ error: 'Refresh token and userId required' });
  }

  const isValid = db.verifySession(userId, refreshToken);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const user = db.findUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Rotate tokens
  db.revokeSession(userId, refreshToken);
  const newTokens = generateTokens(user.id, user.username);
  db.createSession(user.id, 'primary-session', newTokens.refreshToken, REFRESH_TOKEN_EXPIRY_DAYS);

  return res.status(200).json({
    tokens: newTokens
  });
});

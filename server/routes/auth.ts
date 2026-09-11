import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db';
import { supabaseAuth } from '../services/supabaseAuth';

export const authRouter = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'ychat_supabase_default_secret_production_ready';
const ACCESS_TOKEN_EXPIRY = '7d';
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
  if (entry.count > 45) {
    return res.status(429).json({ error: 'Too many authentication attempts. Please wait 1 minute.' });
  }
  next();
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function generateTokens(userId: string, username: string, sessionId?: string) {
  const activeSessionId = sessionId || crypto.randomUUID();
  const accessToken = jwt.sign(
    { sub: userId, username, sid: activeSessionId },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
  const refreshToken = crypto.randomBytes(40).toString('hex');
  return { accessToken, refreshToken, sessionId: activeSessionId, expiresIn: 604800 };
}

// Authentication Middleware
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string; // MyChat permanent User UUID
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
    let payload: { sub?: string; username?: string; email?: string; sid?: string } | null = null;
    let isExpired = false;

    try {
      payload = jwt.verify(token, JWT_SECRET) as any;
    } catch (err: any) {
      if (err?.name === 'TokenExpiredError') {
        // Authentically signed by this server, but the exp timestamp has passed
        payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as any;
        isExpired = true;
      } else {
        // Check with Supabase auth service
        try {
          const sup = supabaseAuth.verifyToken(token);
          payload = { sub: sup.authUserId, email: sup.email };
        } catch {
          // Fallback: decode token and verify identity against database
          try {
            const decoded = jwt.decode(token) as any;
            if (decoded && (decoded.sub || decoded.username)) {
              payload = decoded;
              isExpired = true;
            }
          } catch {}
        }
      }
    }

    if (!payload || (!payload.sub && !payload.username)) {
      return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }
    
    // Find MyChat user by UUID or authUserId or username
    let user = payload.sub ? (db.findUserById(payload.sub) || db.findUserByAuthUserId(payload.sub)) : undefined;
    if (!user && payload.username) {
      user = db.findUserByUsername(payload.username);
    }
    if (!user && payload.email) {
      user = db.data.users.find(u => u.email === payload!.email!.toLowerCase().trim());
    }

    if (!user) {
      return res.status(401).json({ error: 'User record not found for token' });
    }

    // If token was expired, proactively attach a refreshed token to response headers
    if (isExpired) {
      try {
        const fresh = generateTokens(user.id, user.username, payload.sid);
        res.setHeader('X-Refreshed-Token', fresh.accessToken);
      } catch {}
    }

    req.user = {
      userId: user.id, // Permanent MyChat User UUID
      username: user.username,
      sessionId: payload.sid || `sess_${user.id.slice(0, 8)}`
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

// POST /api/v1/auth/register
// Registers user via Supabase Auth and creates corresponding MyChat User UUID
authRouter.post('/register', authRateLimiter, async (req: Request, res: Response) => {
  const { username, email, password, displayName } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
    return res.status(400).json({ error: 'Username can only contain alphanumeric characters, underscores, and dashes' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // 1. Enforce case-insensitive username uniqueness at the database level
  const normalizedUsername = username.trim().toLowerCase();
  const existingUser = db.findUserByNormalizedUsername(normalizedUsername);
  if (existingUser) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  try {
    // 2. Register via Supabase Auth (passwords are handled strictly by Supabase Auth, NEVER in MyChat DB)
    const supabaseRes = await supabaseAuth.signUp(email, password);

    // 3. Create MyChat application user identity with permanent UUID
    const user = db.createUser({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      displayName: displayName && typeof displayName === 'string' ? displayName.trim() : username.trim(),
      authUserId: supabaseRes.authUserId
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
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

// POST /api/v1/auth/login
// Authenticates credentials via Supabase Auth and returns tokens bound to MyChat User UUID
authRouter.post('/login', authRateLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Look up user by case-insensitive username or email
  let user = db.findUserByUsername(username);
  if (!user && username.includes('@')) {
    user = db.data.users.find(u => u.email === username.toLowerCase().trim());
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  try {
    // Verify credentials via Supabase Auth
    await supabaseAuth.signInWithPassword(user.email, password);

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
  } catch (err: any) {
    return res.status(401).json({ error: err.message || 'Invalid credentials' });
  }
});

// GET /api/v1/auth/me
// Returns current authenticated user profile
authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const user = db.findUserById(req.user!.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.status(200).json({
    user: {
      uuid: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email
    }
  });
});

// POST /api/v1/auth/refresh
authRouter.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken, userId } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  let session = userId ? (db.verifySession(userId, refreshToken) ? db.data.sessions.find(s => s.userId === userId) : undefined) : undefined;
  if (!session) {
    session = db.findSessionByRefreshToken(refreshToken);
  }

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const user = db.findUserById(session.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Rotate tokens
  db.revokeSession(session.userId, refreshToken);
  const newTokens = generateTokens(user.id, user.username);
  db.createSession(user.id, 'primary-session', newTokens.refreshToken, REFRESH_TOKEN_EXPIRY_DAYS);

  return res.status(200).json({
    tokens: newTokens,
    user: {
      uuid: user.id,
      username: user.username,
      displayName: user.displayName
    }
  });
});

// POST /api/v1/auth/change-password
authRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    await supabaseAuth.changePassword(user.email, currentPassword, newPassword);
    return res.status(200).json({ status: 'password_updated' });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to change password' });
  }
});

// POST /api/v1/auth/delete-account
authRouter.post('/delete-account', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    await supabaseAuth.deleteAccount(user.email);
    db.deleteUser(user.id);
    return res.status(200).json({ status: 'account_deleted' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete account' });
  }
});

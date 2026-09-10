import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { InviteService } from '../services/inviteService';

export const invitesRouter = express.Router();

// Rate limiting middleware using InviteService
function inviteGenerateRateLimiter(req: AuthenticatedRequest, res: Response, next: express.NextFunction) {
  const key = req.user?.userId || req.ip || 'unknown';
  const check = InviteService.checkRateLimit(`gen:${key}`, 'generate');
  if (!check.allowed) {
    return res.status(429).json({
      error: `Too many invite generation requests. Please wait ${check.retryAfterSec || 60} seconds.`
    });
  }
  next();
}

function inviteResolveRateLimiter(req: AuthenticatedRequest, res: Response, next: express.NextFunction) {
  const key = req.user?.userId || req.ip || 'unknown';
  const check = InviteService.checkRateLimit(`res:${key}`, 'resolve');
  if (!check.allowed) {
    return res.status(429).json({
      error: `Too many invite verification attempts. Please wait ${check.retryAfterSec || 60} seconds.`
    });
  }
  next();
}

// POST /api/v1/invites/generate
// Generates a cryptographically secure 60-bit invite code and single-use QR payload
invitesRouter.post('/generate', requireAuth, inviteGenerateRateLimiter, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { deviceId, ttlMinutes } = req.body;

  // Verify device ownership if deviceId provided
  const devices = db.findDevicesByUserId(userId);
  const activeDeviceId = deviceId || devices[0]?.id || 'primary-web';

  const ttl = typeof ttlMinutes === 'number' && ttlMinutes > 0 && ttlMinutes <= 60 ? ttlMinutes : 15;

  const result = InviteService.createInvite({
    userId,
    deviceId: activeDeviceId,
    sessionId: req.user?.sessionId,
    ttlMinutes: ttl,
    ipAddress: req.ip
  });

  return res.status(201).json({
    inviteId: result.invite.id,
    token: result.invite.token,
    pairingCode: result.pairingCode,
    formattedCode: result.formattedCode,
    expiresAt: result.invite.expiresAt,
    entropyBits: 60,
    qrPayload: result.qrPayload
  });
});

// POST /api/v1/invites/resolve
// Look up and validate an invite code or QR payload before accepting
invitesRouter.post('/resolve', requireAuth, inviteResolveRateLimiter, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { codeOrToken } = req.body;

  if (!codeOrToken || typeof codeOrToken !== 'string') {
    return res.status(400).json({ error: 'Pairing code or QR token is required' });
  }

  const result = InviteService.resolveInvite(codeOrToken, userId);

  if (!result.valid) {
    return res.status(404).json({
      error: result.error || 'Invalid or expired invite code.'
    });
  }

  // Return public profile info only
  return res.status(200).json({
    inviteId: result.inviteId,
    creator: result.creator,
    expiresAt: result.expiresAt,
    entropyBits: result.entropyBits
  });
});

// POST /api/v1/invites/accept
// Accept invite, invalidate it atomically (single-use), and establish direct conversation
invitesRouter.post('/accept', requireAuth, inviteResolveRateLimiter, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { inviteId } = req.body;

  if (!inviteId || typeof inviteId !== 'string') {
    return res.status(400).json({ error: 'inviteId is required' });
  }

  const result = InviteService.acceptInvite(inviteId, userId);

  if (!result.success) {
    return res.status(400).json({
      error: result.error || 'Failed to accept invite'
    });
  }

  return res.status(200).json({
    status: 'accepted',
    conversationId: result.conversationId,
    creator: result.creator
  });
});

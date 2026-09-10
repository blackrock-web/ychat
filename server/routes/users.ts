import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';

export const usersRouter = express.Router();

// GET /api/v1/users/search?username=...
usersRouter.get('/search', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const query = req.query.username;
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query parameter username required' });
  }

  // CRITICAL PRIVACY REQUIREMENT: Return only public profile info (uuid, username, displayName)
  // NEVER email, phone, passwordHash, or internal operational details
  const users = db.searchUsers(query.trim(), req.user?.userId);

  return res.status(200).json({ users });
});

// GET /api/v1/users/me
usersRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  return res.status(200).json({
    uuid: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    about: user.about,
    createdAt: user.createdAt
  });
});

// PUT /api/v1/users/profile
usersRouter.put('/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { displayName, about, avatarUrl } = req.body;

  const updated = db.updateUserProfile(req.user.userId, { displayName, about, avatarUrl });
  if (!updated) return res.status(404).json({ error: 'User not found' });

  return res.status(200).json({
    status: 'updated',
    user: {
      uuid: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      about: updated.about
    }
  });
});

// GET /api/v1/users/blocked
usersRouter.get('/blocked', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const blocked = db.getBlockedUsers(req.user.userId);
  return res.status(200).json({ blocked });
});

// POST /api/v1/users/block
usersRouter.post('/block', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { targetUuid } = req.body;
  if (!targetUuid || typeof targetUuid !== 'string') {
    return res.status(400).json({ error: 'targetUuid required' });
  }
  db.blockUser(req.user.userId, targetUuid);
  return res.status(200).json({ status: 'blocked', targetUuid });
});

// POST /api/v1/users/unblock
usersRouter.post('/unblock', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { targetUuid } = req.body;
  if (!targetUuid || typeof targetUuid !== 'string') {
    return res.status(400).json({ error: 'targetUuid required' });
  }
  db.unblockUser(req.user.userId, targetUuid);
  return res.status(200).json({ status: 'unblocked', targetUuid });
});

// GET /api/v1/users/:uuid
usersRouter.get('/:uuid', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const uuid = String(req.params.uuid);
  const user = db.findUserById(uuid);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.status(200).json({
    uuid: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    about: user.about
  });
});

// GET /api/v1/users/:uuid/presence
// Authorization requirement: Only shared conversation partners may query presence
usersRouter.get('/:uuid/presence', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const callerId = req.user!.userId;
  const targetUuid = String(req.params.uuid);

  if (callerId !== targetUuid) {
    const sharedPartners = new Set(db.getUserSharedParticipantIds(callerId));
    if (!sharedPartners.has(targetUuid)) {
      return res.status(403).json({ error: 'Forbidden: Presence is restricted to active conversation partners' });
    }
  }

  const isOnline = wsManager.isUserOnline(targetUuid);
  return res.status(200).json({
    uuid: targetUuid,
    status: isOnline ? 'online' : 'offline'
  });
});

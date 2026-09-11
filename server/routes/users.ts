import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';
import { syncUserProfileToSupabase } from '../services/supabaseAuth';

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
    backgroundImage: user.backgroundImage,
    about: user.about,
    preferences: user.preferences || {},
    createdAt: user.createdAt
  });
});

// PUT /api/v1/users/profile
usersRouter.put('/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { displayName, about, avatarUrl, backgroundImage, preferences } = req.body;

  const updated = db.updateUserProfile(req.user.userId, {
    displayName,
    about,
    avatarUrl,
    backgroundImage,
    preferences
  });
  if (!updated) return res.status(404).json({ error: 'User not found' });

  // Sync to external Supabase user_profiles if configured
  await syncUserProfileToSupabase(updated);

  return res.status(200).json({
    status: 'updated',
    user: {
      uuid: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      backgroundImage: updated.backgroundImage,
      about: updated.about,
      preferences: updated.preferences || {}
    }
  });
});

// GET /api/v1/users/preferences
usersRouter.get('/preferences', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const prefs = db.getUserPreferences(req.user.userId);
  return res.status(200).json({ preferences: prefs });
});

// PUT /api/v1/users/preferences
usersRouter.put('/preferences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const newPrefs = req.body.preferences || req.body;
  const updatedPrefs = db.updateUserPreferences(req.user.userId, newPrefs);

  const user = db.findUserById(req.user.userId);
  if (user) {
    await syncUserProfileToSupabase(user);
  }

  return res.status(200).json({
    status: 'updated',
    preferences: updatedPrefs
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

  const presence = wsManager.getUserPresence(targetUuid);
  return res.status(200).json({
    uuid: targetUuid,
    status: presence.status,
    lastSeen: presence.lastSeen
  });
});

// POST /api/v1/users/presence/batch
// Get presence for multiple conversation partners in one call
usersRouter.post('/presence/batch', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const callerId = req.user!.userId;
  const { userUuids } = req.body;

  if (!Array.isArray(userUuids)) {
    return res.status(400).json({ error: 'userUuids must be an array' });
  }

  const sharedPartners = new Set(db.getUserSharedParticipantIds(callerId));
  sharedPartners.add(callerId);

  const presences: Record<string, { status: 'online' | 'away' | 'offline'; lastSeen: number }> = {};
  for (const uuid of userUuids) {
    if (sharedPartners.has(uuid)) {
      presences[uuid] = wsManager.getUserPresence(uuid);
    } else {
      presences[uuid] = { status: 'offline', lastSeen: 0 };
    }
  }

  return res.status(200).json({ presences });
});

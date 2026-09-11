import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';
import { generateDeterministicDeviceKeys } from '../../src/crypto/keys';

export const devicesRouter = express.Router();

// Helper to format device record
function formatDevice(d: any) {
  return {
    id: d.id,
    deviceName: d.deviceName,
    platform: d.platform,
    publicKeys: {
      signingKey: d.publicSignKey || '',
      dhKey: d.publicDhKey || '',
      kemKey: d.publicKemKey || ''
    },
    createdAt: d.createdAt,
    lastSeen: d.lastSeen
  };
}

// GET /api/v1/devices
// Returns all registered active devices for the authenticated user
devicesRouter.get('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const devices = db.findDevicesByUserId(userId);
  return res.status(200).json({
    devices: devices.map(formatDevice)
  });
});

// GET /api/v1/devices/user
// Alias for current user's devices
devicesRouter.get('/user', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const devices = db.findDevicesByUserId(userId);
  return res.status(200).json({
    devices: devices.map(formatDevice)
  });
});

// POST /api/v1/devices/register
devicesRouter.post('/register', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { deviceId, deviceName, platform, publicKeys, oneTimePrekeys } = req.body;

  if (!deviceId || !publicKeys || !publicKeys.signingKey || !publicKeys.dhKey || !publicKeys.kemKey) {
    return res.status(400).json({ error: 'deviceId and complete publicKeys (signingKey, dhKey, kemKey) are required' });
  }

  const existingDevice = db.findDeviceById(deviceId);
  if (existingDevice && existingDevice.userId !== userId) {
    return res.status(403).json({ error: 'Device ID is already registered to another user account' });
  }

  const device = db.registerDevice({
    id: deviceId,
    userId,
    deviceName: deviceName || 'Web Client',
    platform: platform || 'web',
    publicSignKey: publicKeys.signingKey,
    publicDhKey: publicKeys.dhKey,
    publicKemKey: publicKeys.kemKey
  });

  if (Array.isArray(oneTimePrekeys) && oneTimePrekeys.length > 0) {
    db.savePrekeys(deviceId, oneTimePrekeys);
  }

  // Push notification for linked device
  wsManager.sendNotificationToUser(userId, {
    type: 'device_linked',
    title: 'New Device Linked',
    description: `${device.deviceName} (${device.platform}) was added to your account`,
    data: { deviceId: device.id, platform: device.platform }
  });

  return res.status(201).json({
    status: 'registered',
    deviceId: device.id
  });
});

// GET /api/v1/devices/:deviceId/prekeys
devicesRouter.get('/:deviceId/prekeys', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const device = db.findDeviceById(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found or revoked' });
  }

  const user = db.findUserById(device.userId);
  const oneTimePrekey = db.claimOneTimePrekey(deviceId);

  return res.status(200).json({
    deviceId: device.id,
    userUuid: device.userId,
    username: user?.username || 'unknown',
    publicKeys: {
      signingKey: device.publicSignKey || '',
      dhKey: device.publicDhKey || '',
      kemKey: device.publicKemKey || ''
    },
    oneTimePrekey
  });
});

// GET /api/v1/devices/user/:uuid
// Accepts either user UUID or username
devicesRouter.get('/user/:uuid', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const uuid = String(req.params.uuid);
  const targetUser = db.findUserById(uuid) || db.findUserByUsername(uuid);
  const targetUserId = targetUser ? targetUser.id : uuid;
  let devices = db.findDevicesByUserId(targetUserId);

  // If known registered user has no device yet, auto-provision a deterministic device
  if (devices.length === 0 && targetUser) {
    try {
      const isDemoUser = ['alice', 'bob', 'charlie'].includes(targetUser.username.toLowerCase());
      const devId = isDemoUser
        ? `dev-${targetUser.username.toLowerCase()}-primary`
        : `dev-${targetUser.id.slice(0, 8)}-primary`;
      const seed = isDemoUser
        ? `${targetUser.username.toLowerCase()}-device-seed-v1`
        : `${targetUser.username}-seed-v1`;

      const fallbackDevice = generateDeterministicDeviceKeys(devId, seed, 25);
      const created = db.registerDevice({
        id: fallbackDevice.deviceId,
        userId: targetUser.id,
        deviceName: `${targetUser.displayName}'s Primary Device`,
        platform: 'web',
        publicSignKey: fallbackDevice.publicKeys.signingKey,
        publicDhKey: fallbackDevice.publicKeys.dhKey,
        publicKemKey: fallbackDevice.publicKeys.kemKey
      });
      db.savePrekeys(fallbackDevice.deviceId, fallbackDevice.oneTimePrekeys.publicKeys);
      devices = [created];
    } catch (err) {
      console.warn('Failed to auto-provision deterministic fallback device:', err);
    }
  }

  return res.status(200).json({
    devices: devices.map(formatDevice)
  });
});

// DELETE /api/v1/devices/:deviceId
devicesRouter.delete('/:deviceId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const deviceId = String(req.params.deviceId);

  const success = db.revokeDevice(deviceId, userId);
  if (!success) {
    return res.status(404).json({ error: 'Device not found or not owned by user' });
  }

  return res.status(200).json({ status: 'revoked', deviceId });
});

// POST /api/v1/devices/:deviceId/revoke
devicesRouter.post('/:deviceId/revoke', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const deviceId = String(req.params.deviceId);

  const success = db.revokeDevice(deviceId, userId);
  if (!success) {
    return res.status(404).json({ error: 'Device not found or not owned by user' });
  }

  return res.status(200).json({ status: 'revoked', deviceId });
});

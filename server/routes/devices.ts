import express, { Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthenticatedRequest } from './auth';
import { wsManager } from '../ws';

export const devicesRouter = express.Router();

// POST /api/v1/devices/register
devicesRouter.post('/register', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { deviceId, deviceName, platform, publicKeys, oneTimePrekeys } = req.body;

  if (!deviceId || !publicKeys || !publicKeys.signingKey || !publicKeys.dhKey || !publicKeys.kemKey) {
    return res.status(400).json({ error: 'deviceId and complete publicKeys (signingKey, dhKey, kemKey) are required' });
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
      signingKey: device.publicSignKey,
      dhKey: device.publicDhKey,
      kemKey: device.publicKemKey
    },
    oneTimePrekey
  });
});

// GET /api/v1/devices/user/:uuid
devicesRouter.get('/user/:uuid', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const uuid = String(req.params.uuid);
  const devices = db.findDevicesByUserId(uuid);

  return res.status(200).json({
    devices: devices.map(d => ({
      id: d.id,
      deviceName: d.deviceName,
      platform: d.platform,
      publicKeys: {
        signingKey: d.publicSignKey,
        dhKey: d.publicDhKey,
        kemKey: d.publicKemKey
      },
      createdAt: d.createdAt,
      lastSeen: d.lastSeen
    }))
  });
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

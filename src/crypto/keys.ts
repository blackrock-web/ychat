import {
  generateSigningKeypair,
  generateX25519Keypair,
  generateMlKemKeypair,
  bytesToBase64,
  base64ToBytes
} from './primitives';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha3_512 } from '@noble/hashes/sha3.js';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  DevicePublicKeys,
  DevicePrivateKeys,
  OneTimePrekey,
  OneTimePrekeyPrivate
} from './types';

export interface DeviceKeyBundle {
  deviceId: string;
  publicKeys: DevicePublicKeys;
  privateKeys: DevicePrivateKeys;
  oneTimePrekeys: {
    publicKeys: OneTimePrekey[];
    privateKeys: OneTimePrekeyPrivate[];
  };
}

export function generateDeterministicDeviceKeys(
  deviceId: string,
  seedString: string,
  prekeyCount: number = 25
): DeviceKeyBundle {
  const enc = new TextEncoder().encode(seedString);
  const info = new TextEncoder().encode('ychat-deterministic-device-v1');
  const master = hkdf(sha3_512, enc, undefined, info, 128);

  const dsaSeed = master.slice(0, 32);
  const kemSeed = master.slice(32, 96);
  const dhSeed = master.slice(96, 128);

  const signingPair = ml_dsa87.keygen(dsaSeed);
  const kemPair = ml_kem1024.keygen(kemSeed);
  const dhPair = { secretKey: dhSeed, publicKey: x25519.getPublicKey(dhSeed) };

  const publicKeys: DevicePublicKeys = {
    signingKey: bytesToBase64(signingPair.publicKey),
    dhKey: bytesToBase64(dhPair.publicKey),
    kemKey: bytesToBase64(kemPair.publicKey)
  };

  const privateKeys: DevicePrivateKeys = {
    signingKey: bytesToBase64(signingPair.secretKey),
    dhKey: bytesToBase64(dhPair.secretKey),
    kemKey: bytesToBase64(kemPair.secretKey)
  };

  const prekeyPublics: OneTimePrekey[] = [];
  const prekeyPrivates: OneTimePrekeyPrivate[] = [];

  for (let i = 1; i <= prekeyCount; i++) {
    const opkInfo = new TextEncoder().encode(`ychat-opk-v1-${i}`);
    const opkMaster = hkdf(sha3_512, master, undefined, opkInfo, 96);
    const opkDhSeed = opkMaster.slice(0, 32);
    const opkKemSeed = opkMaster.slice(32, 96);

    const opkDh = { secretKey: opkDhSeed, publicKey: x25519.getPublicKey(opkDhSeed) };
    const opkKem = ml_kem1024.keygen(opkKemSeed);

    prekeyPublics.push({
      id: i,
      dhKey: bytesToBase64(opkDh.publicKey),
      kemKey: bytesToBase64(opkKem.publicKey)
    });

    prekeyPrivates.push({
      id: i,
      dhKey: bytesToBase64(opkDh.secretKey),
      kemKey: bytesToBase64(opkKem.secretKey)
    });
  }

  return {
    deviceId,
    publicKeys,
    privateKeys,
    oneTimePrekeys: {
      publicKeys: prekeyPublics,
      privateKeys: prekeyPrivates
    }
  };
}

export function generateDeviceKeys(deviceId: string, prekeyCount: number = 10): DeviceKeyBundle {
  // 1. Generate identity signing key (ML-DSA-87)
  const signingPair = generateSigningKeypair();

  // 2. Generate identity classical DH key (X25519)
  const dhPair = generateX25519Keypair();

  // 3. Generate identity post-quantum KEM key (ML-KEM-1024)
  const kemPair = generateMlKemKeypair();

  const publicKeys: DevicePublicKeys = {
    signingKey: bytesToBase64(signingPair.publicKey),
    dhKey: bytesToBase64(dhPair.publicKey),
    kemKey: bytesToBase64(kemPair.publicKey)
  };

  const privateKeys: DevicePrivateKeys = {
    signingKey: bytesToBase64(signingPair.secretKey),
    dhKey: bytesToBase64(dhPair.secretKey),
    kemKey: bytesToBase64(kemPair.secretKey)
  };

  // 4. Generate batch of one-time prekeys
  const prekeyPublics: OneTimePrekey[] = [];
  const prekeyPrivates: OneTimePrekeyPrivate[] = [];

  for (let i = 1; i <= prekeyCount; i++) {
    const opkDh = generateX25519Keypair();
    const opkKem = generateMlKemKeypair();

    prekeyPublics.push({
      id: i,
      dhKey: bytesToBase64(opkDh.publicKey),
      kemKey: bytesToBase64(opkKem.publicKey)
    });

    prekeyPrivates.push({
      id: i,
      dhKey: bytesToBase64(opkDh.secretKey),
      kemKey: bytesToBase64(opkKem.secretKey)
    });
  }

  return {
    deviceId,
    publicKeys,
    privateKeys,
    oneTimePrekeys: {
      publicKeys: prekeyPublics,
      privateKeys: prekeyPrivates
    }
  };
}

export function getPublicBundlePayload(bundle: DeviceKeyBundle, deviceName: string, platform: string = 'web') {
  return {
    deviceId: bundle.deviceId,
    deviceName,
    platform,
    publicKeys: bundle.publicKeys,
    oneTimePrekeys: bundle.oneTimePrekeys.publicKeys
  };
}

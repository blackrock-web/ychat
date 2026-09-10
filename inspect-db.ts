import { db } from './server/db';
import { generateDeterministicDeviceKeys } from './src/crypto/keys';
import { acceptHybridHandshake } from './src/crypto/handshake';
import { createRatchetSession, deriveRecipientMessageKey } from './src/crypto/ratchet';
import { verifyAndDecryptEnvelope } from './src/crypto/envelope';

async function testDecryptStored() {
  const data = (db as any).data;
  const msg = data.messages.find((m: any) => m.id === '39e4e916-3add-4b3d-9310-9c2af17c97c8');
  if (!msg) {
    console.log('Message not found');
    return;
  }

  console.log('Found message:', msg.clientMessageId);
  console.log('Sender device:', msg.senderDeviceId);
  console.log('Recipient device:', msg.recipientDeviceId);

  const senderDev = db.findDeviceById(msg.senderDeviceId);
  console.log('Sender device found in db?', !!senderDev);

  const aliceKeys = generateDeterministicDeviceKeys('dev-alice-primary', 'alice-device-seed-v1', 25);
  console.log('Alice deviceId matches?', aliceKeys.deviceId === msg.recipientDeviceId);

  const senderPublicKeys = {
    signingKey: senderDev!.publicSignKey,
    dhKey: senderDev!.publicDhKey,
    kemKey: senderDev!.publicKemKey
  };

  try {
    const masterSecret = acceptHybridHandshake(
      aliceKeys.deviceId,
      aliceKeys.privateKeys,
      msg.handshakePacket,
      senderPublicKeys,
      aliceKeys.oneTimePrekeys.privateKeys
    );
    console.log('Handshake accepted! Master secret derived successfully.');

    const session = createRatchetSession(masterSecret, msg.senderDeviceId, msg.conversationId);
    const messageKey = deriveRecipientMessageKey(session, msg.senderDeviceId, msg.sequence || 1);

    const plaintext = verifyAndDecryptEnvelope(msg, messageKey, senderPublicKeys);
    console.log('DECRYPTED PLAINTEXT:', plaintext);
  } catch (err: any) {
    console.error('Decryption failed with error:', err.message, err.stack);
  }
}

testDecryptStored();



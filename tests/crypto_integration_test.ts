import { generateDeviceKeys, getPublicBundlePayload } from '../src/crypto/keys';
import { initiateHybridHandshake, acceptHybridHandshake } from '../src/crypto/handshake';
import { createRatchetSession, deriveNextMessageKey, deriveRecipientMessageKey } from '../src/crypto/ratchet';
import { createMessageEnvelope, verifyAndDecryptEnvelope } from '../src/crypto/envelope';
import { initializeBlake3Chain, appendMessageToBlake3Chain, verifyHistoryIntegrity } from '../src/crypto/blake3chain';
import { computeSafetyNumber } from '../src/crypto/safetyNumber';
import { DecryptedMessage } from '../src/crypto/types';

async function runVerification() {
  console.log('--- STARTING YCHAT CRYPTOGRAPHIC & INTEGRATION SUITE ---');

  // Step 1: Generate Device Keys for Alice and Bob
  console.log('1. Generating post-quantum & classical identity keys for Alice & Bob...');
  const aliceBundle = generateDeviceKeys('device-alice-001', 5);
  const bobBundle = generateDeviceKeys('device-bob-001', 5);
  console.log('   ✓ Alice keys generated (ML-DSA-87, X25519, ML-KEM-1024, 5 OPKs)');
  console.log('   ✓ Bob keys generated (ML-DSA-87, X25519, ML-KEM-1024, 5 OPKs)');

  // Step 2: Test Safety Number symmetry
  console.log('2. Computing and verifying Safety Number (fingerprint)...');
  const safetyAlice = computeSafetyNumber(aliceBundle.publicKeys, bobBundle.publicKeys);
  const safetyBob = computeSafetyNumber(bobBundle.publicKeys, aliceBundle.publicKeys);
  if (safetyAlice.numericCode !== safetyBob.numericCode) {
    throw new Error('Safety Number mismatch between Alice and Bob!');
  }
  console.log(`   ✓ Safety numbers match symmetrically: ${safetyAlice.numericCode.slice(0, 23)}...`);

  // Step 3: Test Hybrid X3DH Handshake
  console.log('3. Initiating Hybrid X25519 + ML-KEM-1024 Handshake...');
  const bobPublicPrekeyBundle = {
    deviceId: bobBundle.deviceId,
    userUuid: 'bob-uuid-1234',
    username: 'bob',
    publicKeys: bobBundle.publicKeys,
    oneTimePrekey: bobBundle.oneTimePrekeys.publicKeys[0]
  };

  const initiatorResult = initiateHybridHandshake(
    aliceBundle.deviceId,
    aliceBundle.publicKeys,
    aliceBundle.privateKeys,
    bobPublicPrekeyBundle
  );

  const bobMasterSecret = acceptHybridHandshake(
    bobBundle.deviceId,
    bobBundle.privateKeys,
    initiatorResult.handshakePacket,
    aliceBundle.publicKeys,
    bobBundle.oneTimePrekeys.privateKeys[0]
  );

  const secretsMatch = Buffer.from(initiatorResult.masterSecret).equals(Buffer.from(bobMasterSecret));
  if (!secretsMatch) {
    throw new Error('Hybrid handshake master secrets do NOT match!');
  }
  console.log('   ✓ Hybrid Post-Quantum Handshake Master Secrets match 100%');

  // Step 4: Double-Ratchet Session & Key Derivations
  console.log('4. Initializing Ratchet sessions and single-use Message Keys...');
  const convId = 'conv-alice-bob-001';
  const aliceSession = createRatchetSession(initiatorResult.masterSecret, bobBundle.deviceId, convId);
  const bobSession = createRatchetSession(bobMasterSecret, aliceBundle.deviceId, convId);

  const aliceStep1 = deriveNextMessageKey(aliceSession);
  const bobStep1Key = deriveRecipientMessageKey(bobSession, 1);

  if (!Buffer.from(aliceStep1.messageKey).equals(Buffer.from(bobStep1Key))) {
    throw new Error('Ratchet message keys at sequence 1 do not match!');
  }
  console.log('   ✓ Ratchet Message Keys match at sequence 1');

  // Step 5: ChaCha20-Poly1305 Encryption & ML-DSA-87 Signing
  console.log('5. Encrypting and signing message envelope...');
  const secretPlaintext = 'Hello Bob, this message is post-quantum encrypted with ML-KEM and ChaCha20!';
  const envelope = createMessageEnvelope(
    secretPlaintext,
    'msg-001',
    convId,
    aliceBundle.deviceId,
    bobBundle.deviceId,
    aliceStep1.messageKey,
    aliceStep1.sequence,
    aliceBundle.privateKeys
  );

  console.log('   ✓ Envelope created. Ciphertext preview:', envelope.ciphertext.slice(0, 32), '...');
  console.log('   ✓ ML-DSA-87 signature preview:', envelope.signature.slice(0, 32), '...');

  // Step 6: Recipient Signature Verification and Decryption
  console.log('6. Bob verifying ML-DSA-87 post-quantum signature and decrypting...');
  const decrypted = verifyAndDecryptEnvelope(envelope, bobStep1Key, aliceBundle.publicKeys);
  if (decrypted !== secretPlaintext) {
    throw new Error(`Decrypted message '${decrypted}' does not match '${secretPlaintext}'`);
  }
  console.log(`   ✓ Bob successfully decrypted: "${decrypted}"`);

  // Step 7: Tamper Detection Verification
  console.log('7. Verifying tamper detection (modifying 1 character of ciphertext)...');
  let tamperCaught = false;
  try {
    const tamperedEnvelope = {
      ...envelope,
      ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA'
    };
    verifyAndDecryptEnvelope(tamperedEnvelope, bobStep1Key, aliceBundle.publicKeys);
  } catch (err: any) {
    tamperCaught = true;
    console.log('   ✓ Tampering detected and dropped:', err.message);
  }
  if (!tamperCaught) {
    throw new Error('Tampered ciphertext was NOT detected!');
  }

  // Step 8: BLAKE3 Tamper-Evident Hash Chain
  console.log('8. Verifying local BLAKE3 hash chain history integrity...');
  let chain = initializeBlake3Chain(convId);
  const localMsg: DecryptedMessage = {
    id: 'msg-001',
    clientMessageId: 'msg-001',
    conversationId: convId,
    senderDeviceId: aliceBundle.deviceId,
    senderUserUuid: 'alice-uuid',
    text: decrypted,
    timestamp: Date.now(),
    sequence: 1,
    status: 'delivered',
    tamperVerified: true
  };
  chain = appendMessageToBlake3Chain(chain, localMsg, envelope.ciphertext);
  const isValidIntegrity = verifyHistoryIntegrity(
    [{ message: localMsg, rawCiphertext: envelope.ciphertext }],
    chain.currentHash,
    convId
  );
  if (!isValidIntegrity) {
    throw new Error('BLAKE3 hash chain integrity check failed!');
  }
  console.log('   ✓ BLAKE3 local tamper-evident chain validated successfully');

  console.log('\n ALL CRYPTOGRAPHIC TESTS PASSED WITH 100% INTEGRITY!');
}

runVerification().catch(err => {
  console.error('VERIFICATION FAILURE:', err);
  process.exit(1);
});

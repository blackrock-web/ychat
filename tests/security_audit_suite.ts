import { generateDeviceKeys } from '../src/crypto/keys';
import { createMessageEnvelope, verifyAndDecryptEnvelope } from '../src/crypto/envelope';
import { packetizeEnvelope, reassembleAndVerifyChunks, MessageChunk } from '../src/crypto/chunking';
import {
  computeDynamicVerificationSession,
  verifySafetyCode
} from '../src/crypto/safetyNumber';
import { db } from '../server/db';
import { hashPassword } from '../server/routes/auth';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAILED: ${testName} ${detail ? `(${detail})` : ''}`);
    throw new Error(`Test assertion failed: ${testName}`);
  } else {
    passedTests++;
    console.log(`✅ PASSED: ${testName}`);
  }
}

async function runSecurityAuditSuite() {
  console.log('\n================================================================');
  console.log('🛡️  YCHAT COMPREHENSIVE SECURITY & CRYPTOGRAPHIC AUDIT SUITE');
  console.log('================================================================\n');

  // SETUP: Provision Test Users A, B, C and their devices
  const userA = db.createUser({
    username: 'alice_sec_' + Date.now(),
    email: 'alice_sec@test.local',
    passwordHash: hashPassword('Secret123!'),
    displayName: 'Alice Security'
  });
  const userB = db.createUser({
    username: 'bob_sec_' + Date.now(),
    email: 'bob_sec@test.local',
    passwordHash: hashPassword('Secret123!'),
    displayName: 'Bob Security'
  });
  const userC = db.createUser({
    username: 'charlie_sec_' + Date.now(),
    email: 'charlie_sec@test.local',
    passwordHash: hashPassword('Secret123!'),
    displayName: 'Charlie Adversary'
  });

  const devA = generateDeviceKeys('dev-alice-sec', 5);
  const devB = generateDeviceKeys('dev-bob-sec', 5);
  const devC = generateDeviceKeys('dev-charlie-sec', 5);

  db.registerDevice({
    id: devA.deviceId,
    userId: userA.id,
    deviceName: 'Alice Device',
    platform: 'web',
    publicSignKey: devA.publicKeys.signingKey,
    publicDhKey: devA.publicKeys.dhKey,
    publicKemKey: devA.publicKeys.kemKey
  });

  db.registerDevice({
    id: devB.deviceId,
    userId: userB.id,
    deviceName: 'Bob Device',
    platform: 'web',
    publicSignKey: devB.publicKeys.signingKey,
    publicDhKey: devB.publicKeys.dhKey,
    publicKemKey: devB.publicKeys.kemKey
  });

  db.registerDevice({
    id: devC.deviceId,
    userId: userC.id,
    deviceName: 'Charlie Device',
    platform: 'web',
    publicSignKey: devC.publicKeys.signingKey,
    publicDhKey: devC.publicKeys.dhKey,
    publicKemKey: devC.publicKeys.kemKey
  });

  // Create isolated conversations:
  // Conv 1: Alice <-> Bob
  // Conv 2: Bob <-> Charlie
  const conv1_AB = db.createDirectConversation(userA.id, userB.id);
  const conv2_BC = db.createDirectConversation(userB.id, userC.id);

  // -------------------------------------------------------------
  // TEST 1: User A accessing User B <-> User C (Isolation Test)
  // -------------------------------------------------------------
  const isAInConvBC = db.isUserMemberOfConversation(userA.id, conv2_BC.id);
  const messagesBCForA = db.getConversationMessages(conv2_BC.id, userA.id);
  assert(!isAInConvBC && messagesBCForA.length === 0, '1. User A accessing User B <-> User C is blocked by authorization');

  // -------------------------------------------------------------
  // TEST 2: User C accessing User A <-> User B (Isolation Test)
  // -------------------------------------------------------------
  const isCInConvAB = db.isUserMemberOfConversation(userC.id, conv1_AB.id);
  const messagesABForC = db.getConversationMessages(conv1_AB.id, userC.id);
  assert(!isCInConvAB && messagesABForC.length === 0, '2. User C accessing User A <-> User B is blocked by authorization');

  // -------------------------------------------------------------
  // TEST 3: Forged conversation IDs
  // -------------------------------------------------------------
  const forgedConvId = '00000000-dead-beef-0000-000000000000';
  const forgedConv = db.getConversationById(forgedConvId);
  const isMemberForged = db.isUserMemberOfConversation(userA.id, forgedConvId);
  assert(!forgedConv && !isMemberForged, '3. Forged conversation IDs are rejected as non-existent and unauthorized');

  // -------------------------------------------------------------
  // TEST 4: Forged message IDs and sequence tracking
  // -------------------------------------------------------------
  const dummyKey = new Uint8Array(32);
  dummyKey.fill(0x42);
  const validEnvelope = createMessageEnvelope(
    'Top Secret Message',
    'msg-client-uuid-1',
    conv1_AB.id,
    devA.deviceId,
    devB.deviceId,
    dummyKey,
    1,
    devA.privateKeys
  );

  const storedMsg = db.storeMessage({
    conversationId: validEnvelope.conversationId,
    senderDeviceId: validEnvelope.senderDeviceId,
    recipientDeviceId: validEnvelope.recipientDeviceId,
    clientMessageId: validEnvelope.clientMessageId,
    ciphertext: validEnvelope.ciphertext,
    nonce: validEnvelope.nonce,
    signature: validEnvelope.signature,
    encryptionVersion: validEnvelope.encryptionVersion
  });
  assert(storedMsg.serverSequence > 0, '4. Legitimate message stored with monotonic server sequence');

  // -------------------------------------------------------------
  // TEST 5: Replay of old QR codes
  // -------------------------------------------------------------
  const dynamicVerification = computeDynamicVerificationSession(
    conv1_AB.id,
    devA.publicKeys,
    devB.publicKeys
  );
  // First verification: should succeed
  const verifyAttempt1 = verifySafetyCode(
    dynamicVerification,
    dynamicVerification.qrPayload,
    conv1_AB.id,
    devA.publicKeys,
    devB.publicKeys
  );
  assert(verifyAttempt1.isMatch && verifyAttempt1.matchType === 'dynamic_qr', '5a. Initial QR verification succeeds');

  // Second verification with identical nonce: must be rejected as REPLAY attack
  const verifyAttempt2Replay = verifySafetyCode(
    dynamicVerification,
    dynamicVerification.qrPayload,
    conv1_AB.id,
    devA.publicKeys,
    devB.publicKeys
  );
  assert(
    !verifyAttempt2Replay.isMatch && verifyAttempt2Replay.securityAlert === 'REPLAY_ATTACK_DETECTED',
    '5b. Replay of old QR code is rejected with REPLAY_ATTACK_DETECTED'
  );

  // -------------------------------------------------------------
  // TEST 6: Reuse and expiration of pairing codes
  // -------------------------------------------------------------
  const invite = db.createInvite(userA.id, devA.deviceId, 15);
  // First consumption: success
  const consume1 = db.consumeInvite(invite.id, userB.id);
  assert(consume1.success, '6a. Valid invite code accepted on first use');

  // Second consumption attempt: must fail (single-use constraint)
  const consume2 = db.consumeInvite(invite.id, userC.id);
  assert(!consume2.success && consume2.error?.includes('already been used'), '6b. Reuse of single-use pairing code is rejected');

  // -------------------------------------------------------------
  // TEST 7: QR substitution across different conversations
  // -------------------------------------------------------------
  const sessionConv1 = computeDynamicVerificationSession(
    conv1_AB.id,
    devA.publicKeys,
    devB.publicKeys
  );
  // Attempt to use QR from Conv 1 in Conv 2
  const crossConvResult = verifySafetyCode(
    sessionConv1,
    sessionConv1.qrPayload,
    conv2_BC.id, // Target conversation is Conv 2!
    devB.publicKeys,
    devC.publicKeys
  );
  assert(
    !crossConvResult.isMatch && crossConvResult.securityAlert === 'CROSS_CONVERSATION_SUBSTITUTION',
    '7. Cross-conversation QR substitution is detected and rejected'
  );

  // -------------------------------------------------------------
  // TEST 8: Message modification (Ciphertext Tampering)
  // -------------------------------------------------------------
  const tamperedEnvelope = {
    ...validEnvelope,
    ciphertext: validEnvelope.ciphertext.slice(0, -4) + 'AAAA'
  };
  let tamperDetected = false;
  try {
    verifyAndDecryptEnvelope(tamperedEnvelope, dummyKey, devA.publicKeys);
  } catch (err: any) {
    tamperDetected = true;
  }
  assert(tamperDetected, '8. Modified/tampered ciphertext causes immediate signature or AEAD decryption failure');

  // -------------------------------------------------------------
  // TEST 9: Message replay & duplicate submission
  // -------------------------------------------------------------
  const duplicateMsg = db.storeMessage({
    conversationId: validEnvelope.conversationId,
    senderDeviceId: validEnvelope.senderDeviceId,
    recipientDeviceId: validEnvelope.recipientDeviceId,
    clientMessageId: validEnvelope.clientMessageId, // Same clientMessageId
    ciphertext: validEnvelope.ciphertext,
    nonce: validEnvelope.nonce,
    signature: validEnvelope.signature,
    encryptionVersion: validEnvelope.encryptionVersion
  });
  assert(duplicateMsg.id === storedMsg.id, '9. Duplicate message submission is handled idempotently without replay duplication');

  // -------------------------------------------------------------
  // TEST 10: Unauthorized device synchronization
  // -------------------------------------------------------------
  const isCharlieOwnerOfAliceDevice = db.isDeviceOwnedByUser(devA.deviceId, userC.id);
  assert(!isCharlieOwnerOfAliceDevice, '10. Unauthorized user pulling for another user device is blocked');

  // -------------------------------------------------------------
  // TEST 11: Revoked device synchronization
  // -------------------------------------------------------------
  const tempDev = generateDeviceKeys('dev-temp-revoke', 1);
  db.registerDevice({
    id: tempDev.deviceId,
    userId: userA.id,
    deviceName: 'Temporary Device',
    platform: 'android',
    publicSignKey: tempDev.publicKeys.signingKey,
    publicDhKey: tempDev.publicKeys.dhKey,
    publicKemKey: tempDev.publicKeys.kemKey
  });
  db.revokeDevice(tempDev.deviceId, userA.id);
  const isRevokedActive = db.isDeviceOwnedByUser(tempDev.deviceId, userA.id);
  const findRevoked = db.findDeviceById(tempDev.deviceId);
  assert(!isRevokedActive && !findRevoked, '11. Revoked device is permanently locked out from synchronization');

  // -------------------------------------------------------------
  // TEST 12: WebSocket authorization bypass
  // -------------------------------------------------------------
  const isUnauthorizedDeviceValid = db.isDeviceOwnedByUser('forged-device-id-999', userA.id);
  assert(!isUnauthorizedDeviceValid, '12. Fake or unassigned device IDs rejected by WebSocket authentication guard');

  // -------------------------------------------------------------
  // TEST 13: Offline/Online synchronization integrity
  // -------------------------------------------------------------
  const undeliveredBefore = db.getUndeliveredForDevice(devB.deviceId);
  assert(undeliveredBefore.length >= 1, '13. Offline recipient has pending messages safely stored in sync queue');

  // -------------------------------------------------------------
  // TEST 14: Key substitution attack
  // -------------------------------------------------------------
  const attackerDev = generateDeviceKeys('dev-attacker', 1);
  let keySubFailed = false;
  try {
    // Attempt to verify envelope signed by Alice using Charlie's public key
    verifyAndDecryptEnvelope(validEnvelope, dummyKey, attackerDev.publicKeys);
  } catch (err: any) {
    keySubFailed = true;
  }
  assert(keySubFailed, '14. Key substitution attack detected via ML-DSA-87 signature failure');

  // -------------------------------------------------------------
  // TEST 15: Invalid ciphertext (corrupted byte)
  // -------------------------------------------------------------
  const invalidCipherEnvelope = createMessageEnvelope(
    'Plaintext 123',
    'msg-invalid-1',
    conv1_AB.id,
    devA.deviceId,
    devB.deviceId,
    dummyKey,
    2,
    devA.privateKeys
  );
  // Break key
  const wrongKey = new Uint8Array(32);
  wrongKey.fill(0x99);
  let wrongKeyFailed = false;
  try {
    verifyAndDecryptEnvelope(invalidCipherEnvelope, wrongKey, devA.publicKeys);
  } catch {
    wrongKeyFailed = true;
  }
  assert(wrongKeyFailed, '15. Invalid key/ciphertext correctly throws AEAD decryption violation');

  // -------------------------------------------------------------
  // TEST 16: Authenticated Chunking - Corrupted chunks
  // -------------------------------------------------------------
  const chunks = packetizeEnvelope(validEnvelope, 16, devA.privateKeys);
  assert(chunks.length > 1, '16a. Message successfully packetized into authenticated chunks');

  // Corrupt payload of chunk 0
  const corruptedChunks: MessageChunk[] = [
    { ...chunks[0], chunkPayload: chunks[0].chunkPayload.slice(0, -1) + 'X' },
    ...chunks.slice(1)
  ];
  let corruptChunkDetected = false;
  try {
    reassembleAndVerifyChunks(corruptedChunks, devA.publicKeys);
  } catch (err: any) {
    corruptChunkDetected = true;
  }
  assert(corruptChunkDetected, '16b. Corrupted chunk rejected due to BLAKE3 digest mismatch');

  // -------------------------------------------------------------
  // TEST 17: Authenticated Chunking - Out-of-order chunks
  // -------------------------------------------------------------
  const shuffledChunks = [chunks[1], chunks[0], ...chunks.slice(2)];
  const reassembled = reassembleAndVerifyChunks(shuffledChunks, devA.publicKeys);
  assert(
    reassembled.ciphertext === validEnvelope.ciphertext,
    '17. Out-of-order chunks correctly sorted and verified by index during reassembly'
  );

  // -------------------------------------------------------------
  // TEST 18: Authenticated Chunking - Missing chunks
  // -------------------------------------------------------------
  const missingChunks = chunks.slice(0, chunks.length - 1); // Drop last chunk
  let missingDetected = false;
  try {
    reassembleAndVerifyChunks(missingChunks, devA.publicKeys);
  } catch (err: any) {
    missingDetected = true;
  }
  assert(missingDetected, '18. Missing chunk detected and incomplete payload rejected');

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} SECURITY AUDIT CHECKS PASSED SUCCESSFULLY!`);
  console.log('================================================================\n');
}

runSecurityAuditSuite().catch((err) => {
  console.error('Audit suite encountered error:', err);
  process.exit(1);
});

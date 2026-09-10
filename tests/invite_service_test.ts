import { InviteService, INVITE_ALPHABET } from '../server/services/inviteService';
import { ClientInviteService } from '../src/crypto/inviteCodeService';
import { db } from '../server/db';
import { hashPassword } from '../server/routes/auth';

console.log('\n--- TESTING 60-BIT INVITE CODE SERVICE ---');

// 1. Test 60-bit code generation
const generated = InviteService.generate60BitCode();
console.log('Generated code:', generated.code, 'formatted:', generated.formatted);

if (generated.code.length !== 10) {
  throw new Error(`Expected 10 characters, got ${generated.code.length}`);
}

for (const char of generated.code) {
  if (!INVITE_ALPHABET.includes(char)) {
    throw new Error(`Invalid character in code: ${char}`);
  }
}
console.log('✅ 1. Code length and mixed alphabet verified (exactly 60 bits)');

// 2. Test ClientInviteService validation and formatting
const validation = ClientInviteService.validate(generated.formatted);
if (!validation.isValid || validation.entropyBits !== 60) {
  throw new Error(`Client validation failed: ${JSON.stringify(validation)}`);
}
console.log('✅ 2. Client-side normalization and validation passed');

// 3. Test Invite Creation, Single-Use & Session Binding
const testUserA = db.createUser({
  username: 'invite_alice_' + Date.now(),
  email: 'ialice@test.local',
  passwordHash: hashPassword('Secret123!'),
  displayName: 'Invite Alice'
});

const testUserB = db.createUser({
  username: 'invite_bob_' + Date.now(),
  email: 'ibob@test.local',
  passwordHash: hashPassword('Secret123!'),
  displayName: 'Invite Bob'
});

const createdInvite = InviteService.createInvite({
  userId: testUserA.id,
  deviceId: 'alice-dev-test',
  ttlMinutes: 15
});

// 4. Resolve invite with Bob
const resolveRes = InviteService.resolveInvite(createdInvite.pairingCode, testUserB.id);
if (!resolveRes.valid || resolveRes.creator?.uuid !== testUserA.id) {
  throw new Error(`Resolve failed: ${JSON.stringify(resolveRes)}`);
}
console.log('✅ 3. Bob successfully resolved Alice 60-bit invite code');

// 5. Creator cannot resolve own invite
const selfResolve = InviteService.resolveInvite(createdInvite.pairingCode, testUserA.id);
if (selfResolve.valid) {
  throw new Error('Self-resolve should have been rejected');
}
console.log('✅ 4. Self-resolve rejection confirmed');

// 6. Bob accepts invite
const acceptRes = InviteService.acceptInvite(createdInvite.invite.id, testUserB.id);
if (!acceptRes.success || !acceptRes.conversationId) {
  throw new Error(`Accept failed: ${JSON.stringify(acceptRes)}`);
}
console.log('✅ 5. Single-use invite accepted and isolated conversation created');

// 7. Second attempt to accept must fail (single-use constraint)
const replayAccept = InviteService.acceptInvite(createdInvite.invite.id, testUserB.id);
if (replayAccept.success) {
  throw new Error('Replay accept of single-use code should have failed');
}
console.log('✅ 6. Single-use constraint enforced: replay attempt failed as expected');

// 8. Test Rate Limiting
const rateLimitKey = 'test-ratelimit-' + Date.now();
for (let i = 0; i < 15; i++) {
  const chk = InviteService.checkRateLimit(rateLimitKey, 'resolve');
  if (i < 15 && !chk.allowed) {
    throw new Error(`Premature rate limit at i=${i}`);
  }
}
const blocked = InviteService.checkRateLimit(rateLimitKey, 'resolve');
if (blocked.allowed) {
  throw new Error('Rate limit check should have blocked excess attempts');
}
console.log('✅ 7. Rate limiter successfully throttled excess attempts');

console.log('🎉 ALL 60-BIT INVITE SERVICE TESTS PASSED!\n');

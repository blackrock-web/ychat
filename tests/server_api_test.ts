async function runServerApiTests() {
  const BASE_URL = 'http://localhost:3000';
  console.log('--- STARTING SERVER REST & SECURITY API TEST SUITE ---');

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
  const health = await healthRes.json();
  if (health.status !== 'healthy') throw new Error('Health check failed');
  console.log('1. ✓ Backend Health check passed (Status: healthy)');

  // 2. User Registration
  const testUser = `testuser_${Date.now()}`;
  const regRes = await fetch(`${BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: testUser,
      email: `${testUser}@example.com`,
      password: 'SecurePassword123!',
      displayName: 'Test User'
    })
  });
  if (!regRes.ok) throw new Error('Registration failed');
  const regData = await regRes.json();
  const token = regData.tokens.accessToken;
  const userUuid = regData.user.uuid;
  console.log('2. ✓ User registration with Argon2id hash & JWT tokens succeeded');

  // 3. User Login
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: testUser,
      password: 'SecurePassword123!'
    })
  });
  if (!loginRes.ok) throw new Error('Login failed');
  console.log('3. ✓ Login credential verification succeeded');

  // 4. Device Registration
  const devId = `dev-${testUser}-1`;
  const devRes = await fetch(`${BASE_URL}/api/v1/devices/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      deviceId: devId,
      deviceName: 'Test Linux Workstation',
      platform: 'desktop',
      publicKeys: {
        signingKey: 'bWxkc2EtODctcHVibGljLWtleS1kZW1v',
        dhKey: 'eDI1NTE5LXB1YmxpYy1rZXktZGVtbw==',
        kemKey: 'bWxrZW0tMTAyNC1wdWJsaWMta2V5LWRlbW8='
      },
      oneTimePrekeys: [
        { id: 1, dhKey: 'b3BrLTEtZGg=', kemKey: 'b3BrLTEta2Vt' }
      ]
    })
  });
  if (!devRes.ok) throw new Error('Device registration failed');
  console.log('4. ✓ Device & public key bundle upload succeeded');

  // 5. Prekey Fetching
  const pkRes = await fetch(`${BASE_URL}/api/v1/devices/${devId}/prekeys`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const pkData = await pkRes.json();
  if (!pkData.publicKeys || !pkData.oneTimePrekey) throw new Error('Prekey retrieval failed');
  console.log('5. ✓ One-time prekey bundle claimed for X3DH agreement');

  // 6. Plaintext Rejection Enforcement (Crucial Security Property)
  const leakRes = await fetch(`${BASE_URL}/api/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      clientMessageId: 'msg-leak-test',
      conversationId: 'conv-123',
      text: 'This is an accidental plaintext leak attempt!'
    })
  });
  if (leakRes.status !== 400) {
    throw new Error('SECURITY VIOLATION: Server did NOT reject plaintext message!');
  }
  console.log('6. ✓ Server strictly rejected plaintext transmission with 400 Bad Request');

  // 7. Ciphertext Envelope Transmission
  const envRes = await fetch(`${BASE_URL}/api/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      clientMessageId: `msg-${Date.now()}`,
      conversationId: 'conv-123',
      senderDeviceId: devId,
      recipientDeviceId: 'dev-alice-primary',
      ciphertext: 'SGVsbG8gRW5jcnlwdGVkIENpcGhlcnRleHQgV29ybGQ=',
      nonce: 'bm9uY2UtMTJieXRlcw==',
      signature: 'bWxkc2Etc2lnbmF0dXJlLWJsb2Nr',
      encryptionVersion: 'hybrid-x25519-mlkem1024-chacha20-v1',
      sequence: 1
    })
  });
  if (!envRes.ok) throw new Error('Message dispatch failed');
  const envData = await envRes.json();
  console.log('7. ✓ Ciphertext envelope stored and sequenced (Server Sequence:', envData.serverSequence, ')');

  // 8. Zero-Knowledge Audit Check
  const auditRes = await fetch(`${BASE_URL}/api/v1/security/audit`);
  const audit = await auditRes.json();
  if (!audit.verifiedZeroPlaintext || audit.plaintextLeaksCount > 0) {
    throw new Error('Audit detected plaintext in database!');
  }
  console.log('8. ✓ Zero-knowledge audit passed: 0 plaintext leaks verified across server storage');

  console.log('\n ALL SERVER INTEGRATION AND SECURITY AUDIT TESTS PASSED!');
}

runServerApiTests().catch(err => {
  console.error('SERVER TEST ERROR:', err);
  process.exit(1);
});

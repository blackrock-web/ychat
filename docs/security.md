# YChat Security Architecture & Threat Mitigation Matrix

## 1. Threat Model & Adversary Assumptions

YChat assumes an active, computationally powerful adversary operating across network, server, and storage infrastructure:
- **Passive Wire Eavesdropper (ISP / State-Level)**: Has the capability to record all network traffic indefinitely ("Harvest Now, Decrypt Later" with quantum computers).
- **Compromised Server Infrastructure**: Has full administrative access to central application servers, database records, and server logs.
- **Malicious Co-Tenant / Unauthorized User**: Attempts to access messages in conversations where they are not a participant, forge messages, spoof identity keys, or manipulate sequence IDs.

---

## 2. Participant Isolation & Backend Authorization Enforcement

The YChat backend strictly enforces access control for all conversation data:
- **Zero Client Trust**: The server never trusts a `conversationId` supplied by the client. Every API request (`POST /api/v1/messages`, `GET /api/v1/conversations/:id`, `GET /api/v1/conversations/:id/messages`, `POST /api/v1/sync/push`, `GET /api/v1/sync/pull`) resolves the caller's identity from their validated JWT session token and asserts that `req.user.userId` is a legitimate member of the target conversation.
- **Strict Partitioning**:
  - Given Conversation 1 (User A $\leftrightarrow$ User B) and Conversation 2 (User B $\leftrightarrow$ User C):
  - User A has access only to Conversation 1.
  - User C has access only to Conversation 2.
  - An attempt by User C to fetch or push messages to Conversation 1 returns HTTP `403 Forbidden` (`Forbidden: Authenticated user is not a participant in this conversation`).
- **Device Ownership Assertion**: An authenticated user can only send messages from devices they own and have not revoked (`db.isDeviceOwnedByUser(deviceId, userId)`). Using another user's device ID returns HTTP `403 Forbidden`.
- **WebSocket Boundary**:
  - WebSocket connections require both a valid JWT token and an unrevoked device ID belonging to the user.
  - Inbound WebSocket message events verify conversation membership before accepting or relaying.
  - Messages are dispatched strictly to sockets belonging to authorized participants.

---

## 3. Cryptographic Message Pipeline & Packetization

Before leaving the client device, all messages undergo authenticated serialization and AEAD encryption:

```
[Plaintext Payload]
        ↓
[JSON Serialization with Timestamp, ClientMessageId, Nonce]
        ↓
[Cryptographic Processing: Ratchet Key Derivation]
        ↓
[ChaCha20-Poly1305 AEAD Encryption with AAD (conversationId:msgId:seq)]
        ↓
[Encrypted Ciphertext Envelope]
        ↓
[ML-DSA-87 Post-Quantum Digital Signature]
        ↓
[Chunking / Packetization if Exceeding MTU]
  Each chunk:
  - BLAKE3 chunk digest
  - 12-byte CSPRNG chunk nonce
  - ML-DSA-87 signature over (parentId:chunkIdx:totalChunks:digest:nonce)
        ↓
[Transport Encryption: TLS 1.3]
        ↓
[YChat Central Backend (Stores & Relays Ciphertext Only)]
        ↓
[Recipient Device Reassembly]
  - Validates total chunk count, sequence continuity, and duplicate absence
  - Verifies BLAKE3 digest on each chunk
  - Verifies ML-DSA-87 post-quantum signature
  - Reconstructs ciphertext
        ↓
[ML-DSA-87 Envelope Signature Verification]
        ↓
[ChaCha20-Poly1305 Decryption]
        ↓
[Plaintext Rendered in UI]
```

---

## 4. Threat & Mitigation Verification Checklist

| Vector / Attack | Threat Scenario | Architectural Mitigation | Verification Procedure |
| :--- | :--- | :--- | :--- |
| **Server Plaintext Exposure** | Malicious DB admin or subpoena queries messages table. | **Zero-knowledge architecture**: Server only stores ciphertext, IV, signature, and metadata. Plaintext is rejected with HTTP 400. | Server audit verifies 0 plaintext leaks. |
| **Cross-Conversation Unauthorized Access** | User C queries User A $\leftrightarrow$ User B messages. | **Backend authorization matrix**: Server checks conversation membership for all message/conversation routes. | Access denied with HTTP 403 Forbidden. |
| **Device Impersonation** | User B submits messages claiming to be User A's device. | **Device ownership validation**: `isDeviceOwnedByUser` check on every push/sync/message. | Rejected with HTTP 403 Forbidden. |
| **Quantum Decryption (HNDL)** | Adversary stores traffic to decrypt with future quantum computers. | **Hybrid Post-Quantum Key Agreement**: ML-KEM-1024 (FIPS 203) combined with X25519 using HKDF-SHA3-512. | Hybrid encapsulation validated in automated test suite. |
| **Message Forgery / Spoofing** | Attacker attempts to forge messages from an arbitrary user. | **Post-Quantum Signatures**: All outbound ciphertext envelopes are signed with sender's private ML-DSA-87 key; verified prior to decryption. | Tampered signature test confirms immediate drop. |
| **Replay Attacks** | Attacker intercepts and resends valid ciphertext envelopes. | Monotonic sequence counters, unique `client_message_id`, and ratcheting message keys that are destroyed upon first use. | Re-sending identical ciphertext is discarded or acknowledged idempotently. |
| **Information Leakage (PII)** | Public APIs expose user emails, password hashes, or IP addresses. | Explicit projection whitelists: public user searches return ONLY `{ uuid, username, displayName }`. | Test `/api/v1/users/search` response JSON schema. |
| **Brute Force & Credential Stuffing** | Rapid password guessing against authentication endpoints. | Argon2id high-cost memory/time parameters, plus endpoint rate limiting. | Rate limit triggers HTTP 429 upon threshold breach. |
| **Corrupted / Out-of-Order Chunks** | Network tampering corrupts packetized chunks. | BLAKE3 digests and per-chunk ML-DSA-87 signatures. Missing, duplicate, or out-of-order chunks are dropped. | Reassembly throws security violation error. |
| **Verification Replay / Substitution** | Attacker reuses a scanned QR code or substitutes a QR from another chat. | 128-bit CSPRNG nonces, 10-min TTL, single-use nonce invalidation, and explicit conversation ID binding. | Verification fails with `REPLAY_ATTACK_DETECTED` or `CROSS_CONVERSATION_SUBSTITUTION`. |

# YChat Synchronization & Multi-Device Subsystem Specification

## 1. Objectives & Guarantees

YChat's synchronization subsystem guarantees reliable, strictly isolated message delivery across unstable cellular connections, device restarts, and multi-device account fleets.

- **At-Least-Once Delivery**: No outbound message is dropped if network drops mid-flight; queued in persistent local IndexedDB.
- **Strict Authorization**:
  - `POST /api/v1/sync/push` asserts that the authenticated caller owns `senderDeviceId` and is a member of `conversationId`.
  - `GET /api/v1/sync/pull` strictly asserts that the query `deviceId` belongs to the authenticated user. User C cannot pull messages for User A's devices.
- **Idempotency & Duplicate Suppression**: Retried messages share the same `client_message_id` and are processed idempotently without duplicates.
- **Revocation Enforcement**: Revoked devices are permanently prevented from pushing or pulling ciphertext.
- **Total Ordering**: Monotonic server sequences protect against race conditions and ordering anomalies.

---

## 2. Message State Machine

```
              [User Types & Presses Send]
                           |
                           v
               [Encrypt Locally (ChaCha20)]
                           |
                           v
            +------------------------------+
            | IndexedDB: "queued_offline"  |
            +--------------+---------------+
                           |
            (Network / WebSocket Available?)
             /                            \
           No                             Yes
           /                                \
          v                                  v
    [Stay in Sync Queue]             +-------------------+
          |                          | State: "sending"  |
   (Network Reconnected)             +---------+---------+
          |                                    |
          +---------> [Dispatch Payload] <-----+
                           |
                           v
            [Server Enqueues / Stored in DB]
                           |
                           v
            +------------------------------+
            |     Server Stamped (Seq)     |
            |     State: "sent" (Single ✔) |
            +--------------+---------------+
                           |
                 (Recipient Device Online)
                           |
                           v
            +------------------------------+
            | Recipient Receives Envelope  |
            | Emits Delivery Receipt       |
            | State: "delivered" (Double ✔)|
            +--------------+---------------+
                           |
                 (Recipient Opens Chat)
                           |
                           v
            +------------------------------+
            | Recipient Reads Message      |
            | Emits Read Receipt           |
            | State: "read" (Purple ✔✔)    |
            +------------------------------+
```

---

## 3. Sync Protocol & Multi-Device Security

### Outbound Push (Client -> Server)
1. **Local Commit**: Payload is encrypted with single-use message key. The client stores `{ clientMessageId, conversationId, ciphertext, nonce, signature, status: 'sending', timestamp }` in IndexedDB.
2. **WebSocket Send**: If WebSocket connection is active, payload is emitted via frame `{"type": "message", "envelope": ...}`.
3. **HTTP Fallback**: If WebSocket is disconnected, client batches pending queue and calls `POST /api/v1/sync/push`.
4. **Server Authorization**:
   - Rejects plaintext payloads.
   - Asserts `db.isUserMemberOfConversation(userId, conversationId)`.
   - Asserts `db.isDeviceOwnedByUser(senderDeviceId, userId)`.
5. **Server Dedup**: Server stores message idempotently on `client_message_id`.

### Inbound Pull (Server -> Client)
1. **Real-time Push**: When online, server forwards ciphertext envelopes only to authorized connected sockets.
2. **Reconnection Pull**: Reconnecting client queries:
   `GET /api/v1/sync/pull?sinceSequence=<LAST_KNOWN_SEQ>&deviceId=<DEVICE_ID>`
3. **Strict Authorization**:
   - Server asserts that `deviceId` belongs to `req.user.userId` and `!device.revokedAt`.
   - If unauthorized, returns HTTP `403 Forbidden`.
4. **Local Ingestion & Signature Verification**:
   - Verifies sender's ML-DSA-87 signature.
   - Decrypts ciphertext using ratchet message key.
   - Appends to BLAKE3 hash chain and writes to IndexedDB.
   - Emits delivery receipt: `POST /api/v1/messages/:messageId/receipt`.

### Device Revocation & Synchronization Lockout
- When a user revokes a compromised or lost device via `POST /api/v1/devices/:deviceId/revoke`:
  - `revokedAt` timestamp is permanently set.
  - Active WebSockets for that device are immediately terminated.
  - Any subsequent push/pull from that device returns HTTP `403 Forbidden`.

# YChat REST & WebSocket API Specification

All REST endpoints are versioned under `/api/v1`. All requests and responses utilize UTF-8 JSON. Authenticated endpoints require the `Authorization: Bearer <JWT_ACCESS_TOKEN>` HTTP header.

---

## 1. Authentication & Identity

### `POST /api/v1/auth/register`
Creates a new account with a permanent UUID and securely hashed password using Argon2id.

- **Request Body**:
  ```json
  {
    "username": "alice123",
    "email": "alice@example.com",
    "password": "SecurePassword123!",
    "displayName": "Alice"
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "user": {
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "username": "alice123",
      "displayName": "Alice"
    },
    "tokens": {
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "eyJhbGciOi...",
      "expiresIn": 900
    }
  }
  ```
- **Note**: The email address is stored for account recovery but is **strictly confidential** and NEVER exposed in public endpoints.

### `POST /api/v1/auth/login`
Authenticates a user using their username/email and password.
- **Request Body**:
  ```json
  {
    "username": "alice123",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK)**: Returns tokens and public user object.

### `POST /api/v1/auth/refresh`
Refreshes an expired access token using a valid refresh token.
- **Request Body**: `{ "refreshToken": "..." }`
- **Response (200 OK)**: `{ "accessToken": "...", "refreshToken": "...", "expiresIn": 900 }`

---

## 2. Public User Directory

### `GET /api/v1/users/search?username=:username`
Searches for users by human-readable username to initiate a conversation.
- **Response (200 OK)**:
  ```json
  {
    "users": [
      {
        "uuid": "7b6f1234-5678-4321-9876-abcdef012345",
        "username": "bob456",
        "displayName": "Bob"
      }
    ]
  }
  ```
- **Security Check**: This endpoint NEVER returns email, phone numbers, password hashes, or IP addresses.

### `GET /api/v1/users/:uuid`
Returns the public identity profile of a given user by UUID.

---

## 3. Device & Public Key Registry

### `POST /api/v1/devices/register`
Registers the calling client device and uploads its cryptographic public keys and one-time prekeys.
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Request Body**:
  ```json
  {
    "deviceId": "dev-web-98765432",
    "deviceName": "Alice's Web Client",
    "platform": "web",
    "publicKeys": {
      "signingKey": "base64_ml_dsa_87_public_key",
      "dhKey": "base64_x25519_public_key",
      "kemKey": "base64_ml_kem_1024_public_key"
    },
    "oneTimePrekeys": [
      { "id": 1, "dhKey": "base64...", "kemKey": "base64..." },
      { "id": 2, "dhKey": "base64...", "kemKey": "base64..." }
    ]
  }
  ```
- **Response (201 Created)**: `{ "status": "registered", "deviceId": "dev-web-98765432" }`

### `GET /api/v1/devices/:deviceId/prekeys`
Fetches a device's identity public keys and claims a single one-time prekey for X3DH session establishment.

### `GET /api/v1/users/:uuid/devices`
Returns the active devices and public key material for a given user.

### `POST /api/v1/devices/:deviceId/revoke`
Revokes a compromised or decommissioned device.

---

## 4. Conversations

### `POST /api/v1/conversations`
Creates or retrieves an existing 1:1 conversation between the authenticated user and a recipient UUID.
- **Request Body**: `{ "recipientUuid": "7b6f1234-5678-4321-9876-abcdef012345" }`
- **Response (200 OK / 201 Created)**:
  ```json
  {
    "conversationId": "c92849b2-32a1-432b-987c-112233445566",
    "members": [
      { "userUuid": "550e8400-...", "username": "alice123", "displayName": "Alice" },
      { "userUuid": "7b6f1234-...", "username": "bob456", "displayName": "Bob" }
    ],
    "createdAt": "2026-09-10T12:00:00.000Z"
  }
  ```

### `GET /api/v1/conversations`
Lists all active conversations for the authenticated user.

---

## 5. Message Ciphertext Transport

### `POST /api/v1/messages`
Sends an end-to-end encrypted ciphertext envelope.
- **Request Body**:
  ```json
  {
    "clientMessageId": "msg-local-12345678",
    "conversationId": "c92849b2-32a1-432b-987c-112233445566",
    "senderDeviceId": "dev-web-98765432",
    "recipientDeviceId": "dev-and-11223344",
    "ciphertext": "o2K+V8Q2...base64",
    "nonce": "n7x...base64",
    "signature": "sig...base64",
    "encryptionVersion": "hybrid-x25519-mlkem1024-v1",
    "sequence": 1
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "messageId": "msg-srv-998877",
    "clientMessageId": "msg-local-12345678",
    "serverSequence": 42,
    "createdAt": "2026-09-10T12:00:01.000Z",
    "status": "stored_or_delivered"
  }
  ```
- **Validation**: Any request attempting to pass unencrypted `text` or `content` fields is rejected with `400 Bad Request`.

### `POST /api/v1/messages/:messageId/receipt`
Updates the delivery state (`delivered` or `read`) for an envelope.

---

## 6. Offline Synchronization

### `POST /api/v1/sync/push`
Batched sync pushing offline-queued ciphertext envelopes upon network reconnection.

### `GET /api/v1/sync/pull?sinceSequence=:seq&deviceId=:deviceId`
Fetches all undelivered or pending ciphertext envelopes intended for the specified device since the given sequence number.

---

## 7. Health Check

### `GET /api/v1/health`
Returns system status, active database dialect, and uptime.
- **Response (200 OK)**:
  ```json
  {
    "status": "healthy",
    "service": "YChat Backend",
    "timestamp": "2026-09-10T12:00:00.000Z",
    "database": "connected",
    "version": "1.0.0"
  }
  ```

---

## 8. WebSocket Protocol (`/ws`)

### Connection Handshake
Clients connect to `ws://localhost:3000/ws?token=<JWT_ACCESS_TOKEN>&deviceId=<DEVICE_ID>`.

### Client-to-Server Frames:
1. `{"type": "subscribe", "conversationId": "..."}`
2. `{"type": "message", "envelope": { ... }}`
3. `{"type": "receipt", "messageId": "...", "status": "delivered" | "read"}`
4. `{"type": "ping"}`

### Server-to-Client Frames:
1. `{"type": "connected", "userUuid": "...", "deviceId": "..."}`
2. `{"type": "message", "envelope": { ... }, "messageId": "...", "serverSequence": 42}`
3. `{"type": "receipt", "messageId": "...", "clientMessageId": "...", "status": "delivered" | "read"}`
4. `{"type": "presence", "userUuid": "...", "status": "online" | "offline"}`
5. `{"type": "pong"}`

# YChat System Architecture

## 1. High-Level Architecture Overview

YChat is built around a single, centralized backend serving three client targets: Web, Desktop, and Android. The backend acts as an authenticated routing and synchronization hub, while all cryptographic operations (key generation, encapsulation, encryption, decryption, signing, and verification) occur strictly on client devices.

```
                                    +-----------------------+
                                    |     YCHAT BACKEND     |
                                    |  (Node.js / Express / |
                                    |   WebSocket / REST)   |
                                    +-----------+-----------+
                                                |
               +--------------------------------+--------------------------------+
               |                                |                                |
               v                                v                                v
    +--------------------+            +--------------------+            +--------------------+
    |     WEB CLIENT     |            |   DESKTOP CLIENT   |            |   ANDROID CLIENT   |
    |  (React, Vite,     |            |  (Tauri / WebCore, |            | (Jetpack Compose,  |
    |   IndexedDB local) |            |   SQLite local)    |            |   Room DB local)   |
    +--------------------+            +--------------------+            +--------------------+
               |                                |                                |
               +--------------------------------+--------------------------------+
                                                |
                               +----------------v----------------+
                               |   Single Central PostgreSQL /   |
                               |    Supabase Database Storage    |
                               +---------------------------------+
```

### Core Tenets
1. **Single Backend Principle**: No separate backends for Web, Desktop, and Android. All client targets consume identical REST endpoints under `/api/v1` and the same real-time WebSocket protocol.
2. **Untrusted Server / Zero-Knowledge Plaintext**: The backend is explicitly excluded from the trust boundary for message contents. Plaintext messages NEVER traverse the network or enter server RAM/disk.
3. **Local-First Caching**: Each client maintains a dedicated, encrypted local database (IndexedDB on Web, SQLite on Desktop, Room on Android) so chats remain readable offline, and the server is not a single point of failure for history access.
4. **Resilient Synchronization**: Senders push encrypted payloads into a persistent sync queue. The server holds undelivered ciphertext envelopes until the recipient device confirms receipt, enabling seamless asynchronous and offline message delivery.

---

## 2. Multi-Device Topology

A single user account identified by a permanent UUID may register multiple devices:

```
                              User (UUID: 550e8400-...)
                                         |
         +-------------------------------+-------------------------------+
         |                               |                               |
  Device 1 (Web)                 Device 2 (Desktop)              Device 3 (Android)
  ID: dev-web-01                 ID: dev-desk-02                 ID: dev-and-03
  - ML-DSA-87 Identity Key       - ML-DSA-87 Identity Key        - ML-DSA-87 Identity Key
  - X25519 Identity Key          - X25519 Identity Key           - X25519 Identity Key
  - ML-KEM-1024 Identity Key     - ML-KEM-1024 Identity Key      - ML-KEM-1024 Identity Key
  - Local IndexedDB Cache        - Local SQLite Database         - Android Keystore + Room
```

When a user initiates an outbound message:
1. Sender encrypts the payload for each recipient device AND for all other linked devices belonging to the sender account.
2. Ciphertext envelopes are dispatched to the server.
3. Server fans out the respective ciphertexts to online devices via WebSocket or enqueues them for offline devices.

---

## 3. Communication Pathways

### REST API (`/api/v1/*`)
- Primary use: User registration, Argon2id authentication, JWT token refresh, public profile lookup by username, device key registration, prekey bundle queries, conversation initialization, and batch synchronization (`/sync/push`, `/sync/pull`).

### WebSocket Engine (`/ws`)
- Primary use: Bidirectional real-time delivery of encrypted message envelopes, presence indicators, real-time delivery receipts (`delivered_at`), read receipts (`read_at`), and sync event broadcasts.
- Uses JWT authentication on handshake. Reconnects with exponential backoff and synchronizes any missed envelopes via `/sync/pull`.

---

## 4. Scalability & Future Cloud Evolution

### Local MVP Phase (Current)
- Standalone Node.js server process bundling Express, WebSocket Server, and an embedded transactional storage engine (with automatic PostgreSQL fallback when `DATABASE_URL` is set).
- Vite development server or production static distribution hosted on port 3000.

### Cloud Production Phase
```
                                     INTERNET
                                        |
                            +-----------v-----------+
                            | Cloud Load Balancer / |
                            |    Ingress (TLS)      |
                            +-----------+-----------+
                                        |
                    +-------------------+-------------------+
                    |                                       |
          +---------v---------+                   +---------v---------+
          |  YChat Worker 1   |                   |  YChat Worker 2   |
          |  (Stateless API/WS|                   |  (Stateless API/WS|
          +---------+---------+                   +---------+---------+
                    |                                       |
                    +-------------------+-------------------+
                                        |
                       +----------------v----------------+
                       |    PostgreSQL Database Cluster  |
                       |    (e.g., Supabase / Cloud SQL) |
                       |    + Redis Pub/Sub for WS fanout|
                       +---------------------------------+
```
To enable horizontal scaling across multiple backend nodes:
- WebSocket connection affinity is maintained via load balancers.
- A future Redis message bus coordinates real-time envelope fan-out between stateless server instances.
- PostgreSQL manages persistent state with UUID primary keys and atomic transactions.

# YChat Developer Onboarding & Architecture Guide

## 1. Project Directory Layout

```
ychat/
├── docs/                      # Architectural, cryptographic, and API specs
│   ├── architecture.md
│   ├── api.md
│   ├── database.md
│   ├── sync.md
│   ├── security.md
│   ├── cryptography.md
│   ├── deployment.md
│   └── development.md
├── server/                    # Centralized backend service
│   ├── server.ts              # Express API + WebSocket server entry point
│   ├── db.ts                  # Database adapter & transactional storage engine
│   ├── schema.sql             # Production PostgreSQL DDL migrations
│   ├── ws.ts                  # Authenticated WebSocket real-time distribution
│   └── routes/                # Versioned REST endpoints (/api/v1/*)
│       ├── auth.ts            # Registration, Argon2id login, JWT refresh
│       ├── users.ts           # Public user search & profiles (no PII leakage)
│       ├── devices.ts         # Device registration & public key directory
│       ├── conversations.ts   # 1:1 conversation initialization & metadata
│       ├── messages.ts        # Ciphertext envelopes & delivery receipts
│       └── sync.ts            # Offline push/pull synchronization
├── src/                       # Frontend application (Web, Desktop, Android)
│   ├── crypto/                # Zero-knowledge cryptographic engine
│   │   ├── types.ts           # Protocol interfaces & envelope data models
│   │   ├── primitives.ts      # Audited wrappers (ML-KEM, ML-DSA, X25519, ChaCha20)
│   │   ├── keys.ts            # Device key generation & prekey generation
│   │   ├── handshake.ts       # Hybrid X3DH key agreement (ML-KEM + X25519)
│   │   ├── ratchet.ts         # Rekeying engine (50 msgs / 5 mins)
│   │   ├── envelope.ts        # ChaCha20 AEAD encryption & ML-DSA signing
│   │   ├── blake3chain.ts     # Client-side tamper-evident message history chain
│   │   └── safetyNumber.ts    # Fingerprint & visual safety number generation
│   ├── storage/               # Client persistence
│   │   ├── db.ts              # IndexedDB local storage engine
│   │   └── syncEngine.ts      # Offline queue, retry, and receipt coordinator
│   ├── components/            # Reusable UI component library (Purple theme)
│   │   ├── ChatScreen.tsx     # Message bubbles, timestamp, delivery status
│   │   ├── ConversationList.tsx # Search, conversations, unread badges
│   │   ├── NewChatModal.tsx   # User search by username
│   │   ├── SafetyNumberModal.tsx # MITM safety number verification
│   │   ├── DevicesModal.tsx   # Active device management & key inspector
│   │   ├── SecurityAuditModal.tsx # Live cryptographic inspector & E2EE test
│   │   └── AuthScreen.tsx     # Login & Registration with Argon2id client salt
│   ├── App.tsx                # Main application orchestrator & simulator
│   ├── main.tsx               # DOM entry point
│   └── index.css              # Tailwind CSS & design tokens
├── docker-compose.yml         # Containerized PostgreSQL service
├── package.json
└── metadata.json
```

## 2. Multi-Platform Portability Strategy

- **Desktop (Tauri)**: The `src/` React code maps directly into Tauri without changes. Replace `IndexedDB` with SQLite via Tauri's `@tauri-apps/plugin-sql` for OS-level file persistence.
- **Android (Kotlin / Jetpack Compose)**: Consumes the exact same `/api/v1` REST endpoints and `/ws` WebSocket frames. The cryptographic protocol uses standard NIST ML-KEM-1024, ML-DSA-87, X25519, and ChaCha20-Poly1305 with Android Keystore for private key protection.

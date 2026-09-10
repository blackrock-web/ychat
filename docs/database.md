# YChat Database Schema Specification

## 1. Principles & Privacy Constraints

1. **UUID Primary Keys**: Every entity is indexed by a cryptographically random RFC 4122 UUID v4 (`gen_random_uuid()` in PostgreSQL). Usernames are unique candidate keys but **never** database primary keys.
2. **Strict Exclusion of Message Plaintext**: The database contains columns for `ciphertext`, `nonce`, `signature`, and `encryption_version`. There is no `plaintext_content` column, nor will any plaintext ever be persisted.
3. **Multi-Device Support**: Messages are routed and receipts are tracked at the device granularity (`sender_device_id`, `recipient_device_id`).
4. **PostgreSQL & Supabase Compatibility**: Schema is written in standard ANSI SQL with PostgreSQL extensions, ready for immediate deployment on Docker Compose, Supabase, or RDS.

---

## 2. Relational Entity Diagram

```
       +-------------------------+
       |          users          |
       +-------------------------+
       | id (UUID, PK)           |
       | username (VARCHAR, UQ)  |
       | email (VARCHAR, UQ)     |
       | password_hash (TEXT)    |
       | display_name (VARCHAR)  |
       | created_at (TIMESTAMPTZ)|
       +------------+------------+
                    |
       +------------+------------+---------------------------+
       | 1:N                     | 1:N                       | 1:N
       v                         v                           v
+---------------+      +----------------------+      +----------------------+
|    devices    |      | conversation_members |      |       sessions       |
+---------------+      +----------------------+      +----------------------+
| id (TEXT, PK) |      | conversation_id (UUID|      | id (UUID, PK)        |
| user_id (UUID)|      | user_id (UUID, FK)   |      | user_id (UUID, FK)   |
| device_name   |      | joined_at            |      | refresh_token_hash   |
| platform      |      +----------+-----------+      | expires_at           |
| public_sign   |                 |                  +----------------------+
| public_dh     |                 | N:1
| public_kem    |                 v
| created_at    |      +----------------------+
| last_seen     |      |    conversations     |
| revoked_at    |      +----------------------+
+-------+-------+      | id (UUID, PK)        |
        |              | type (VARCHAR, '1:1')|
        | 1:N          | created_at           |
        v              +----------+-----------+
+------------------+              |
|  device_prekeys  |              | 1:N
+------------------+              v
| id (UUID, PK)    |   +----------------------+
| device_id (TEXT) |   |       messages       |
| prekey_type      |   +----------------------+
| public_key       |   | id (UUID, PK)        |
| consumed_at      |   | conversation_id(UUID)|
+------------------+   | sender_device_id(FK) |
                       | recipient_device_id  |
                       | client_message_id(UQ)|
                       | ciphertext (TEXT)    |
                       | nonce (TEXT)         |
                       | signature (TEXT)     |
                       | encryption_version   |
                       | server_sequence (BIG)|
                       | created_at           |
                       | delivered_at         |
                       | read_at              |
                       +----------------------+
```

---

## 3. PostgreSQL DDL Schema (`schema.sql`)

```sql
-- Enable cryptographic extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- USER DEVICES TABLE
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(64) NOT NULL,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('web', 'desktop', 'android', 'ios')),
    public_sign_key TEXT NOT NULL,
    public_dh_key TEXT NOT NULL,
    public_kem_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

-- DEVICE ONE-TIME PREKEYS (X3DH)
CREATE TABLE IF NOT EXISTS device_prekeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL,
    dh_public_key TEXT NOT NULL,
    kem_public_key TEXT NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_device_prekeys_active ON device_prekeys(device_id) WHERE consumed_at IS NULL;

-- CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_type VARCHAR(16) NOT NULL DEFAULT 'direct' CHECK (conversation_type IN ('direct', 'group')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CONVERSATION MEMBERSHIP
CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);

-- CIPHERTEXT MESSAGES TABLE (NO PLAINTEXT COLUMN)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_device_id VARCHAR(64) NOT NULL REFERENCES devices(id),
    recipient_device_id VARCHAR(64) NOT NULL,
    client_message_id VARCHAR(64) NOT NULL UNIQUE,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    signature TEXT NOT NULL,
    encryption_version VARCHAR(32) NOT NULL,
    server_sequence BIGSERIAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ NULL,
    read_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, server_sequence);
CREATE INDEX IF NOT EXISTS idx_messages_undelivered ON messages(recipient_device_id) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_message_id);

-- USER SESSIONS / REFRESH TOKENS
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    refresh_token_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_device ON sessions(user_id, device_id);
```

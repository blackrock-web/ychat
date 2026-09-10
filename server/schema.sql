-- YChat PostgreSQL Database Schema (v2.0.0 Production Upgrade)
-- Verified UUID-to-UUID Private Messaging + Supabase Auth + RLS + Zero-Knowledge Architecture
-- NO PLAINTEXT STORAGE & NO PASSWORDS STORED IN MYCHAT APPLICATION DB

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS TABLE
-- Enforces case-insensitive username uniqueness via username_normalized.
-- Authentication credentials handled strictly by Supabase Auth (auth_user_id).
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE, -- Supabase Auth User ID
    username VARCHAR(32) NOT NULL,
    username_normalized VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized ON users(username_normalized);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_user_id);

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

-- DEVICE ONE-TIME PREKEYS (X3DH / ML-KEM-1024)
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

-- CONVERSATION MEMBERSHIP (Row Level Security Foundation)
CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_members_lookup ON conversation_members(conversation_id, user_id);

-- CIPHERTEXT MESSAGES TABLE (ZERO-KNOWLEDGE: STRICTLY ENCRYPTED CIPHERTEXT ENVELOPES ONLY)
-- Logical routing destination: UUID-to-UUID (sender_user_id -> recipient_user_id)
-- 15-Minute maximum TTL for temporary offline queue
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_device_id VARCHAR(64) NOT NULL,
    recipient_device_id VARCHAR(64) NOT NULL,
    client_message_id VARCHAR(64) NOT NULL UNIQUE,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    signature TEXT NOT NULL,
    encryption_version VARCHAR(32) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 1,
    server_sequence BIGSERIAL,
    handshake_packet JSONB NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ NULL,
    read_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, server_sequence);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_undelivered ON messages(recipient_user_id) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at);

-- SESSIONS TABLE FOR REFRESH TOKEN ROTATION
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    refresh_token_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_device ON sessions(user_id, device_id);

-- INVITATION & PAIRING CODES TABLE
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_device_id VARCHAR(64) NOT NULL,
    pairing_code VARCHAR(16) NOT NULL UNIQUE,
    token VARCHAR(128) NOT NULL UNIQUE,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMPTZ NULL,
    used_by_user_id UUID NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(pairing_code) WHERE is_used = FALSE;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 1. Conversation Members: Users can only see memberships for conversations they belong to
CREATE POLICY rls_conversation_members_select ON conversation_members
    FOR SELECT
    USING (
        conversation_id IN (
            SELECT cm.conversation_id 
            FROM conversation_members cm 
            WHERE cm.user_id = auth.uid()
        )
    );

-- 2. Conversations: Users can only access conversations they participate in
CREATE POLICY rls_conversations_select ON conversations
    FOR SELECT
    USING (
        id IN (
            SELECT cm.conversation_id 
            FROM conversation_members cm 
            WHERE cm.user_id = auth.uid()
        )
    );

-- 3. Messages: Users can ONLY read messages in conversations where they are authorized members
CREATE POLICY rls_messages_select ON messages
    FOR SELECT
    USING (
        conversation_id IN (
            SELECT cm.conversation_id 
            FROM conversation_members cm 
            WHERE cm.user_id = auth.uid()
        )
    );

-- 4. Messages Insert: Senders can ONLY insert messages into conversations they belong to
CREATE POLICY rls_messages_insert ON messages
    FOR INSERT
    WITH CHECK (
        sender_user_id = auth.uid()
        AND conversation_id IN (
            SELECT cm.conversation_id 
            FROM conversation_members cm 
            WHERE cm.user_id = auth.uid()
        )
    );

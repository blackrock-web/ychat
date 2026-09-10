-- YChat PostgreSQL Database Schema (v1.0.0)
-- Zero-Knowledge E2EE Architecture: No plaintext columns exist

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

-- CIPHERTEXT MESSAGES TABLE (STRICTLY NO PLAINTEXT STORAGE)
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

-- SESSIONS TABLE FOR TOKEN ROTATION
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    refresh_token_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_device ON sessions(user_id, device_id);

-- INVITATION & PAIRING CODES TABLE (60-BIT ENTROPY, SINGLE-USE, SESSION BOUND)
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    session_id VARCHAR(64) NOT NULL,
    token VARCHAR(128) NOT NULL UNIQUE,
    pairing_code VARCHAR(32) NOT NULL UNIQUE,
    session_binding TEXT NOT NULL,
    entropy_bits INTEGER NOT NULL DEFAULT 60,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMPTZ NULL,
    used_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invites_pairing_code ON invites(pairing_code);
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_active ON invites(pairing_code) WHERE is_used = FALSE;

-- ============================================================================
-- POSTGRESQL ROW LEVEL SECURITY (RLS) POLICIES
-- Strict participant verification for every message retrieval and conversation query
-- ============================================================================

-- Enable RLS on sensitive tables
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 1. Conversation Members: Users can only query memberships for conversations they belong to
CREATE POLICY rls_conversation_members_isolation ON conversation_members
    FOR ALL
    USING (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        OR conversation_id IN (
            SELECT cm.conversation_id FROM conversation_members cm
            WHERE cm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    );

-- 2. Conversations: Users can only select, update, or access conversations where they are in conversation_members
CREATE POLICY rls_conversations_isolation ON conversations
    FOR ALL
    USING (
        id IN (
            SELECT cm.conversation_id FROM conversation_members cm
            WHERE cm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    );

-- 3. Messages: Users can only retrieve or store ciphertext messages for conversations they are an active member of
CREATE POLICY rls_messages_isolation ON messages
    FOR ALL
    USING (
        conversation_id IN (
            SELECT cm.conversation_id FROM conversation_members cm
            WHERE cm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    )
    WITH CHECK (
        conversation_id IN (
            SELECT cm.conversation_id FROM conversation_members cm
            WHERE cm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
        )
    );

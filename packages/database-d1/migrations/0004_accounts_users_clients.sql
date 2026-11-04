-- ==============================================================================
-- CANGREJO D1 MIGRATION: 0004_accounts_users_clients.sql
-- Description: Native D1/SQLite User Accounts, Client Organizations (Tenants),
--              and PBKDF2-SHA256 Authenticated Sessions.
-- Dialect: SQLite 3 / Cloudflare D1
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. USER ACCOUNTS (SCOPED TO TENANT / CLIENT ORGANIZATION)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_users (
    user_id TEXT PRIMARY KEY,                        -- 'usr_' + hex
    tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,                      -- Normalized lowercase email
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'OWNER'
        CHECK (role IN ('OWNER', 'ADMIN', 'ANALYST')),
    password_hash TEXT NOT NULL,                     -- pbkdf2_sha256$<iterations>$<saltHex>$<hashHex>
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_login_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_tenant
    ON cangrejo_users(tenant_id, status);

-- ------------------------------------------------------------------------------
-- 2. AUTHENTICATED USER SESSIONS (BEARER TOKENS cgrj_usr_*)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_auth_sessions (
    auth_session_id TEXT PRIMARY KEY,                -- 'asess_' + hex
    user_id TEXT NOT NULL REFERENCES cangrejo_users(user_id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,                 -- SHA-256 of raw 'cgrj_usr_<hex>' bearer token
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
    ON cangrejo_auth_sessions(user_id, expires_at);

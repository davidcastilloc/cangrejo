-- ==============================================================================
-- CANGREJO INTELLIGENCE GRAPH PLATFORM - CLOUDFLARE D1 RELATIONAL SCHEMA
-- Migration: 0001_production_core_schema.sql
-- Dialect: SQLite 3 / Cloudflare D1
-- Target Environment: Edge Serverless (Workers + D1)
-- Description: Multi-tenant identity, RBAC, workspaces, rooms, secrets vault,
--              audit logging, and Turnstile verification audit.
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. ORGANIZATIONS (Multi-Tenant Root)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,                             -- Prefix: 'org_' + NanoID/UUIDv4
    name TEXT NOT NULL,                              -- Organization Display Name
    slug TEXT UNIQUE NOT NULL,                       -- URL-safe identifier (e.g., 'cyber-defense-corp')
    plan TEXT NOT NULL DEFAULT 'enterprise'          -- Subscription Tier
        CHECK (plan IN ('starter', 'professional', 'enterprise', 'government')),
    max_collaborators INTEGER NOT NULL DEFAULT 50,  -- Quota: Seats allowed
    max_workspaces INTEGER NOT NULL DEFAULT 100,    -- Quota: Workspaces allowed
    max_entities_per_graph INTEGER NOT NULL DEFAULT 500000, -- Quota: Performance ceiling
    settings_json TEXT NOT NULL DEFAULT '{}',       -- JSON: Security policies (SSO, IP whitelist)
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON organizations(created_at);

-- ------------------------------------------------------------------------------
-- 2. USERS (Global Accounts & Authentication)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                             -- Prefix: 'usr_' + NanoID/UUIDv4
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,       -- Normalized case-insensitive email
    password_hash TEXT NOT NULL,                     -- Argon2id or Scrypt encoded hash
    full_name TEXT NOT NULL,                         -- Investigator name
    avatar_url TEXT,                                 -- URL / R2 reference to profile picture
    status TEXT NOT NULL DEFAULT 'active'            -- Account lifecycle status
        CHECK (status IN ('pending_verification', 'active', 'suspended', 'deactivated')),
    totp_secret_encrypted TEXT,                      -- AES-256-GCM encrypted TOTP secret for 2FA
    totp_enabled INTEGER NOT NULL DEFAULT 0          -- Boolean: 0 = disabled, 1 = enabled
        CHECK (totp_enabled IN (0, 1)),
    last_login_at INTEGER,                           -- Unix timestamp of latest login
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,-- Brute-force protection counter
    locked_until INTEGER,                            -- Unix timestamp until lockout expires
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ------------------------------------------------------------------------------
-- 3. MEMBERSHIPS & ROLES (Tenant-Scoped RBAC)
-- ------------------------------------------------------------------------------
-- Role Definition Catalog:
-- - 'owner': Full control, billing, organization deletion, API key management
-- - 'admin': Workspace administration, member invites/removals, transform policies
-- - 'analyst': Create/edit investigations, execute transforms, export graphs
-- - 'viewer': Read-only access to published investigations and shared rooms
CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'analyst'
        CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
    custom_permissions_mask INTEGER NOT NULL DEFAULT 0, -- Granular permission bitflags
    invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_org_role ON memberships(org_id, role);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

-- ------------------------------------------------------------------------------
-- 4. WORKSPACES (Logical Partitioning of Investigations)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,                             -- Prefix: 'wsp_' + NanoID/UUIDv4
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                              -- e.g., 'Project Titan - APT29 Campaign'
    description TEXT,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived INTEGER NOT NULL DEFAULT 0              -- Boolean: 0 = active, 1 = archived
        CHECK (archived IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(org_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_creator ON workspaces(created_by);

-- ------------------------------------------------------------------------------
-- 5. INVESTIGATIONS (Graph Projects & Meta State)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigations (
    id TEXT PRIMARY KEY,                             -- Prefix: 'inv_' + NanoID/UUIDv4
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,                             -- Investigation title
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'workspace'     -- Scoping
        CHECK (visibility IN ('private', 'workspace', 'organization', 'public_read')),
    status TEXT NOT NULL DEFAULT 'active'            -- Lifecycle
        CHECK (status IN ('active', 'archived', 'locked_evidence')),
    storage_r2_key TEXT,                             -- R2 Key: snapshots/{investigationId}.mtgj
    last_snapshot_clock INTEGER NOT NULL DEFAULT 0,  -- Yjs vector clock counter
    node_count INTEGER NOT NULL DEFAULT 0,           -- Telemetry: Node count for quick listing
    edge_count INTEGER NOT NULL DEFAULT 0,           -- Telemetry: Edge count for quick listing
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_investigations_org ON investigations(org_id);
CREATE INDEX IF NOT EXISTS idx_investigations_workspace ON investigations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_investigations_created_by ON investigations(created_by);
CREATE INDEX IF NOT EXISTS idx_investigations_updated_at ON investigations(updated_at DESC);

-- ------------------------------------------------------------------------------
-- 6. INVESTIGATION COLLABORATORS (Explicit Access Control List)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigation_collaborators (
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level TEXT NOT NULL DEFAULT 'read_write'
        CHECK (permission_level IN ('read_only', 'read_write', 'admin')),
    granted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (investigation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_collab_user ON investigation_collaborators(user_id);

-- ------------------------------------------------------------------------------
-- 7. COLLABORATION ROOMS (Durable Object Session Registry)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,                             -- Room Identifier (often matches investigation_id)
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    durable_object_id TEXT NOT NULL,                 -- Cloudflare DO hex ID or name string
    durable_object_jurisdiction TEXT,                -- 'eu' | 'fedramp' | 'global'
    status TEXT NOT NULL DEFAULT 'active'            -- Session status
        CHECK (status IN ('active', 'idle', 'draining', 'closed')),
    active_connections_count INTEGER NOT NULL DEFAULT 0,
    peak_connections_count INTEGER NOT NULL DEFAULT 0,
    opened_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_active_at INTEGER NOT NULL DEFAULT (unixepoch()),
    closed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rooms_investigation ON rooms(investigation_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- ------------------------------------------------------------------------------
-- 8. SECRETS VAULT & API KEYS (Encrypted Provider Credentials)
-- ------------------------------------------------------------------------------
-- Keys used for outbound transforms (VirusTotal, Shodan, Censys, WhoisXML, Maltego TDS).
-- Encrypted with organization master key using AES-256-GCM.
CREATE TABLE IF NOT EXISTS api_keys_vault (
    id TEXT PRIMARY KEY,                             -- Prefix: 'sec_' + NanoID/UUIDv4
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider_name TEXT NOT NULL                      -- e.g. 'virustotal', 'shodan', 'censys', 'custom_tds'
        COLLATE NOCASE,
    key_alias TEXT NOT NULL,                         -- Human-readable label (e.g. 'Corp Shodan Tier 2')
    encrypted_key TEXT NOT NULL,                     -- Base64 encoded AES-256-GCM ciphertext
    iv TEXT NOT NULL,                                -- Base64 encoded 96-bit initialization vector
    auth_tag TEXT NOT NULL,                          -- Base64 encoded 128-bit GCM authentication tag
    key_version INTEGER NOT NULL DEFAULT 1,          -- Key rotation sequence version
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_org_provider_alias 
    ON api_keys_vault(org_id, provider_name, key_alias);
CREATE INDEX IF NOT EXISTS idx_vault_org ON api_keys_vault(org_id);

-- ------------------------------------------------------------------------------
-- 9. AUDIT LOGS (Immutable Security & Compliance Record)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,                             -- Prefix: 'aud_' + NanoID/UUIDv4
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,                            -- e.g., 'auth.login', 'investigation.export_mtgx', 'transform.execute'
    target_type TEXT,                                -- 'investigation', 'user', 'vault_key', 'room'
    target_id TEXT,                                  -- Associated entity ID
    ip_address TEXT NOT NULL,                        -- CF-Connecting-IP
    country_code TEXT,                               -- CF-IPCountry
    user_agent TEXT,                                 -- User-Agent header
    details_json TEXT NOT NULL DEFAULT '{}',         -- Arbitrary event context (JSON)
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created 
    ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user 
    ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action 
    ON audit_logs(action, created_at DESC);

-- ------------------------------------------------------------------------------
-- 10. TURNSTILE BOT DEFENSE LOGS (Verification Audit)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnstile_verification_logs (
    id TEXT PRIMARY KEY,
    ip_address TEXT NOT NULL,
    action TEXT NOT NULL,                            -- e.g. 'register', 'login', 'reset_password'
    success INTEGER NOT NULL                         -- Boolean: 0 = failed/rejected, 1 = passed
        CHECK (success IN (0, 1)),
    error_codes TEXT,                                -- Comma-separated error codes from Turnstile API
    cdata TEXT,                                      -- Customer data payload if provided
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_turnstile_ip ON turnstile_verification_logs(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_turnstile_created ON turnstile_verification_logs(created_at DESC);

-- ------------------------------------------------------------------------------
-- 11. AUTOMATIC UPDATED_AT TRIGGERS
-- ------------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_organizations_updated_at
AFTER UPDATE ON organizations
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE organizations SET updated_at = unixepoch() WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE users SET updated_at = unixepoch() WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_memberships_updated_at
AFTER UPDATE ON memberships
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE memberships SET updated_at = unixepoch() WHERE user_id = OLD.user_id AND org_id = OLD.org_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_workspaces_updated_at
AFTER UPDATE ON workspaces
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE workspaces SET updated_at = unixepoch() WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_investigations_updated_at
AFTER UPDATE ON investigations
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE investigations SET updated_at = unixepoch() WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_api_keys_vault_updated_at
AFTER UPDATE ON api_keys_vault
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE api_keys_vault SET updated_at = unixepoch() WHERE id = OLD.id;
END;

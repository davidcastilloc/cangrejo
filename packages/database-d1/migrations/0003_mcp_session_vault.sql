-- ==============================================================================
-- CANGREJO D1 MIGRATION: 0003_mcp_session_vault.sql
-- Description: Multi-tenant MCP session isolation, WAL graph mutations,
--              snapshot checkpoints, and tenant metadata.
-- Dialect: SQLite 3 / Cloudflare D1
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. TENANT METADATA & LICENSE BINDINGS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_tenant_metadata (
    tenant_id TEXT PRIMARY KEY,                       -- Scoped ID: 'org_' + digest
    tier TEXT NOT NULL DEFAULT 'COMMUNITY'
        CHECK (tier IN ('COMMUNITY', 'ORO_PRO', 'PLATINO_ENTERPRISE')),
    license_key_masked TEXT,
    license_signature_hash TEXT,                      -- SHA-256 hash of commercial license token
    organization_name TEXT NOT NULL,
    max_active_mcp_sessions INTEGER NOT NULL DEFAULT 5,
    max_entities_per_session INTEGER NOT NULL DEFAULT 25000,
    credits_remaining INTEGER NOT NULL DEFAULT 0,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tenant_tier ON cangrejo_tenant_metadata(tier);

-- ------------------------------------------------------------------------------
-- 2. ISOLATED MCP SESSIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_mcp_sessions (
    session_id TEXT PRIMARY KEY,                      -- Namespaced PK: '${tenantId}:${rawSessionId}'
    tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
    raw_session_id TEXT NOT NULL,                     -- URL/analyst slug: e.g. 'expediente-apt29'
    user_id TEXT,                                     -- Analyst user ID or principal
    session_token_hash TEXT,                          -- SHA-256 hash of dedicated Bearer token (NULL for Type A license sessions)
    title TEXT NOT NULL DEFAULT 'Expediente MCP',
    case_tier TEXT NOT NULL DEFAULT 'ORO'
        CHECK (case_tier IN ('PLATINO', 'ORO', 'PLATA', 'BRONCE')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'idle', 'closed', 'revoked')),
    last_seq INTEGER NOT NULL DEFAULT 0,              -- High-water mark of graph mutations
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_active_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,                      -- Unix epoch timestamp of session expiration
    CONSTRAINT uq_tenant_raw_session UNIQUE (tenant_id, raw_session_id)
);

-- Partial unique index: enforces unique session tokens when set, while allowing multiple license-backed sessions
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_session_token
    ON cangrejo_mcp_sessions(session_token_hash)
    WHERE session_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_session_tenant
    ON cangrejo_mcp_sessions(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_mcp_session_expires
    ON cangrejo_mcp_sessions(expires_at);

-- ------------------------------------------------------------------------------
-- 3. SESSION GRAPH SNAPSHOTS (CHECKPOINTS) - TWO-TIER COMPRESSED STORAGE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_session_graphs (
    session_id TEXT PRIMARY KEY REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
    checkpoint_seq INTEGER NOT NULL DEFAULT 0,        -- Sequence number of this snapshot
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    storage_tier TEXT NOT NULL DEFAULT 'd1_inline'
        CHECK (storage_tier IN ('d1_inline', 'r2_offload')),
    compression_codec TEXT NOT NULL DEFAULT 'gzip'
        CHECK (compression_codec IN ('gzip', 'cgrx', 'none')),
    snapshot_payload BLOB,                            -- Compressed bytes (populated when storage_tier = 'd1_inline')
    snapshot_r2_key TEXT,                             -- R2 object key (populated when storage_tier = 'r2_offload')
    byte_size INTEGER NOT NULL DEFAULT 0,             -- Compressed byte count
    payload_sha256 TEXT NOT NULL,                     -- Cryptographic integrity seal (Daubert / FRE 702)
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------------------
-- 4. GRAPH MUTATION LOG (APPEND-ONLY WAL)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cangrejo_graph_mutations (
    id TEXT PRIMARY KEY,                              -- 'mut_' + UUID
    session_id TEXT NOT NULL REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,                             -- Monotonic sequence (1, 2, 3...)
    delta_id TEXT NOT NULL,                           -- CollaborationRoomHub deltaId
    author_id TEXT NOT NULL DEFAULT 'mcp-agent',      -- Identifier of actor/agent
    action TEXT NOT NULL                              -- Action discriminator
        CHECK (action IN ('upsert', 'remove', 'clear', 'paste_iocs', 'delta', 'layout', 'undo', 'redo')),
    delta_json TEXT NOT NULL,                         -- SerializedGraphModsDelta payload
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT uq_session_seq UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_mutations_created_at
    ON cangrejo_graph_mutations(created_at);

-- ------------------------------------------------------------------------------
-- 5. AUTOMATIC TRIGGER FOR TENANT METADATA UPDATED_AT
-- ------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_tenant_metadata_updated_at
AFTER UPDATE ON cangrejo_tenant_metadata
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
BEGIN
    UPDATE cangrejo_tenant_metadata SET updated_at = unixepoch() WHERE tenant_id = OLD.tenant_id;
END;

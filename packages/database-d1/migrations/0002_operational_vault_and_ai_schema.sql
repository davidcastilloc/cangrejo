-- ==============================================================================
-- CANGREJO INTELLIGENCE GRAPH PLATFORM - CLOUDFLARE D1 OPERATIONAL VAULT SCHEMA
-- Migration: 0002_operational_vault_and_ai_schema.sql
-- Dialect: SQLite 3 / Cloudflare D1
-- Description: Operational Expediente vault, Singleflight TTL cache, Open-Core
--              edition state, BYOK provider keys, and Radar 24/7 watches/alerts.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS cangrejo_expedientes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    case_tier TEXT NOT NULL DEFAULT 'ORO',
    entity_count INTEGER NOT NULL DEFAULT 0,
    link_count INTEGER NOT NULL DEFAULT 0,
    cgrj_payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cangrejo_pesquisa_audit (
    id TEXT PRIMARY KEY,
    transform_id TEXT NOT NULL,
    target_value TEXT NOT NULL,
    discovered_count INTEGER NOT NULL DEFAULT 0,
    elapsed_ms REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cangrejo_pesquisa_cache (
    cache_key TEXT PRIMARY KEY,
    transform_id TEXT NOT NULL,
    target_value TEXT NOT NULL,
    response_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cangrejo_edition_state (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    edition_tier TEXT NOT NULL DEFAULT 'COMMUNITY',
    license_key_masked TEXT,
    credits_remaining INTEGER NOT NULL DEFAULT 0,
    credits_total INTEGER NOT NULL DEFAULT 0,
    organization_name TEXT NOT NULL DEFAULT 'CANGREJO — Unidad de Criminalística Digital & OSINT',
    badge_title TEXT NOT NULL DEFAULT 'CANGREJO COMMUNITY EDITION',
    watermark_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cangrejo_provider_keys (
    provider TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cangrejo_radar_watches (
    id TEXT PRIMARY KEY,
    target_value TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'maltego.Domain',
    expediente_id TEXT NOT NULL DEFAULT 'expediente-apt29',
    baseline_json TEXT NOT NULL,
    baseline_digest_hex TEXT NOT NULL,
    drift_count INTEGER NOT NULL DEFAULT 0,
    last_checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cangrejo_radar_alerts (
    id TEXT PRIMARY KEY,
    watch_id TEXT NOT NULL,
    target_value TEXT NOT NULL,
    severity TEXT NOT NULL,
    added_json TEXT NOT NULL,
    removed_json TEXT NOT NULL,
    baseline_digest_hex TEXT NOT NULL,
    current_digest_hex TEXT NOT NULL,
    detected_at INTEGER NOT NULL
);

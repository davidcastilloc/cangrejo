import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { D1SchemaRunner } from './D1SchemaRunner.js';

const getDefaultLicenseHmacSecret = (): string =>
  (typeof process !== 'undefined' && process.env?.CANGREJO_LICENSE_SECRET) ||
  'cangrejo-oro-hmac-sha256-master-secret-2026';

export interface SignedLicenseClaims {
  tier: CangrejoEditionTier;
  organizationName: string;
  badgeTitle: string;
  credits: number;
  issuedAt: number;
  expiresAt: number;
  tenantId?: string;
}

export interface CangrejoUserAccount {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: 'OWNER' | 'ADMIN' | 'ANALYST';
  status: 'active' | 'suspended';
  createdAt: number;
  lastLoginAt: number;
}

export interface CangrejoClientOrganization {
  tenantId: string;
  organizationName: string;
  tier: CangrejoEditionTier;
  creditsRemaining: number;
  maxActiveMcpSessions: number;
  maxEntitiesPerSession: number;
  licenseKeyMasked: string | null;
  createdAt: number;
}

export interface CangrejoMcpSessionSummary {
  sessionId: string;
  rawSessionId: string;
  title: string;
  caseTier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
  status: string;
  lastSeq: number;
  expiresAt: number;
  hasDedicatedToken: boolean;
}

export interface CangrejoAuthenticatedAccountResult {
  user: CangrejoUserAccount;
  client: CangrejoClientOrganization;
  authToken: string;
  licenseToken: string;
  mcpSessions: CangrejoMcpSessionSummary[];
}

export interface RadarWatchRecord {
  id: string;
  targetValue: string;
  entityType: string;
  expedienteId: string;
  baselineIndicators: string[];
  baselineDigestHex: string;
  lastCheckedAt: number;
  driftCount: number;
}

export interface RadarDriftAlertRecord {
  id: string;
  watchId: string;
  targetValue: string;
  severity: 'CRITICO' | 'ALTO' | 'INFO';
  addedIndicators: string[];
  removedIndicators: string[];
  baselineDigestHex: string;
  currentDigestHex: string;
  detectedAt: number;
}

export interface ProviderKeySummary {
  provider: string;
  maskedKey: string;
  updatedAt: number;
}

export interface ExpedienteRecord {
  id: string;
  title: string;
  caseTier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
  entityCount: number;
  linkCount: number;
  cgrjPayload: string;
  updatedAt: number;
}

export interface PesquisaAuditEntry {
  id: string;
  transformId: string;
  targetValue: string;
  discoveredCount: number;
  elapsedMs: number;
  createdAt: number;
}

export type CangrejoEditionTier = 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';

export interface CangrejoEditionState {
  editionTier: CangrejoEditionTier;
  editionLabel: string;
  licenseKeyMasked: string | null;
  creditsRemaining: number;
  creditsTotal: number;
  whiteLabel: {
    organizationName: string;
    badgeTitle: string;
    watermarkEnabled: boolean;
  };
  entitlements: {
    oneClickCloudOsint: boolean;
    whiteLabelDossier: boolean;
    multiAnalystCollab: boolean;
    continuousRadar24x7: boolean;
    maxEntitiesPerExpediente: number;
  };
  updatedAt: number;
}

export interface CloudflareD1PreparedStatementLike {
  bind(...values: unknown[]): CloudflareD1PreparedStatementLike;
  run<T = unknown>(): Promise<{ success?: boolean; results?: T[] }>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
}

export interface CloudflareD1DatabaseLike {
  prepare(query: string): CloudflareD1PreparedStatementLike;
  exec?(query: string): Promise<unknown>;
  batch?<T = unknown>(
    statements: CloudflareD1PreparedStatementLike[]
  ): Promise<Array<{ results?: T[] }>>;
}

export interface CloudflareR2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  customMetadata?: Record<string, string>;
}

export interface CloudflareR2BucketLike {
  put(
    key: string,
    value: Uint8Array | ArrayBuffer | string,
    options?: { customMetadata?: Record<string, string> }
  ): Promise<unknown>;
  get(key: string): Promise<CloudflareR2ObjectBodyLike | null>;
}

export interface McpSessionConsolidatedMeta {
  session_id: string;
  tenant_id: string;
  raw_session_id: string;
  status: string;
  last_seq: number;
  expires_at: number;
  checkpoint_seq: number;
  storage_tier: 'd1_inline' | 'r2_offload' | null;
  snapshot_r2_key: string | null;
  byte_size: number;
  payload_sha256: string | null;
}

export interface McpGraphMutationRow {
  seq: number;
  delta_id: string;
  author_id: string;
  action: string;
  delta_json: string;
}

export const MAX_D1_INLINE_SNAPSHOT_BYTES = 1_500_000;

export async function compressGraphSnapshot(jsonText: string): Promise<Uint8Array> {
  const inputBytes = new TextEncoder().encode(jsonText);
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const readPromise = new Response(cs.readable).arrayBuffer();
    const writer = cs.writable.getWriter();
    await writer.write(inputBytes);
    await writer.close();
    return new Uint8Array(await readPromise);
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.gzipSync(inputBytes));
}

export async function decompressGraphSnapshot(compressedBytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const readPromise = new Response(ds.readable).arrayBuffer();
    const writer = ds.writable.getWriter();
    await writer.write(new Uint8Array(compressedBytes));
    await writer.close();
    const decompressed = new Uint8Array(await readPromise);
    return new TextDecoder().decode(decompressed);
  }
  const zlib = await import('node:zlib');
  return new TextDecoder().decode(zlib.gunzipSync(compressedBytes));
}

interface SqliteStatementLike {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDbLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

function createEdgeMemorySqliteDb(): SqliteDbLike {
  const expedientes = new Map<string, Record<string, unknown>>();
  const audits: Array<Record<string, unknown>> = [];
  const cache = new Map<string, Record<string, unknown>>();
  let editionState: Record<string, unknown> | undefined;
  const providerKeys = new Map<string, Record<string, unknown>>();
  const radarWatches = new Map<string, Record<string, unknown>>();
  const radarAlerts: Array<Record<string, unknown>> = [];

  return {
    exec(): void {},
    close(): void {},
    prepare(sql: string): SqliteStatementLike {
      const norm = sql.replace(/\s+/g, ' ').trim();
      return {
        run(...params: unknown[]): unknown {
          if (norm.startsWith('INSERT INTO cangrejo_expedientes')) {
            const [id, title, case_tier, entity_count, link_count, cgrj_payload, updated_at] = params;
            expedientes.set(String(id), {
              id,
              title,
              case_tier,
              entity_count,
              link_count,
              cgrj_payload,
              updated_at,
            });
          } else if (norm.startsWith('DELETE FROM cangrejo_expedientes')) {
            expedientes.delete(String(params[0]));
          } else if (norm.startsWith('INSERT INTO cangrejo_pesquisa_audit')) {
            const [id, transform_id, target_value, discovered_count, elapsed_ms, created_at] = params;
            audits.unshift({
              id,
              transform_id,
              target_value,
              discovered_count,
              elapsed_ms,
              created_at,
            });
          } else if (norm.startsWith('INSERT INTO cangrejo_pesquisa_cache')) {
            const [cache_key, transform_id, target_value, response_json, expires_at, created_at] =
              params;
            cache.set(String(cache_key), {
              cache_key,
              transform_id,
              target_value,
              response_json,
              expires_at,
              created_at,
            });
          } else if (norm.startsWith('INSERT INTO cangrejo_edition_state')) {
            const [
              edition_tier,
              license_key_masked,
              credits_remaining,
              credits_total,
              organization_name,
              badge_title,
              watermark_enabled,
              updated_at,
            ] = params;
            editionState = {
              edition_tier,
              license_key_masked,
              credits_remaining,
              credits_total,
              organization_name,
              badge_title,
              watermark_enabled,
              updated_at,
            };
          } else if (norm.startsWith('UPDATE cangrejo_edition_state')) {
            const [credits_remaining, updated_at] = params;
            if (editionState) {
              editionState.credits_remaining = credits_remaining;
              editionState.updated_at = updated_at;
            }
          } else if (norm.startsWith('INSERT INTO cangrejo_provider_keys')) {
            const [provider, api_key, updated_at] = params;
            providerKeys.set(String(provider), { provider, api_key, updated_at });
          } else if (norm.startsWith('INSERT INTO cangrejo_radar_watches')) {
            const [
              id,
              target_value,
              entity_type,
              expediente_id,
              baseline_json,
              baseline_digest_hex,
              last_checked_at,
            ] = params;
            const prev = radarWatches.get(String(id));
            radarWatches.set(String(id), {
              id,
              target_value,
              entity_type,
              expediente_id,
              baseline_json,
              baseline_digest_hex,
              drift_count: prev?.drift_count ?? 0,
              last_checked_at,
            });
          } else if (norm.startsWith('UPDATE cangrejo_radar_watches')) {
            const [drift_count, last_checked_at, id] = params;
            const existing = radarWatches.get(String(id));
            if (existing) {
              existing.drift_count = drift_count;
              existing.last_checked_at = last_checked_at;
            }
          } else if (norm.startsWith('INSERT INTO cangrejo_radar_alerts')) {
            const [
              id,
              watch_id,
              target_value,
              severity,
              added_json,
              removed_json,
              baseline_digest_hex,
              current_digest_hex,
              detected_at,
            ] = params;
            radarAlerts.unshift({
              id,
              watch_id,
              target_value,
              severity,
              added_json,
              removed_json,
              baseline_digest_hex,
              current_digest_hex,
              detected_at,
            });
          }
          return undefined;
        },
        get(...params: unknown[]): unknown {
          if (norm.includes('FROM cangrejo_expedientes WHERE id = ?')) {
            return expedientes.get(String(params[0]));
          }
          if (norm.includes('FROM cangrejo_pesquisa_cache WHERE cache_key = ?')) {
            const row = cache.get(String(params[0]));
            if (row && Number(row.expires_at) > Number(params[1])) return row;
            return undefined;
          }
          if (norm.includes('FROM cangrejo_edition_state WHERE singleton_id = 1')) {
            return editionState;
          }
          if (norm.includes('FROM cangrejo_provider_keys WHERE provider = ?')) {
            return providerKeys.get(String(params[0]));
          }
          if (norm.includes('FROM cangrejo_radar_watches WHERE id = ?')) {
            return radarWatches.get(String(params[0]));
          }
          return undefined;
        },
        all(...params: unknown[]): unknown[] {
          if (norm.includes('FROM cangrejo_expedientes')) {
            return Array.from(expedientes.values()).sort(
              (a, b) => Number(b.updated_at) - Number(a.updated_at)
            );
          }
          if (norm.includes('FROM cangrejo_pesquisa_audit')) {
            return audits.slice(0, Number(params[0] ?? 25));
          }
          if (norm.includes('FROM cangrejo_provider_keys')) {
            return Array.from(providerKeys.values());
          }
          if (norm.includes('FROM cangrejo_radar_watches')) {
            return Array.from(radarWatches.values());
          }
          if (norm.includes('FROM cangrejo_radar_alerts')) {
            return radarAlerts.slice(0, Number(params[0] ?? 25));
          }
          return [];
        },
      };
    },
  };
}

function openNativeSqlite(dbPath: string): { db: SqliteDbLike; engine: 'bun:sqlite' | 'node:sqlite' } {
  try {
    const req = createRequire(
      typeof import.meta !== 'undefined' && typeof import.meta.url === 'string'
        ? import.meta.url
        : 'file:///index.js'
    );
    const isBun = typeof globalThis !== 'undefined' && 'Bun' in globalThis;
    if (isBun) {
      try {
        const bunSqlite = req('bun:sqlite') as {
          Database: new (filename: string) => SqliteDbLike;
        };
        return {
          db: new bunSqlite.Database(dbPath),
          engine: 'bun:sqlite',
        };
      } catch {
        // Fallback to node:sqlite if bun:sqlite fails to load
      }
    }
    const nodeSqlite = req('node:sqlite') as {
      DatabaseSync: new (filename: string) => SqliteDbLike;
    };
    return {
      db: new nodeSqlite.DatabaseSync(dbPath),
      engine: 'node:sqlite',
    };
  } catch {
    return {
      db: createEdgeMemorySqliteDb(),
      engine: 'node:sqlite',
    };
  }
}

/**
 * Polymorphic normalizer for Expediente metadata inputs.
 * Never assumes whether `rawTitleOrMeta` is a primitive string or a dictionary object.
 */
function normalizeExpedienteMeta(rawTitleOrMeta: unknown): {
  title: string;
  caseTier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
} {
  if (typeof rawTitleOrMeta === 'string' && rawTitleOrMeta.trim().length > 0) {
    return { title: rawTitleOrMeta.trim(), caseTier: 'ORO' };
  }
  if (typeof rawTitleOrMeta === 'object' && rawTitleOrMeta !== null) {
    const record = rawTitleOrMeta as Record<string, unknown>;
    const rawTitle =
      typeof record.title === 'string'
        ? record.title
        : typeof record.name === 'string'
          ? record.name
          : 'Expediente Cangrejo';
    const rawTier = typeof record.caseTier === 'string' ? record.caseTier.toUpperCase() : 'ORO';
    const validTier =
      rawTier === 'PLATINO' || rawTier === 'ORO' || rawTier === 'PLATA' || rawTier === 'BRONCE'
        ? rawTier
        : 'ORO';
    return { title: rawTitle, caseTier: validTier };
  }
  return { title: 'Expediente Cangrejo', caseTier: 'ORO' };
}

/**
 * Native `bun:sqlite` / Cloudflare D1 Vault Persistence Engine (`BunSqliteVault`).
 * Shares `0001_initial_schema.sql` with Cloudflare D1 and provides high-speed local SQLite storage
 * for Forensic Expedientes and Pesquisa OSINT execution telemetry.
 */
export class BunSqliteVault {
  public readonly db: SqliteDbLike;
  public readonly engine: 'bun:sqlite' | 'node:sqlite';
  public readonly dbPath: string;

  /**
   * Resolves the SQLite database path from `CANGREJO_SQLITE_PATH` environment variable,
   * defaulting to `:memory:` when unset (e.g., in unit tests or stateless edge isolates).
   */
  public static resolveDefaultDbPath(
    env: Record<string, string | undefined> | undefined = typeof process !== 'undefined'
      ? process.env
      : undefined
  ): string {
    const raw = env?.CANGREJO_SQLITE_PATH;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : ':memory:';
  }

  public constructor(dbPath = ':memory:') {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:' && !dbPath.startsWith('file:')) {
      try {
        const parentDir = path.dirname(path.resolve(dbPath));
        if (typeof fs?.mkdirSync === 'function' && !fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      } catch {
        // Ignore directory creation errors in restricted runtimes
      }
    }
    const opened = openNativeSqlite(dbPath);
    this.db = opened.db;
    this.engine = opened.engine;
    if (dbPath !== ':memory:') {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
      } catch {
        // Ignore if WAL is unsupported in fallback memory engine
      }
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA recursive_triggers = ON;');
    this.initializeVaultTables();
  }

  private initializeVaultTables(): void {
    try {
      const sqlPath = D1SchemaRunner.getMigrationSqlPath();
      if (typeof fs?.existsSync === 'function' && fs.existsSync(sqlPath)) {
        const baseSql = fs.readFileSync(sqlPath, 'utf8');
        this.db.exec(baseSql);
      }
    } catch {
      // Edge runtime (Cloudflare Workers workerd) does not expose host filesystem
    }

    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS cangrejo_tenant_metadata (
        tenant_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'COMMUNITY'
          CHECK (tier IN ('COMMUNITY', 'ORO_PRO', 'PLATINO_ENTERPRISE')),
        license_key_masked TEXT,
        license_signature_hash TEXT,
        organization_name TEXT NOT NULL,
        max_active_mcp_sessions INTEGER NOT NULL DEFAULT 5,
        max_entities_per_session INTEGER NOT NULL DEFAULT 25000,
        credits_remaining INTEGER NOT NULL DEFAULT 0,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_tenant_tier ON cangrejo_tenant_metadata(tier);

      CREATE TABLE IF NOT EXISTS cangrejo_mcp_sessions (
        session_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
        raw_session_id TEXT NOT NULL,
        user_id TEXT,
        session_token_hash TEXT,
        title TEXT NOT NULL DEFAULT 'Expediente MCP',
        case_tier TEXT NOT NULL DEFAULT 'ORO'
          CHECK (case_tier IN ('PLATINO', 'ORO', 'PLATA', 'BRONCE')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'idle', 'closed', 'revoked')),
        last_seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_active_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL,
        CONSTRAINT uq_tenant_raw_session UNIQUE (tenant_id, raw_session_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_session_token
        ON cangrejo_mcp_sessions(session_token_hash)
        WHERE session_token_hash IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_mcp_session_tenant
        ON cangrejo_mcp_sessions(tenant_id, status);

      CREATE INDEX IF NOT EXISTS idx_mcp_session_expires
        ON cangrejo_mcp_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS cangrejo_session_graphs (
        session_id TEXT PRIMARY KEY REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
        checkpoint_seq INTEGER NOT NULL DEFAULT 0,
        node_count INTEGER NOT NULL DEFAULT 0,
        edge_count INTEGER NOT NULL DEFAULT 0,
        storage_tier TEXT NOT NULL DEFAULT 'd1_inline'
          CHECK (storage_tier IN ('d1_inline', 'r2_offload')),
        compression_codec TEXT NOT NULL DEFAULT 'gzip'
          CHECK (compression_codec IN ('gzip', 'cgrx', 'none')),
        snapshot_payload BLOB,
        snapshot_r2_key TEXT,
        byte_size INTEGER NOT NULL DEFAULT 0,
        payload_sha256 TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS cangrejo_graph_mutations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        delta_id TEXT NOT NULL,
        author_id TEXT NOT NULL DEFAULT 'mcp-agent',
        action TEXT NOT NULL
          CHECK (action IN ('upsert', 'remove', 'clear', 'paste_iocs', 'delta', 'layout', 'undo', 'redo')),
        delta_json TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CONSTRAINT uq_session_seq UNIQUE (session_id, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_mutations_created_at
        ON cangrejo_graph_mutations(created_at);

      CREATE TRIGGER IF NOT EXISTS trg_tenant_metadata_updated_at
      AFTER UPDATE ON cangrejo_tenant_metadata
      FOR EACH ROW
      WHEN OLD.updated_at = NEW.updated_at AND unixepoch() != OLD.updated_at
      BEGIN
        UPDATE cangrejo_tenant_metadata SET updated_at = unixepoch() WHERE tenant_id = OLD.tenant_id;
      END;

      CREATE TABLE IF NOT EXISTS cangrejo_users (
        user_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'OWNER'
          CHECK (role IN ('OWNER', 'ADMIN', 'ANALYST')),
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'suspended')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_login_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_users_tenant
        ON cangrejo_users(tenant_id, status);

      CREATE TABLE IF NOT EXISTS cangrejo_auth_sessions (
        auth_session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES cangrejo_users(user_id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
        ON cangrejo_auth_sessions(user_id, expires_at);
    `);
  }

  /**
   * Persists or updates a forensic Expediente graph in SQLite.
   */
  public saveExpediente(params: {
    id: string;
    titleOrMeta: unknown;
    entityCount: number;
    linkCount: number;
    cgrjPayload: Record<string, unknown> | string;
  }): ExpedienteRecord {
    const { title, caseTier } = normalizeExpedienteMeta(params.titleOrMeta);
    const serialized =
      typeof params.cgrjPayload === 'string'
        ? params.cgrjPayload
        : JSON.stringify(params.cgrjPayload);
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO cangrejo_expedientes (id, title, case_tier, entity_count, link_count, cgrj_payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        case_tier = excluded.case_tier,
        entity_count = excluded.entity_count,
        link_count = excluded.link_count,
        cgrj_payload = excluded.cgrj_payload,
        updated_at = excluded.updated_at
    `);
    stmt.run(params.id, title, caseTier, params.entityCount, params.linkCount, serialized, now);

    return {
      id: params.id,
      title,
      caseTier,
      entityCount: params.entityCount,
      linkCount: params.linkCount,
      cgrjPayload: serialized,
      updatedAt: now,
    };
  }

  /**
   * Retrieves a saved Expediente by ID.
   */
  public getExpediente(id: string): ExpedienteRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, title, case_tier, entity_count, link_count, cgrj_payload, updated_at
      FROM cangrejo_expedientes
      WHERE id = ?
    `);
    const row = stmt.get(id) as
      | {
          id: string;
          title: string;
          case_tier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
          entity_count: number;
          link_count: number;
          cgrj_payload: string;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      caseTier: row.case_tier,
      entityCount: row.entity_count,
      linkCount: row.link_count,
      cgrjPayload: row.cgrj_payload,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Lists all saved Expedientes ordered by most recently updated.
   */
  public listExpedientes(): Array<Omit<ExpedienteRecord, 'cgrjPayload'>> {
    const stmt = this.db.prepare(`
      SELECT id, title, case_tier, entity_count, link_count, updated_at
      FROM cangrejo_expedientes
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all() as Array<{
      id: string;
      title: string;
      case_tier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
      entity_count: number;
      link_count: number;
      updated_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      caseTier: r.case_tier,
      entityCount: r.entity_count,
      linkCount: r.link_count,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Deletes a saved Expediente from SQLite by ID.
   */
  public deleteExpediente(id: string): boolean {
    const cleanId = id.trim();
    if (!cleanId) return false;
    const existing = this.getExpediente(cleanId);
    if (!existing) return false;
    const stmt = this.db.prepare(`DELETE FROM cangrejo_expedientes WHERE id = ?`);
    stmt.run(cleanId);
    return true;
  }

  /**
   * Records a secondary Pesquisa OSINT execution telemetry entry with graceful degradation.
   * Never throws or aborts a primary transform execution if telemetry storage fails.
   */
  public recordPesquisaAuditSafe(entry: Omit<PesquisaAuditEntry, 'createdAt'>): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO cangrejo_pesquisa_audit (id, transform_id, target_value, discovered_count, elapsed_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        entry.id,
        entry.transformId,
        entry.targetValue,
        entry.discoveredCount,
        entry.elapsedMs,
        Date.now()
      );
      return true;
    } catch (err) {
      console.error('[BunSqliteVault] Secondary audit enrichment failed gracefully:', err);
      return false;
    }
  }

  public listPesquisaAudits(limit = 25): PesquisaAuditEntry[] {
    const stmt = this.db.prepare(`
      SELECT id, transform_id, target_value, discovered_count, elapsed_ms, created_at
      FROM cangrejo_pesquisa_audit
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: string;
      transform_id: string;
      target_value: string;
      discovered_count: number;
      elapsed_ms: number;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      transformId: r.transform_id,
      targetValue: r.target_value,
      discoveredCount: r.discovered_count,
      elapsedMs: r.elapsed_ms,
      createdAt: r.created_at,
    }));
  }

  public static buildPesquisaCacheKey(transformId: string, targetValue: string): string {
    return `${transformId.trim().toLowerCase()}::${targetValue.trim().toLowerCase()}`;
  }

  /**
   * Retrieves a non-expired OSINT Pesquisa response from the local SQLite TTL cache.
   * Degrades gracefully to `null` if the table is unavailable or JSON parsing fails.
   */
  public getCachedPesquisa(
    transformId: string,
    targetValue: string
  ): Record<string, unknown> | null {
    try {
      const cacheKey = BunSqliteVault.buildPesquisaCacheKey(transformId, targetValue);
      const stmt = this.db.prepare(`
        SELECT response_json
        FROM cangrejo_pesquisa_cache
        WHERE cache_key = ? AND expires_at > ?
      `);
      const row = stmt.get(cacheKey, Date.now()) as { response_json: string } | undefined;
      if (!row || typeof row.response_json !== 'string') {
        return null;
      }
      const parsed = JSON.parse(row.response_json) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Stores an OSINT Pesquisa response in the local SQLite TTL cache (default TTL: 5 minutes).
   * Never throws if SQLite is read-only or busy.
   */
  public setCachedPesquisaSafe(
    transformId: string,
    targetValue: string,
    responsePayload: Record<string, unknown>,
    ttlMs = 300_000
  ): boolean {
    try {
      const cacheKey = BunSqliteVault.buildPesquisaCacheKey(transformId, targetValue);
      const now = Date.now();
      const expiresAt = now + Math.max(1_000, ttlMs);
      const stmt = this.db.prepare(`
        INSERT INTO cangrejo_pesquisa_cache (cache_key, transform_id, target_value, response_json, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          response_json = excluded.response_json,
          expires_at = excluded.expires_at,
          created_at = excluded.created_at
      `);
      stmt.run(
        cacheKey,
        transformId.trim(),
        targetValue.trim(),
        JSON.stringify(responsePayload),
        expiresAt,
        now
      );
      return true;
    } catch (err) {
      console.error('[BunSqliteVault] Secondary cache persistence failed gracefully:', err);
      return false;
    }
  }

  private static computeEntitlementsForTier(tier: CangrejoEditionTier): CangrejoEditionState['entitlements'] {
    if (tier === 'PLATINO_ENTERPRISE') {
      return {
        oneClickCloudOsint: true,
        whiteLabelDossier: true,
        multiAnalystCollab: true,
        continuousRadar24x7: true,
        maxEntitiesPerExpediente: 100_000,
      };
    }
    if (tier === 'ORO_PRO') {
      return {
        oneClickCloudOsint: true,
        whiteLabelDossier: true,
        multiAnalystCollab: false,
        continuousRadar24x7: false,
        maxEntitiesPerExpediente: 25_000,
      };
    }
    return {
      oneClickCloudOsint: false,
      whiteLabelDossier: false,
      multiAnalystCollab: false,
      continuousRadar24x7: false,
      maxEntitiesPerExpediente: 500,
    };
  }

  private static computeEditionLabel(tier: CangrejoEditionTier): string {
    if (tier === 'PLATINO_ENTERPRISE') return 'Cangrejo de Platino — Enterprise & Cloud';
    if (tier === 'ORO_PRO') return 'Cangrejo de Oro — Investigator Pro';
    return 'Cangrejo Community Edition (Open-Core Apache-2.0)';
  }

  /**
   * Retrieves the current Odoo-style Open-Core Edition state (`COMMUNITY` vs `ORO_PRO` vs `PLATINO_ENTERPRISE`).
   */
  public getEditionState(): CangrejoEditionState {
    try {
      const stmt = this.db.prepare(`
        SELECT edition_tier, license_key_masked, credits_remaining, credits_total,
               organization_name, badge_title, watermark_enabled, updated_at
        FROM cangrejo_edition_state
        WHERE singleton_id = 1
      `);
      const row = stmt.get() as
        | {
            edition_tier: string;
            license_key_masked: string | null;
            credits_remaining: number;
            credits_total: number;
            organization_name: string;
            badge_title: string;
            watermark_enabled: number;
            updated_at: number;
          }
        | undefined;

      if (row) {
        const tier: CangrejoEditionTier =
          row.edition_tier === 'PLATINO_ENTERPRISE' || row.edition_tier === 'ORO_PRO'
            ? row.edition_tier
            : 'COMMUNITY';
        return {
          editionTier: tier,
          editionLabel: BunSqliteVault.computeEditionLabel(tier),
          licenseKeyMasked: row.license_key_masked ?? null,
          creditsRemaining: row.credits_remaining,
          creditsTotal: row.credits_total,
          whiteLabel: {
            organizationName: row.organization_name,
            badgeTitle: row.badge_title,
            watermarkEnabled: row.watermark_enabled !== 0,
          },
          entitlements: BunSqliteVault.computeEntitlementsForTier(tier),
          updatedAt: row.updated_at,
        };
      }
    } catch {
      // Fallback to default COMMUNITY state
    }

    return {
      editionTier: 'COMMUNITY',
      editionLabel: BunSqliteVault.computeEditionLabel('COMMUNITY'),
      licenseKeyMasked: null,
      creditsRemaining: 0,
      creditsTotal: 0,
      whiteLabel: {
        organizationName: 'CANGREJO — Unidad de Criminalística Digital & OSINT',
        badgeTitle: 'CANGREJO COMMUNITY EDITION',
        watermarkEnabled: true,
      },
      entitlements: BunSqliteVault.computeEntitlementsForTier('COMMUNITY'),
      updatedAt: Date.now(),
    };
  }

  /**
   * Issues an HMAC-SHA256 cryptographically signed commercial license token:
   * `CGRJ.<TIER>.<base64urlClaims>.<hmacHex>`
   */
  public static issueSignedLicenseToken(params: {
    tier: CangrejoEditionTier;
    organizationName: string;
    badgeTitle?: string;
    credits?: number;
    ttlMs?: number;
    secret?: string;
    tenantId?: string;
  }): string {
    const secret = params.secret ?? getDefaultLicenseHmacSecret();
    const now = Date.now();
    const defaultCredits =
      params.tier === 'PLATINO_ENTERPRISE' ? 5_000 : params.tier === 'ORO_PRO' ? 500 : 0;
    const claims: SignedLicenseClaims = {
      tier: params.tier,
      organizationName: params.organizationName.trim(),
      badgeTitle:
        params.badgeTitle?.trim() ||
        (params.tier === 'PLATINO_ENTERPRISE'
          ? 'EXPEDIENTE PERICIAL CERTIFICADO — PLATINO ENTERPRISE'
          : 'EXPEDIENTE PERICIAL — CANGREJO DE ORO PRO'),
      credits: params.credits ?? defaultCredits,
      issuedAt: now,
      expiresAt: now + (params.ttlMs ?? 365 * 24 * 60 * 60 * 1000),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    };
    const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signingInput = `CGRJ.${params.tier}.${payloadB64}`;
    const hmacHex = crypto.createHmac('sha256', secret).update(signingInput).digest('hex');
    return `${signingInput}.${hmacHex}`;
  }

  /**
   * Verifies an HMAC-SHA256 signed license token (`CGRJ.<TIER>.<base64urlClaims>.<hmacHex>`)
   * using constant-time comparison (`crypto.timingSafeEqual`).
   */
  public static verifySignedLicenseToken(
    token: string,
    secret = getDefaultLicenseHmacSecret()
  ): { valid: boolean; reason?: string; claims?: SignedLicenseClaims } {
    const parts = token.trim().split('.');
    if (parts.length !== 4 || parts[0] !== 'CGRJ') {
      return { valid: false, reason: 'Not a 4-part CGRJ signed token.' };
    }
    const [, tierPart, payloadB64, signatureHex] = parts;
    const signingInput = `CGRJ.${tierPart}.${payloadB64}`;
    const expectedHex = crypto.createHmac('sha256', secret).update(signingInput).digest('hex');

    const sigBuf = Buffer.from(signatureHex, 'utf8');
    const expBuf = Buffer.from(expectedHex, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return {
        valid: false,
        reason: 'HMAC-SHA256 license signature verification failed (tampered token).',
      };
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8')
      ) as SignedLicenseClaims;
      if (typeof decoded.expiresAt === 'number' && decoded.expiresAt < Date.now()) {
        return { valid: false, reason: 'Signed license token has expired.' };
      }
      return { valid: true, claims: decoded };
    } catch {
      return { valid: false, reason: 'Malformed signed license claims payload.' };
    }
  }

  /**
   * Polymorphically activates a Pro/Enterprise license key or updates White-Label branding.
   * Strictly verifies HMAC-SHA256 signatures when given a `CGRJ.<TIER>.<payload>.<sig>` token,
   * while supporting local demo activation keys (`CGRJ-PLATINO-...`, `CGRJ-ORO-...`).
   */
  public activateLicenseOrUpdateEdition(rawInput: unknown): CangrejoEditionState {
    let rawKey = '';
    let requestedTier: CangrejoEditionTier | null = null;
    let orgName: string | undefined;
    let badgeTitle: string | undefined;
    let signedCreditsOverride: number | undefined;

    if (typeof rawInput === 'string') {
      rawKey = rawInput.trim();
    } else if (typeof rawInput === 'object' && rawInput !== null) {
      const rec = rawInput as Record<string, unknown>;
      if (typeof rec.licenseKey === 'string') rawKey = rec.licenseKey.trim();
      if (
        rec.tier === 'COMMUNITY' ||
        rec.tier === 'ORO_PRO' ||
        rec.tier === 'PLATINO_ENTERPRISE'
      ) {
        requestedTier = rec.tier;
      }
      if (typeof rec.organizationName === 'string' && rec.organizationName.trim().length > 0) {
        orgName = rec.organizationName.trim();
      }
      if (typeof rec.badgeTitle === 'string' && rec.badgeTitle.trim().length > 0) {
        badgeTitle = rec.badgeTitle.trim();
      }
    }

    // If the key is formatted as a 4-segment cryptographic token (CGRJ.<TIER>.<payload>.<sig>), verify HMAC
    if (rawKey.startsWith('CGRJ.')) {
      const verified = BunSqliteVault.verifySignedLicenseToken(rawKey);
      if (!verified.valid || !verified.claims) {
        throw new Error(verified.reason ?? 'Invalid signed CGRJ license token.');
      }
      requestedTier = verified.claims.tier;
      orgName = orgName ?? verified.claims.organizationName;
      badgeTitle = badgeTitle ?? verified.claims.badgeTitle;
      signedCreditsOverride = verified.claims.credits;
    }

    const upperKey = rawKey.toUpperCase();
    let targetTier: CangrejoEditionTier = requestedTier ?? 'COMMUNITY';
    if (!requestedTier) {
      if (upperKey.startsWith('CGRJ-PLATINO') || upperKey.includes('ENTERPRISE')) {
        targetTier = 'PLATINO_ENTERPRISE';
      } else if (upperKey.startsWith('CGRJ-ORO') || upperKey.includes('PRO')) {
        targetTier = 'ORO_PRO';
      } else {
        targetTier = 'COMMUNITY';
      }
    }

    const creditsTotal =
      signedCreditsOverride ??
      (targetTier === 'PLATINO_ENTERPRISE' ? 5_000 : targetTier === 'ORO_PRO' ? 500 : 0);
    const creditsRemaining = creditsTotal;
    const watermarkEnabled = targetTier === 'COMMUNITY' ? 1 : 0;
    const maskedKey =
      targetTier === 'COMMUNITY'
        ? null
        : rawKey.length >= 8
          ? `${rawKey.slice(0, 12)}••••${rawKey.slice(-4)}`
          : `CGRJ-${targetTier}-ACTIVE`;

    const finalOrgName =
      orgName ??
      (targetTier === 'COMMUNITY'
        ? 'CANGREJO — Unidad de Criminalística Digital & OSINT'
        : 'Unidad Especial de Inteligencia Forense & CTI (Enterprise)');
    const finalBadgeTitle =
      badgeTitle ??
      (targetTier === 'PLATINO_ENTERPRISE'
        ? 'EXPEDIENTE PERICIAL CERTIFICADO — PLATINO ENTERPRISE'
        : targetTier === 'ORO_PRO'
          ? 'EXPEDIENTE PERICIAL — CANGREJO DE ORO PRO'
          : 'CANGREJO COMMUNITY EDITION');

    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO cangrejo_edition_state (
        singleton_id, edition_tier, license_key_masked, credits_remaining, credits_total,
        organization_name, badge_title, watermark_enabled, updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        edition_tier = excluded.edition_tier,
        license_key_masked = excluded.license_key_masked,
        credits_remaining = excluded.credits_remaining,
        credits_total = excluded.credits_total,
        organization_name = excluded.organization_name,
        badge_title = excluded.badge_title,
        watermark_enabled = excluded.watermark_enabled,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      targetTier,
      maskedKey,
      creditsRemaining,
      creditsTotal,
      finalOrgName,
      finalBadgeTitle,
      watermarkEnabled,
      now
    );

    return this.getEditionState();
  }

  /**
   * Consumes OSINT Cloud credits when operating in `ORO_PRO` or `PLATINO_ENTERPRISE` mode.
   * Never throws or blocks transform execution if SQLite is busy.
   */
  public consumeOsintCreditsSafe(cost = 1): CangrejoEditionState {
    try {
      const current = this.getEditionState();
      if (current.editionTier !== 'COMMUNITY' && current.creditsRemaining > 0) {
        const nextCredits = Math.max(0, current.creditsRemaining - Math.max(1, cost));
        const stmt = this.db.prepare(`
          UPDATE cangrejo_edition_state
          SET credits_remaining = ?, updated_at = ?
          WHERE singleton_id = 1
        `);
        stmt.run(nextCredits, Date.now());
      }
    } catch (err) {
      console.error('[BunSqliteVault] Secondary credit deduction failed gracefully:', err);
    }
    return this.getEditionState();
  }

  /**
   * Stores a BYOK (Bring Your Own Key) OSINT provider API key in SQLite (`shodan`, `virustotal`, `abuseipdb`, etc.).
   */
  public setProviderApiKey(provider: string, apiKey: string): ProviderKeySummary {
    const cleanProvider = provider.trim().toLowerCase();
    const cleanKey = apiKey.trim();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO cangrejo_provider_keys (provider, api_key, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        api_key = excluded.api_key,
        updated_at = excluded.updated_at
    `);
    stmt.run(cleanProvider, cleanKey, now);

    const maskedKey =
      cleanKey.length >= 8
        ? `${cleanKey.slice(0, 4)}••••${cleanKey.slice(-4)}`
        : `${cleanKey.slice(0, 2)}••••`;

    return {
      provider: cleanProvider,
      maskedKey,
      updatedAt: now,
    };
  }

  public getProviderApiKey(provider: string): string | null {
    try {
      const stmt = this.db.prepare(`
        SELECT api_key FROM cangrejo_provider_keys WHERE provider = ?
      `);
      const row = stmt.get(provider.trim().toLowerCase()) as { api_key: string } | undefined;
      return row?.api_key ?? null;
    } catch {
      return null;
    }
  }

  public listConfiguredProviders(): ProviderKeySummary[] {
    try {
      const stmt = this.db.prepare(`
        SELECT provider, api_key, updated_at
        FROM cangrejo_provider_keys
        ORDER BY provider ASC
      `);
      const rows = stmt.all() as Array<{ provider: string; api_key: string; updated_at: number }>;
      return rows.map((r) => ({
        provider: r.provider,
        maskedKey:
          r.api_key.length >= 8
            ? `${r.api_key.slice(0, 4)}••••${r.api_key.slice(-4)}`
            : `${r.api_key.slice(0, 2)}••••`,
        updatedAt: r.updated_at,
      }));
    } catch {
      return [];
    }
  }

  private static computeIndicatorSetDigest(indicators: string[]): {
    normalized: string[];
    digestHex: string;
  } {
    const normalized = Array.from(
      new Set(indicators.map((item) => item.trim().toLowerCase()).filter(Boolean))
    ).sort();
    const digestHex = crypto
      .createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
    return { normalized, digestHex };
  }

  /**
   * Registers or updates a 24/7 Radar Cangrejo continuous infrastructure watch.
   */
  public upsertRadarWatch(params: {
    id?: string;
    targetValue: string;
    entityType?: string;
    expedienteId?: string;
    baselineIndicators: string[];
  }): RadarWatchRecord {
    const id =
      params.id?.trim() ||
      `watch-${params.targetValue.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '-')}`;
    const targetValue = params.targetValue.trim();
    const entityType = params.entityType?.trim() || 'maltego.Domain';
    const expedienteId = params.expedienteId?.trim() || 'expediente-apt29';
    const { normalized, digestHex } = BunSqliteVault.computeIndicatorSetDigest(
      params.baselineIndicators
    );
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO cangrejo_radar_watches (
        id, target_value, entity_type, expediente_id, baseline_json, baseline_digest_hex, drift_count, last_checked_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        target_value = excluded.target_value,
        entity_type = excluded.entity_type,
        expediente_id = excluded.expediente_id,
        baseline_json = excluded.baseline_json,
        baseline_digest_hex = excluded.baseline_digest_hex,
        last_checked_at = excluded.last_checked_at
    `);
    stmt.run(
      id,
      targetValue,
      entityType,
      expedienteId,
      JSON.stringify(normalized),
      digestHex,
      now
    );

    return {
      id,
      targetValue,
      entityType,
      expedienteId,
      baselineIndicators: normalized,
      baselineDigestHex: digestHex,
      lastCheckedAt: now,
      driftCount: 0,
    };
  }

  public listRadarWatches(): RadarWatchRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, target_value, entity_type, expediente_id, baseline_json, baseline_digest_hex, drift_count, last_checked_at
      FROM cangrejo_radar_watches
      ORDER BY last_checked_at DESC
    `);
    const rows = stmt.all() as Array<{
      id: string;
      target_value: string;
      entity_type: string;
      expediente_id: string;
      baseline_json: string;
      baseline_digest_hex: string;
      drift_count: number;
      last_checked_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      targetValue: r.target_value,
      entityType: r.entity_type,
      expedienteId: r.expediente_id,
      baselineIndicators: JSON.parse(r.baseline_json) as string[],
      baselineDigestHex: r.baseline_digest_hex,
      driftCount: r.drift_count,
      lastCheckedAt: r.last_checked_at,
    }));
  }

  /**
   * Evaluates a watched indicator against newly observed DNS/CT/IP records and records a forensic drift alert if infrastructure changed.
   */
  public evaluateRadarDrift(params: {
    watchId: string;
    observedIndicators: string[];
  }): {
    driftDetected: boolean;
    watch: RadarWatchRecord;
    alert: RadarDriftAlertRecord | null;
  } {
    const watchStmt = this.db.prepare(`
      SELECT id, target_value, entity_type, expediente_id, baseline_json, baseline_digest_hex, drift_count, last_checked_at
      FROM cangrejo_radar_watches
      WHERE id = ?
    `);
    const row = watchStmt.get(params.watchId) as
      | {
          id: string;
          target_value: string;
          entity_type: string;
          expediente_id: string;
          baseline_json: string;
          baseline_digest_hex: string;
          drift_count: number;
          last_checked_at: number;
        }
      | undefined;

    if (!row) {
      throw new Error(`Radar watch "${params.watchId}" not found.`);
    }

    const baselineSet = new Set<string>(JSON.parse(row.baseline_json) as string[]);
    const { normalized: currentNormalized, digestHex: currentDigestHex } =
      BunSqliteVault.computeIndicatorSetDigest(params.observedIndicators);
    const currentSet = new Set<string>(currentNormalized);

    const addedIndicators = currentNormalized.filter((item) => !baselineSet.has(item));
    const removedIndicators = Array.from(baselineSet).filter((item) => !currentSet.has(item));
    const driftDetected =
      currentDigestHex !== row.baseline_digest_hex &&
      (addedIndicators.length > 0 || removedIndicators.length > 0);
    const now = Date.now();
    const nextDriftCount = driftDetected ? row.drift_count + 1 : row.drift_count;

    const updateStmt = this.db.prepare(`
      UPDATE cangrejo_radar_watches
      SET drift_count = ?, last_checked_at = ?
      WHERE id = ?
    `);
    updateStmt.run(nextDriftCount, now, row.id);

    const updatedWatch: RadarWatchRecord = {
      id: row.id,
      targetValue: row.target_value,
      entityType: row.entity_type,
      expedienteId: row.expediente_id,
      baselineIndicators: Array.from(baselineSet),
      baselineDigestHex: row.baseline_digest_hex,
      driftCount: nextDriftCount,
      lastCheckedAt: now,
    };

    if (!driftDetected) {
      return {
        driftDetected: false,
        watch: updatedWatch,
        alert: null,
      };
    }

    const severity: 'CRITICO' | 'ALTO' | 'INFO' =
      addedIndicators.length > 0 && removedIndicators.length > 0
        ? 'CRITICO'
        : addedIndicators.length > 0
          ? 'ALTO'
          : 'INFO';

    const alert: RadarDriftAlertRecord = {
      id: `alert-${now}-${Math.random().toString(36).slice(2, 7)}`,
      watchId: row.id,
      targetValue: row.target_value,
      severity,
      addedIndicators,
      removedIndicators,
      baselineDigestHex: row.baseline_digest_hex,
      currentDigestHex,
      detectedAt: now,
    };

    const insertAlertStmt = this.db.prepare(`
      INSERT INTO cangrejo_radar_alerts (
        id, watch_id, target_value, severity, added_json, removed_json, baseline_digest_hex, current_digest_hex, detected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAlertStmt.run(
      alert.id,
      alert.watchId,
      alert.targetValue,
      alert.severity,
      JSON.stringify(alert.addedIndicators),
      JSON.stringify(alert.removedIndicators),
      alert.baselineDigestHex,
      alert.currentDigestHex,
      alert.detectedAt
    );

    return {
      driftDetected: true,
      watch: updatedWatch,
      alert,
    };
  }

  public listRadarAlerts(limit = 25): RadarDriftAlertRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, watch_id, target_value, severity, added_json, removed_json, baseline_digest_hex, current_digest_hex, detected_at
      FROM cangrejo_radar_alerts
      ORDER BY detected_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: string;
      watch_id: string;
      target_value: string;
      severity: 'CRITICO' | 'ALTO' | 'INFO';
      added_json: string;
      removed_json: string;
      baseline_digest_hex: string;
      current_digest_hex: string;
      detected_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      watchId: r.watch_id,
      targetValue: r.target_value,
      severity: r.severity,
      addedIndicators: JSON.parse(r.added_json) as string[],
      removedIndicators: JSON.parse(r.removed_json) as string[],
      baselineDigestHex: r.baseline_digest_hex,
      currentDigestHex: r.current_digest_hex,
      detectedAt: r.detected_at,
    }));
  }

  private async ensureD1TablesSafe(d1: CloudflareD1DatabaseLike): Promise<void> {
    try {
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_expedientes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            case_tier TEXT NOT NULL DEFAULT 'ORO',
            entity_count INTEGER NOT NULL DEFAULT 0,
            link_count INTEGER NOT NULL DEFAULT 0,
            cgrj_payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_pesquisa_audit (
            id TEXT PRIMARY KEY,
            transform_id TEXT NOT NULL,
            target_value TEXT NOT NULL,
            discovered_count INTEGER NOT NULL DEFAULT 0,
            elapsed_ms REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_pesquisa_cache (
            cache_key TEXT PRIMARY KEY,
            transform_id TEXT NOT NULL,
            target_value TEXT NOT NULL,
            response_json TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_provider_keys (
            provider TEXT PRIMARY KEY,
            api_key TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_radar_watches (
            id TEXT PRIMARY KEY,
            target_value TEXT NOT NULL,
            entity_type TEXT NOT NULL DEFAULT 'maltego.Domain',
            expediente_id TEXT NOT NULL DEFAULT 'expediente-apt29',
            baseline_json TEXT NOT NULL,
            baseline_digest_hex TEXT NOT NULL,
            drift_count INTEGER NOT NULL DEFAULT 0,
            last_checked_at INTEGER NOT NULL
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_radar_alerts (
            id TEXT PRIMARY KEY,
            watch_id TEXT NOT NULL,
            target_value TEXT NOT NULL,
            severity TEXT NOT NULL,
            added_json TEXT NOT NULL,
            removed_json TEXT NOT NULL,
            baseline_digest_hex TEXT NOT NULL,
            current_digest_hex TEXT NOT NULL,
            detected_at INTEGER NOT NULL
          )`
        )
        .run();
    } catch {
      // Ignore schema bootstrap errors on read-only or pre-migrated D1 instances
    }
  }

  /**
   * Persists a saved Expediente to a Cloudflare D1 binding (`env.DB`) when running on Cloudflare Workers.
   */
  public async saveExpedienteToD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    record: ExpedienteRecord
  ): Promise<boolean> {
    if (!d1 || typeof d1.prepare !== 'function') return false;
    try {
      await this.ensureD1TablesSafe(d1);
      await d1
        .prepare(
          `INSERT INTO cangrejo_expedientes (id, title, case_tier, entity_count, link_count, cgrj_payload, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             case_tier = excluded.case_tier,
             entity_count = excluded.entity_count,
             link_count = excluded.link_count,
             cgrj_payload = excluded.cgrj_payload,
             updated_at = excluded.updated_at`
        )
        .bind(
          record.id,
          record.title,
          record.caseTier,
          record.entityCount,
          record.linkCount,
          record.cgrjPayload,
          record.updatedAt
        )
        .run();
      return true;
    } catch (err) {
      console.error('[BunSqliteVault] Cloudflare D1 saveExpediente failed gracefully:', err);
      return false;
    }
  }

  /**
   * Retrieves an Expediente from a Cloudflare D1 binding (`env.DB`) by ID.
   */
  public async getExpedienteFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    id: string
  ): Promise<ExpedienteRecord | null> {
    if (!d1 || typeof d1.prepare !== 'function') return null;
    try {
      await this.ensureD1TablesSafe(d1);
      const row = await d1
        .prepare(
          `SELECT id, title, case_tier, entity_count, link_count, cgrj_payload, updated_at
           FROM cangrejo_expedientes
           WHERE id = ?`
        )
        .bind(id)
        .first<{
          id: string;
          title: string;
          case_tier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
          entity_count: number;
          link_count: number;
          cgrj_payload: string;
          updated_at: number;
        }>();
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        caseTier: row.case_tier,
        entityCount: Number(row.entity_count ?? 0),
        linkCount: Number(row.link_count ?? 0),
        cgrjPayload: row.cgrj_payload,
        updatedAt: Number(row.updated_at ?? Date.now()),
      };
    } catch (err) {
      console.error('[BunSqliteVault] Cloudflare D1 getExpediente failed gracefully:', err);
      return null;
    }
  }

  /**
   * Lists saved Expedientes from a Cloudflare D1 binding (`env.DB`).
   */
  public async listExpedientesFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined
  ): Promise<Array<Omit<ExpedienteRecord, 'cgrjPayload'>> | null> {
    if (!d1 || typeof d1.prepare !== 'function') return null;
    try {
      await this.ensureD1TablesSafe(d1);
      const res = await d1
        .prepare(
          `SELECT id, title, case_tier, entity_count, link_count, updated_at
           FROM cangrejo_expedientes
           ORDER BY updated_at DESC`
        )
        .all<{
          id: string;
          title: string;
          case_tier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
          entity_count: number;
          link_count: number;
          updated_at: number;
        }>();
      const rows = Array.isArray(res?.results) ? res.results : [];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        caseTier: r.case_tier,
        entityCount: Number(r.entity_count ?? 0),
        linkCount: Number(r.link_count ?? 0),
        updatedAt: Number(r.updated_at ?? Date.now()),
      }));
    } catch (err) {
      console.error('[BunSqliteVault] Cloudflare D1 listExpedientes failed gracefully:', err);
      return null;
    }
  }

  /**
   * Deletes an Expediente from a Cloudflare D1 binding (`env.DB`) by ID.
   */
  public async deleteExpedienteFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    id: string
  ): Promise<boolean> {
    if (!d1 || typeof d1.prepare !== 'function') return false;
    try {
      await this.ensureD1TablesSafe(d1);
      await d1
        .prepare(`DELETE FROM cangrejo_expedientes WHERE id = ?`)
        .bind(id.trim())
        .run();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Records a Pesquisa OSINT audit entry to a Cloudflare D1 binding (`env.DB`).
   */
  public async recordPesquisaAuditToD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    entry: Omit<PesquisaAuditEntry, 'createdAt'> & { createdAt?: number }
  ): Promise<boolean> {
    if (!d1 || typeof d1.prepare !== 'function') return false;
    try {
      await this.ensureD1TablesSafe(d1);
      await d1
        .prepare(
          `INSERT INTO cangrejo_pesquisa_audit (id, transform_id, target_value, discovered_count, elapsed_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          entry.id,
          entry.transformId,
          entry.targetValue,
          entry.discoveredCount,
          entry.elapsedMs,
          entry.createdAt ?? Date.now()
        )
        .run();
      return true;
    } catch {
      return false;
    }
  }

  public async getCachedPesquisaFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    transformId: string,
    targetValue: string
  ): Promise<Record<string, unknown> | null> {
    if (!d1 || typeof d1.prepare !== 'function') return null;
    try {
      await this.ensureD1TablesSafe(d1);
      const cacheKey = BunSqliteVault.buildPesquisaCacheKey(transformId, targetValue);
      const row = await d1
        .prepare(
          `SELECT response_json
           FROM cangrejo_pesquisa_cache
           WHERE cache_key = ? AND expires_at > ?`
        )
        .bind(cacheKey, Date.now())
        .first<{ response_json: string }>();
      if (!row || typeof row.response_json !== 'string') return null;
      const parsed = JSON.parse(row.response_json) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  public async setCachedPesquisaToD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    transformId: string,
    targetValue: string,
    responsePayload: Record<string, unknown>,
    ttlMs = 300_000
  ): Promise<boolean> {
    if (!d1 || typeof d1.prepare !== 'function') return false;
    try {
      await this.ensureD1TablesSafe(d1);
      const cacheKey = BunSqliteVault.buildPesquisaCacheKey(transformId, targetValue);
      const now = Date.now();
      const expiresAt = now + Math.max(1_000, ttlMs);
      await d1
        .prepare(
          `INSERT INTO cangrejo_pesquisa_cache (cache_key, transform_id, target_value, response_json, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
             response_json = excluded.response_json,
             expires_at = excluded.expires_at,
             created_at = excluded.created_at`
        )
        .bind(
          cacheKey,
          transformId.trim(),
          targetValue.trim(),
          JSON.stringify(responsePayload),
          expiresAt,
          now
        )
        .run();
      return true;
    } catch {
      return false;
    }
  }

  public async setProviderApiKeyToD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    provider: string,
    apiKey: string
  ): Promise<boolean> {
    if (!d1 || typeof d1.prepare !== 'function') return false;
    try {
      await this.ensureD1TablesSafe(d1);
      await d1
        .prepare(
          `INSERT INTO cangrejo_provider_keys (provider, api_key, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(provider) DO UPDATE SET
             api_key = excluded.api_key,
             updated_at = excluded.updated_at`
        )
        .bind(provider.trim().toLowerCase(), apiKey.trim(), Date.now())
        .run();
      return true;
    } catch {
      return false;
    }
  }

  public async getProviderApiKeyFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    provider: string
  ): Promise<string | null> {
    if (!d1 || typeof d1.prepare !== 'function') return null;
    try {
      await this.ensureD1TablesSafe(d1);
      const row = await d1
        .prepare(`SELECT api_key FROM cangrejo_provider_keys WHERE provider = ?`)
        .bind(provider.trim().toLowerCase())
        .first<{ api_key: string }>();
      return row?.api_key ?? null;
    } catch {
      return null;
    }
  }

  public async listConfiguredProvidersFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined
  ): Promise<ProviderKeySummary[] | null> {
    if (!d1 || typeof d1.prepare !== 'function') return null;
    try {
      await this.ensureD1TablesSafe(d1);
      const res = await d1
        .prepare(
          `SELECT provider, api_key, updated_at
           FROM cangrejo_provider_keys
           ORDER BY provider ASC`
        )
        .all<{ provider: string; api_key: string; updated_at: number }>();
      const rows = Array.isArray(res?.results) ? res.results : [];
      return rows.map((r) => ({
        provider: r.provider,
        maskedKey:
          r.api_key.length >= 8
            ? `${r.api_key.slice(0, 4)}••••${r.api_key.slice(-4)}`
            : `${r.api_key.slice(0, 2)}••••`,
        updatedAt: Number(r.updated_at ?? Date.now()),
      }));
    } catch {
      return null;
    }
  }

  public async upsertRadarWatchToD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    watch: RadarWatchRecord
  ): Promise<boolean> {
    if (!d1 || typeof d1.prepare !== 'function') return false;
    try {
      await this.ensureD1TablesSafe(d1);
      await d1
        .prepare(
          `INSERT INTO cangrejo_radar_watches (
             id, target_value, entity_type, expediente_id, baseline_json, baseline_digest_hex, drift_count, last_checked_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             target_value = excluded.target_value,
             entity_type = excluded.entity_type,
             expediente_id = excluded.expediente_id,
             baseline_json = excluded.baseline_json,
             baseline_digest_hex = excluded.baseline_digest_hex,
             drift_count = excluded.drift_count,
             last_checked_at = excluded.last_checked_at`
        )
        .bind(
          watch.id,
          watch.targetValue,
          watch.entityType,
          watch.expedienteId,
          JSON.stringify(watch.baselineIndicators),
          watch.baselineDigestHex,
          watch.driftCount,
          watch.lastCheckedAt
        )
        .run();
      return true;
    } catch {
      return false;
    }
  }

  public async listRadarWatchesFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined
  ): Promise<RadarWatchRecord[] | null> {
    if (!d1 || typeof d1.prepare !== 'function') return null;
    try {
      await this.ensureD1TablesSafe(d1);
      const res = await d1
        .prepare(
          `SELECT id, target_value, entity_type, expediente_id, baseline_json, baseline_digest_hex, drift_count, last_checked_at
           FROM cangrejo_radar_watches
           ORDER BY last_checked_at DESC`
        )
        .all<{
          id: string;
          target_value: string;
          entity_type: string;
          expediente_id: string;
          baseline_json: string;
          baseline_digest_hex: string;
          drift_count: number;
          last_checked_at: number;
        }>();
      const rows = Array.isArray(res?.results) ? res.results : [];
      return rows.map((r) => ({
        id: r.id,
        targetValue: r.target_value,
        entityType: r.entity_type,
        expedienteId: r.expediente_id,
        baselineIndicators: JSON.parse(r.baseline_json) as string[],
        baselineDigestHex: r.baseline_digest_hex,
        driftCount: Number(r.drift_count ?? 0),
        lastCheckedAt: Number(r.last_checked_at ?? Date.now()),
      }));
    } catch {
      return null;
    }
  }

  public async saveRadarAlertToD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    alert: RadarDriftAlertRecord
  ): Promise<boolean> {
    if (!d1 || typeof d1.prepare !== 'function') return false;
    try {
      await this.ensureD1TablesSafe(d1);
      await d1
        .prepare(
          `INSERT INTO cangrejo_radar_alerts (
             id, watch_id, target_value, severity, added_json, removed_json, baseline_digest_hex, current_digest_hex, detected_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          alert.id,
          alert.watchId,
          alert.targetValue,
          alert.severity,
          JSON.stringify(alert.addedIndicators),
          JSON.stringify(alert.removedIndicators),
          alert.baselineDigestHex,
          alert.currentDigestHex,
          alert.detectedAt
        )
        .run();
      return true;
    } catch {
      return false;
    }
  }

  public async listRadarAlertsFromD1Safe(
    d1: CloudflareD1DatabaseLike | undefined,
    limit = 25
  ): Promise<RadarDriftAlertRecord[] | null> {
    if (!d1 || typeof d1.prepare !== 'function') return null;
    try {
      await this.ensureD1TablesSafe(d1);
      const res = await d1
        .prepare(
          `SELECT id, watch_id, target_value, severity, added_json, removed_json, baseline_digest_hex, current_digest_hex, detected_at
           FROM cangrejo_radar_alerts
           ORDER BY detected_at DESC
           LIMIT ?`
        )
        .bind(limit)
        .all<{
          id: string;
          watch_id: string;
          target_value: string;
          severity: 'CRITICO' | 'ALTO' | 'INFO';
          added_json: string;
          removed_json: string;
          baseline_digest_hex: string;
          current_digest_hex: string;
          detected_at: number;
        }>();
      const rows = Array.isArray(res?.results) ? res.results : [];
      return rows.map((r) => ({
        id: r.id,
        watchId: r.watch_id,
        targetValue: r.target_value,
        severity: r.severity,
        addedIndicators: JSON.parse(r.added_json) as string[],
        removedIndicators: JSON.parse(r.removed_json) as string[],
        baselineDigestHex: r.baseline_digest_hex,
        currentDigestHex: r.current_digest_hex,
        detectedAt: Number(r.detected_at ?? Date.now()),
      }));
    } catch {
      return null;
    }
  }

  /**
   * Exposes this `BunSqliteVault` SQLite instance via the asynchronous `CloudflareD1DatabaseLike`
   * contract (`prepare`, `bind`, `run`, `first`, `all`, and atomic transactional `batch`).
   * Used both for local Community parity and for deterministic Gate 12 D1 integration tests.
   */
  public asD1Database(): CloudflareD1DatabaseLike {
    const db = this.db;

    interface BoundSqliteStmt extends CloudflareD1PreparedStatementLike {
      __sql: string;
      __params: unknown[];
    }

    const makeStatement = (query: string, boundParams: unknown[] = []): BoundSqliteStmt => ({
      __sql: query,
      __params: boundParams,
      bind(...values: unknown[]): CloudflareD1PreparedStatementLike {
        return makeStatement(query, values);
      },
      async run<T = unknown>(): Promise<{ success?: boolean; results?: T[] }> {
        const stmt = db.prepare(query);
        stmt.run(...boundParams);
        return { success: true, results: [] };
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        const stmt = db.prepare(query);
        const row = stmt.get(...boundParams) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName) return ((row[colName] as T) ?? null);
        return row as unknown as T;
      },
      async all<T = unknown>(): Promise<{ results?: T[] }> {
        const stmt = db.prepare(query);
        const rows = stmt.all(...boundParams) as T[];
        return { results: Array.isArray(rows) ? rows : [] };
      },
    });

    return {
      prepare(query: string): CloudflareD1PreparedStatementLike {
        return makeStatement(query);
      },
      async exec(query: string): Promise<unknown> {
        db.exec(query);
        return { ok: true };
      },
      async batch<T = unknown>(
        statements: CloudflareD1PreparedStatementLike[]
      ): Promise<Array<{ results?: T[] }>> {
        const results: Array<{ results?: T[] }> = [];
        db.exec('BEGIN IMMEDIATE;');
        try {
          for (const rawStmt of statements) {
            const internal = rawStmt as unknown as Partial<BoundSqliteStmt>;
            if (typeof internal.__sql === 'string') {
              const trimmed = internal.__sql.trim().toUpperCase();
              const stmt = db.prepare(internal.__sql);
              const params = internal.__params ?? [];
              if (trimmed.startsWith('SELECT')) {
                const rows = stmt.all(...params) as T[];
                results.push({ results: Array.isArray(rows) ? rows : [] });
              } else {
                stmt.run(...params);
                results.push({ results: [] });
              }
            } else {
              const res = await rawStmt.run<T>();
              results.push({ results: res.results ?? [] });
            }
          }
          db.exec('COMMIT;');
          return results;
        } catch (err) {
          try {
            db.exec('ROLLBACK;');
          } catch {
            // Ignore rollback error if transaction already aborted
          }
          throw err;
        }
      },
    };
  }

  public static async ensureMcpSessionD1TablesSafe(
    d1: CloudflareD1DatabaseLike | undefined
  ): Promise<void> {
    if (!d1 || typeof d1.prepare !== 'function') return;
    try {
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_tenant_metadata (
            tenant_id TEXT PRIMARY KEY,
            tier TEXT NOT NULL DEFAULT 'COMMUNITY'
              CHECK (tier IN ('COMMUNITY', 'ORO_PRO', 'PLATINO_ENTERPRISE')),
            license_key_masked TEXT,
            license_signature_hash TEXT,
            organization_name TEXT NOT NULL,
            max_active_mcp_sessions INTEGER NOT NULL DEFAULT 5,
            max_entities_per_session INTEGER NOT NULL DEFAULT 25000,
            credits_remaining INTEGER NOT NULL DEFAULT 0,
            settings_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_mcp_sessions (
            session_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
            raw_session_id TEXT NOT NULL,
            user_id TEXT,
            session_token_hash TEXT,
            title TEXT NOT NULL DEFAULT 'Expediente MCP',
            case_tier TEXT NOT NULL DEFAULT 'ORO'
              CHECK (case_tier IN ('PLATINO', 'ORO', 'PLATA', 'BRONCE')),
            status TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'idle', 'closed', 'revoked')),
            last_seq INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            last_active_at INTEGER NOT NULL DEFAULT (unixepoch()),
            expires_at INTEGER NOT NULL,
            CONSTRAINT uq_tenant_raw_session UNIQUE (tenant_id, raw_session_id)
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_session_graphs (
            session_id TEXT PRIMARY KEY REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
            checkpoint_seq INTEGER NOT NULL DEFAULT 0,
            node_count INTEGER NOT NULL DEFAULT 0,
            edge_count INTEGER NOT NULL DEFAULT 0,
            storage_tier TEXT NOT NULL DEFAULT 'd1_inline'
              CHECK (storage_tier IN ('d1_inline', 'r2_offload')),
            compression_codec TEXT NOT NULL DEFAULT 'gzip'
              CHECK (compression_codec IN ('gzip', 'cgrx', 'none')),
            snapshot_payload BLOB,
            snapshot_r2_key TEXT,
            byte_size INTEGER NOT NULL DEFAULT 0,
            payload_sha256 TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_graph_mutations (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES cangrejo_mcp_sessions(session_id) ON DELETE CASCADE,
            seq INTEGER NOT NULL,
            delta_id TEXT NOT NULL,
            author_id TEXT NOT NULL DEFAULT 'mcp-agent',
            action TEXT NOT NULL
              CHECK (action IN ('upsert', 'remove', 'clear', 'paste_iocs', 'delta', 'layout', 'undo', 'redo')),
            delta_json TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            CONSTRAINT uq_session_seq UNIQUE (session_id, seq)
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_users (
            user_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'OWNER'
              CHECK (role IN ('OWNER', 'ADMIN', 'ANALYST')),
            password_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'suspended')),
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            last_login_at INTEGER NOT NULL DEFAULT (unixepoch())
          )`
        )
        .run();
      await d1
        .prepare(
          `CREATE TABLE IF NOT EXISTS cangrejo_auth_sessions (
            auth_session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES cangrejo_users(user_id) ON DELETE CASCADE,
            tenant_id TEXT NOT NULL REFERENCES cangrejo_tenant_metadata(tenant_id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            expires_at INTEGER NOT NULL
          )`
        )
        .run();
    } catch {
      // Ignore on pre-migrated D1 databases
    }
  }

  /**
   * Atomically provisions both `cangrejo_tenant_metadata` and `cangrejo_mcp_sessions`
   * via `d1.batch([upsertTenantStmt, upsertSessionStmt])` (Just-In-Time provisioning).
   */
  public static async provisionMcpSessionJit(
    d1: CloudflareD1DatabaseLike,
    params: {
      tenantId: string;
      tier: CangrejoEditionTier;
      organizationName: string;
      licenseSignatureHash: string | null;
      creditsRemaining: number;
      dbSessionId: string;
      rawSessionId: string;
      expiresEpoch: number;
      sessionTokenHash?: string | null;
    }
  ): Promise<void> {
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const maxSessions =
      params.tier === 'PLATINO_ENTERPRISE' ? 25 : params.tier === 'ORO_PRO' ? 5 : 2;
    const maxEntities =
      params.tier === 'PLATINO_ENTERPRISE' ? 100_000 : params.tier === 'ORO_PRO' ? 25_000 : 500;
    const caseTier = params.tier === 'PLATINO_ENTERPRISE' ? 'PLATINO' : 'ORO';

    const upsertTenantStmt = d1
      .prepare(
        `INSERT INTO cangrejo_tenant_metadata (
          tenant_id, tier, organization_name, license_signature_hash,
          max_active_mcp_sessions, max_entities_per_session, credits_remaining, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(tenant_id) DO UPDATE SET
          tier = excluded.tier,
          organization_name = COALESCE(NULLIF(excluded.organization_name, ''), cangrejo_tenant_metadata.organization_name),
          license_signature_hash = COALESCE(excluded.license_signature_hash, cangrejo_tenant_metadata.license_signature_hash),
          max_entities_per_session = excluded.max_entities_per_session,
          updated_at = unixepoch()`
      )
      .bind(
        params.tenantId,
        params.tier,
        params.organizationName,
        params.licenseSignatureHash,
        maxSessions,
        maxEntities,
        params.creditsRemaining
      );

    const upsertSessionStmt = d1
      .prepare(
        `INSERT INTO cangrejo_mcp_sessions (
          session_id, tenant_id, raw_session_id, session_token_hash, title, case_tier,
          status, last_seq, created_at, last_active_at, expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', 0, unixepoch(), unixepoch(), ?)
        ON CONFLICT(session_id) DO UPDATE SET
          last_active_at = unixepoch(),
          status = 'active'`
      )
      .bind(
        params.dbSessionId,
        params.tenantId,
        params.rawSessionId,
        params.sessionTokenHash ?? null,
        `Expediente ${params.rawSessionId}`,
        caseTier,
        params.expiresEpoch
      );

    if (typeof d1.batch === 'function') {
      await d1.batch([upsertTenantStmt, upsertSessionStmt]);
    } else {
      await upsertTenantStmt.run();
      await upsertSessionStmt.run();
    }
  }

  /**
   * Retrieves consolidated session and checkpoint sequence state in a single indexed read.
   */
  public static async getMcpSessionMeta(
    d1: CloudflareD1DatabaseLike,
    dbSessionId: string
  ): Promise<McpSessionConsolidatedMeta | null> {
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const row = await d1
      .prepare(
        `SELECT
          s.session_id, s.tenant_id, s.raw_session_id, s.status, s.last_seq, s.expires_at,
          COALESCE(g.checkpoint_seq, 0) AS checkpoint_seq,
          g.storage_tier, g.snapshot_r2_key, COALESCE(g.byte_size, 0) AS byte_size, g.payload_sha256
        FROM cangrejo_mcp_sessions s
        LEFT JOIN cangrejo_session_graphs g ON s.session_id = g.session_id
        WHERE s.session_id = ?`
      )
      .bind(dbSessionId)
      .first<McpSessionConsolidatedMeta>();

    if (!row) return null;
    return {
      session_id: row.session_id,
      tenant_id: row.tenant_id,
      raw_session_id: row.raw_session_id,
      status: row.status,
      last_seq: Number(row.last_seq ?? 0),
      expires_at: Number(row.expires_at ?? 0),
      checkpoint_seq: Number(row.checkpoint_seq ?? 0),
      storage_tier: row.storage_tier ?? null,
      snapshot_r2_key: row.snapshot_r2_key ?? null,
      byte_size: Number(row.byte_size ?? 0),
      payload_sha256: row.payload_sha256 ?? null,
    };
  }

  /**
   * Fetches all WAL graph mutations for `dbSessionId` with `seq > afterSeq` in ascending order.
   */
  public static async fetchMutationsAfterSeq(
    d1: CloudflareD1DatabaseLike,
    dbSessionId: string,
    afterSeq: number
  ): Promise<McpGraphMutationRow[]> {
    const res = await d1
      .prepare(
        `SELECT seq, delta_id, author_id, action, delta_json
         FROM cangrejo_graph_mutations
         WHERE session_id = ? AND seq > ?
         ORDER BY seq ASC`
      )
      .bind(dbSessionId, afterSeq)
      .all<McpGraphMutationRow>();
    const rows = Array.isArray(res.results) ? res.results : [];
    return rows.map((r) => ({
      seq: Number(r.seq),
      delta_id: r.delta_id,
      author_id: r.author_id,
      action: r.action,
      delta_json: r.delta_json,
    }));
  }

  /**
   * Atomically appends a WAL mutation and advances `cangrejo_mcp_sessions.last_seq`
   * using `d1.batch([insertMutationStmt, updateSessionStmt])` with Optimistic Concurrency Control (OCC).
   * If a concurrent isolate wins the same `(session_id, seq)` slot (`SQLITE_CONSTRAINT_UNIQUE`),
   * the batch rolls back, missed deltas are fetched and passed to `onReconcileMissedDeltas`,
   * and the append retries at `max(seq) + 1` (up to `maxRetries` times).
   */
  public static async appendGraphMutationWithOcc(
    d1: CloudflareD1DatabaseLike,
    params: {
      dbSessionId: string;
      expectedNextSeq: number;
      deltaId: string;
      authorId?: string;
      action: 'upsert' | 'remove' | 'clear' | 'paste_iocs' | 'delta' | 'layout' | 'undo' | 'redo';
      deltaPayload: Record<string, unknown> | string;
      maxRetries?: number;
      onReconcileMissedDeltas?: (missed: McpGraphMutationRow[]) => Promise<void> | void;
    }
  ): Promise<{ committedSeq: number; retries: number; reconciledDeltas: McpGraphMutationRow[] }> {
    const maxRetries = params.maxRetries ?? 3;
    let nextSeq = Math.max(1, params.expectedNextSeq);
    let retries = 0;
    const reconciledDeltas: McpGraphMutationRow[] = [];
    const deltaJson =
      typeof params.deltaPayload === 'string'
        ? params.deltaPayload
        : JSON.stringify(params.deltaPayload);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const mutationId = `mut_${crypto.randomUUID()}`;
      const insertMutationStmt = d1
        .prepare(
          `INSERT INTO cangrejo_graph_mutations (
            id, session_id, seq, delta_id, author_id, action, delta_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`
        )
        .bind(
          mutationId,
          params.dbSessionId,
          nextSeq,
          params.deltaId,
          params.authorId ?? 'mcp-agent',
          params.action,
          deltaJson
        );

      const updateSessionStmt = d1
        .prepare(
          `UPDATE cangrejo_mcp_sessions
           SET last_seq = ?, last_active_at = unixepoch()
           WHERE session_id = ?`
        )
        .bind(nextSeq, params.dbSessionId);

      try {
        if (typeof d1.batch === 'function') {
          await d1.batch([insertMutationStmt, updateSessionStmt]);
        } else {
          await insertMutationStmt.run();
          await updateSessionStmt.run();
        }
        return { committedSeq: nextSeq, retries, reconciledDeltas };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isUniqueConflict =
          msg.includes('UNIQUE') ||
          msg.includes('uq_session_seq') ||
          msg.includes('SQLITE_CONSTRAINT');

        if (!isUniqueConflict || attempt === maxRetries) {
          throw err;
        }

        retries++;
        // Fetch concurrent mutations starting from `nextSeq - 1` so our isolate reconciles them
        const missed = await BunSqliteVault.fetchMutationsAfterSeq(
          d1,
          params.dbSessionId,
          nextSeq - 1
        );
        if (missed.length > 0) {
          reconciledDeltas.push(...missed);
          if (params.onReconcileMissedDeltas) {
            await params.onReconcileMissedDeltas(missed);
          }
          const highestSeen = Math.max(...missed.map((m) => m.seq));
          nextSeq = highestSeen + 1;
        } else {
          nextSeq++;
        }
      }
    }

    throw new Error(`OCC retry limit exceeded for session ${params.dbSessionId}`);
  }

  /**
   * Compresses a serialized graph snapshot with Gzip, computes its SHA-256 Daubert seal,
   * stores it in D1 inline BLOB (`<= maxInlineBytes`) or offloads to Cloudflare R2 (`> maxInlineBytes`),
   * and prunes compacted WAL mutations (`seq < checkpointSeq`).
   */
  public static async persistGraphSnapshotToD1OrR2(
    d1: CloudflareD1DatabaseLike,
    r2: CloudflareR2BucketLike | undefined,
    params: {
      tenantId: string;
      dbSessionId: string;
      checkpointSeq: number;
      serializedGraph: Record<string, unknown> | string;
      nodeCount: number;
      edgeCount: number;
      maxInlineBytes?: number;
      pruneBeforeCheckpoint?: boolean;
    }
  ): Promise<{
    storageTier: 'd1_inline' | 'r2_offload';
    byteSize: number;
    payloadSha256: string;
    snapshotR2Key: string | null;
  }> {
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const jsonText =
      typeof params.serializedGraph === 'string'
        ? params.serializedGraph
        : JSON.stringify(params.serializedGraph);
    const compressedBytes = await compressGraphSnapshot(jsonText);
    const byteSize = compressedBytes.byteLength;
    const payloadSha256 = crypto.createHash('sha256').update(compressedBytes).digest('hex');
    const maxInline = params.maxInlineBytes ?? MAX_D1_INLINE_SNAPSHOT_BYTES;

    let storageTier: 'd1_inline' | 'r2_offload' = 'd1_inline';
    let snapshotR2Key: string | null = null;

    if (byteSize <= maxInline) {
      await d1
        .prepare(
          `INSERT INTO cangrejo_session_graphs (
            session_id, checkpoint_seq, node_count, edge_count,
            storage_tier, compression_codec, snapshot_payload, snapshot_r2_key,
            byte_size, payload_sha256, updated_at
          ) VALUES (?, ?, ?, ?, 'd1_inline', 'gzip', ?, NULL, ?, ?, unixepoch())
          ON CONFLICT(session_id) DO UPDATE SET
            checkpoint_seq = excluded.checkpoint_seq,
            node_count = excluded.node_count,
            edge_count = excluded.edge_count,
            storage_tier = 'd1_inline',
            compression_codec = 'gzip',
            snapshot_payload = excluded.snapshot_payload,
            snapshot_r2_key = NULL,
            byte_size = excluded.byte_size,
            payload_sha256 = excluded.payload_sha256,
            updated_at = excluded.updated_at`
        )
        .bind(
          params.dbSessionId,
          params.checkpointSeq,
          params.nodeCount,
          params.edgeCount,
          compressedBytes,
          byteSize,
          payloadSha256
        )
        .run();
    } else {
      if (!r2) {
        throw new Error(
          `R2 bucket binding CANGREJO_VAULT_R2 missing; cannot offload ${byteSize} byte snapshot.`
        );
      }
      storageTier = 'r2_offload';
      snapshotR2Key = `snapshots/${params.tenantId}/${params.dbSessionId}/chk_${params.checkpointSeq}.cgrj.gz`;
      await r2.put(snapshotR2Key, compressedBytes, {
        customMetadata: {
          tenantId: params.tenantId,
          sessionId: params.dbSessionId,
          checkpointSeq: String(params.checkpointSeq),
          sha256: payloadSha256,
          nodeCount: String(params.nodeCount),
          edgeCount: String(params.edgeCount),
        },
      });

      await d1
        .prepare(
          `INSERT INTO cangrejo_session_graphs (
            session_id, checkpoint_seq, node_count, edge_count,
            storage_tier, compression_codec, snapshot_payload, snapshot_r2_key,
            byte_size, payload_sha256, updated_at
          ) VALUES (?, ?, ?, ?, 'r2_offload', 'gzip', NULL, ?, ?, ?, unixepoch())
          ON CONFLICT(session_id) DO UPDATE SET
            checkpoint_seq = excluded.checkpoint_seq,
            node_count = excluded.node_count,
            edge_count = excluded.edge_count,
            storage_tier = 'r2_offload',
            compression_codec = 'gzip',
            snapshot_payload = NULL,
            snapshot_r2_key = excluded.snapshot_r2_key,
            byte_size = excluded.byte_size,
            payload_sha256 = excluded.payload_sha256,
            updated_at = excluded.updated_at`
        )
        .bind(
          params.dbSessionId,
          params.checkpointSeq,
          params.nodeCount,
          params.edgeCount,
          snapshotR2Key,
          byteSize,
          payloadSha256
        )
        .run();
    }

    if (params.pruneBeforeCheckpoint !== false && params.checkpointSeq > 0) {
      await d1
        .prepare(`DELETE FROM cangrejo_graph_mutations WHERE session_id = ? AND seq <= ?`)
        .bind(params.dbSessionId, params.checkpointSeq)
        .run();
    }

    return {
      storageTier,
      byteSize,
      payloadSha256,
      snapshotR2Key,
    };
  }

  /**
   * Hydrates a session's compressed checkpoint snapshot (from D1 inline BLOB or Cloudflare R2),
   * verifies its SHA-256 Daubert integrity seal, and returns the deserialized snapshot document
   * plus any trailing WAL mutations (`seq > checkpoint_seq`).
   */
  public static async hydrateSessionSnapshotAndDeltas(
    d1: CloudflareD1DatabaseLike,
    r2: CloudflareR2BucketLike | undefined,
    dbSessionId: string
  ): Promise<{
    snapshotDoc: Record<string, unknown> | null;
    checkpointSeq: number;
    lastSeq: number;
    trailingMutations: McpGraphMutationRow[];
  }> {
    const meta = await BunSqliteVault.getMcpSessionMeta(d1, dbSessionId);
    const d1LastSeq = meta?.last_seq ?? 0;

    const graphRow = await d1
      .prepare(
        `SELECT checkpoint_seq, storage_tier, compression_codec, snapshot_payload, snapshot_r2_key, payload_sha256
         FROM cangrejo_session_graphs
         WHERE session_id = ?`
      )
      .bind(dbSessionId)
      .first<{
        checkpoint_seq: number;
        storage_tier: 'd1_inline' | 'r2_offload';
        compression_codec: string;
        snapshot_payload: Uint8Array | ArrayBuffer | Buffer | null;
        snapshot_r2_key: string | null;
        payload_sha256: string;
      }>();

    let snapshotDoc: Record<string, unknown> | null = null;
    let checkpointSeq = 0;

    if (graphRow) {
      checkpointSeq = Number(graphRow.checkpoint_seq ?? 0);
      let compressedBytes: Uint8Array;

      if (graphRow.storage_tier === 'd1_inline') {
        const raw = graphRow.snapshot_payload;
        if (!raw) {
          throw new Error(`Missing inline snapshot_payload for session ${dbSessionId}`);
        }
        compressedBytes =
          raw instanceof Uint8Array
            ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
            : new Uint8Array(raw as ArrayBuffer);
      } else {
        if (!r2) {
          throw new Error(`Cannot hydrate from R2: CANGREJO_VAULT_R2 binding is undefined.`);
        }
        const r2Obj = await r2.get(graphRow.snapshot_r2_key as string);
        if (!r2Obj) {
          throw new Error(`Snapshot R2 object not found at key: ${graphRow.snapshot_r2_key}`);
        }
        compressedBytes = new Uint8Array(await r2Obj.arrayBuffer());
      }

      const computedSha = crypto.createHash('sha256').update(compressedBytes).digest('hex');
      if (computedSha !== graphRow.payload_sha256) {
        throw new Error(
          `Daubert integrity violation: snapshot SHA-256 mismatch for session ${dbSessionId}`
        );
      }

      const jsonText = await decompressGraphSnapshot(compressedBytes);
      snapshotDoc = JSON.parse(jsonText) as Record<string, unknown>;
    }

    const trailingMutations =
      checkpointSeq < d1LastSeq
        ? await BunSqliteVault.fetchMutationsAfterSeq(d1, dbSessionId, checkpointSeq)
        : [];

    return {
      snapshotDoc,
      checkpointSeq,
      lastSeq: d1LastSeq,
      trailingMutations,
    };
  }

  /**
   * Hashes a password with PBKDF2-HMAC-SHA256 (100,000 iterations, 16-byte random salt).
   */
  public static hashPasswordPbkdf2(password: string): string {
    const iterations = 100_000;
    const saltHex = crypto.randomBytes(16).toString('hex');
    const hashHex = crypto
      .pbkdf2Sync(password, saltHex, iterations, 32, 'sha256')
      .toString('hex');
    return `pbkdf2_sha256$${iterations}$${saltHex}$${hashHex}`;
  }

  /**
   * Verifies a password against a `pbkdf2_sha256$<iterations>$<saltHex>$<hashHex>` digest
   * using constant-time comparison (`crypto.timingSafeEqual`).
   */
  public static verifyPasswordPbkdf2(password: string, storedHash: string): boolean {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
    const iterations = Number.parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHex = parts[3];
    if (!Number.isFinite(iterations) || iterations < 1_000 || !saltHex || !expectedHex) {
      return false;
    }
    const derivedHex = crypto
      .pbkdf2Sync(password, saltHex, iterations, 32, 'sha256')
      .toString('hex');
    const bufA = Buffer.from(derivedHex, 'utf8');
    const bufB = Buffer.from(expectedHex, 'utf8');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Lists all active MCP sessions belonging to a Client Organization (`tenantId`).
   */
  public static async listTenantMcpSessions(
    d1: CloudflareD1DatabaseLike,
    tenantId: string
  ): Promise<CangrejoMcpSessionSummary[]> {
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const res = await d1
      .prepare(
        `SELECT session_id, raw_session_id, title, case_tier, status, last_seq, expires_at, session_token_hash
         FROM cangrejo_mcp_sessions
         WHERE tenant_id = ?
         ORDER BY last_active_at DESC`
      )
      .bind(tenantId)
      .all<{
        session_id: string;
        raw_session_id: string;
        title: string;
        case_tier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
        status: string;
        last_seq: number;
        expires_at: number;
        session_token_hash: string | null;
      }>();

    const rows = Array.isArray(res.results) ? res.results : [];
    return rows.map((r) => ({
      sessionId: r.session_id,
      rawSessionId: r.raw_session_id,
      title: r.title,
      caseTier: r.case_tier,
      status: r.status,
      lastSeq: Number(r.last_seq ?? 0),
      expiresAt: Number(r.expires_at ?? 0),
      hasDedicatedToken: Boolean(r.session_token_hash),
    }));
  }

  /**
   * Registers a new User (`cangrejo_users`), creates their isolated Client Organization (`cangrejo_tenant_metadata`),
   * provisions a default MCP investigation session (`expediente-apt29`), and issues both a `cgrj_usr_*` session token
   * and an HMAC-signed `CGRJ.<TIER>.*` license token.
   */
  public static async registerUserAndClient(
    d1: CloudflareD1DatabaseLike,
    params: {
      email: string;
      password: string;
      displayName: string;
      organizationName?: string;
      requestedTier?: CangrejoEditionTier;
    }
  ): Promise<CangrejoAuthenticatedAccountResult> {
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const cleanEmail = params.email.trim().toLowerCase();
    const cleanName = params.displayName.trim();
    const tier: CangrejoEditionTier = params.requestedTier ?? 'ORO_PRO';
    const cleanOrg =
      params.organizationName?.trim() || `${cleanName} — Unidad Forense & OSINT`;

    const existing = await d1
      .prepare(`SELECT user_id FROM cangrejo_users WHERE email = ?`)
      .bind(cleanEmail)
      .first<{ user_id: string }>();
    if (existing) {
      const err = new Error('Ya existe una cuenta registrada con este correo electrónico.') as Error & {
        code?: string;
      };
      err.code = 'EMAIL_EXISTS';
      throw err;
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    const tenantHash = crypto
      .createHash('sha256')
      .update(`${cleanEmail}:${cleanOrg}:${crypto.randomUUID()}`)
      .digest('hex')
      .slice(0, 12);
    const tenantId = `org_${tenantHash}`;
    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const creditsRemaining =
      tier === 'PLATINO_ENTERPRISE' ? 5_000 : tier === 'ORO_PRO' ? 500 : 50;
    const maxActiveMcpSessions =
      tier === 'PLATINO_ENTERPRISE' ? 25 : tier === 'ORO_PRO' ? 10 : 3;
    const maxEntitiesPerSession = tier === 'PLATINO_ENTERPRISE' ? 100_000 : 25_000;

    const licenseToken = BunSqliteVault.issueSignedLicenseToken({
      tier,
      organizationName: cleanOrg,
      credits: creditsRemaining,
      tenantId,
    });
    const licenseKeyMasked = `${licenseToken.slice(0, 12)}••••${licenseToken.slice(-4)}`;
    const sigHex = licenseToken.split('.')[3] ?? '';
    const sigHash = crypto.createHash('sha256').update(sigHex).digest('hex');

    const passwordHash = BunSqliteVault.hashPasswordPbkdf2(params.password);
    const authToken = `cgrj_usr_${crypto.randomBytes(24).toString('hex')}`;
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
    const authSessionId = `asess_${crypto.randomBytes(8).toString('hex')}`;
    const expiresEpoch = nowEpoch + 30 * 86400;

    const defaultRawSessionId = 'expediente-apt29';
    const defaultDbSessionId = `${tenantId}:${defaultRawSessionId}`;
    const defaultCaseTier = tier === 'PLATINO_ENTERPRISE' ? 'PLATINO' : 'ORO';

    const insertTenantStmt = d1
      .prepare(
        `INSERT INTO cangrejo_tenant_metadata (
          tenant_id, tier, license_key_masked, license_signature_hash, organization_name,
          max_active_mcp_sessions, max_entities_per_session, credits_remaining, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        tier,
        licenseKeyMasked,
        sigHash,
        cleanOrg,
        maxActiveMcpSessions,
        maxEntitiesPerSession,
        creditsRemaining,
        nowEpoch,
        nowEpoch
      );

    const insertUserStmt = d1
      .prepare(
        `INSERT INTO cangrejo_users (
          user_id, tenant_id, email, display_name, role, password_hash, status, created_at, last_login_at
        ) VALUES (?, ?, ?, ?, 'OWNER', ?, 'active', ?, ?)`
      )
      .bind(userId, tenantId, cleanEmail, cleanName, passwordHash, nowEpoch, nowEpoch);

    const insertAuthSessionStmt = d1
      .prepare(
        `INSERT INTO cangrejo_auth_sessions (
          auth_session_id, user_id, tenant_id, token_hash, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(authSessionId, userId, tenantId, authTokenHash, nowEpoch, expiresEpoch);

    const insertDefaultMcpSessionStmt = d1
      .prepare(
        `INSERT INTO cangrejo_mcp_sessions (
          session_id, tenant_id, raw_session_id, user_id, title, case_tier,
          status, last_seq, created_at, last_active_at, expires_at
        ) VALUES (?, ?, ?, ?, 'Expediente Inicial APT29', ?, 'active', 0, ?, ?, ?)`
      )
      .bind(
        defaultDbSessionId,
        tenantId,
        defaultRawSessionId,
        userId,
        defaultCaseTier,
        nowEpoch,
        nowEpoch,
        nowEpoch + 365 * 86400
      );

    if (typeof d1.batch === 'function') {
      await d1.batch([
        insertTenantStmt,
        insertUserStmt,
        insertAuthSessionStmt,
        insertDefaultMcpSessionStmt,
      ]);
    } else {
      await insertTenantStmt.run();
      await insertUserStmt.run();
      await insertAuthSessionStmt.run();
      await insertDefaultMcpSessionStmt.run();
    }

    const mcpSessions = await BunSqliteVault.listTenantMcpSessions(d1, tenantId);

    return {
      user: {
        userId,
        tenantId,
        email: cleanEmail,
        displayName: cleanName,
        role: 'OWNER',
        status: 'active',
        createdAt: nowEpoch,
        lastLoginAt: nowEpoch,
      },
      client: {
        tenantId,
        organizationName: cleanOrg,
        tier,
        creditsRemaining,
        maxActiveMcpSessions,
        maxEntitiesPerSession,
        licenseKeyMasked,
        createdAt: nowEpoch,
      },
      authToken,
      licenseToken,
      mcpSessions,
    };
  }

  /**
   * Authenticates an existing User (`email + password`), issues a new `cgrj_usr_*` session token,
   * and returns the User + Client Organization profile.
   */
  public static async loginUser(
    d1: CloudflareD1DatabaseLike,
    params: { email: string; password: string }
  ): Promise<CangrejoAuthenticatedAccountResult> {
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const cleanEmail = params.email.trim().toLowerCase();

    const row = await d1
      .prepare(
        `SELECT
          u.user_id, u.tenant_id, u.email, u.display_name, u.role, u.password_hash, u.status, u.created_at,
          t.organization_name, t.tier, t.credits_remaining, t.max_active_mcp_sessions,
          t.max_entities_per_session, t.license_key_masked, t.created_at AS tenant_created_at
         FROM cangrejo_users u
         JOIN cangrejo_tenant_metadata t ON u.tenant_id = t.tenant_id
         WHERE u.email = ?`
      )
      .bind(cleanEmail)
      .first<{
        user_id: string;
        tenant_id: string;
        email: string;
        display_name: string;
        role: 'OWNER' | 'ADMIN' | 'ANALYST';
        password_hash: string;
        status: 'active' | 'suspended';
        created_at: number;
        organization_name: string;
        tier: CangrejoEditionTier;
        credits_remaining: number;
        max_active_mcp_sessions: number;
        max_entities_per_session: number;
        license_key_masked: string | null;
        tenant_created_at: number;
      }>();

    if (
      !row ||
      row.status !== 'active' ||
      !BunSqliteVault.verifyPasswordPbkdf2(params.password, row.password_hash)
    ) {
      const err = new Error('Credenciales inválidas o cuenta suspendida.') as Error & {
        code?: string;
      };
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    const expiresEpoch = nowEpoch + 30 * 86400;
    const authToken = `cgrj_usr_${crypto.randomBytes(24).toString('hex')}`;
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
    const authSessionId = `asess_${crypto.randomBytes(8).toString('hex')}`;

    const insertSessionStmt = d1
      .prepare(
        `INSERT INTO cangrejo_auth_sessions (
          auth_session_id, user_id, tenant_id, token_hash, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(authSessionId, row.user_id, row.tenant_id, authTokenHash, nowEpoch, expiresEpoch);

    const updateUserStmt = d1
      .prepare(`UPDATE cangrejo_users SET last_login_at = ? WHERE user_id = ?`)
      .bind(nowEpoch, row.user_id);

    if (typeof d1.batch === 'function') {
      await d1.batch([insertSessionStmt, updateUserStmt]);
    } else {
      await insertSessionStmt.run();
      await updateUserStmt.run();
    }

    const licenseToken = BunSqliteVault.issueSignedLicenseToken({
      tier: row.tier,
      organizationName: row.organization_name,
      credits: Number(row.credits_remaining ?? 0),
      tenantId: row.tenant_id,
    });
    const mcpSessions = await BunSqliteVault.listTenantMcpSessions(d1, row.tenant_id);

    return {
      user: {
        userId: row.user_id,
        tenantId: row.tenant_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        createdAt: Number(row.created_at ?? nowEpoch),
        lastLoginAt: nowEpoch,
      },
      client: {
        tenantId: row.tenant_id,
        organizationName: row.organization_name,
        tier: row.tier,
        creditsRemaining: Number(row.credits_remaining ?? 0),
        maxActiveMcpSessions: Number(row.max_active_mcp_sessions ?? 5),
        maxEntitiesPerSession: Number(row.max_entities_per_session ?? 25_000),
        licenseKeyMasked: row.license_key_masked,
        createdAt: Number(row.tenant_created_at ?? nowEpoch),
      },
      authToken,
      licenseToken,
      mcpSessions,
    };
  }

  /**
   * Verifies a `cgrj_usr_*` session bearer token and returns the authenticated User + Client Organization.
   */
  public static async verifyUserSessionToken(
    d1: CloudflareD1DatabaseLike,
    rawToken: string
  ): Promise<Omit<CangrejoAuthenticatedAccountResult, 'authToken'> | null> {
    if (!rawToken || !rawToken.startsWith('cgrj_usr_')) return null;
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const nowEpoch = Math.floor(Date.now() / 1000);

    const row = await d1
      .prepare(
        `SELECT
          a.expires_at,
          u.user_id, u.tenant_id, u.email, u.display_name, u.role, u.status, u.created_at, u.last_login_at,
          t.organization_name, t.tier, t.credits_remaining, t.max_active_mcp_sessions,
          t.max_entities_per_session, t.license_key_masked, t.created_at AS tenant_created_at
         FROM cangrejo_auth_sessions a
         JOIN cangrejo_users u ON a.user_id = u.user_id
         JOIN cangrejo_tenant_metadata t ON u.tenant_id = t.tenant_id
         WHERE a.token_hash = ?`
      )
      .bind(tokenHash)
      .first<{
        expires_at: number;
        user_id: string;
        tenant_id: string;
        email: string;
        display_name: string;
        role: 'OWNER' | 'ADMIN' | 'ANALYST';
        status: 'active' | 'suspended';
        created_at: number;
        last_login_at: number;
        organization_name: string;
        tier: CangrejoEditionTier;
        credits_remaining: number;
        max_active_mcp_sessions: number;
        max_entities_per_session: number;
        license_key_masked: string | null;
        tenant_created_at: number;
      }>();

    if (!row || row.status !== 'active' || Number(row.expires_at ?? 0) < nowEpoch) {
      return null;
    }

    const licenseToken = BunSqliteVault.issueSignedLicenseToken({
      tier: row.tier,
      organizationName: row.organization_name,
      credits: Number(row.credits_remaining ?? 0),
      tenantId: row.tenant_id,
    });
    const mcpSessions = await BunSqliteVault.listTenantMcpSessions(d1, row.tenant_id);

    return {
      user: {
        userId: row.user_id,
        tenantId: row.tenant_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        createdAt: Number(row.created_at ?? nowEpoch),
        lastLoginAt: Number(row.last_login_at ?? nowEpoch),
      },
      client: {
        tenantId: row.tenant_id,
        organizationName: row.organization_name,
        tier: row.tier,
        creditsRemaining: Number(row.credits_remaining ?? 0),
        maxActiveMcpSessions: Number(row.max_active_mcp_sessions ?? 5),
        maxEntitiesPerSession: Number(row.max_entities_per_session ?? 25_000),
        licenseKeyMasked: row.license_key_masked,
        createdAt: Number(row.tenant_created_at ?? nowEpoch),
      },
      licenseToken,
      mcpSessions,
    };
  }

  /**
   * Revokes a `cgrj_usr_*` session token on logout.
   */
  public static async logoutUserSession(
    d1: CloudflareD1DatabaseLike,
    rawToken: string
  ): Promise<boolean> {
    if (!rawToken || !rawToken.startsWith('cgrj_usr_')) return false;
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    await d1
      .prepare(`DELETE FROM cangrejo_auth_sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
    return true;
  }

  /**
   * Issues a dedicated per-session MCP token (`ses_sec_<hex>`) scoped to `${tenantId}:${rawSessionId}`.
   */
  public static async issueDedicatedMcpSessionToken(
    d1: CloudflareD1DatabaseLike,
    params: {
      tenantId: string;
      userId?: string | null;
      rawSessionId: string;
      title?: string;
      caseTier?: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
      ttlSeconds?: number;
    }
  ): Promise<{
    sessionToken: string;
    sessionId: string;
    dbSessionId: string;
    expiresAt: number;
  }> {
    await BunSqliteVault.ensureMcpSessionD1TablesSafe(d1);
    const cleanRaw =
      params.rawSessionId
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .slice(0, 96) || 'expediente-apt29';
    const dbSessionId = `${params.tenantId}:${cleanRaw}`;
    const sessionToken = `ses_sec_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const nowEpoch = Math.floor(Date.now() / 1000);
    const expiresAt = nowEpoch + (params.ttlSeconds ?? 30 * 86400);
    const title = params.title?.trim() || `Expediente ${cleanRaw}`;
    const caseTier = params.caseTier ?? 'ORO';

    await d1
      .prepare(
        `INSERT INTO cangrejo_mcp_sessions (
          session_id, tenant_id, raw_session_id, user_id, session_token_hash,
          title, case_tier, status, last_seq, created_at, last_active_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          user_id = COALESCE(excluded.user_id, cangrejo_mcp_sessions.user_id),
          session_token_hash = excluded.session_token_hash,
          title = excluded.title,
          case_tier = excluded.case_tier,
          status = 'active',
          last_active_at = excluded.last_active_at,
          expires_at = excluded.expires_at`
      )
      .bind(
        dbSessionId,
        params.tenantId,
        cleanRaw,
        params.userId ?? null,
        tokenHash,
        title,
        caseTier,
        nowEpoch,
        nowEpoch,
        expiresAt
      )
      .run();

    return {
      sessionToken,
      sessionId: cleanRaw,
      dbSessionId,
      expiresAt,
    };
  }

  public close(): void {
    this.db.close();
  }
}

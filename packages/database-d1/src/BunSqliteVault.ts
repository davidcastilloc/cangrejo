import fs from 'node:fs';
import { createRequire } from 'node:module';
import { D1SchemaRunner } from './D1SchemaRunner.js';

const require = createRequire(import.meta.url);

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

function openNativeSqlite(dbPath: string): { db: SqliteDbLike; engine: 'bun:sqlite' | 'node:sqlite' } {
  const isBun = typeof globalThis !== 'undefined' && 'Bun' in globalThis;
  if (isBun) {
    try {
      const bunSqlite = require('bun:sqlite') as {
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
  const nodeSqlite = require('node:sqlite') as {
    DatabaseSync: new (filename: string) => SqliteDbLike;
  };
  return {
    db: new nodeSqlite.DatabaseSync(dbPath),
    engine: 'node:sqlite',
  };
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

  public constructor(dbPath = ':memory:') {
    const opened = openNativeSqlite(dbPath);
    this.db = opened.db;
    this.engine = opened.engine;
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA recursive_triggers = ON;');
    this.initializeVaultTables();
  }

  private initializeVaultTables(): void {
    const sqlPath = D1SchemaRunner.getMigrationSqlPath();
    if (fs.existsSync(sqlPath)) {
      const baseSql = fs.readFileSync(sqlPath, 'utf8');
      this.db.exec(baseSql);
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

  public close(): void {
    this.db.close();
  }
}

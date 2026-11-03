import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { D1SchemaRunner } from './D1SchemaRunner.js';

const DEFAULT_LICENSE_HMAC_SECRET =
  (typeof process !== 'undefined' && process.env?.CANGREJO_LICENSE_SECRET) ||
  'cangrejo-oro-hmac-sha256-master-secret-2026';

export interface SignedLicenseClaims {
  tier: CangrejoEditionTier;
  organizationName: string;
  badgeTitle: string;
  credits: number;
  issuedAt: number;
  expiresAt: number;
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

  public constructor(dbPath = ':memory:') {
    const opened = openNativeSqlite(dbPath);
    this.db = opened.db;
    this.engine = opened.engine;
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
  }): string {
    const secret = params.secret ?? DEFAULT_LICENSE_HMAC_SECRET;
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
    secret = DEFAULT_LICENSE_HMAC_SECRET
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

  public close(): void {
    this.db.close();
  }
}

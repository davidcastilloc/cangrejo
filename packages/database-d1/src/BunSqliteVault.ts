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
   * Polymorphically activates a Pro/Enterprise license key or updates White-Label branding.
   * Supports either a raw license key string (`"CGRJ-PLATINO-2026"`) or a configuration object.
   */
  public activateLicenseOrUpdateEdition(rawInput: unknown): CangrejoEditionState {
    let rawKey = '';
    let requestedTier: CangrejoEditionTier | null = null;
    let orgName: string | undefined;
    let badgeTitle: string | undefined;

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
      targetTier === 'PLATINO_ENTERPRISE' ? 5_000 : targetTier === 'ORO_PRO' ? 500 : 0;
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

  public close(): void {
    this.db.close();
  }
}

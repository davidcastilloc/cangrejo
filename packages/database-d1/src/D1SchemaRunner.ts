import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType;
};

export interface D1OrganizationRow {
  id: string;
  slug: string;
  name: string;
  plan_tier: 'free' | 'pro' | 'team' | 'enterprise';
  seat_limit: number;
}

export interface D1UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

export class D1SchemaRunner {
  public readonly db: DatabaseSyncType;

  public constructor(dbPath = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA recursive_triggers = ON;');
  }

  public static getMigrationSqlPath(): string {
    return path.resolve(__dirname, '../migrations/0001_initial_schema.sql');
  }

  public applyInitialSchema(): void {
    const sqlPath = D1SchemaRunner.getMigrationSqlPath();
    const sql = fs.readFileSync(sqlPath, 'utf8');
    this.db.exec(sql);
  }

  public applyInitialMigration(): void {
    this.applyInitialSchema();
  }

  public listTables(): string[] {
    const stmt = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
    );
    const rows = stmt.all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  public listTriggers(): string[] {
    const stmt = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name ASC"
    );
    const rows = stmt.all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  public close(): void {
    this.db.close();
  }
}

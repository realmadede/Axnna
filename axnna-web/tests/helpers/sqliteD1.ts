import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/**
 * Lightweight D1Database adapter backed by Node's built-in `node:sqlite` (`DatabaseSync`),
 * enforcing real SQLite CHECK constraints, UNIQUE constraints, and FOREIGN KEY constraints.
 */
export function createSqliteD1(applyUpToMigration?: string): { db: D1Database; sqlite: DatabaseSyncType } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    sqlite.exec(sql);
    if (applyUpToMigration && file.startsWith(applyUpToMigration)) {
      break;
    }
  }

  const db = {
    prepare(query: string) {
      let bound: unknown[] = [];
      const stmtApi = {
        bind(...params: unknown[]) {
          bound = params.map((p) => (p === undefined ? null : p));
          return stmtApi;
        },
        async run() {
          const stmt = sqlite.prepare(query);
          const info = stmt.run(...(bound as any[]));
          return { success: true, meta: { changes: Number(info.changes ?? 0) }, results: [] };
        },
        async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
          const stmt = sqlite.prepare(query);
          const row = stmt.get(...(bound as any[])) as Record<string, unknown> | undefined;
          if (!row) return null;
          const plain = { ...row };
          if (colName) return (plain[colName] ?? null) as T;
          return plain as T;
        },
        async all<T = Record<string, unknown>>(): Promise<{ success: boolean; results: T[]; meta: Record<string, unknown> }> {
          const stmt = sqlite.prepare(query);
          const rows = (stmt.all(...(bound as any[])) as Array<Record<string, unknown>>).map((r) => ({ ...r }));
          return { success: true, results: rows as T[], meta: {} };
        },
        async raw() {
          const stmt = sqlite.prepare(query);
          return stmt.all(...(bound as any[])).map((r) => Object.values(r as Record<string, unknown>));
        },
      };
      return stmtApi;
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    },
    async batch(statements: any[]) {
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const s of statements) {
          results.push(await s.run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;

  return { db, sqlite };
}

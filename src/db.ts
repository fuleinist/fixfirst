/**
 * Local SQLite store.
 *
 * The only state is the iFixit guide cache. The app keeps no user data.
 * `FIXFIRST_DB` overrides the path. Use `:memory:` in tests.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.FIXFIRST_DB ?? resolve("data/fixfirst.db");

let instance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (instance) return instance;
  if (DB_PATH !== ":memory:") {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }
  instance = new DatabaseSync(DB_PATH);
  instance.exec(`
    CREATE TABLE IF NOT EXISTS guide_cache (
      cache_key TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  return instance;
}

export function readCache(cacheKey: string): { payload: unknown; fetchedAt: number } | null {
  const row = getDb()
    .prepare("SELECT payload, fetched_at FROM guide_cache WHERE cache_key = ?")
    .get(cacheKey) as { payload: string; fetched_at: number } | undefined;
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload), fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

export function writeCache(cacheKey: string, payload: unknown, fetchedAt = Date.now()): void {
  getDb()
    .prepare(
      `INSERT INTO guide_cache (cache_key, fetched_at, payload)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
    )
    .run(cacheKey, fetchedAt, JSON.stringify(payload));
}

export function clearCache(): void {
  getDb().exec("DELETE FROM guide_cache");
}

export function cacheSize(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM guide_cache").get() as { n: number };
  return row.n;
}
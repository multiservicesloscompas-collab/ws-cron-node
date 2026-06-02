import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { failure, success, type Result } from "../../types/result.ts";

export interface SqliteDb {
  database: DatabaseSync;
  close: () => void;
}

export interface SqliteDbDeps {
  databasePath: string;
}

const ensureParentDirectory = async (databasePath: string): Promise<void> => {
  if (databasePath === ":memory:" || !databasePath.includes("/")) return;

  const lastSlashIndex = databasePath.lastIndexOf("/");
  if (lastSlashIndex <= 0) return;

  await mkdir(databasePath.slice(0, lastSlashIndex), { recursive: true });
};

const initializeSchema = (database: DatabaseSync): void => {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS internal_contacts (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('manual', 'system')),
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_internal_contacts_kind
      ON internal_contacts(kind, updated_at DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      singleton_key TEXT PRIMARY KEY CHECK(singleton_key = 'default'),
      default_target_jid TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'America/Caracas',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule_time TEXT NOT NULL,
      days TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      target_jid TEXT NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'sequence' CHECK(execution_mode IN ('sequence', 'random_single')),
      content_type TEXT NOT NULL CHECK(content_type IN ('static_template', 'llm_generated')),
      static_template TEXT,
      llm_prompt TEXT,
      llm_model TEXT,
      fallback_messages TEXT,
      message_sequence TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_triggered_at TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_schedule
      ON cron_jobs(enabled, schedule_time, days);
  `);

  const columns = database.prepare("PRAGMA table_info(cron_jobs)").all() as Array<{
    name: string;
  }>;
  const hasFallbackMessages = columns.some((column) => column.name === "fallback_messages");
  const hasMessageSequence = columns.some((column) => column.name === "message_sequence");
  const hasExecutionMode = columns.some((column) => column.name === "execution_mode");

  if (!hasFallbackMessages) {
    database.exec("ALTER TABLE cron_jobs ADD COLUMN fallback_messages TEXT");
  }

  if (!hasMessageSequence) {
    database.exec("ALTER TABLE cron_jobs ADD COLUMN message_sequence TEXT");
  }

  if (!hasExecutionMode) {
    database.exec(
      "ALTER TABLE cron_jobs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'sequence' CHECK(execution_mode IN ('sequence', 'random_single'))",
    );
  }

  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO app_settings (
      singleton_key,
      default_target_jid,
      timezone,
      created_at,
      updated_at
    ) VALUES ('default', '', 'America/Caracas', ?, ?)
    ON CONFLICT(singleton_key) DO NOTHING
  `).run(now, now);
};

export const makeSqliteDb = async (
  deps: SqliteDbDeps,
): Promise<Result<SqliteDb, string>> => {
  try {
    await ensureParentDirectory(deps.databasePath);

    const database = new DatabaseSync(deps.databasePath);
    initializeSchema(database);

    return success({
      database,
      close: () => database.close(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(`Error al inicializar SQLite: ${reason}`);
  }
};

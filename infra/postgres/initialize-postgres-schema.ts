import { failure, success, type Result } from "../../types/result.ts";
import type { PostgresQueryable } from "./postgres-types.ts";

const statements = [
  `
    CREATE TABLE IF NOT EXISTS internal_contacts (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('manual', 'system')),
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_internal_contacts_kind
      ON internal_contacts(kind, updated_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS app_settings (
      singleton_key TEXT PRIMARY KEY CHECK(singleton_key = 'default'),
      default_target_jid TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'America/Caracas',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule_time TEXT NOT NULL,
      days TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
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
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_cron_jobs_schedule
      ON cron_jobs(enabled, schedule_time, days)
  `,
  `ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS fallback_messages TEXT`,
  `ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS message_sequence TEXT`,
  `ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'sequence'`,
  `
    UPDATE cron_jobs
    SET execution_mode = 'sequence'
    WHERE execution_mode IS NULL OR execution_mode = ''
  `,
  `
    CREATE TABLE IF NOT EXISTS whatsapp_auth_credentials (
      singleton_key TEXT PRIMARY KEY CHECK(singleton_key = 'default'),
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS whatsapp_auth_keys (
      category TEXT NOT NULL,
      id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(category, id)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_keys_category
      ON whatsapp_auth_keys(category, updated_at DESC)
  `,
];

export const initializePostgresSchema = async (
  database: PostgresQueryable,
): Promise<Result<void, string>> => {
  try {
    for (const statement of statements) {
      await database.query(statement);
    }

    const now = new Date().toISOString();
    await database.query(
      `
        INSERT INTO app_settings (
          singleton_key,
          default_target_jid,
          timezone,
          created_at,
          updated_at
        ) VALUES ('default', '', 'America/Caracas', $1, $2)
        ON CONFLICT(singleton_key) DO NOTHING
      `,
      [now, now],
    );

    return success(undefined);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(`Error al inicializar PostgreSQL: ${reason}`);
  }
};

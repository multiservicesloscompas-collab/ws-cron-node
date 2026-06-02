import { stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { success } from "../types/result.ts";
import { getPostgresEnv } from "../infra/postgres/get-postgres-env.ts";
import { makePostgresDb } from "../infra/postgres/make-postgres-db.ts";

interface ContactRow {
  jid: string;
  name: string;
  kind: "manual" | "system";
  source: string | null;
  created_at: string;
  updated_at: string;
}

interface AppSettingsRow {
  singleton_key: string;
  default_target_jid: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

interface CronJobRow {
  id: string;
  name: string;
  schedule_time: string;
  days: string;
  enabled: number;
  target_jid: string;
  execution_mode: string | null;
  content_type: string;
  static_template: string | null;
  llm_prompt: string | null;
  llm_model: string | null;
  fallback_messages: string | null;
  message_sequence: string | null;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
}

const sqlitePath = process.argv[2] ?? "./data/internal-contacts.sqlite";

const readSqliteRows = async () => {
  await stat(sqlitePath);
  const sqlite = new DatabaseSync(sqlitePath, { open: true, readOnly: true });

  try {
    const contacts = sqlite.prepare(`
      SELECT jid, name, kind, source, created_at, updated_at
      FROM internal_contacts
    `).all() as unknown as ContactRow[];
    const appSettings = sqlite.prepare(`
      SELECT singleton_key, default_target_jid, timezone, created_at, updated_at
      FROM app_settings
    `).all() as unknown as AppSettingsRow[];
    const cronJobs = sqlite.prepare(`
      SELECT id, name, schedule_time, days, enabled, target_jid, execution_mode,
             content_type, static_template, llm_prompt, llm_model, fallback_messages,
             message_sequence, created_at, updated_at, last_triggered_at
      FROM cron_jobs
    `).all() as unknown as CronJobRow[];

    return { contacts, appSettings, cronJobs };
  } finally {
    sqlite.close();
  }
};

const main = async () => {
  const rows = await readSqliteRows();
  const postgresResult = await makePostgresDb(getPostgresEnv());
  if (postgresResult.isFailure) {
    throw new Error(postgresResult.getError());
  }

  const postgres = postgresResult.getValue();

  try {
    const result = await postgres.runInTransaction(async (client) => {
      await client.query("DELETE FROM internal_contacts");
      await client.query("DELETE FROM cron_jobs");
      await client.query("DELETE FROM app_settings");

      for (const row of rows.contacts) {
        await client.query(
          `
            INSERT INTO internal_contacts (jid, name, kind, source, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            row.jid,
            row.name,
            row.kind,
            row.source,
            row.created_at,
            row.updated_at,
          ],
        );
      }

      for (const row of rows.appSettings) {
        await client.query(
          `
            INSERT INTO app_settings (
              singleton_key, default_target_jid, timezone, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5)
          `,
          [
            row.singleton_key,
            row.default_target_jid,
            row.timezone,
            row.created_at,
            row.updated_at,
          ],
        );
      }

      for (const row of rows.cronJobs) {
        await client.query(
          `
            INSERT INTO cron_jobs (
              id, name, schedule_time, days, enabled, target_jid, execution_mode,
              content_type, static_template, llm_prompt, llm_model, fallback_messages,
              message_sequence, created_at, updated_at, last_triggered_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12,
              $13, $14, $15, $16
            )
          `,
          [
            row.id,
            row.name,
            row.schedule_time,
            row.days,
            Boolean(row.enabled),
            row.target_jid,
            row.execution_mode || "sequence",
            row.content_type,
            row.static_template,
            row.llm_prompt,
            row.llm_model,
            row.fallback_messages,
            row.message_sequence,
            row.created_at,
            row.updated_at,
            row.last_triggered_at,
          ],
        );
      }

      return success({
        contacts: rows.contacts.length,
        settings: rows.appSettings.length,
        cronJobs: rows.cronJobs.length,
      });
    });

    if (result.isFailure) {
      throw new Error(result.getError());
    }

    const counts = result.getValue() as {
      contacts: number;
      settings: number;
      cronJobs: number;
    };
    console.log(
      `✅ Migración completada: ${counts.contacts} contactos, ${counts.settings} ajustes y ${counts.cronJobs} cron jobs.`,
    );
  } finally {
    await postgres.close();
  }
};

if (import.meta.main) {
  main().catch((error) => {
    console.error("💥 Error de migración:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

import { failure, success, type Result } from "../../types/result.ts";
import type { PostgresQueryable } from "../postgres/postgres-types.ts";
import type { AppSettings, AppSettingsInput } from "./app-settings.ts";

export interface AppSettingsRepositoryDeps {
  database: PostgresQueryable;
}

export interface AppSettingsRepository {
  get: () => Promise<Result<AppSettings, string>>;
  update: (input: AppSettingsInput) => Promise<Result<AppSettings, string>>;
  withDatabase: (database: PostgresQueryable) => AppSettingsRepository;
}

interface AppSettingsRow {
  default_target_jid: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

const toSettings = (row: AppSettingsRow): AppSettings => ({
  defaultTargetJid: row.default_target_jid,
  timezone: row.timezone,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const makeAppSettingsRepository = (
  deps: AppSettingsRepositoryDeps,
): AppSettingsRepository => {
  const get = async (): Promise<Result<AppSettings, string>> => {
    try {
      const result = await deps.database.query(`
        SELECT default_target_jid, timezone, created_at, updated_at
        FROM app_settings
        WHERE singleton_key = 'default'
      `);
      const row = result.rows[0] as unknown as AppSettingsRow | undefined;
      if (!row) return failure("No se encontró la configuración global");
      return success(toSettings(row));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al leer configuración global: ${reason}`);
    }
  };

  const update = (
    input: AppSettingsInput,
  ): Promise<Result<AppSettings, string>> => {
    return (async () => {
      try {
        const currentResult = await get();
        if (currentResult.isFailure) return failure(currentResult.getError());

        await deps.database.query(
          `
            UPDATE app_settings
            SET default_target_jid = $1, timezone = $2, updated_at = $3
            WHERE singleton_key = 'default'
          `,
          [input.defaultTargetJid, input.timezone, new Date().toISOString()],
        );

        return get();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`Error al guardar configuración global: ${reason}`);
      }
    })();
  };

  return {
    get,
    update,
    withDatabase: (database) => makeAppSettingsRepository({ database }),
  };
};

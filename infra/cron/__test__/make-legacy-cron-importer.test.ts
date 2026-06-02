import { assertEquals } from "#test-assert";
import { failure } from "../../../types/result.ts";
import { makeAppSettingsRepository } from "../make-app-settings-repository.ts";
import {
  makeCronJobsRepository,
  type CronJobsRepository,
} from "../make-cron-jobs-repository.ts";
import type { CronJobInput } from "../cron-job.ts";
import type { PostgresQueryable } from "../../postgres/postgres-types.ts";
import { makeLegacyCronImporter } from "../make-legacy-cron-importer.ts";
import { makeTestPostgresDb } from "../../postgres/make-test-postgres-db.ts";

const legacyConfigPath = new URL("../../../config/cron-config.json", import.meta.url)
  .pathname;

const createEnvironment = async () => {
  const postgres = await makeTestPostgresDb();
  return {
    postgres,
    appSettingsRepository: makeAppSettingsRepository({ database: postgres.pool }),
    cronJobsRepository: makeCronJobsRepository({ database: postgres.pool }),
  };
};

const makeFailingCronJobsRepository = (
  baseRepository: CronJobsRepository,
): CronJobsRepository => {
  const state = { createCalls: 0 };

  const wrap = (repository: CronJobsRepository): CronJobsRepository => ({
    ...repository,
    create: async (input: CronJobInput, id?: string) => {
      state.createCalls += 1;
      if (state.createCalls === 2) {
        return failure("falló el segundo insert");
      }

      return repository.create(input, id);
    },
    withDatabase: (database: PostgresQueryable) =>
      wrap(repository.withDatabase(database)),
  });

  return wrap(baseRepository);
};

Deno.test("makeLegacyCronImporter imports legacy config only when cron table is empty", async () => {
  const env = await createEnvironment();
  try {
    const importer = makeLegacyCronImporter({
      configPath: legacyConfigPath,
      database: env.postgres,
      appSettingsRepository: env.appSettingsRepository,
      cronJobsRepository: env.cronJobsRepository,
    });

    const firstImport = await importer.importIfEmpty();
    assertEquals(firstImport.isFailure, false);
    assertEquals(firstImport.getValue(), "imported");

    const secondImport = await importer.importIfEmpty();
    assertEquals(secondImport.isFailure, false);
    assertEquals(secondImport.getValue(), "skipped");

    const settingsResult = await env.appSettingsRepository.get();
    assertEquals(settingsResult.isFailure, false);
    assertEquals(
      settingsResult.getValue().defaultTargetJid,
      "120363394083049638@g.us",
    );

    const cronJobsResult = await env.cronJobsRepository.list();
    assertEquals(cronJobsResult.isFailure, false);
    assertEquals(cronJobsResult.getValue().length, 2);
    assertEquals(cronJobsResult.getValue()[0]?.messages, [{
      contentType: "static_template",
      staticTemplate: "{{street_washers}}",
      llmPrompt: null,
      llmModel: null,
      fallbackMessages: null,
    }]);
    assertEquals(cronJobsResult.getValue()[1]?.messages, [{
      contentType: "static_template",
      staticTemplate: "🌙 Buenas equipo, cerramos el día.\n\nPor favor, recordemos:\n✅ Desconectar la lámpara del agua\n✅ Dejar el local limpio y ordenado\n✅ Limpiar la mesa de trabajo y la cocina\n\n¡Gracias por el esfuerzo de hoy! 🙌",
      llmPrompt: null,
      llmModel: null,
      fallbackMessages: null,
    }]);
  } finally {
    await env.postgres.close();
  }
});

Deno.test("makeLegacyCronImporter rolls back partial imports on failure", async () => {
  const env = await createEnvironment();

  try {
    const importer = makeLegacyCronImporter({
      configPath: legacyConfigPath,
      database: env.postgres,
      appSettingsRepository: env.appSettingsRepository,
      cronJobsRepository: makeFailingCronJobsRepository(env.cronJobsRepository),
    });

    const importResult = await importer.importIfEmpty();
    assertEquals(importResult.isFailure, true);
    assertEquals(importResult.getError(), "falló el segundo insert");

    const countResult = await env.cronJobsRepository.count();
    assertEquals(countResult.isFailure, false);
    assertEquals(countResult.getValue(), 0);

    const settingsResult = await env.appSettingsRepository.get();
    assertEquals(settingsResult.isFailure, false);
    assertEquals(settingsResult.getValue().defaultTargetJid, "");
    assertEquals(settingsResult.getValue().timezone, "America/Caracas");
  } finally {
    await env.postgres.close();
  }
});

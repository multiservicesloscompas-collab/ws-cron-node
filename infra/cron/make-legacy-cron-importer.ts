import { failure, success, type Result } from "../../types/result.ts";
import type { PostgresDb } from "../postgres/make-postgres-db.ts";
import type { AppSettingsRepository } from "./make-app-settings-repository.ts";
import type { CronJobsRepository } from "./make-cron-jobs-repository.ts";
import { readLegacyCronConfig } from "./legacy-cron-config.ts";

export interface LegacyCronImporterDeps {
  configPath: string;
  database: PostgresDb;
  appSettingsRepository: AppSettingsRepository;
  cronJobsRepository: CronJobsRepository;
}

export const makeLegacyCronImporter = (deps: LegacyCronImporterDeps) => {
  const importIfEmpty = async (): Promise<Result<"imported" | "skipped", string>> => {
    const countResult = await deps.cronJobsRepository.count();
    if (countResult.isFailure) return failure(countResult.getError());
    if (countResult.getValue() > 0) return success("skipped");

    const configResult = await readLegacyCronConfig(deps.configPath);
    if (configResult.isFailure) return failure(configResult.getError());

    const config = configResult.getValue();

    return deps.database.runInTransaction(async (client) => {
      const appSettingsRepository = deps.appSettingsRepository.withDatabase(client);
      const cronJobsRepository = deps.cronJobsRepository.withDatabase(client);

      const settingsResult = await appSettingsRepository.update({
        defaultTargetJid: config.targetJid,
        timezone: config.timezone,
      });
      if (settingsResult.isFailure) return failure(settingsResult.getError());

      const morningResult = await cronJobsRepository.create({
        name: "Matutino",
        scheduleTime: config.morning.time,
        days: config.morning.days,
        enabled: config.morning.enabled,
        targetJid: config.targetJid,
        messages: [{
          contentType: "static_template",
          staticTemplate: config.morning.message,
          llmPrompt: null,
          llmModel: null,
          fallbackMessages: null,
        }],
        contentType: "static_template",
        staticTemplate: config.morning.message,
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: null,
      });
      if (morningResult.isFailure) return failure(morningResult.getError());

      const nightResult = await cronJobsRepository.create({
        name: "Nocturno",
        scheduleTime: config.night.time,
        days: config.night.days,
        enabled: config.night.enabled,
        targetJid: config.targetJid,
        messages: [{
          contentType: "static_template",
          staticTemplate: config.night.message,
          llmPrompt: null,
          llmModel: null,
          fallbackMessages: null,
        }],
        contentType: "static_template",
        staticTemplate: config.night.message,
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: null,
      });
      if (nightResult.isFailure) return failure(nightResult.getError());

      return success("imported");
    });
  };

  return { importIfEmpty };
};

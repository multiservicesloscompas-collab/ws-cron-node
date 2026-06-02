import { failure, success, type Result } from "../../types/result.ts";
import {
  normalizeAppSettingsInput,
  type AppSettingsInput,
} from "./app-settings.ts";
import {
  normalizeCronJobInput,
  validateCronJobId,
  type CronJobInput,
} from "./cron-job.ts";
import type { AppSettingsRepository } from "./make-app-settings-repository.ts";
import type { CronJobsRepository } from "./make-cron-jobs-repository.ts";
import type { CronRuntimeState } from "./cron-runtime.ts";

export interface CronServiceDeps {
  appSettingsRepository: AppSettingsRepository;
  cronJobsRepository: CronJobsRepository;
}

export const makeCronService = (deps: CronServiceDeps) => {
  const getRuntimeState = async (): Promise<Result<CronRuntimeState, string>> => {
    const settingsResult = await deps.appSettingsRepository.get();
    if (settingsResult.isFailure) return failure(settingsResult.getError());

    const cronJobsResult = await deps.cronJobsRepository.list();
    if (cronJobsResult.isFailure) return failure(cronJobsResult.getError());

    return success({
      settings: settingsResult.getValue(),
      cronJobs: cronJobsResult.getValue(),
    });
  };

  const updateSettings = async (
    input: unknown,
  ): Promise<Result<CronRuntimeState, string>> => {
    const normalizedResult = normalizeAppSettingsInput(input);
    if (normalizedResult.isFailure) return failure(normalizedResult.getError());

    const updateResult = await deps.appSettingsRepository.update(
      normalizedResult.getValue(),
    );
    if (updateResult.isFailure) return failure(updateResult.getError());

    return getRuntimeState();
  };

  const createCronJob = async (
    input: unknown,
  ): Promise<Result<CronRuntimeState, string>> => {
    const normalizedResult = normalizeCronJobInput(input);
    if (normalizedResult.isFailure) return failure(normalizedResult.getError());

    const settingsResult = await deps.appSettingsRepository.get();
    if (settingsResult.isFailure) return failure(settingsResult.getError());

    const normalized = normalizedResult.getValue();
    const withDefaultTarget: CronJobInput = {
      ...normalized,
      targetJid: normalized.targetJid || settingsResult.getValue().defaultTargetJid,
    };

    const createResult = await deps.cronJobsRepository.create(withDefaultTarget);
    if (createResult.isFailure) return failure(createResult.getError());

    return getRuntimeState();
  };

  const updateCronJob = (
    id: string,
    input: unknown,
  ): Promise<Result<CronRuntimeState, string>> => {
    return (async () => {
      const idResult = validateCronJobId(id);
      if (idResult.isFailure) return failure(idResult.getError());

      const normalizedResult = normalizeCronJobInput(input);
      if (normalizedResult.isFailure) return failure(normalizedResult.getError());

      const updateResult = await deps.cronJobsRepository.update(
        id,
        normalizedResult.getValue(),
      );
      if (updateResult.isFailure) return failure(updateResult.getError());

      return getRuntimeState();
    })();
  };

  const deleteCronJob = async (id: string): Promise<Result<CronRuntimeState, string>> => {
    const deleteResult = await deps.cronJobsRepository.delete(id);
    if (deleteResult.isFailure) return failure(deleteResult.getError());

    return getRuntimeState();
  };

  const markTriggered = (id: string): Promise<Result<void, string>> => {
    return deps.cronJobsRepository.markTriggered(id);
  };

  return {
    getRuntimeState,
    updateSettings,
    createCronJob,
    updateCronJob,
    deleteCronJob,
    markTriggered,
  };
};

export type CronService = ReturnType<typeof makeCronService>;

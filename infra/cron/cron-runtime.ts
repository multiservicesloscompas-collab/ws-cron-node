import type { AppSettings } from "./app-settings.ts";
import type { CronJob } from "./cron-job.ts";

export interface CronRuntimeState {
  settings: AppSettings;
  cronJobs: CronJob[];
}

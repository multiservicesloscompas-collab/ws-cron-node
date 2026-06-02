import { failure, type Result } from "../../types/result.ts";
import {
  type CronConfig,
  type CronConfigManager,
  normalizeCronConfig,
} from "../../infra/cron/make-cron-config.ts";

export const resolveTriggerConfig = async (
  req: Request,
  cronConfig: CronConfigManager,
): Promise<Result<CronConfig, string>> => {
  const bodyText = await req.text();

  if (!bodyText.trim()) {
    return cronConfig.read();
  }

  try {
    const body = JSON.parse(bodyText) as { config?: unknown };
    if (!body.config) {
      return failure('Se requiere el objeto "config"');
    }

    return normalizeCronConfig(body.config);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(`JSON inválido: ${reason}`);
  }
};

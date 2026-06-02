import { isFailure, type Result } from "../../types/result.ts";
import type {
  CronConfig,
  CronConfigManager,
} from "../../infra/cron/make-cron-config.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "./http-responses.ts";
import { resolveTriggerConfig } from "./resolve-trigger-config.ts";

export const handleManualTrigger = async (
  req: Request,
  cronConfig: CronConfigManager,
  trigger: (config: CronConfig) => Promise<Result<void, string>>,
  successMessage: string,
): Promise<Response> => {
  const configResult = await resolveTriggerConfig(req, cronConfig);
  if (isFailure(configResult)) {
    return corsHeaders(errorResponse(configResult.getError()));
  }

  const result = await trigger(configResult.getValue());
  if (isFailure(result)) {
    return corsHeaders(errorResponse(result.getError()));
  }

  return corsHeaders(successResponse({ message: successMessage }));
};

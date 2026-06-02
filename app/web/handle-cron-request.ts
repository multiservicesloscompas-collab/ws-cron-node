import { isFailure } from "../../types/result.ts";
import type { CronScheduler } from "../../infra/cron/make-cron-scheduler.ts";
import type {
  CronExecutionMode,
  CronJob,
  CronJobMessage,
} from "../../infra/cron/cron-job.ts";
import type { CronRuntimeState } from "../../infra/cron/cron-runtime.ts";
import type { CronService } from "../../infra/cron/make-cron-service.ts";
import { syncCronTargetContacts } from "../../infra/cron/sync-cron-target-contacts.ts";
import type { SystemContactSync } from "../../infra/contacts/make-system-contact-sync.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "./http-responses.ts";

export interface CronRouteDeps {
  cronService: CronService;
  cronScheduler: CronScheduler;
  systemContactSync?: SystemContactSync | null;
  getOwnJid: () => string;
}

type SerializableCronJob = Partial<CronJob> & {
  [key: string]: unknown;
};

const hydrateCronMessages = (
  cronJob: SerializableCronJob,
): CronJobMessage[] => {
  if (Array.isArray(cronJob.messages) && cronJob.messages.length > 0) {
    return cronJob.messages;
  }

  return [{
    contentType: cronJob.contentType === "llm_generated"
      ? "llm_generated"
      : "static_template",
    staticTemplate: typeof cronJob.staticTemplate === "string"
      ? cronJob.staticTemplate
      : null,
    llmPrompt: typeof cronJob.llmPrompt === "string" ? cronJob.llmPrompt : null,
    llmModel: typeof cronJob.llmModel === "string" ? cronJob.llmModel : null,
    fallbackMessages: Array.isArray(cronJob.fallbackMessages)
      ? cronJob.fallbackMessages.filter((entry): entry is string => typeof entry === "string")
      : null,
  }];
};

const hydrateCronExecutionMode = (
  cronJob: SerializableCronJob,
): CronExecutionMode => {
  return cronJob.executionMode === "random_single"
    ? "random_single"
    : "sequence";
};

const serializeCronJob = (
  cronJob: CronJob | SerializableCronJob,
) => {
  const serializableCronJob = cronJob as SerializableCronJob;
  const messages = hydrateCronMessages(serializableCronJob);
  const firstMessage = messages[0];

  return {
    ...serializableCronJob,
    executionMode: hydrateCronExecutionMode(serializableCronJob),
    messages,
    contentType: firstMessage.contentType,
    staticTemplate: firstMessage.staticTemplate,
    llmPrompt: firstMessage.llmPrompt,
    llmModel: firstMessage.llmModel,
    fallbackMessages: firstMessage.fallbackMessages,
  };
};

const serializeRuntimeState = (state: CronRuntimeState) => ({
  settings: state.settings,
  cronJobs: state.cronJobs.map((cronJob) => serializeCronJob(cronJob)),
});

const getCronJobPayload = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const payload = body as Record<string, unknown>;
  return payload.cronJob ?? body;
};

const reloadRuntime = (
  state: CronRuntimeState,
  deps: CronRouteDeps,
): Promise<void> => {
  return (async () => {
    deps.cronScheduler.reload(state);
    await syncCronTargetContacts(state, deps.systemContactSync, deps.getOwnJid());
  })();
};

export const handleCronRequest = async (
  req: Request,
  path: string,
  deps: CronRouteDeps,
): Promise<Response | null> => {
  if (req.method === "GET" && path === "/api/runtime") {
    const stateResult = await deps.cronService.getRuntimeState();
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError()));
    }

    const state = stateResult.getValue();
    return corsHeaders(successResponse(serializeRuntimeState(state)));
  }

  if (req.method === "GET" && path === "/api/settings") {
    const stateResult = await deps.cronService.getRuntimeState();
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError()));
    }

    return corsHeaders(successResponse({ settings: stateResult.getValue().settings }));
  }

  if (req.method === "PUT" && path === "/api/settings") {
    const body = await req.json() as { settings?: unknown };
    const stateResult = await deps.cronService.updateSettings(body?.settings);
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError()));
    }

    const state = stateResult.getValue();
    await reloadRuntime(state, deps);
    return corsHeaders(successResponse(serializeRuntimeState(state)));
  }

  if (req.method === "GET" && path === "/api/crons") {
    const stateResult = await deps.cronService.getRuntimeState();
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError()));
    }

    return corsHeaders(successResponse({
      cronJobs: stateResult.getValue().cronJobs.map((cronJob) => serializeCronJob(cronJob)),
    }));
  }

  if (req.method === "POST" && path === "/api/crons") {
    const body = await req.json();
    const stateResult = await deps.cronService.createCronJob(getCronJobPayload(body));
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError()));
    }

    const state = stateResult.getValue();
    await reloadRuntime(state, deps);
    return corsHeaders(successResponse(serializeRuntimeState(state)));
  }

  if (!path.startsWith("/api/crons/")) return null;

  const suffix = path.replace("/api/crons/", "");
  const isTriggerPath = suffix.endsWith("/trigger");
  const cronId = decodeURIComponent(
    isTriggerPath ? suffix.replace(/\/trigger$/, "") : suffix,
  );

  if (!cronId) {
    return corsHeaders(errorResponse("Se requiere el id del cron"));
  }

  if (req.method === "PUT" && !isTriggerPath) {
    const body = await req.json();
    const stateResult = await deps.cronService.updateCronJob(
      cronId,
      getCronJobPayload(body),
    );
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError()));
    }

    const state = stateResult.getValue();
    await reloadRuntime(state, deps);
    return corsHeaders(successResponse(serializeRuntimeState(state)));
  }

  if (req.method === "DELETE" && !isTriggerPath) {
    const stateResult = await deps.cronService.deleteCronJob(cronId);
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError(), 404));
    }

    const state = stateResult.getValue();
    await reloadRuntime(state, deps);
    return corsHeaders(successResponse(serializeRuntimeState(state)));
  }

  if (req.method === "POST" && isTriggerPath) {
    const stateResult = await deps.cronService.getRuntimeState();
    if (isFailure(stateResult)) {
      return corsHeaders(errorResponse(stateResult.getError()));
    }

    const state = stateResult.getValue();
    const cronJob = state.cronJobs.find((entry) => entry.id === cronId);
    if (!cronJob) {
      return corsHeaders(errorResponse("Cron job no encontrado", 404));
    }

    const triggerResult = await deps.cronScheduler.triggerCronJob(
      cronJob,
      state.settings,
    );
    if (isFailure(triggerResult)) {
      return corsHeaders(errorResponse(triggerResult.getError()));
    }

    const freshState = await deps.cronService.getRuntimeState();
    if (isFailure(freshState)) {
      return corsHeaders(errorResponse(freshState.getError()));
    }

    return corsHeaders(successResponse({
      message: `✅ Cron "${cronJob.name}" ejecutado correctamente`,
      cronJob: serializeCronJob(
        freshState.getValue().cronJobs.find((entry) => entry.id === cronId) ?? cronJob,
      ),
    }));
  }

  return null;
};

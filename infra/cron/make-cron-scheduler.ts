import { failure, isFailure, type Result, success } from "../../types/result.ts";
import type { AppSettings } from "./app-settings.ts";
import type { CronJob, CronJobMessage } from "./cron-job.ts";
import type { CronRuntimeState } from "./cron-runtime.ts";
import {
  resolveCronExecutionPlan,
  type CronMessageRenderer,
  type RenderedCronMessage,
} from "./make-cron-message-renderer.ts";
import { getZonedDateParts, isDayMatch } from "./cron-time.ts";

export interface CronSchedulerDeps {
  sendMessage: (jid: string, text: string) => Promise<Result<void, string>>;
  messageRenderer: CronMessageRenderer;
  onTriggered?: (cronJobId: string) => void;
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface CronScheduler {
  startAll: (state: CronRuntimeState) => void;
  stopAll: () => void;
  reload: (state: CronRuntimeState) => void;
  triggerCronJob: (
    cronJob: CronJob,
    settings: AppSettings,
  ) => Promise<Result<void, string>>;
}

const CHECK_INTERVAL_MS = 30_000;
const LLM_RETRY_DELAYS_MS = [2_000, 5_000, 8_000] as const;
const AUTOMATIC_RETRY_WINDOW_MS = 3 * 60_000;

interface PendingAutomaticRetry {
  fireKey: string;
  retryUntilMs: number;
}

const chooseFallbackMessage = (
  renderedMessage: Pick<RenderedCronMessage, "fallbackMessages">,
  random: () => number,
): string | null => {
  if (!renderedMessage.fallbackMessages?.length) return null;

  const index = Math.min(
    renderedMessage.fallbackMessages.length - 1,
    Math.floor(random() * renderedMessage.fallbackMessages.length),
  );
  return renderedMessage.fallbackMessages[index] ?? null;
};

export const makeCronScheduler = (deps: CronSchedulerDeps): CronScheduler => {
  let checkInterval: ReturnType<typeof setInterval> | null = null;
  let currentState: CronRuntimeState | null = null;
  let lastFired = new Map<string, string>();
  let inFlight = new Set<string>();
  let pendingRetries = new Map<string, PendingAutomaticRetry>();
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;

  const renderLlmMessageWithRetries = async (
    message: CronJobMessage,
    settings: AppSettings,
    label: string,
  ): Promise<Result<RenderedCronMessage, string>> => {
    let lastError = "Error desconocido al generar mensaje con LLM";

    for (let attempt = 0; attempt <= LLM_RETRY_DELAYS_MS.length; attempt++) {
      const renderedResult = await deps.messageRenderer.renderMessage(message, settings);
      if (!isFailure(renderedResult)) return success(renderedResult.getValue());

      lastError = renderedResult.getError();
      console.warn(`[${label}] Intento ${attempt + 1} de LLM falló: ${lastError}`);

      if (attempt < LLM_RETRY_DELAYS_MS.length) {
        await wait(LLM_RETRY_DELAYS_MS[attempt]);
      }
    }

    return failure(lastError);
  };

  const executeCronJob = async (
    cronJob: CronJob,
    settings: AppSettings,
    label: string,
  ): Promise<Result<void, string>> => {
    if (!cronJob.targetJid) {
      return failure("No hay JID destino configurado para este cron");
    }

    const executionPlan = resolveCronExecutionPlan(cronJob, random);

    for (const message of executionPlan.messages) {
      const renderedResult = message.contentType === "llm_generated"
        ? await renderLlmMessageWithRetries(message, settings, label)
        : await deps.messageRenderer.renderMessage(message, settings);

      if (isFailure(renderedResult)) {
        if (message.contentType !== "llm_generated") {
          console.error(`[${label}] ${renderedResult.getError()}`);
          return failure(renderedResult.getError());
        }

        const fallbackMessage = chooseFallbackMessage({ fallbackMessages: message.fallbackMessages }, random);
        if (!fallbackMessage) {
          console.error(`[${label}] ${renderedResult.getError()}`);
          return failure(renderedResult.getError());
        }

        const fallbackSendResult = await deps.sendMessage(cronJob.targetJid, fallbackMessage);
        if (isFailure(fallbackSendResult)) {
          console.error(`[${label}] ${fallbackSendResult.getError()}`);
          return failure(fallbackSendResult.getError());
        }

        console.log(`[${label}] Mensaje fallback enviado correctamente`);
        continue;
      }

      const renderedMessage = renderedResult.getValue();
      const sendResult = await deps.sendMessage(cronJob.targetJid, renderedMessage.text);
      if (isFailure(sendResult)) {
        console.error(`[${label}] ${sendResult.getError()}`);
        return failure(sendResult.getError());
      }
    }

    deps.onTriggered?.(cronJob.id);
    console.log(`[${label}] Mensajes enviados correctamente`);
    return success(undefined);
  };

  const tick = async (): Promise<void> => {
    if (!currentState) return;

    const zoned = getZonedDateParts(currentState.settings.timezone);
    const nowMs = Date.now();

    for (const cronJob of currentState.cronJobs) {
      if (!cronJob.enabled) continue;
      if (!isDayMatch(cronJob.days, zoned.dayOfWeek)) continue;

      const fireKey = `${zoned.date}-${cronJob.scheduleTime}`;
      const pendingRetry = pendingRetries.get(cronJob.id);
      const isScheduledMinute = cronJob.scheduleTime === zoned.time;
      const isPendingRetry = pendingRetry?.fireKey === fireKey &&
        pendingRetry.retryUntilMs >= nowMs;

      if (pendingRetry && pendingRetry.retryUntilMs < nowMs) {
        pendingRetries.delete(cronJob.id);
      }

      if (!isScheduledMinute && !isPendingRetry) continue;
      if (lastFired.get(cronJob.id) === fireKey) continue;
      const executionKey = `${cronJob.id}:${fireKey}`;
      if (inFlight.has(executionKey)) continue;

      inFlight.add(executionKey);

      try {
        const result = await executeCronJob(
          cronJob,
          currentState.settings,
          `${cronJob.name} automático`,
        );

        if (!isFailure(result)) {
          lastFired.set(cronJob.id, fireKey);
          pendingRetries.delete(cronJob.id);
        } else if (!pendingRetry) {
          pendingRetries.set(cronJob.id, {
            fireKey,
            retryUntilMs: nowMs + AUTOMATIC_RETRY_WINDOW_MS,
          });
        }
      } finally {
        inFlight.delete(executionKey);
      }
    }
  };

  const startAll = (state: CronRuntimeState): void => {
    currentState = state;
    lastFired = new Map();
    inFlight = new Set();
    pendingRetries = new Map();

    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(tick, CHECK_INTERVAL_MS);

    console.log("✅ CRON scheduler iniciado");
    for (const cronJob of state.cronJobs) {
      console.log(
        `   ${cronJob.enabled ? "⏰" : "⏸️"} ${cronJob.name}: ${cronJob.scheduleTime} (${cronJob.days})`,
      );
    }

    tick();
  };

  const stopAll = (): void => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }

    currentState = null;
    lastFired = new Map();
    inFlight = new Set();
    pendingRetries = new Map();
    console.log("CRON scheduler detenido");
  };

  const reload = (state: CronRuntimeState): void => {
    console.log("Recargando cron jobs...");
    startAll(state);
  };

  const triggerCronJob = (
    cronJob: CronJob,
    settings: AppSettings,
  ): Promise<Result<void, string>> => {
    return executeCronJob(cronJob, settings, `${cronJob.name} manual`);
  };

  return {
    startAll,
    stopAll,
    reload,
    triggerCronJob,
  };
};

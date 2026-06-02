import {
  failure,
  success,
  type Result,
} from "../../types/result.ts";
import { makeScheduleTime } from "../../domain/value-objects/schedule-time.ts";

export const CRON_CONTENT_TYPES = ["static_template", "llm_generated"] as const;
export const CRON_EXECUTION_MODES = ["sequence", "random_single"] as const;

export type CronContentType = typeof CRON_CONTENT_TYPES[number];
export type CronExecutionMode = typeof CRON_EXECUTION_MODES[number];

export interface CronJobMessage {
  contentType: CronContentType;
  staticTemplate: string | null;
  llmPrompt: string | null;
  llmModel: string | null;
  fallbackMessages: string[] | null;
}

export interface CronJob {
  id: string;
  name: string;
  scheduleTime: string;
  days: string;
  enabled: boolean;
  targetJid: string;
  executionMode: CronExecutionMode;
  messages: CronJobMessage[];
  contentType: CronContentType;
  staticTemplate: string | null;
  llmPrompt: string | null;
  llmModel: string | null;
  fallbackMessages: string[] | null;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt: string | null;
}

export interface CronJobInput {
  name: string;
  scheduleTime: string;
  days: string;
  enabled: boolean;
  targetJid: string;
  executionMode?: CronExecutionMode;
  messages?: CronJobMessage[] | null;
  contentType?: CronContentType;
  staticTemplate?: string | null;
  llmPrompt?: string | null;
  llmModel?: string | null;
  fallbackMessages?: string[] | null;
}

export interface NormalizedCronJobInput {
  name: string;
  scheduleTime: string;
  days: string;
  enabled: boolean;
  targetJid: string;
  executionMode: CronExecutionMode;
  messages: CronJobMessage[];
  contentType: CronContentType;
  staticTemplate: string | null;
  llmPrompt: string | null;
  llmModel: string | null;
  fallbackMessages: string[] | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_LLM_MODEL = "gemini-2.5-flash";

const isCronContentType = (value: string): value is CronContentType => {
  return CRON_CONTENT_TYPES.includes(value as CronContentType);
};

const normalizeExecutionMode = (value: unknown): CronExecutionMode => {
  return value === "random_single" ? "random_single" : "sequence";
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeFallbackMessages = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;

  const normalized = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalized.length ? normalized : null;
};

const normalizeCronJobMessage = (
  value: unknown,
  index: number,
): Result<CronJobMessage, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failure(`El mensaje ${index + 1} del cron no es válido`);
  }

  const raw = value as Record<string, unknown>;
  const contentType = typeof raw.contentType === "string"
    ? raw.contentType.trim()
    : "";

  if (!isCronContentType(contentType)) {
    return failure(`El tipo de contenido del mensaje ${index + 1} no es válido`);
  }

  const staticTemplate = normalizeOptionalText(raw.staticTemplate);
  const llmPrompt = normalizeOptionalText(raw.llmPrompt);
  const llmModel = normalizeOptionalText(raw.llmModel) ?? DEFAULT_LLM_MODEL;
  const fallbackMessages = normalizeFallbackMessages(raw.fallbackMessages);

  if (contentType === "static_template" && !staticTemplate) {
    return failure(
      `La plantilla estática es obligatoria para el mensaje ${index + 1}`,
    );
  }

  if (contentType === "llm_generated" && !llmPrompt) {
    return failure(`El prompt es obligatorio para el mensaje ${index + 1}`);
  }

  return success({
    contentType,
    staticTemplate,
    llmPrompt,
    llmModel: contentType === "llm_generated" ? llmModel : null,
    fallbackMessages: contentType === "llm_generated" ? fallbackMessages : null,
  });
};

const normalizeCronJobMessages = (
  raw: Record<string, unknown>,
): Result<CronJobMessage[], string> => {
  if (raw.messages == null) {
    const legacyMessageResult = normalizeCronJobMessage(raw, 0);
    if (legacyMessageResult.isFailure) return failure(legacyMessageResult.getError());
    return success([legacyMessageResult.getValue()]);
  }

  if (!Array.isArray(raw.messages)) {
    return failure("Los mensajes del cron deben enviarse en un arreglo válido");
  }

  if (raw.messages.length < 1 || raw.messages.length > 4) {
    return failure("El cron debe tener entre 1 y 4 mensajes");
  }

  const normalizedMessages: CronJobMessage[] = [];
  for (const [index, message] of raw.messages.entries()) {
    const messageResult = normalizeCronJobMessage(message, index);
    if (messageResult.isFailure) return failure(messageResult.getError());
    normalizedMessages.push(messageResult.getValue());
  }

  return success(normalizedMessages);
};

export const validateCronJobId = (id: string): Result<string, string> => {
  if (!UUID_RE.test(id)) {
    return failure("El id del cron debe ser un UUID válido");
  }

  return success(id);
};

export const normalizeCronJobInput = (
  value: unknown,
): Result<NormalizedCronJobInput, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failure("Se requiere un objeto cron válido");
  }

  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const scheduleTime = typeof raw.scheduleTime === "string"
    ? raw.scheduleTime.trim()
    : "";
  const days = typeof raw.days === "string" ? raw.days.trim() : "";
  const targetJid = typeof raw.targetJid === "string"
    ? raw.targetJid.trim()
    : "";
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
  const executionMode = normalizeExecutionMode(raw.executionMode);

  if (!name) return failure("El nombre del cron es obligatorio");
  if (!scheduleTime) return failure("La hora del cron es obligatoria");
  if (!days) return failure("Los días del cron son obligatorios");
  if (!targetJid) return failure("El destino del cron es obligatorio");

  const timeResult = makeScheduleTime(scheduleTime);
  if (timeResult.isFailure) return failure(timeResult.getError());

  const messagesResult = normalizeCronJobMessages(raw);
  if (messagesResult.isFailure) return failure(messagesResult.getError());

  const messages = messagesResult.getValue();
  const firstMessage = messages[0];

  return success({
    name,
    scheduleTime,
    days,
    enabled,
    targetJid,
    executionMode,
    messages,
    contentType: firstMessage.contentType,
    staticTemplate: firstMessage.staticTemplate,
    llmPrompt: firstMessage.llmPrompt,
    llmModel: firstMessage.llmModel,
    fallbackMessages: firstMessage.fallbackMessages,
  });
};

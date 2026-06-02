import { failure, success, type Result } from "../../types/result.ts";
import type { PostgresQueryable } from "../postgres/postgres-types.ts";
import {
  normalizeCronJobInput,
  validateCronJobId,
  type CronContentType,
  type CronExecutionMode,
  type CronJob,
  type CronJobInput,
  type CronJobMessage,
} from "./cron-job.ts";

export interface CronJobsRepositoryDeps {
  database: PostgresQueryable;
}

export interface CronJobsRepository {
  count: () => Promise<Result<number, string>>;
  list: () => Promise<Result<CronJob[], string>>;
  findById: (id: CronJobIdentifier) => Promise<Result<CronJob | null, string>>;
  create: (input: CronJobInput, id?: CronJobIdentifier) => Promise<Result<CronJob, string>>;
  update: (id: CronJobIdentifier, input: CronJobInput) => Promise<Result<CronJob, string>>;
  delete: (id: CronJobIdentifier) => Promise<Result<void, string>>;
  markTriggered: (id: CronJobIdentifier) => Promise<Result<void, string>>;
  withDatabase: (database: PostgresQueryable) => CronJobsRepository;
}

interface CronJobRow {
  id: string;
  name: string;
  schedule_time: string;
  days: string;
  enabled: number | boolean;
  target_jid: string;
  execution_mode: CronExecutionMode;
  content_type: CronContentType;
  static_template: string | null;
  llm_prompt: string | null;
  llm_model: string | null;
  fallback_messages: string | null;
  message_sequence: string | null;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
}

type CronJobIdentifier = string;

const parseFallbackMessages = (value: string | null): string[] | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const normalized = parsed
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);

    return normalized.length ? normalized : null;
  } catch {
    return null;
  }
};

const serializeFallbackMessages = (value: string[] | null): string | null => {
  if (!value?.length) return null;
  return JSON.stringify(value);
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeMessageFallbackMessages = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;

  const normalized = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalized.length ? normalized : null;
};

const parseMessageSequence = (
  value: string | null,
  fallbackRow: Pick<
    CronJobRow,
    | "content_type"
    | "static_template"
    | "llm_prompt"
    | "llm_model"
    | "fallback_messages"
  >,
): CronJobMessage[] => {
  const fallbackMessage: CronJobMessage = {
    contentType: fallbackRow.content_type,
    staticTemplate: fallbackRow.static_template,
    llmPrompt: fallbackRow.llm_prompt,
    llmModel: fallbackRow.llm_model,
    fallbackMessages: parseFallbackMessages(fallbackRow.fallback_messages),
  };

  if (!value) return [fallbackMessage];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) return [fallbackMessage];

    const normalized = parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];

      const raw = entry as Record<string, unknown>;
      const contentType = raw.contentType === "llm_generated"
        ? "llm_generated"
        : raw.contentType === "static_template"
        ? "static_template"
        : null;

      if (!contentType) return [];

      const staticTemplate = normalizeOptionalText(raw.staticTemplate);
      const llmPrompt = normalizeOptionalText(raw.llmPrompt);
      const llmModel = normalizeOptionalText(raw.llmModel);
      const fallbackMessages = normalizeMessageFallbackMessages(
        raw.fallbackMessages,
      );

      if (contentType === "static_template" && !staticTemplate) return [];
      if (contentType === "llm_generated" && !llmPrompt) return [];

      return [{
        contentType,
        staticTemplate,
        llmPrompt,
        llmModel: contentType === "llm_generated" ? llmModel : null,
        fallbackMessages: contentType === "llm_generated" ? fallbackMessages : null,
      } satisfies CronJobMessage];
    });

    return normalized.length ? normalized : [fallbackMessage];
  } catch {
    return [fallbackMessage];
  }
};

const serializeMessageSequence = (messages: CronJobMessage[]): string => {
  return JSON.stringify(messages);
};

const toCronJob = (row: CronJobRow): CronJob => {
  const messages = parseMessageSequence(row.message_sequence, row);
  const firstMessage = messages[0];

  return {
    id: row.id,
    name: row.name,
    scheduleTime: row.schedule_time,
    days: row.days,
    enabled: Boolean(row.enabled),
    targetJid: row.target_jid,
    executionMode: row.execution_mode === "random_single"
      ? "random_single"
      : "sequence",
    messages,
    contentType: firstMessage.contentType,
    staticTemplate: firstMessage.staticTemplate,
    llmPrompt: firstMessage.llmPrompt,
    llmModel: firstMessage.llmModel,
    fallbackMessages: firstMessage.fallbackMessages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTriggeredAt: row.last_triggered_at,
  };
};

export const makeCronJobsRepository = (
  deps: CronJobsRepositoryDeps,
): CronJobsRepository => {
  const count = async (): Promise<Result<number, string>> => {
    try {
      const result = await deps.database.query(`
        SELECT COUNT(*)::int AS total
        FROM cron_jobs
      `);
      const row = result.rows[0] as { total: number } | undefined;
      return success(Number(row?.total ?? 0));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al contar cron jobs: ${reason}`);
    }
  };

  const list = async (): Promise<Result<CronJob[], string>> => {
    try {
      const result = await deps.database.query(`
        SELECT *
        FROM cron_jobs
        ORDER BY lower(name), created_at
      `);
      const rows = result.rows as unknown as CronJobRow[];
      return success(rows.map(toCronJob));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al listar cron jobs: ${reason}`);
    }
  };

  const findById = async (id: string): Promise<Result<CronJob | null, string>> => {
    const idResult = validateCronJobId(id);
    if (idResult.isFailure) return failure(idResult.getError());

    try {
      const result = await deps.database.query(
        `
          SELECT *
          FROM cron_jobs
          WHERE id = $1
        `,
        [id],
      );
      const row = result.rows[0] as unknown as CronJobRow | undefined;
      return success(row ? toCronJob(row) : null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al buscar cron job: ${reason}`);
    }
  };

  const create = (
    input: CronJobInput,
    id: CronJobIdentifier = crypto.randomUUID(),
  ): Promise<Result<CronJob, string>> => {
    return (async () => {
      const idResult = validateCronJobId(id);
      if (idResult.isFailure) return failure(idResult.getError());

      const normalizedResult = normalizeCronJobInput(input);
      if (normalizedResult.isFailure) return failure(normalizedResult.getError());

      try {
        const normalized = normalizedResult.getValue();
        const now = new Date().toISOString();

        await deps.database.query(
          `
            INSERT INTO cron_jobs (
              id, name, schedule_time, days, enabled, target_jid, execution_mode, content_type,
              static_template, llm_prompt, llm_model, fallback_messages, message_sequence, created_at, updated_at, last_triggered_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, $11, $12, $13, $14, $15, $16
            )
          `,
          [
            id,
            normalized.name,
            normalized.scheduleTime,
            normalized.days,
            normalized.enabled,
            normalized.targetJid,
            normalized.executionMode,
            normalized.contentType,
            normalized.staticTemplate,
            normalized.llmPrompt,
            normalized.llmModel,
            serializeFallbackMessages(normalized.fallbackMessages),
            serializeMessageSequence(normalized.messages),
            now,
            now,
            null,
          ],
        );

        const createdResult = await findById(id);
        if (createdResult.isFailure) return failure(createdResult.getError());
        if (!createdResult.getValue()) return failure("Cron job no encontrado");
        return success(createdResult.getValue()!);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`Error al crear cron job: ${reason}`);
      }
    })();
  };

  const update = (
    id: string,
    input: CronJobInput,
  ): Promise<Result<CronJob, string>> => {
    return (async () => {
      const idResult = validateCronJobId(id);
      if (idResult.isFailure) return failure(idResult.getError());

      const normalizedResult = normalizeCronJobInput(input);
      if (normalizedResult.isFailure) return failure(normalizedResult.getError());

      try {
        const normalized = normalizedResult.getValue();
        const result = await deps.database.query(
          `
            UPDATE cron_jobs
            SET name = $1, schedule_time = $2, days = $3, enabled = $4, target_jid = $5,
                execution_mode = $6, content_type = $7, static_template = $8, llm_prompt = $9,
                llm_model = $10, fallback_messages = $11, message_sequence = $12, updated_at = $13
            WHERE id = $14
          `,
          [
            normalized.name,
            normalized.scheduleTime,
            normalized.days,
            normalized.enabled,
            normalized.targetJid,
            normalized.executionMode,
            normalized.contentType,
            normalized.staticTemplate,
            normalized.llmPrompt,
            normalized.llmModel,
            serializeFallbackMessages(normalized.fallbackMessages),
            serializeMessageSequence(normalized.messages),
            new Date().toISOString(),
            id,
          ],
        );

        if ((result.rowCount ?? 0) === 0) return failure("Cron job no encontrado");

        const updatedResult = await findById(id);
        if (updatedResult.isFailure) return failure(updatedResult.getError());
        if (!updatedResult.getValue()) return failure("Cron job no encontrado");
        return success(updatedResult.getValue()!);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`Error al actualizar cron job: ${reason}`);
      }
    })();
  };

  const remove = async (id: string): Promise<Result<void, string>> => {
    const idResult = validateCronJobId(id);
    if (idResult.isFailure) return failure(idResult.getError());

    try {
      const result = await deps.database.query(
        `
          DELETE FROM cron_jobs
          WHERE id = $1
        `,
        [id],
      );
      if ((result.rowCount ?? 0) === 0) return failure("Cron job no encontrado");
      return success(undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al eliminar cron job: ${reason}`);
    }
  };

  const markTriggered = async (id: string): Promise<Result<void, string>> => {
    const idResult = validateCronJobId(id);
    if (idResult.isFailure) return failure(idResult.getError());

    try {
      const now = new Date().toISOString();
      const result = await deps.database.query(
        `
          UPDATE cron_jobs
          SET last_triggered_at = $1, updated_at = $2
          WHERE id = $3
        `,
        [now, now, id],
      );
      if ((result.rowCount ?? 0) === 0) return failure("Cron job no encontrado");
      return success(undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al actualizar última ejecución: ${reason}`);
    }
  };

  return {
    count,
    list,
    findById,
    create,
    update,
    delete: remove,
    markTriggered,
    withDatabase: (database) => makeCronJobsRepository({ database }),
  };
};

import { failure, isFailure, success, type Result } from "../../types/result.ts";
import type { LlmAdapter } from "../llm/llm-adapter.ts";
import type { AppSettings } from "./app-settings.ts";
import type {
  CronExecutionMode,
  CronJob,
  CronJobMessage,
} from "./cron-job.ts";
import { getZonedDateParts } from "./cron-time.ts";
import {
  createBasicTemplateValues,
  hasSalesTemplateVariables,
  renderCronTemplate,
} from "./render-cron-template.ts";

export interface CronMessageRendererDeps {
  llmAdapter: LlmAdapter;
  buildMorningMessage?: (
    date?: string,
    template?: string,
  ) => Promise<Result<string, string>>;
  buildNightMessage?: (
    date?: string,
    template?: string,
    time?: string,
  ) => Promise<Result<string, string>>;
}

export interface RenderedCronMessage {
  contentType: CronJobMessage["contentType"];
  text: string;
  fallbackMessages: string[] | null;
}

export interface ResolvedCronExecutionPlan {
  executionMode: CronExecutionMode;
  messages: CronJobMessage[];
}

export const getCronJobMessages = (cronJob: CronJob): CronJobMessage[] => {
  if (cronJob.messages?.length) return cronJob.messages;

  return [{
    contentType: cronJob.contentType,
    staticTemplate: cronJob.staticTemplate,
    llmPrompt: cronJob.llmPrompt,
    llmModel: cronJob.llmModel,
    fallbackMessages: cronJob.fallbackMessages,
  }];
};

export const getCronExecutionMode = (cronJob: CronJob): CronExecutionMode => {
  return cronJob.executionMode === "random_single" ? "random_single" : "sequence";
};

export const resolveCronExecutionPlan = (
  cronJob: CronJob,
  random: () => number,
): ResolvedCronExecutionPlan => {
  const messages = getCronJobMessages(cronJob);
  const executionMode = getCronExecutionMode(cronJob);

  if (executionMode !== "random_single" || messages.length <= 1) {
    return { executionMode, messages };
  }

  const index = Math.min(
    messages.length - 1,
    Math.floor(random() * messages.length),
  );

  return {
    executionMode,
    messages: [messages[index]],
  };
};

const renderStaticMessage = async (
  message: CronJobMessage,
  settings: AppSettings,
  deps: CronMessageRendererDeps,
): Promise<Result<string, string>> => {
  const template = message.staticTemplate || "";
  const zoned = getZonedDateParts(settings.timezone);

  if (template.includes("{{street_washers}}") && deps.buildMorningMessage) {
    return deps.buildMorningMessage(zoned.date, template);
  }

  if (hasSalesTemplateVariables(template) && deps.buildNightMessage) {
    return deps.buildNightMessage(zoned.date, template, zoned.time);
  }

  return success(
    renderCronTemplate(template, createBasicTemplateValues(zoned.date, zoned.time)).trim(),
  );
};

const renderPrompt = async (
  message: CronJobMessage,
  settings: AppSettings,
  deps: CronMessageRendererDeps,
): Promise<Result<string, string>> => {
  const prompt = message.llmPrompt || "";
  const zoned = getZonedDateParts(settings.timezone);

  if (prompt.includes("{{street_washers}}") && deps.buildMorningMessage) {
    return deps.buildMorningMessage(zoned.date, prompt);
  }

  if (hasSalesTemplateVariables(prompt) && deps.buildNightMessage) {
    return deps.buildNightMessage(zoned.date, prompt, zoned.time);
  }

  return success(
    renderCronTemplate(prompt, createBasicTemplateValues(zoned.date, zoned.time)).trim(),
  );
};

export const makeCronMessageRenderer = (deps: CronMessageRendererDeps) => {
  const renderMessage = async (
    message: CronJobMessage,
    settings: AppSettings,
  ): Promise<Result<RenderedCronMessage, string>> => {
    if (message.contentType === "static_template") {
      const renderedResult = await renderStaticMessage(message, settings, deps);
      if (isFailure(renderedResult)) return failure(renderedResult.getError());

      return success({
        contentType: message.contentType,
        text: renderedResult.getValue(),
        fallbackMessages: null,
      });
    }

    const promptResult = await renderPrompt(message, settings, deps);
    if (isFailure(promptResult)) return failure(promptResult.getError());

    const generatedResult = await deps.llmAdapter.generateText({
      prompt: promptResult.getValue(),
      model: message.llmModel || "gemini-2.5-flash",
    });
    if (isFailure(generatedResult)) return failure(generatedResult.getError());

    return success({
      contentType: message.contentType,
      text: generatedResult.getValue(),
      fallbackMessages: message.fallbackMessages ?? null,
    });
  };

  const render = async (
    cronJob: CronJob,
    settings: AppSettings,
  ): Promise<Result<RenderedCronMessage[], string>> => {
    const renderedMessages: RenderedCronMessage[] = [];

    for (const message of getCronJobMessages(cronJob)) {
      const renderedResult = await renderMessage(message, settings);
      if (isFailure(renderedResult)) return failure(renderedResult.getError());
      renderedMessages.push(renderedResult.getValue());
    }

    return success(renderedMessages);
  };

  return { render, renderMessage };
};

export type CronMessageRenderer = ReturnType<typeof makeCronMessageRenderer>;

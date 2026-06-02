import { assertEquals } from "#test-assert";
import { makeUnavailableLlmAdapter } from "../../llm/llm-adapter.ts";
import { makeCronMessageRenderer } from "../make-cron-message-renderer.ts";
import type { AppSettings } from "../app-settings.ts";
import type { CronJob } from "../cron-job.ts";
import { getZonedDateParts } from "../cron-time.ts";
import { success } from "../../../types/result.ts";

const settings: AppSettings = {
  defaultTargetJid: "saved@g.us",
  timezone: "America/Caracas",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseCronJob: CronJob = {
  id: "6cb4f1d0-80ad-4bc4-86d1-d74960f01656",
  name: "Nocturno",
  scheduleTime: "19:30",
  days: "1-6",
  enabled: true,
  targetJid: "saved@g.us",
  executionMode: "sequence",
  messages: [{
    contentType: "static_template",
    staticTemplate: "{{payment_category_summary}}",
    llmPrompt: null,
    llmModel: null,
    fallbackMessages: null,
  }],
  contentType: "static_template",
  staticTemplate: "{{payment_category_summary}}",
  llmPrompt: null,
  llmModel: null,
  fallbackMessages: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastTriggeredAt: null,
};

Deno.test("makeCronMessageRenderer routes payment_category_summary through night service", async () => {
  let receivedDate = "";
  let receivedTemplate = "";
  let receivedTime = "";

  const renderer = makeCronMessageRenderer({
    llmAdapter: makeUnavailableLlmAdapter("sin api key"),
    buildNightMessage: async (date, template, time) => {
      receivedDate = date ?? "";
      receivedTemplate = template ?? "";
      receivedTime = time ?? "";
      return success("Resumen nocturno");
    },
  });

  const result = await renderer.render(baseCronJob, settings);

  assertEquals(result.isFailure, false);
  assertEquals(result.getValue(), [{
    contentType: "static_template",
    text: "Resumen nocturno",
    fallbackMessages: null,
  }]);
  assertEquals(receivedTemplate, "{{payment_category_summary}}");
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(receivedDate), true);
  assertEquals(/^\d{2}:\d{2}$/.test(receivedTime), true);
});

Deno.test("makeCronMessageRenderer renders cron messages in configured order", async () => {
  const zoned = getZonedDateParts(settings.timezone);
  const prompts: string[] = [];
  const renderer = makeCronMessageRenderer({
    llmAdapter: {
      generateText: async ({ prompt }) => {
        prompts.push(prompt);
        return success(`LLM: ${prompt}`);
      },
    },
  });

  const result = await renderer.render({
    ...baseCronJob,
    messages: [
      {
        contentType: "static_template",
        staticTemplate: "Hola {{date}}",
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: null,
      },
      {
        contentType: "llm_generated",
        staticTemplate: null,
        llmPrompt: "Resumen de {{date}}",
        llmModel: "gemini-2.5-flash",
        fallbackMessages: ["Fallback del segundo mensaje"],
      },
    ],
  }, settings);

  assertEquals(result.isFailure, false);
  assertEquals(result.getValue().length, 2);
  assertEquals(result.getValue()[0], {
    contentType: "static_template",
    text: `Hola ${zoned.date}`,
    fallbackMessages: null,
  });
  assertEquals(result.getValue()[1], {
    contentType: "llm_generated",
    text: `LLM: Resumen de ${zoned.date}`,
    fallbackMessages: ["Fallback del segundo mensaje"],
  });
  assertEquals(prompts.length, 1);
});

Deno.test("makeCronMessageRenderer keeps legacy single-message crons working", async () => {
  const renderer = makeCronMessageRenderer({
    llmAdapter: makeUnavailableLlmAdapter("sin api key"),
  });

  const result = await renderer.render({
    ...baseCronJob,
    messages: [],
    staticTemplate: "Hola {{day}}",
  }, settings);

  assertEquals(result.isFailure, false);
  assertEquals(result.getValue().length, 1);
  assertEquals(result.getValue()[0]?.contentType, "static_template");
});

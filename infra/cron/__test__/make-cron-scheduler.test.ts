import { assertEquals } from "#test-assert";
import { makeCronScheduler } from "../make-cron-scheduler.ts";
import { makeCronMessageRenderer } from "../make-cron-message-renderer.ts";
import { makeUnavailableLlmAdapter } from "../../llm/llm-adapter.ts";
import type { AppSettings } from "../app-settings.ts";
import type { CronJob, CronJobMessage } from "../cron-job.ts";
import { failure, success } from "../../../types/result.ts";

const settings: AppSettings = {
  defaultTargetJid: "saved@g.us",
  timezone: "America/Caracas",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseCronJob: CronJob = {
  id: "3d10262b-4afd-48e3-b4bb-77b2810e1d25",
  name: "Matutino",
  scheduleTime: "08:30",
  days: "*",
  enabled: true,
  targetJid: "saved@g.us",
  executionMode: "sequence",
  messages: [{
    contentType: "static_template",
    staticTemplate: "Hola {{date}}",
    llmPrompt: null,
    llmModel: null,
    fallbackMessages: null,
  }],
  contentType: "static_template",
  staticTemplate: "Hola {{date}}",
  llmPrompt: null,
  llmModel: null,
  fallbackMessages: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastTriggeredAt: null,
};

const makeMessage = (message: Partial<CronJobMessage> & Pick<CronJobMessage, "contentType">): CronJobMessage => ({
  staticTemplate: null,
  llmPrompt: null,
  llmModel: null,
  fallbackMessages: null,
  ...message,
});

const makeCronJobWithMessages = (messages: CronJobMessage[], overrides: Partial<CronJob> = {}): CronJob => ({
  ...baseCronJob,
  ...overrides,
  messages,
});

const makeSingleLlmCronJob = (overrides: Partial<CronJob> = {}, messageOverrides: Partial<CronJobMessage> = {}): CronJob => makeCronJobWithMessages([
  makeMessage({
    contentType: "llm_generated",
    llmPrompt: "Escribe un resumen",
    llmModel: "gemini-2.5-flash",
    ...messageOverrides,
  }),
], {
  contentType: "llm_generated",
  staticTemplate: null,
  llmPrompt: "Escribe un resumen",
  llmModel: "gemini-2.5-flash",
  ...overrides,
});

Deno.test("makeCronScheduler triggers a static cron job", async () => {
  const sent: Array<{ jid: string; text: string }> = [];
  const renderer = makeCronMessageRenderer({
    llmAdapter: makeUnavailableLlmAdapter("sin api key"),
  });

  const scheduler = makeCronScheduler({
    sendMessage: async (jid, text) => {
      sent.push({ jid, text });
      return success(undefined);
    },
    messageRenderer: renderer,
  });

  const result = await scheduler.triggerCronJob(baseCronJob, settings);
  assertEquals(result.isFailure, false);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].jid, "saved@g.us");
});

Deno.test("makeCronScheduler propagates llm adapter failures in Spanish", async () => {
  const renderer = makeCronMessageRenderer({
    llmAdapter: makeUnavailableLlmAdapter("Falta configurar GEMINI_API_KEY en el archivo .env"),
  });

  const scheduler = makeCronScheduler({
    sendMessage: async () => success(undefined),
    messageRenderer: renderer,
    wait: async () => {},
  });

  const result = await scheduler.triggerCronJob(makeSingleLlmCronJob({
    id: "6685694e-2f51-4540-a66d-1404659b0b29",
    name: "Gemini",
  }), settings);

  assertEquals(result.isFailure, true);
  assertEquals(result.getError(), "Falta configurar GEMINI_API_KEY en el archivo .env");
});

Deno.test("makeCronScheduler retries llm generation with fixed backoff before fallback", async () => {
  const waits: number[] = [];
  const sent: Array<{ jid: string; text: string }> = [];
  let attempts = 0;
  let triggeredCount = 0;

  const scheduler = makeCronScheduler({
    sendMessage: async (jid, text) => {
      sent.push({ jid, text });
      return success(undefined);
    },
    messageRenderer: {
      render: async () => failure("No debería usarse en este test"),
      renderMessage: async () => {
        attempts += 1;
        return failure("Gemini no respondió");
      },
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    random: () => 0.75,
    onTriggered: () => {
      triggeredCount += 1;
    },
  });

  const result = await scheduler.triggerCronJob(makeSingleLlmCronJob({
    id: "6685694e-2f51-4540-a66d-1404659b0b29",
    name: "Gemini",
    fallbackMessages: ["Fallback 1", "Fallback 2"],
  }, { fallbackMessages: ["Fallback 1", "Fallback 2"] }), settings);

  assertEquals(result.isFailure, false);
  assertEquals(attempts, 4);
  assertEquals(waits, [2000, 5000, 8000]);
  assertEquals(sent, [{ jid: "saved@g.us", text: "Fallback 2" }]);
  assertEquals(triggeredCount, 1);
});

Deno.test("makeCronScheduler returns fallback send error after llm retries exhaust", async () => {
  const waits: number[] = [];
  const sent: Array<{ jid: string; text: string }> = [];
  let attempts = 0;
  let triggeredCount = 0;

  const scheduler = makeCronScheduler({
    sendMessage: async (jid, text) => {
      sent.push({ jid, text });
      return failure("No se pudo enviar el fallback");
    },
    messageRenderer: {
      render: async () => failure("No debería usarse en este test"),
      renderMessage: async () => {
        attempts += 1;
        return failure("Gemini no respondió");
      },
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    random: () => 0,
    onTriggered: () => {
      triggeredCount += 1;
    },
  });

  const result = await scheduler.triggerCronJob(makeSingleLlmCronJob({
    id: "b6fa8520-8df7-4134-a6d1-9461ce0393ee",
    name: "Gemini con fallback fallido",
    fallbackMessages: ["Fallback 1", "Fallback 2"],
  }, { fallbackMessages: ["Fallback 1", "Fallback 2"] }), settings);

  assertEquals(result.isFailure, true);
  assertEquals(result.getError(), "No se pudo enviar el fallback");
  assertEquals(attempts, 4);
  assertEquals(waits, [2000, 5000, 8000]);
  assertEquals(sent, [{ jid: "saved@g.us", text: "Fallback 1" }]);
  assertEquals(triggeredCount, 0);
});

Deno.test("makeCronScheduler succeeds after llm retries without fallback", async () => {
  const waits: number[] = [];
  let attempts = 0;
  const sent: Array<{ jid: string; text: string }> = [];

  const scheduler = makeCronScheduler({
    sendMessage: async (jid, text) => {
      sent.push({ jid, text });
      return success(undefined);
    },
    messageRenderer: {
      render: async () => failure("No debería usarse en este test"),
      renderMessage: async () => {
        attempts += 1;
        if (attempts < 3) {
          return failure("Gemini temporalmente caído");
        }

        return success({
          contentType: "llm_generated",
          text: "Mensaje generado",
          fallbackMessages: ["No debería usarse"],
        });
      },
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });

  const result = await scheduler.triggerCronJob(makeSingleLlmCronJob({
    id: "9f79fbb8-a2dd-4b58-bca1-b83acb677f01",
    name: "Gemini recuperado",
    fallbackMessages: ["No debería usarse"],
  }, { fallbackMessages: ["No debería usarse"] }), settings);

  assertEquals(result.isFailure, false);
  assertEquals(attempts, 3);
  assertEquals(waits, [2000, 5000]);
  assertEquals(sent, [{ jid: "saved@g.us", text: "Mensaje generado" }]);
});

Deno.test("makeCronScheduler sends multi-message cron jobs sequentially and marks triggered once", async () => {
  const sent: string[] = [];
  let triggeredCount = 0;

  const scheduler = makeCronScheduler({
    sendMessage: async (_jid, text) => {
      sent.push(text);
      return success(undefined);
    },
    messageRenderer: {
      render: async () => failure("No debería usarse en este test"),
      renderMessage: async (message) => {
        if (message.contentType === "static_template") {
          return success({
            contentType: "static_template",
            text: message.staticTemplate ?? "",
            fallbackMessages: null,
          });
        }

        return success({
          contentType: "llm_generated",
          text: message.llmPrompt ?? "",
          fallbackMessages: message.fallbackMessages,
        });
      },
    },
    onTriggered: () => {
      triggeredCount += 1;
    },
  });

  const result = await scheduler.triggerCronJob(makeCronJobWithMessages([
    makeMessage({ contentType: "static_template", staticTemplate: "Primero" }),
    makeMessage({ contentType: "llm_generated", llmPrompt: "Segundo", llmModel: "gemini-2.5-flash", fallbackMessages: ["Fallback segundo"] }),
    makeMessage({ contentType: "static_template", staticTemplate: "Tercero" }),
  ]), settings);

  assertEquals(result.isFailure, false);
  assertEquals(sent, ["Primero", "Segundo", "Tercero"]);
  assertEquals(triggeredCount, 1);
});

Deno.test("makeCronScheduler sends only one random message when execution mode is random_single", async () => {
  const rendered: string[] = [];
  const sent: string[] = [];

  const scheduler = makeCronScheduler({
    sendMessage: async (_jid, text) => {
      sent.push(text);
      return success(undefined);
    },
    messageRenderer: {
      render: async () => failure("No debería usarse en este test"),
      renderMessage: async (message) => {
        const text = message.staticTemplate ?? message.llmPrompt ?? "";
        rendered.push(text);
        return success({
          contentType: message.contentType,
          text,
          fallbackMessages: message.fallbackMessages,
        });
      },
    },
    random: () => 0.8,
  });

  const result = await scheduler.triggerCronJob(makeCronJobWithMessages([
    makeMessage({ contentType: "static_template", staticTemplate: "Primero" }),
    makeMessage({ contentType: "static_template", staticTemplate: "Segundo" }),
    makeMessage({ contentType: "static_template", staticTemplate: "Tercero" }),
  ], { executionMode: "random_single" }), settings);

  assertEquals(result.isFailure, false);
  assertEquals(rendered, ["Tercero"]);
  assertEquals(sent, ["Tercero"]);
});

Deno.test("makeCronScheduler stops a multi-message cron when a normal send fails", async () => {
  const sent: string[] = [];
  let triggeredCount = 0;

  const scheduler = makeCronScheduler({
    sendMessage: async (_jid, text) => {
      sent.push(text);
      if (text === "Segundo") return failure("No se pudo enviar el segundo mensaje");
      return success(undefined);
    },
    messageRenderer: {
      render: async () => failure("No debería usarse en este test"),
      renderMessage: async (message) => success({
        contentType: message.contentType,
        text: message.staticTemplate ?? message.llmPrompt ?? "",
        fallbackMessages: message.fallbackMessages,
      }),
    },
    onTriggered: () => {
      triggeredCount += 1;
    },
  });

  const result = await scheduler.triggerCronJob(makeCronJobWithMessages([
    makeMessage({ contentType: "static_template", staticTemplate: "Primero" }),
    makeMessage({ contentType: "static_template", staticTemplate: "Segundo" }),
    makeMessage({ contentType: "static_template", staticTemplate: "Tercero" }),
  ]), settings);

  assertEquals(result.isFailure, true);
  assertEquals(result.getError(), "No se pudo enviar el segundo mensaje");
  assertEquals(sent, ["Primero", "Segundo"]);
  assertEquals(triggeredCount, 0);
});

Deno.test("makeCronScheduler uses fallback only for the failed llm item and continues in order", async () => {
  const sent: string[] = [];

  const scheduler = makeCronScheduler({
    sendMessage: async (_jid, text) => {
      sent.push(text);
      return success(undefined);
    },
    messageRenderer: {
      render: async () => failure("No debería usarse en este test"),
      renderMessage: async (message) => {
        if (message.llmPrompt === "Segundo") return failure("Gemini no respondió");

        return success({
          contentType: message.contentType,
          text: message.staticTemplate ?? message.llmPrompt ?? "",
          fallbackMessages: message.fallbackMessages,
        });
      },
    },
    wait: async () => {},
    random: () => 0,
  });

  const result = await scheduler.triggerCronJob(makeCronJobWithMessages([
    makeMessage({ contentType: "static_template", staticTemplate: "Primero" }),
    makeMessage({ contentType: "llm_generated", llmPrompt: "Segundo", llmModel: "gemini-2.5-flash", fallbackMessages: ["Fallback segundo"] }),
    makeMessage({ contentType: "static_template", staticTemplate: "Tercero" }),
  ]), settings);

  assertEquals(result.isFailure, false);
  assertEquals(sent, ["Primero", "Fallback segundo", "Tercero"]);
});

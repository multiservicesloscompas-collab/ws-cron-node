import { createServer } from "node:net";
import { makeWebServer } from "../make-web-server.ts";
import { success } from "../../../types/result.ts";
import type { AppSettings } from "../../../infra/cron/app-settings.ts";
import type { CronJob, CronJobMessage } from "../../../infra/cron/cron-job.ts";
import type { InternalContact } from "../../../infra/contacts/make-contacts-repository.ts";
import type { CronService } from "../../../infra/cron/make-cron-service.ts";
import type { ContactsRepository } from "../../../infra/contacts/make-contacts-repository.ts";

export const sampleContact: InternalContact = {
  jid: "sample@s.whatsapp.net",
  name: "Sample",
  kind: "manual",
  source: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const sampleSettings: AppSettings = {
  defaultTargetJid: "saved@g.us",
  timezone: "America/Caracas",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const sampleCronJob = (overrides: Partial<CronJob> = {}): CronJob => ({
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
  ...overrides,
});

export const createRuntimeState = (
  cronJobs: CronJob[] = [sampleCronJob()],
) => ({
  settings: sampleSettings,
  cronJobs,
});

export const createContactsRepository = (): ContactsRepository => ({
  list: async () => success([]),
  findByJid: async () => success(null),
  create: async () => success(sampleContact),
  upsert: async () => success(sampleContact),
  update: async () => success(sampleContact),
  delete: async () => success(undefined),
  deleteSystemContactsBySourceExceptJid: async () => success(0),
  deleteSystemContactsBySourceExceptJids: async () => success(0),
  withDatabase: () => createContactsRepository(),
});

export const createMessageStore = () => ({
  getConversations: () => [],
  getMessages: () => [],
  getConversation: () => null,
  getTotalUnread: () => 0,
  hasMessagesForJid: () => false,
  markRead: () => {},
  clear: () => {},
  startListening: () => {},
  stopListening: () => {},
  subscribe: () => () => {},
});

export const createCronScheduler = () => ({
  startAll: () => {},
  stopAll: () => {},
  reload: () => {},
  triggerCronJob: async () => success(undefined),
});

export const createCronService = (runtimeState = createRuntimeState()) => {
  let state = runtimeState;

  const createMessage = (
    next: Record<string, unknown>,
  ): CronJobMessage => ({
    contentType: next.contentType === "llm_generated"
      ? "llm_generated"
      : "static_template",
    staticTemplate: typeof next.staticTemplate === "string"
      ? next.staticTemplate
      : null,
    llmPrompt: typeof next.llmPrompt === "string"
      ? next.llmPrompt
      : null,
    llmModel: typeof next.llmModel === "string"
      ? next.llmModel
      : null,
    fallbackMessages: Array.isArray(next.fallbackMessages)
      ? next.fallbackMessages as string[]
      : null,
  });

  return {
    getRuntimeState: async () => success(state),
    updateSettings: async (input: unknown) => {
      const next = input as { defaultTargetJid: string; timezone: string };
      state = {
        ...state,
        settings: {
          ...state.settings,
          defaultTargetJid: next.defaultTargetJid,
          timezone: next.timezone,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      };
      return success(state);
    },
    createCronJob: async (input: unknown) => {
      const next = input as Record<string, unknown>;
      const nextMessages = Array.isArray(next.messages)
        ? next.messages as CronJob["messages"]
        : [createMessage(next)];
      const firstMessage = nextMessages[0];
      state = {
        ...state,
        cronJobs: [
          ...state.cronJobs,
          sampleCronJob({
            id: "8a6a2cc6-6114-4af2-a520-d4d06bc00f4f",
            name: String(next.name || "Nuevo cron"),
            executionMode: next.executionMode === "random_single"
              ? "random_single"
              : "sequence",
            messages: nextMessages,
            contentType: firstMessage?.contentType === "llm_generated"
              ? "llm_generated"
              : "static_template",
            targetJid: String(next.targetJid || state.settings.defaultTargetJid),
            staticTemplate: firstMessage?.staticTemplate ?? null,
            llmPrompt: firstMessage?.llmPrompt ?? null,
            llmModel: firstMessage?.llmModel ?? null,
            fallbackMessages: firstMessage?.fallbackMessages ?? null,
          }),
        ],
      };
      return success(state);
    },
    updateCronJob: async (_id: string, _input: unknown) => success(state),
    deleteCronJob: async (id: string) => {
      state = {
        ...state,
        cronJobs: state.cronJobs.filter((cronJob) => cronJob.id !== id),
      };
      return success(state);
    },
    markTriggered: async () => success(undefined),
  } as CronService;
};

const getAvailablePort = async (): Promise<number> => {
  const server = createServer();

  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No se pudo obtener un puerto libre"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
};

export const startTestServer = async (
  overrides: Partial<Parameters<typeof makeWebServer>[0]> = {},
) => {
  const port = await getAvailablePort();
  const server = makeWebServer({
    port,
    cronService: createCronService(),
    cronScheduler: createCronScheduler(),
    messageStore: createMessageStore(),
    contactsRepository: createContactsRepository(),
    sendMessageToJid: async () => success(undefined),
    getConnectionStatus: () => "open",
    getSessionState: () => ({
      connectionStatus: "open",
      phase: "connected",
      requiresUserAction: false,
      canAutoReconnect: false,
      reconnectAttempt: 0,
      nextReconnectDelayMs: null,
      qr: null,
      qrDataUrl: null,
      qrGeneratedAt: null,
      lastDisconnectCode: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getTargetJid: () => "saved@g.us",
    getOwnJid: () => "584129833320@s.whatsapp.net",
    htmlPath: "app/web/web-ui.html",
    ...overrides,
  });

  await server.start();

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
};

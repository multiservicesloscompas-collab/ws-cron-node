import { WebSocket } from "ws";
import { expect, test } from "vitest";
import { success } from "../../../types/result.ts";
import type { ContactsRepository } from "../../../infra/contacts/make-contacts-repository.ts";
import {
  createContactsRepository,
  createCronService,
  createRuntimeState,
  sampleContact,
  sampleCronJob,
  startTestServer,
} from "./make-web-server-test-support.ts";

test("makeWebServer status route includes own jid and cron metadata", async () => {
  const runtime = await startTestServer();

  try {
    const response = await fetch(`${runtime.baseUrl}/api/status`);
    const payload = await response.json();

    expect(payload?.ok).toBe(true);
    expect(payload?.ownJid).toBe("584129833320@s.whatsapp.net");
    expect(payload?.defaultTargetJid).toBe("saved@g.us");
    expect(payload?.cronCount).toBe(1);
    expect(payload?.session?.phase).toBe("connected");
  } finally {
    await runtime.server.stop();
  }
});

test("makeWebServer runtime route returns postgres-backed cron state", async () => {
  const runtime = await startTestServer({
    cronService: createCronService(createRuntimeState([
      sampleCronJob(),
      sampleCronJob({
        id: "6685694e-2f51-4540-a66d-1404659b0b29",
        name: "Gemini cierre",
        messages: [{
          contentType: "llm_generated",
          llmPrompt: "Escribe un resumen",
          llmModel: "gemini-2.5-flash",
          staticTemplate: null,
          fallbackMessages: ["Equipo, hubo un error"],
        }],
        contentType: "llm_generated",
        llmPrompt: "Escribe un resumen",
        llmModel: "gemini-2.5-flash",
        staticTemplate: null,
        fallbackMessages: ["Equipo, hubo un error"],
      }),
    ])),
  });

  try {
    const response = await fetch(`${runtime.baseUrl}/api/runtime`);
    const payload = await response.json();

    expect(payload?.ok).toBe(true);
    expect(payload?.cronJobs?.length).toBe(2);
    expect(payload?.cronJobs?.[0]?.messages?.length).toBe(1);
    expect(payload?.cronJobs?.[1]?.contentType).toBe("llm_generated");
    expect(payload?.cronJobs?.[1]?.messages?.[0]?.contentType).toBe("llm_generated");
    expect(payload?.cronJobs?.[1]?.fallbackMessages?.length).toBe(1);
    expect(payload?.cronJobs?.[1]?.executionMode).toBe("sequence");
  } finally {
    await runtime.server.stop();
  }
});

test("makeWebServer can create a cron via API", async () => {
  const runtime = await startTestServer();

  try {
    const response = await fetch(`${runtime.baseUrl}/api/crons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cronJob: {
          name: "Cierre Gemini",
          scheduleTime: "19:30",
          days: "1-6",
          enabled: true,
          targetJid: "saved@g.us",
          executionMode: "random_single",
          messages: [{
            contentType: "static_template",
            staticTemplate: "Primer mensaje",
            llmPrompt: null,
            llmModel: null,
            fallbackMessages: null,
          }, {
            contentType: "llm_generated",
            llmPrompt: "Escribe un resumen corto del día",
            llmModel: "gemini-2.5-flash",
            staticTemplate: null,
            fallbackMessages: ["Hubo un error, pero seguimos atentos."],
          }],
        },
      }),
    });

    const payload = await response.json();
    expect(payload?.ok).toBe(true);
    expect(payload?.cronJobs?.length).toBe(2);
    expect(payload?.cronJobs?.[1]?.messages?.length).toBe(2);
    expect(payload?.cronJobs?.[1]?.executionMode).toBe("random_single");
    expect(payload?.cronJobs?.[1]?.messages?.[1]?.fallbackMessages?.[0]).toBe(
      "Hubo un error, pero seguimos atentos.",
    );
  } finally {
    await runtime.server.stop();
  }
});

test("makeWebServer accepts legacy cron payload shape and returns hydrated messages", async () => {
  const runtime = await startTestServer();

  try {
    const response = await fetch(`${runtime.baseUrl}/api/crons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cron legacy",
        scheduleTime: "19:30",
        days: "1-6",
        enabled: true,
        targetJid: "saved@g.us",
        contentType: "static_template",
        staticTemplate: "Solo un mensaje legado",
      }),
    });

    const payload = await response.json();
    expect(payload?.ok).toBe(true);
    expect(payload?.cronJobs?.[1]?.messages?.length).toBe(1);
    expect(payload?.cronJobs?.[1]?.messages?.[0]?.staticTemplate).toBe(
      "Solo un mensaje legado",
    );
    expect(payload?.cronJobs?.[1]?.executionMode).toBe("sequence");
  } finally {
    await runtime.server.stop();
  }
});

test("makeWebServer chats route merges internal contacts without messages", async () => {
  const runtime = await startTestServer({
    messageStore: {
      getConversations: () => [{
        jid: "584129833320@s.whatsapp.net",
        name: "Desconocido",
        lastMessage: "Hola",
        lastActivity: 100,
        unread: 1,
      }],
      getMessages: () => [],
      getConversation: () => null,
      getTotalUnread: () => 1,
      hasMessagesForJid: (jid: string) => jid === "584129833320@s.whatsapp.net",
      markRead: () => {},
      clear: () => {},
      startListening: () => {},
      stopListening: () => {},
      subscribe: () => () => {},
    },
    contactsRepository: {
      list: async () => success([
        {
          jid: "120363394083049638@g.us",
          name: "Los Compas",
          kind: "system",
          source: "detected-group",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
      findByJid: async () => success(null),
      create: async () => success(sampleContact),
      upsert: async () => success(sampleContact),
      update: async () => success(sampleContact),
      delete: async () => success(undefined),
      deleteSystemContactsBySourceExceptJid: async () => success(0),
      deleteSystemContactsBySourceExceptJids: async () => success(0),
      withDatabase: () => createContactsRepository(),
    } as ContactsRepository,
    getTargetJid: () => "120363394083049638@g.us",
  });

  try {
    const response = await fetch(`${runtime.baseUrl}/api/chats`);
    const payload = await response.json();

    expect(payload?.ok).toBe(true);
    expect(payload?.conversations?.length).toBe(2);
    expect(payload?.conversations?.[1]?.jid).toBe("120363394083049638@g.us");
    expect(payload?.conversations?.[1]?.isInternal).toBe(true);
    expect(payload?.conversations?.[1]?.hasMessages).toBe(false);
  } finally {
    await runtime.server.stop();
  }
});

test("makeWebServer chat detail route marks conversation as read", async () => {
  let markedReadJid = "";

  const runtime = await startTestServer({
    messageStore: {
      getConversations: () => [],
      getMessages: () => [{
        id: "msg-1",
        jid: "584129833320@s.whatsapp.net",
        pushName: "Beto",
        text: "Hola",
        fromMe: false,
        timestamp: 100,
        dateStr: "01/01, 08:00",
      }],
      getConversation: () => ({
        jid: "584129833320@s.whatsapp.net",
        name: "Beto",
        lastMessage: "Hola",
        lastActivity: 100,
        unread: 1,
      }),
      getTotalUnread: () => 1,
      hasMessagesForJid: () => true,
      markRead: (jid: string) => {
        markedReadJid = jid;
      },
      clear: () => {},
      startListening: () => {},
      stopListening: () => {},
      subscribe: () => () => {},
    },
  });

  try {
    const response = await fetch(
      `${runtime.baseUrl}/api/chats/584129833320%40s.whatsapp.net`,
    );
    const payload = await response.json();

    expect(payload?.ok).toBe(true);
    expect(markedReadJid).toBe("584129833320@s.whatsapp.net");
  } finally {
    await runtime.server.stop();
  }
});

test("makeWebServer status stream upgrades websocket and broadcasts snapshots", async () => {
  const runtime = await startTestServer();
  const socket = new WebSocket(`${runtime.baseUrl.replace("http", "ws")}/api/status-stream`);

  try {
    const firstMessage = await new Promise<string>((resolve, reject) => {
      socket.once("message", (data) => resolve(data.toString()));
      socket.once("error", reject);
    });

    const nextMessagePromise = new Promise<string>((resolve, reject) => {
      socket.once("message", (data) => resolve(data.toString()));
      socket.once("error", reject);
    });

    await runtime.server.broadcastStatus();
    const secondMessage = await nextMessagePromise;

    expect(firstMessage).toContain('"type":"status"');
    expect(firstMessage).toContain('"defaultTargetJid":"saved@g.us"');
    expect(secondMessage).toContain('"type":"status"');
  } finally {
    socket.close();
    await runtime.server.stop();
  }
});

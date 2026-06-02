import { assertEquals } from "#test-assert";
import { syncCronTargetContacts } from "../sync-cron-target-contacts.ts";

Deno.test("syncCronTargetContacts excludes authenticated own JID", async () => {
  const syncedJids: string[][] = [];

  await syncCronTargetContacts(
    {
      settings: {
        defaultTargetJid: "584129833320@s.whatsapp.net",
        timezone: "America/Caracas",
        createdAt: "2026-05-20T00:00:00.000Z",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      cronJobs: [
        {
          id: "7f5d4cd1-6c39-4d8b-a772-356112e56be6",
          name: "Night",
          scheduleTime: "19:30",
          days: "mon-sat",
          enabled: true,
          targetJid: "120363394083049638@g.us",
          executionMode: "sequence",
          messages: [{
            contentType: "static_template",
            staticTemplate: "hola",
            llmPrompt: null,
            llmModel: null,
            fallbackMessages: null,
          }],
          contentType: "static_template",
          staticTemplate: "hola",
          llmPrompt: null,
          llmModel: null,
          fallbackMessages: null,
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
          lastTriggeredAt: null,
        },
      ],
    },
    {
      syncTargetContact: async () => {},
      syncCronRuntimeContacts: async (jids) => {
        syncedJids.push(jids);
      },
    },
    "584129833320@s.whatsapp.net",
  );

  assertEquals(syncedJids, [["120363394083049638@g.us"]]);
});

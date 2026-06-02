import { assertEquals } from "#test-assert";
import { makeCronJobsRepository } from "../make-cron-jobs-repository.ts";
import { makeTestPostgresDb } from "../../postgres/make-test-postgres-db.ts";

const createRepository = async () => {
  const postgres = await makeTestPostgresDb();
  return {
    postgres,
    repository: makeCronJobsRepository({ database: postgres.pool }),
  };
};

Deno.test("makeCronJobsRepository creates and lists uuid cron jobs", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const createResult = await repository.create({
      name: "Matutino",
      scheduleTime: "08:30",
      days: "*",
      enabled: true,
      targetJid: "saved@g.us",
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
    });

    assertEquals(createResult.isFailure, false);
    assertEquals(createResult.getValue().id.length, 36);

    const listResult = await repository.list();
    assertEquals(listResult.isFailure, false);
    assertEquals(listResult.getValue().length, 1);
    assertEquals(listResult.getValue()[0].name, "Matutino");
    assertEquals(listResult.getValue()[0].executionMode, "sequence");
    assertEquals(listResult.getValue()[0].messages, [{
      contentType: "static_template",
      staticTemplate: "Hola {{date}}",
      llmPrompt: null,
      llmModel: null,
      fallbackMessages: null,
    }]);
  } finally {
    await postgres.close();
  }
});

Deno.test("makeCronJobsRepository validates llm crons", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const createResult = await repository.create({
      name: "Gemini",
      scheduleTime: "19:30",
      days: "1-6",
      enabled: true,
      targetJid: "saved@g.us",
      messages: [{
        contentType: "llm_generated",
        staticTemplate: null,
        llmPrompt: "Escribe un resumen del día",
        llmModel: "gemini-2.5-flash",
        fallbackMessages: ["Mensaje alternativo", "  Otro mensaje  ", ""],
      }],
      contentType: "llm_generated",
      staticTemplate: null,
      llmPrompt: "Escribe un resumen del día",
      llmModel: "gemini-2.5-flash",
      fallbackMessages: ["Mensaje alternativo", "  Otro mensaje  ", ""],
    });

    assertEquals(createResult.isFailure, false);
    assertEquals(createResult.getValue().contentType, "llm_generated");
    assertEquals(createResult.getValue().llmPrompt, "Escribe un resumen del día");
    assertEquals(createResult.getValue().fallbackMessages, [
      "Mensaje alternativo",
      "Otro mensaje",
    ]);
    assertEquals(createResult.getValue().messages, [{
      contentType: "llm_generated",
      staticTemplate: null,
      llmPrompt: "Escribe un resumen del día",
      llmModel: "gemini-2.5-flash",
      fallbackMessages: ["Mensaje alternativo", "Otro mensaje"],
    }]);

    const listResult = await repository.list();
    assertEquals(listResult.isFailure, false);
    assertEquals(listResult.getValue()[0].fallbackMessages, [
      "Mensaje alternativo",
      "Otro mensaje",
    ]);
  } finally {
    await postgres.close();
  }
});

Deno.test("makeCronJobsRepository ignores fallback messages for static crons", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const createResult = await repository.create({
      name: "Checklist",
      scheduleTime: "08:30",
      days: "*",
      enabled: true,
      targetJid: "saved@g.us",
      messages: [{
        contentType: "static_template",
        staticTemplate: "Hola {{date}}",
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: ["No debería guardarse", "  Tampoco este  "],
      }],
      contentType: "static_template",
      staticTemplate: "Hola {{date}}",
      llmPrompt: null,
      llmModel: null,
      fallbackMessages: ["No debería guardarse", "  Tampoco este  "],
    });

    assertEquals(createResult.isFailure, false);
    assertEquals(createResult.getValue().contentType, "static_template");
    assertEquals(createResult.getValue().fallbackMessages, null);

    const listResult = await repository.list();
    assertEquals(listResult.isFailure, false);
    assertEquals(listResult.getValue()[0].fallbackMessages, null);
  } finally {
    await postgres.close();
  }
});

Deno.test("makeCronJobsRepository normalizes legacy singular payloads into one message", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const createResult = await repository.create({
      name: "Legacy",
      scheduleTime: "08:30",
      days: "*",
      enabled: true,
      targetJid: "saved@g.us",
      contentType: "static_template",
      staticTemplate: "Mensaje legado",
      llmPrompt: null,
      llmModel: null,
      fallbackMessages: null,
    });

    assertEquals(createResult.isFailure, false);
    assertEquals(createResult.getValue().messages, [{
      contentType: "static_template",
      staticTemplate: "Mensaje legado",
      llmPrompt: null,
      llmModel: null,
      fallbackMessages: null,
    }]);
    assertEquals(createResult.getValue().contentType, "static_template");
    assertEquals(createResult.getValue().staticTemplate, "Mensaje legado");
    assertEquals(createResult.getValue().executionMode, "sequence");
  } finally {
    await postgres.close();
  }
});

Deno.test("makeCronJobsRepository persists ordered message sequences with first-item mirrors", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const createResult = await repository.create({
      name: "Secuencia",
      scheduleTime: "19:30",
      days: "1-6",
      enabled: true,
      targetJid: "saved@g.us",
      messages: [
        {
          contentType: "static_template",
          staticTemplate: "Primer mensaje",
          llmPrompt: null,
          llmModel: null,
          fallbackMessages: null,
        },
        {
          contentType: "llm_generated",
          staticTemplate: null,
          llmPrompt: "Resume el cierre",
          llmModel: "gemini-2.5-flash",
          fallbackMessages: ["Fallback 1", "  Fallback 2  "],
        },
      ],
    });

    assertEquals(createResult.isFailure, false);
    assertEquals(createResult.getValue().messages, [
      {
        contentType: "static_template",
        staticTemplate: "Primer mensaje",
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: null,
      },
      {
        contentType: "llm_generated",
        staticTemplate: null,
        llmPrompt: "Resume el cierre",
        llmModel: "gemini-2.5-flash",
        fallbackMessages: ["Fallback 1", "Fallback 2"],
      },
    ]);
    assertEquals(createResult.getValue().contentType, "static_template");
    assertEquals(createResult.getValue().staticTemplate, "Primer mensaje");
    assertEquals(createResult.getValue().fallbackMessages, null);
    assertEquals(createResult.getValue().executionMode, "sequence");

    const rowResult = await postgres.pool.query(
      `
        SELECT content_type, static_template, fallback_messages, message_sequence
        FROM cron_jobs
        WHERE id = $1
      `,
      [createResult.getValue().id],
    );
    const row = rowResult.rows[0] as {
      content_type: string;
      static_template: string | null;
      fallback_messages: string | null;
      message_sequence: string | null;
    };

    assertEquals(row.content_type, "static_template");
    assertEquals(row.static_template, "Primer mensaje");
    assertEquals(row.fallback_messages, null);
    assertEquals(typeof row.message_sequence, "string");

    const persistedResult = await repository.findById(createResult.getValue().id);
    assertEquals(persistedResult.isFailure, false);
    assertEquals(persistedResult.getValue()?.messages.length, 2);
    assertEquals(persistedResult.getValue()?.messages[1].fallbackMessages, [
      "Fallback 1",
      "Fallback 2",
    ]);
  } finally {
    await postgres.close();
  }
});

Deno.test("makeCronJobsRepository validates message sequence size", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const createResult = await repository.create({
      name: "Exceso",
      scheduleTime: "08:30",
      days: "*",
      enabled: true,
      targetJid: "saved@g.us",
      messages: Array.from({ length: 5 }, (_, index) => ({
        contentType: "static_template" as const,
        staticTemplate: `Mensaje ${index + 1}`,
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: null,
      })),
    });

    assertEquals(createResult.isFailure, true);
    assertEquals(createResult.getError(), "El cron debe tener entre 1 y 4 mensajes");
  } finally {
    await postgres.close();
  }
});

Deno.test("makeCronJobsRepository persists random_single execution mode and migrates old rows to sequence", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const createResult = await repository.create({
      name: "Aleatorio",
      scheduleTime: "08:30",
      days: "*",
      enabled: true,
      targetJid: "saved@g.us",
      executionMode: "random_single",
      messages: [{
        contentType: "static_template",
        staticTemplate: "Uno",
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: null,
      }, {
        contentType: "static_template",
        staticTemplate: "Dos",
        llmPrompt: null,
        llmModel: null,
        fallbackMessages: null,
      }],
    });

    assertEquals(createResult.isFailure, false);
    assertEquals(createResult.getValue().executionMode, "random_single");

    const rowResult = await postgres.pool.query(
      `
        SELECT execution_mode
        FROM cron_jobs
        WHERE id = $1
      `,
      [createResult.getValue().id],
    );
    const row = rowResult.rows[0] as { execution_mode: string };

    assertEquals(row.execution_mode, "random_single");
  } finally {
    await postgres.close();
  }
});

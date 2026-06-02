import { assertEquals } from "#test-assert";
import { makeContactsRepository } from "../make-contacts-repository.ts";
import { syncSystemContact } from "../sync-system-contact.ts";
import { makeSystemContactSync } from "../make-system-contact-sync.ts";
import { makeTestPostgresDb } from "../../postgres/make-test-postgres-db.ts";

const createRepository = async () => {
  const postgres = await makeTestPostgresDb();
  return {
    postgres,
    repository: makeContactsRepository({ database: postgres.pool }),
  };
};

Deno.test("makeContactsRepository upserts and lists contacts", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const ownResult = await repository.upsert({
      jid: "584129833320@s.whatsapp.net",
      name: "Yo",
      kind: "system",
      source: "own-account",
    });
    const manualResult = await repository.create({
      jid: "120363394083049638@g.us",
      name: "Los Compas",
    });

    assertEquals(ownResult.isFailure, false);
    assertEquals(manualResult.isFailure, false);

    const listResult = await repository.list();
    assertEquals(listResult.isFailure, false);
    assertEquals(
      listResult.getValue().map((contact) => ({
        jid: contact.jid,
        name: contact.name,
        kind: contact.kind,
      })),
      [
        {
          jid: "584129833320@s.whatsapp.net",
          name: "Yo",
          kind: "system",
        },
        {
          jid: "120363394083049638@g.us",
          name: "Los Compas",
          kind: "manual",
        },
      ],
    );
  } finally {
    await postgres.close();
  }
});

Deno.test("makeContactsRepository updates and deletes contacts", async () => {
  const { postgres, repository } = await createRepository();

  try {
    await repository.create({
      jid: "584129833321@s.whatsapp.net",
      name: "Caja",
    });

    const updateResult = await repository.update("584129833321@s.whatsapp.net", {
      name: "Caja principal",
    });

    assertEquals(updateResult.isFailure, false);
    assertEquals(updateResult.getValue().name, "Caja principal");

    const deleteResult = await repository.delete("584129833321@s.whatsapp.net");
    assertEquals(deleteResult.isFailure, false);

    const findResult = await repository.findByJid("584129833321@s.whatsapp.net");
    assertEquals(findResult.isFailure, false);
    assertEquals(findResult.getValue(), null);
  } finally {
    await postgres.close();
  }
});

Deno.test("syncSystemContact does not overwrite manual contacts", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const manualResult = await repository.create({
      jid: "120363394083049638@g.us",
      name: "Grupo personalizado",
      kind: "manual",
      source: "user-created",
    });

    assertEquals(manualResult.isFailure, false);

    const syncResult = await syncSystemContact(repository, {
      jid: "120363394083049638@g.us",
      name: "Los Compas",
      source: "detected-group",
    });

    assertEquals(syncResult.isFailure, false);
    assertEquals(syncResult.getValue().name, "Grupo personalizado");
    assertEquals(syncResult.getValue().kind, "manual");
    assertEquals(syncResult.getValue().source, "user-created");

    const persistedResult = await repository.findByJid("120363394083049638@g.us");
    assertEquals(persistedResult.isFailure, false);
    assertEquals(persistedResult.getValue()?.name, "Grupo personalizado");
    assertEquals(persistedResult.getValue()?.kind, "manual");
    assertEquals(persistedResult.getValue()?.source, "user-created");
  } finally {
    await postgres.close();
  }
});

Deno.test("makeSystemContactSync removes stale own-account system contacts", async () => {
  const { postgres, repository } = await createRepository();

  try {
    const manualResult = await repository.create({
      jid: "584129833320@s.whatsapp.net",
      name: "Yo manual",
      kind: "manual",
      source: "user-created",
    });
    const staleOwnResult = await repository.upsert({
      jid: "584129833321@s.whatsapp.net",
      name: "Yo",
      kind: "system",
      source: "own-account",
    });
    const targetGroupResult = await repository.upsert({
      jid: "120363394083049638@g.us",
      name: "Los Compas",
      kind: "system",
      source: "detected-group",
    });

    assertEquals(manualResult.isFailure, false);
    assertEquals(staleOwnResult.isFailure, false);
    assertEquals(targetGroupResult.isFailure, false);

    await makeSystemContactSync(repository).syncOwnContact(
      "584129833322@s.whatsapp.net",
    );

    const listResult = await repository.list();
    assertEquals(listResult.isFailure, false);
    assertEquals(
      listResult.getValue().map((contact) => ({
        jid: contact.jid,
        name: contact.name,
        kind: contact.kind,
        source: contact.source,
      })),
      [
        {
          jid: "120363394083049638@g.us",
          name: "Los Compas",
          kind: "system",
          source: "detected-group",
        },
        {
          jid: "584129833322@s.whatsapp.net",
          name: "Yo",
          kind: "system",
          source: "own-account",
        },
        {
          jid: "584129833320@s.whatsapp.net",
          name: "Yo manual",
          kind: "manual",
          source: "user-created",
        },
      ],
    );
  } finally {
    await postgres.close();
  }
});

Deno.test("makeSystemContactSync repairs own contact from authenticated jid", async () => {
  const { postgres, repository } = await createRepository();

  try {
    await repository.upsert({
      jid: "584129833320@s.whatsapp.net",
      name: "Los Compas",
      kind: "system",
      source: "cron-runtime",
    });

    await makeSystemContactSync(repository).syncOwnContact(
      "584129833320@s.whatsapp.net",
    );

    const ownResult = await repository.findByJid("584129833320@s.whatsapp.net");
    assertEquals(ownResult.isFailure, false);
    assertEquals(ownResult.getValue()?.name, "Yo");
    assertEquals(ownResult.getValue()?.source, "own-account");
  } finally {
    await postgres.close();
  }
});

Deno.test("makeSystemContactSync removes stale cron-runtime system contacts", async () => {
  const { postgres, repository } = await createRepository();

  try {
    await repository.upsert({
      jid: "120363394083049638@g.us",
      name: "Los Compas",
      kind: "system",
      source: "cron-runtime",
    });
    await repository.upsert({
      jid: "120363394083049639@g.us",
      name: "Los Compas 2",
      kind: "system",
      source: "cron-runtime",
    });
    await repository.upsert({
      jid: "120363394083049640@g.us",
      name: "Detectado",
      kind: "system",
      source: "detected-group",
    });

    await makeSystemContactSync(repository).syncCronRuntimeContacts([
      "120363394083049639@g.us",
      "120363394083049641@g.us",
      "120363394083049641@g.us",
    ]);

    const listResult = await repository.list();
    assertEquals(listResult.isFailure, false);
    assertEquals(
      listResult.getValue().map((contact) => ({
        jid: contact.jid,
        source: contact.source,
      })),
      [
        {
          jid: "120363394083049640@g.us",
          source: "detected-group",
        },
        {
          jid: "120363394083049639@g.us",
          source: "cron-runtime",
        },
        {
          jid: "120363394083049641@g.us",
          source: "cron-runtime",
        },
      ],
    );
  } finally {
    await postgres.close();
  }
});

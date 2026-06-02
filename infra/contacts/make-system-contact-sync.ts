import type { ContactsRepository } from "./make-contacts-repository.ts";
import { isFailure } from "../../types/result.ts";
import { syncSystemContact } from "./sync-system-contact.ts";

export interface SystemContactSync {
  syncOwnContact: (ownJid: string) => Promise<void>;
  syncTargetContact: (jid: string, source: string) => Promise<void>;
  syncCronRuntimeContacts: (jids: string[]) => Promise<void>;
}

export const makeSystemContactSync = (
  contactsRepository: ContactsRepository,
): SystemContactSync => {
  const syncOwnContact = async (ownJid: string) => {
    if (!ownJid) return;

    const result = await syncSystemContact(contactsRepository, {
      jid: ownJid,
      name: "Yo",
      source: "own-account",
    });

    if (isFailure(result)) {
      console.log(`  ⚠️  No se pudo sincronizar contacto Yo: ${result.getError()}`);
      return;
    }

    const cleanupResult = await contactsRepository.deleteSystemContactsBySourceExceptJid({
      source: "own-account",
      keepJid: ownJid,
    });

    if (isFailure(cleanupResult)) {
      console.log(
        `  ⚠️  No se pudieron limpiar contactos Yo obsoletos: ${cleanupResult.getError()}`,
      );
    }
  };

  const syncTargetContact = async (jid: string, source: string) => {
    if (!jid) return;

    const result = await syncSystemContact(contactsRepository, {
      jid,
      name: "Los Compas",
      source,
    });

    if (isFailure(result)) {
      console.log(
        `  ⚠️  No se pudo sincronizar contacto Los Compas: ${result.getError()}`,
      );
    }
  };

  const syncCronRuntimeContacts = async (jids: string[]) => {
    const uniqueJids = Array.from(
      new Set(jids.map((jid) => jid.trim()).filter((jid) => jid.length > 0)),
    );

    for (const jid of uniqueJids) {
      await syncTargetContact(jid, "cron-runtime");
    }

    const cleanupResult = await contactsRepository.deleteSystemContactsBySourceExceptJids({
      source: "cron-runtime",
      keepJids: uniqueJids,
    });

    if (isFailure(cleanupResult)) {
      console.log(
        `  ⚠️  No se pudieron limpiar contactos cron obsoletos: ${cleanupResult.getError()}`,
      );
    }
  };

  return {
    syncOwnContact,
    syncTargetContact,
    syncCronRuntimeContacts,
  };
};

import type {
  ContactsRepository,
  InternalContact,
} from "./make-contacts-repository.ts";
import { failure, success, type Result } from "../../types/result.ts";

export interface SystemContactInput {
  jid: string;
  name: string;
  source: string;
}

export const syncSystemContact = (
  contactsRepository: ContactsRepository,
  input: SystemContactInput,
): Promise<Result<InternalContact, string>> => {
  return (async () => {
    if (!input.jid.trim()) {
      return failure("El JID del contacto del sistema es obligatorio");
    }

    const existingResult = await contactsRepository.findByJid(input.jid.trim());
    if (existingResult.isFailure) {
      return failure(existingResult.getError());
    }

    const existingContact = existingResult.getValue();
    if (existingContact?.kind === "manual") {
      return success(existingContact);
    }

    return contactsRepository.upsert({
      jid: input.jid.trim(),
      name: input.name.trim(),
      kind: "system",
      source: input.source,
    });
  })();
};

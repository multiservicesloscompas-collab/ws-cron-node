import { isFailure } from "../../types/result.ts";
import type { ContactsRepository } from "../../infra/contacts/make-contacts-repository.ts";
import type { MessageStore } from "../../infra/whatsapp/make-message-store.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "./http-responses.ts";
import { normalizeJid } from "./normalize-jid.ts";

interface ContactsRouteDeps {
  contactsRepository: ContactsRepository;
  messageStore: MessageStore;
}

export const handleContactsRequest = async (
  req: Request,
  path: string,
  deps: ContactsRouteDeps,
): Promise<Response | null> => {
  if (req.method === "GET" && path === "/api/contacts") {
    const contactsResult = await deps.contactsRepository.list();
    if (isFailure(contactsResult)) {
      return corsHeaders(errorResponse(contactsResult.getError()));
    }

    const contacts = contactsResult.getValue().map((contact) => ({
      ...contact,
      hasMessages: deps.messageStore.hasMessagesForJid(contact.jid),
    }));

    return corsHeaders(successResponse({ contacts }));
  }

  if (req.method === "POST" && path === "/api/contacts") {
    const body = await req.json() as {
      jid?: string;
      name?: string;
      kind?: "manual" | "system";
      source?: string | null;
    };

    const normalizedJid = body.jid ? normalizeJid(body.jid) : "";

    const result = await deps.contactsRepository.create({
      jid: normalizedJid,
      name: body.name || "",
      kind: body.kind,
      source: body.source,
    });

    if (isFailure(result)) {
      return corsHeaders(errorResponse(result.getError()));
    }

    return corsHeaders(successResponse({ contact: result.getValue() }));
  }

  if (!path.startsWith("/api/contacts/")) return null;

  const jid = decodeURIComponent(path.replace("/api/contacts/", ""));
  if (!jid) {
    return corsHeaders(errorResponse("JID requerido"));
  }

  if (req.method === "PUT") {
    const body = await req.json() as {
      name?: string;
      kind?: "manual" | "system";
      source?: string | null;
    };

    const result = await deps.contactsRepository.update(jid, {
      name: body.name || "",
      kind: body.kind,
      source: body.source,
    });

    if (isFailure(result)) {
      return corsHeaders(errorResponse(result.getError()));
    }

    return corsHeaders(successResponse({ contact: result.getValue() }));
  }

  if (req.method === "DELETE") {
    const deleteResult = await deps.contactsRepository.delete(jid);
    if (isFailure(deleteResult)) {
      return corsHeaders(errorResponse(deleteResult.getError(), 404));
    }

    return corsHeaders(successResponse({
      jid,
      keptChatHistory: deps.messageStore.hasMessagesForJid(jid),
    }));
  }

  return null;
};

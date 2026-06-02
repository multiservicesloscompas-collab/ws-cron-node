import { isFailure } from "../../types/result.ts";
import type { ContactsRepository } from "../../infra/contacts/make-contacts-repository.ts";
import type { MessageStore } from "../../infra/whatsapp/make-message-store.ts";
import {
  corsHeaders,
  errorResponse,
  successResponse,
} from "./http-responses.ts";
import { mergeChatList } from "./merge-chat-list.ts";

interface ChatsRouteDeps {
  contactsRepository: ContactsRepository;
  messageStore: MessageStore;
}

export const handleChatsRequest = (
  req: Request,
  path: string,
  deps: ChatsRouteDeps,
): Promise<Response | null> => {
  return (async () => {
    if (req.method === "GET" && path === "/api/chats") {
      const contactsResult = await deps.contactsRepository.list();
      if (isFailure(contactsResult)) {
        return corsHeaders(errorResponse(contactsResult.getError()));
      }

      const conversations = mergeChatList(
        contactsResult.getValue(),
        deps.messageStore.getConversations(),
      );

      return corsHeaders(successResponse({ conversations }));
    }

    if (req.method === "GET" && path.startsWith("/api/chats/")) {
      const jid = decodeURIComponent(path.replace("/api/chats/", ""));
      if (!jid) {
        return corsHeaders(errorResponse("JID requerido"));
      }

      deps.messageStore.markRead(jid);
      const messages = deps.messageStore.getMessages(jid);
      const contactsResult = await deps.contactsRepository.findByJid(jid);
      if (isFailure(contactsResult)) {
        return corsHeaders(errorResponse(contactsResult.getError()));
      }

      const existingConversation = deps.messageStore.getConversation(jid);
      const conversation = mergeChatList(
        contactsResult.getValue() ? [contactsResult.getValue()!] : [],
        existingConversation ? [existingConversation] : [],
      )[0] ?? null;

      return corsHeaders(successResponse({ messages, conversation }));
    }

    return null;
  })();
};

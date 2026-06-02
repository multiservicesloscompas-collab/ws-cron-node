import type { InternalContact } from "../../infra/contacts/make-contacts-repository.ts";
import type { MessageStore } from "../../infra/whatsapp/make-message-store.ts";

export interface ChatListItem {
  jid: string;
  name: string;
  lastMessage: string;
  lastActivity: number;
  unread: number;
  isInternal: boolean;
  contactKind: "manual" | "system" | null;
  contactSource: string | null;
  hasMessages: boolean;
}

export const mergeChatList = (
  contacts: InternalContact[],
  conversations: ReturnType<MessageStore["getConversations"]>,
): ChatListItem[] => {
  const map = new Map<string, ChatListItem>();

  for (const conversation of conversations) {
    map.set(conversation.jid, {
      jid: conversation.jid,
      name: conversation.name,
      lastMessage: conversation.lastMessage,
      lastActivity: conversation.lastActivity,
      unread: conversation.unread,
      isInternal: false,
      contactKind: null,
      contactSource: null,
      hasMessages: true,
    });
  }

  for (const contact of contacts) {
    const existing = map.get(contact.jid);
    if (existing) {
      map.set(contact.jid, {
        ...existing,
        name: contact.name || existing.name,
        isInternal: true,
        contactKind: contact.kind,
        contactSource: contact.source,
      });
      continue;
    }

    map.set(contact.jid, {
      jid: contact.jid,
      name: contact.name,
      lastMessage: "",
      lastActivity: 0,
      unread: 0,
      isInternal: true,
      contactKind: contact.kind,
      contactSource: contact.source,
      hasMessages: false,
    });
  }

  return Array.from(map.values()).sort((left, right) => {
    if (left.lastActivity !== right.lastActivity) {
      return right.lastActivity - left.lastActivity;
    }

    if (left.isInternal !== right.isInternal) {
      return left.isInternal ? -1 : 1;
    }

    return left.name.localeCompare(right.name, "es", { sensitivity: "base" });
  });
};

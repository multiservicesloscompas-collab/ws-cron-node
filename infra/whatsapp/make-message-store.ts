/**
 * Message Store — Captures incoming WhatsApp messages and stores them in memory.
 *
 * Listens to Baileys `messages.upsert` events and keeps a ring buffer
 * of recent messages organized by conversation (JID).
 *
 * Also provides a helper to send messages to arbitrary JIDs.
 *
 * @see docs/spec-whatsapp-service.md section 7
 */

import { type WASocket } from './make-whatsapp-client.ts'
import { success, failure, type Result } from '../../types/result.ts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface StoredMessage {
  /** Unique message ID */
  id: string
  /** Sender/remote JID */
  jid: string
  /** The contact's push name if available */
  pushName: string
  /** Message text content */
  text: string
  /** Whether this message was sent by us */
  fromMe: boolean
  /** Timestamp (Unix seconds) */
  timestamp: number
  /** ISO formatted date string */
  dateStr: string
  /** Media info for non-text messages (image, sticker, video, audio) */
  media?: {
    type: 'image' | 'sticker' | 'video' | 'audio' | 'document'
    mimetype?: string
    /** Caption for media messages */
    caption?: string
    /** Raw message key for Baileys media download */
    messageKey: { id: string; remoteJid: string; fromMe: boolean }
    /** Raw message content for Baileys media download */
    messageContent: Record<string, unknown>
  }
}

export interface Conversation {
  /** The JID of the conversation */
  jid: string
  /** Contact name (push name or phone) */
  name: string
  /** Last message in this conversation */
  lastMessage: string
  /** Timestamp of last activity */
  lastActivity: number
  /** Unread count */
  unread: number
}

export interface MessageStore {
  /** Get all conversations sorted by most recent */
  getConversations: () => Conversation[]
  /** Get messages for a specific JID */
  getMessages: (jid: string, limit?: number) => StoredMessage[]
  /** Get a single conversation by JID */
  getConversation: (jid: string) => Conversation | null
  /** Get total number of unread messages */
  getTotalUnread: () => number
  /** Whether we have real messages for this JID */
  hasMessagesForJid: (jid: string) => boolean
  /** Mark conversation as read */
  markRead: (jid: string) => void
  /** Clear all messages */
  clear: () => void
  /** Start listening to socket events */
  startListening: (socket: WASocket) => void
  /** Stop listening */
  stopListening: () => void
  /** Subscribe to unread-impacting changes */
  subscribe: (listener: () => void) => () => void
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_STORED_MESSAGES = 500
const MAX_MESSAGES_PER_CHAT = 100

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract text and metadata from a Baileys message object.
 */
const extractMessage = (msg: Record<string, unknown>): {
  id: string
  jid: string
  pushName: string
  text: string
  fromMe: boolean
  timestamp: number
  media?: StoredMessage['media']
} | null => {
  try {
    const key = msg.key as Record<string, unknown> | undefined
    if (!key) return null

    const remoteJid = (key.remoteJid as string) || ''
    const fromMe = (key.fromMe as boolean) || false
    const id = (key.id as string) || ''

    // Only capture messages from contacts (not groups, not status)
    if (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@g.us')) {
      return null
    }

    // Extract text content and media info from various message types
    const message = msg.message as Record<string, unknown> | undefined
    let text = ''
    let media: StoredMessage['media'] | undefined

    if (message?.conversation) {
      text = message.conversation as string
    } else if (message?.extendedTextMessage) {
      const etm = message.extendedTextMessage as Record<string, unknown>
      text = (etm.text as string) || ''
    } else if (message?.imageMessage) {
      const img = message.imageMessage as Record<string, unknown>
      text = img.caption ? `🖼️ ${img.caption}` : '🖼️ [Imagen]'
      const ik = { id, remoteJid, fromMe }
      media = { type: 'image', mimetype: (img.mimetype as string) || 'image/jpeg', caption: (img.caption as string) || undefined, messageKey: ik, messageContent: { imageMessage: img } }
    } else if (message?.videoMessage) {
      text = '🎬 [Video]'
      const vid = message.videoMessage as Record<string, unknown>
      const vk = { id, remoteJid, fromMe }
      media = { type: 'video', mimetype: (vid.mimetype as string) || 'video/mp4', messageKey: vk, messageContent: { videoMessage: vid } }
    } else if (message?.audioMessage) {
      text = '🎵 [Audio]'
      const ak = { id, remoteJid, fromMe }
      media = { type: 'audio', messageKey: ak, messageContent: message }
    } else if (message?.documentMessage) {
      text = '📄 [Documento]'
      const dk = { id, remoteJid, fromMe }
      media = { type: 'document', messageKey: dk, messageContent: message }
    } else if (message?.stickerMessage) {
      text = '🃏 [Sticker]'
      const stk = message.stickerMessage as Record<string, unknown>
      const sk = { id, remoteJid, fromMe }
      media = { type: 'sticker', mimetype: (stk.mimetype as string) || 'image/webp', messageKey: sk, messageContent: { stickerMessage: stk } }
    } else {
      text = '📨 [Mensaje no textual]'
    }

    const pushName = (msg.pushName as string) || ''

    // messageTimestamp could be number (low) or Long (high)
    const timestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : Date.now() / 1000

    // Ignore own messages from store (they'll be captured differently)
    const stored: StoredMessage = { id, jid: remoteJid, pushName, text, fromMe, timestamp, dateStr: '' }
    if (media) stored.media = media
    return stored
  } catch {
    return null
  }
}

/**
 * Format a phone number JID to a readable display.
 * "584129833320@s.whatsapp.net" -> "+58 412-9833320"
 */
const formatJid = (jid: string): string => {
  if (jid.endsWith('@g.us')) {
    return 'Grupo'
  }
  const phone = jid.replace(/@.*$/, '')
  // Basic formatting as Venezuelan phone
  if (phone.startsWith('58') && phone.length >= 11) {
    return `+${phone.substring(0, 2)} ${phone.substring(2, 5)}-${phone.substring(5)}`
  }
  return phone
}

/**
 * Get the current date as a readable string.
 */
const now = (): string => {
  const d = new Date()
  return d.toLocaleString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  })
}

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeMessageStore = (): MessageStore => {
  const messages: StoredMessage[] = []
  const readMessageIds = new Set<string>()
  const listeners = new Set<() => void>()
  let listening = false
  let activeSocket: WASocket | null = null
  let messageHandler: ((...args: unknown[]) => void) | null = null

  // ─── Internal helpers ─────────────────────────────────────────────

  const getConverationMap = (): Map<string, Conversation> => {
    const map = new Map<string, Conversation>()

    for (const msg of messages) {
      const existing = map.get(msg.jid)
      if (!existing) {
        map.set(msg.jid, {
          jid: msg.jid,
          name: msg.pushName || formatJid(msg.jid),
          lastMessage: msg.text,
          lastActivity: msg.timestamp,
          unread: msg.fromMe || readMessageIds.has(msg.id) ? 0 : 1,
        })
      } else {
        existing.lastMessage = msg.text
        existing.lastActivity = msg.timestamp
        if (!msg.fromMe && !readMessageIds.has(msg.id)) existing.unread++
        if (msg.pushName) existing.name = msg.pushName
      }
    }

    return map
  }

  const notify = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  const getConversations = (): Conversation[] => {
    const map = getConverationMap()
    return Array.from(map.values())
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }

  const getMessages = (jid: string, limit = MAX_MESSAGES_PER_CHAT): StoredMessage[] => {
    return messages
      .filter((m) => m.jid === jid)
      .slice(-limit)
  }

  const getConversation = (jid: string): Conversation | null => {
    const convs = getConversations()
    return convs.find((c) => c.jid === jid) || null
  }

  const getTotalUnread = (): number => {
    return messages.filter((message) => {
      return !message.fromMe && !readMessageIds.has(message.id)
    }).length
  }

  const hasMessagesForJid = (jid: string): boolean => {
    return messages.some((message) => message.jid === jid)
  }

  const markRead = (jid: string): void => {
    let changed = false

    for (const message of messages) {
      if (message.jid !== jid || message.fromMe || readMessageIds.has(message.id)) {
        continue
      }

      readMessageIds.add(message.id)
      changed = true
    }

    if (changed) notify()
  }

  const clear = (): void => {
    messages.length = 0
    readMessageIds.clear()
    notify()
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const startListening = (socket: WASocket): void => {
    if (activeSocket === socket && listening && messageHandler) return

    if (activeSocket && messageHandler && activeSocket.ev.removeListener) {
      activeSocket.ev.removeListener('messages.upsert', messageHandler)
    }

    activeSocket = socket
    listening = true

    messageHandler = (data: unknown) => {
      try {
        const upsert = data as { messages?: Record<string, unknown>[]; type?: string }
        if (!upsert?.messages) return

        for (const rawMsg of upsert.messages) {
          const extracted = extractMessage(rawMsg)
          if (!extracted) continue

          // Add to store (trim if needed)
          messages.push({
            id: extracted.id,
            jid: extracted.jid,
            pushName: extracted.pushName,
            text: extracted.text,
            fromMe: extracted.fromMe,
            timestamp: extracted.timestamp,
            dateStr: now(),
            media: extracted.media,
          })

          // Trim oldest if over limit
          if (messages.length > MAX_STORED_MESSAGES) {
            const removedMessages = messages.splice(
              0,
              messages.length - MAX_STORED_MESSAGES,
            )

            for (const removedMessage of removedMessages) {
              readMessageIds.delete(removedMessage.id)
            }
          }

          notify()

          const direction = extracted.fromMe ? '→' : '←'
          console.log(`[CHAT ${direction}] ${extracted.pushName || extracted.jid}: ${extracted.text.substring(0, 80)}`)
        }
      } catch {
        // Silently ignore malformed messages
      }
    }

    socket.ev.on('messages.upsert', messageHandler)
    console.log('📬 Message store: escuchando mensajes entrantes')
  }

  const stopListening = (): void => {
    if (!listening || !messageHandler) return

    if (activeSocket?.ev.removeListener) {
      activeSocket.ev.removeListener('messages.upsert', messageHandler)
    }

    listening = false
    activeSocket = null
    messageHandler = null
  }

  return {
    getConversations,
    getMessages,
    getConversation,
    getTotalUnread,
    hasMessagesForJid,
    markRead,
    clear,
    startListening,
    stopListening,
    subscribe,
  }
}

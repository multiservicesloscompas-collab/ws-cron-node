import { assertEquals } from '#test-assert'
import { makeMessageStore } from '../make-message-store.ts'
import type { WASocket } from '../make-whatsapp-client.ts'

const CONTACT_JID = '584129833320@s.whatsapp.net'

type MessageHandler = (data: unknown) => void

type FakeSocket = WASocket & {
  emitUpsert: (data: unknown) => void
  listenerCount: (event: string) => number
}

const createFakeSocket = (): FakeSocket => {
  const listeners = new Map<string, MessageHandler[]>()

  return {
    ev: {
      on: (event: string, handler: MessageHandler) => {
        const handlers = listeners.get(event) || []
        handlers.push(handler)
        listeners.set(event, handlers)
      },
      removeListener: (event: string, handler: MessageHandler) => {
        const handlers = listeners.get(event) || []
        listeners.set(event, handlers.filter((entry) => entry !== handler))
      },
    },
    end: () => {},
    emitUpsert: (data: unknown) => {
      for (const handler of listeners.get('messages.upsert') || []) {
        handler(data)
      }
    },
    listenerCount: (event: string) => (listeners.get(event) || []).length,
  }
}

Deno.test('startListening persists image media metadata in stored messages', () => {
  const store = makeMessageStore()
  const socket = createFakeSocket()

  store.startListening(socket)

  socket.emitUpsert({
    messages: [{
      key: {
        id: 'image-1',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      pushName: 'Beto',
      messageTimestamp: 1,
      message: {
        imageMessage: {
          mimetype: 'image/png',
          caption: 'Foto del cierre',
          url: 'https://example.com/image',
        },
      },
    }],
  })

  const [message] = store.getMessages(CONTACT_JID)

  assertEquals(message, {
    id: 'image-1',
    jid: CONTACT_JID,
    pushName: 'Beto',
    text: '🖼️ Foto del cierre',
    fromMe: false,
    timestamp: 1,
    dateStr: message.dateStr,
    media: {
      type: 'image',
      mimetype: 'image/png',
      caption: 'Foto del cierre',
      messageKey: {
        id: 'image-1',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      messageContent: {
        imageMessage: {
          mimetype: 'image/png',
          caption: 'Foto del cierre',
          url: 'https://example.com/image',
        },
      },
    },
  })
})

Deno.test('startListening persists sticker media metadata in stored messages', () => {
  const store = makeMessageStore()
  const socket = createFakeSocket()

  store.startListening(socket)

  socket.emitUpsert({
    messages: [{
      key: {
        id: 'sticker-1',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      pushName: 'Beto',
      messageTimestamp: 2,
      message: {
        stickerMessage: {
          mimetype: 'image/webp',
          fileSha256: 'abc123',
        },
      },
    }],
  })

  const [message] = store.getMessages(CONTACT_JID)

  assertEquals(message, {
    id: 'sticker-1',
    jid: CONTACT_JID,
    pushName: 'Beto',
    text: '🃏 [Sticker]',
    fromMe: false,
    timestamp: 2,
    dateStr: message.dateStr,
    media: {
      type: 'sticker',
      mimetype: 'image/webp',
      messageKey: {
        id: 'sticker-1',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      messageContent: {
        stickerMessage: {
          mimetype: 'image/webp',
          fileSha256: 'abc123',
        },
      },
    },
  })
})

Deno.test('startListening reattaches the listener when the socket changes', () => {
  const store = makeMessageStore()
  const firstSocket = createFakeSocket()
  const secondSocket = createFakeSocket()

  store.startListening(firstSocket)
  store.startListening(secondSocket)

  assertEquals(firstSocket.listenerCount('messages.upsert'), 0)
  assertEquals(secondSocket.listenerCount('messages.upsert'), 1)

  firstSocket.emitUpsert({
    messages: [{
      key: {
        id: 'old-socket-message',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      pushName: 'Beto',
      messageTimestamp: 3,
      message: { conversation: 'Viejo socket' },
    }],
  })

  secondSocket.emitUpsert({
    messages: [{
      key: {
        id: 'new-socket-message',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      pushName: 'Beto',
      messageTimestamp: 4,
      message: { conversation: 'Socket actual' },
    }],
  })

  assertEquals(store.getMessages(CONTACT_JID).map((message) => message.id), [
    'new-socket-message',
  ])
})

Deno.test('subscribe notifies when unread state changes', () => {
  const store = makeMessageStore()
  const socket = createFakeSocket()
  let notifications = 0

  store.subscribe(() => {
    notifications++
  })

  store.startListening(socket)
  socket.emitUpsert({
    messages: [{
      key: {
        id: 'new-message',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      pushName: 'Beto',
      messageTimestamp: 5,
      message: { conversation: 'Hola' },
    }],
  })

  assertEquals(notifications, 1)
})

Deno.test('markRead clears unread count for a conversation', () => {
  const store = makeMessageStore()
  const socket = createFakeSocket()

  store.startListening(socket)
  socket.emitUpsert({
    messages: [{
      key: {
        id: 'first-unread',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      pushName: 'Beto',
      messageTimestamp: 6,
      message: { conversation: 'Pendiente 1' },
    }, {
      key: {
        id: 'second-unread',
        remoteJid: CONTACT_JID,
        fromMe: false,
      },
      pushName: 'Beto',
      messageTimestamp: 7,
      message: { conversation: 'Pendiente 2' },
    }],
  })

  assertEquals(store.getConversation(CONTACT_JID)?.unread, 2)
  assertEquals(store.getTotalUnread(), 2)

  store.markRead(CONTACT_JID)

  assertEquals(store.getConversation(CONTACT_JID)?.unread, 0)
  assertEquals(store.getTotalUnread(), 0)
})

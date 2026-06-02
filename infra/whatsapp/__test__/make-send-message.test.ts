/**
 * Tests for makeSendMessage factory.
 *
 * @see infra/whatsapp/make-send-message.ts
 */

import { assertEquals, assert } from '#test-assert'
import { makeSendMessage } from '../make-send-message.ts'
import { isFailure } from '../../../types/result.ts'

// ─── Helpers ───────────────────────────────────────────────────────────────

const createMockSocket = () => ({
  sendMessage: (_jid: string, _content: { text: string }) =>
    Promise.resolve(),
})

// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test(
  '1. sendMessage returns success when socket is present and resolves',
  async () => {
    const mockSocket = createMockSocket()

    const sendMessage = makeSendMessage({
      getSocket: () => mockSocket as any,
    })

    const result = await sendMessage('123@g.us', 'Hola mundo')

    assert(!isFailure(result), 'Result should be success')
    assertEquals(result.getValue(), undefined)
  },
)

Deno.test(
  '2. sendMessage returns failure when getSocket() is null',
  async () => {
    const sendMessage = makeSendMessage({
      getSocket: () => null,
    })

    const result = await sendMessage('123@g.us', 'Hola mundo')

    assert(isFailure(result), 'Result should be failure')
    assertEquals(result.getError(), 'WhatsApp no está conectado')
  },
)

Deno.test(
  '3. sendMessage returns failure with Baileys error message when rejects',
  async () => {
    const mockSocket = createMockSocket()
    mockSocket.sendMessage = () =>
      Promise.reject(new Error('Connection lost'))

    const sendMessage = makeSendMessage({
      getSocket: () => mockSocket as any,
    })

    const result = await sendMessage('123@g.us', 'Hola mundo')

    assert(isFailure(result), 'Result should be failure')
    assertEquals(
      result.getError(),
      'Error al enviar mensaje: Connection lost',
    )
  },
)

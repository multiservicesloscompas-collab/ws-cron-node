/**
 * Tests for makeSendMessage factory.
 *
 * @see infra/whatsapp/make-send-message.ts
 */

import { assertEquals, assert } from '#test-assert'
import { makeSendMessage } from '../make-send-message.ts'
import { isFailure } from '../../../types/result.ts'
import type { WASocket } from '../make-whatsapp-client.ts'

// ─── Helpers ───────────────────────────────────────────────────────────────

const createMockSocket = () => {
  let calls = 0

  const socket: WASocket = {
    ev: {
      on: () => undefined,
    },
    end: () => undefined,
    sendMessage: async () => {
      calls += 1
      return undefined
    },
  }

  return {
    socket,
    getCalls: () => calls,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test(
  '1. sendMessage returns success when socket is open and resolves',
  async () => {
    const mockSocket = createMockSocket()

    const sendMessage = makeSendMessage({
      getSocket: () => mockSocket.socket,
      getConnectionStatus: () => 'open',
    })

    const result = await sendMessage('123@g.us', 'Hola mundo')

    assert(!isFailure(result), 'Result should be success')
    assertEquals(result.getValue(), undefined)
    assertEquals(mockSocket.getCalls(), 1)
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
  '3. sendMessage returns failure when status is not open and does not call socket',
  async () => {
    const mockSocket = createMockSocket()

    const sendMessage = makeSendMessage({
      getSocket: () => mockSocket.socket,
      getConnectionStatus: () => 'connecting',
    })

    const result = await sendMessage('123@g.us', 'Hola mundo')

    assert(isFailure(result), 'Result should be failure')
    assertEquals(result.getError(), 'WhatsApp no está conectado')
    assertEquals(mockSocket.getCalls(), 0)
  },
)

Deno.test(
  '4. sendMessage returns failure when status is closed and does not call socket',
  async () => {
    const mockSocket = createMockSocket()

    const sendMessage = makeSendMessage({
      getSocket: () => mockSocket.socket,
      getConnectionStatus: () => 'closed',
    })

    const result = await sendMessage('123@g.us', 'Hola mundo')

    assert(isFailure(result), 'Result should be failure')
    assertEquals(result.getError(), 'WhatsApp no está conectado')
    assertEquals(mockSocket.getCalls(), 0)
  },
)

Deno.test(
  '5. sendMessage returns failure with Baileys error message when rejects',
  async () => {
    const mockSocket = createMockSocket()
    mockSocket.socket.sendMessage = async () => {
      throw new Error('Connection lost')
    }

    const sendMessage = makeSendMessage({
      getSocket: () => mockSocket.socket,
      getConnectionStatus: () => 'open',
    })

    const result = await sendMessage('123@g.us', 'Hola mundo')

    assert(isFailure(result), 'Result should be failure')
    assertEquals(
      result.getError(),
      'Error al enviar mensaje: Connection lost',
    )
  },
)

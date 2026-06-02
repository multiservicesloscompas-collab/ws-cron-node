/**
 * Tests for makeWhatsAppClient factory.
 *
 * @see infra/whatsapp/make-whatsapp-client.ts
 */

import { assertEquals, assert } from '#test-assert'
import { makeWhatsAppClient } from '../make-whatsapp-client.ts'
import type { ManagedWhatsAppAuthState } from '../whatsapp-auth-state.ts'

// ─── Helpers ───────────────────────────────────────────────────────────────

interface FakeSocket {
  ev: {
    on: (event: string, handler: (...args: any[]) => void) => void
    removeListener: (event: string, handler: (...args: any[]) => void) => void
  }
  end: (input?: unknown) => void
  _emit: (event: string, data: any) => void
  user?: {
    id?: string
  }
}

const createFakeSocket = (): FakeSocket => {
  const listeners: Record<string, Array<(data: any) => void>> = {}

  return {
    ev: {
      on: (event: string, handler: (...args: any[]) => void) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(handler)
      },
      removeListener: (event: string, handler: (...args: any[]) => void) => {
        if (!listeners[event]) return
        listeners[event] = listeners[event].filter((entry) => entry !== handler)
      },
    },
    end: (_input?: unknown) => {},
    _emit: (event: string, data: any) => {
      if (listeners[event]) {
        listeners[event].forEach((h) => h(data))
      }
    },
  }
}

type TimeoutCallback = () => void | Promise<void>

/** Temporarily replace globalThis.setTimeout, returns original. */
const captureSetTimeout = (
  captured: Array<{ delay: number; callback: TimeoutCallback }>,
): typeof globalThis.setTimeout => {
  const replacement = ((cb: unknown, delay: number): number => {
    if (typeof cb !== 'function') throw new Error('Expected function callback')
    captured.push({ delay, callback: cb as TimeoutCallback })
    return captured.length
  }) as unknown as typeof globalThis.setTimeout
  const orig = globalThis.setTimeout
  globalThis.setTimeout = replacement
  return orig
}

const restoreSetTimeout = (orig: typeof globalThis.setTimeout): void => {
  globalThis.setTimeout = orig
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const waitFor = async (
  predicate: () => boolean,
  attempts = 10,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await flushMicrotasks()
    if (predicate()) return
  }

  throw new Error('Condition not met in time')
}

const DISCONNECT_REASON = { loggedOut: 401 }

const QR_CODE_BINDINGS = {
  toString: async (value: string) => `QR:${value}`,
  toDataURL: async (value: string) => `data:image/png;base64,${value}`,
}

const makeInjectedAuthState = (): ManagedWhatsAppAuthState => ({
  state: {
    creds: {},
    keys: {
      get: async () => ({}),
      set: async () => {},
      clear: async () => {},
    },
  },
  saveCreds: async () => {},
  clear: async () => {},
})


// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test(
  '1. start() calls makeWASocket with correct config',
  async () => {
    const f = createFakeSocket()
    let capturedConfig: Record<string, unknown> | null = null

    const mockMakeWASocket = (config: Record<string, unknown>) => {
      capturedConfig = config
      return f
    }

    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: mockMakeWASocket,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
      qrCode: QR_CODE_BINDINGS,
    })

    await client.start()

    assert(capturedConfig !== null, 'makeWASocket should have been called')
    const config = capturedConfig as Record<string, unknown>
    // Baileys v7 ya no soporta printQRInTerminal
    assertEquals(config.printQRInTerminal, undefined)
    assertEquals(config.qrTimeout, 120_000)
  },
)

Deno.test(
  '10. QR event logs QR code in terminal or link fallback',
  async () => {
    const f = createFakeSocket()

    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => f,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
    })

    await client.start()

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }

    try {
      f._emit('connection.update', { qr: 'test-qr-string-12345' })

      // Esperar a que la promesa de QRCode.toString se resuelva
      await new Promise((r) => setTimeout(r, 100))

      const joined = logs.join('\n')
      // Debe contener el encabezado
      assert(
        joined.includes('ESCANEA ESTE QR'),
        'Debería mostrar el encabezado del QR',
      )

      // Debe contener el QR en ASCII (la librería funciona) o el link original
      const hasQrAscii = logs.some((l) => l.includes('█') || l.includes('▀'))
      const hasMockQr = logs.some((l) => l.includes('QR:test-qr-string-12345'))
      const hasLink = logs.some((l) => l.includes('test-qr-string-12345'))

      assert(
        hasQrAscii || hasMockQr || hasLink,
        'Debería mostrar el QR renderizado o el link como fallback',
      )
    } finally {
      console.log = origLog
    }
  },
)

Deno.test(
  '11. getOwnJid() returns normalized account jid after open connection',
  async () => {
    const f = createFakeSocket()
    f.user = { id: '584129833320:12@s.whatsapp.net' }

    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => f,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
    })

    await client.start()
    f._emit('connection.update', { connection: 'open' })

    assertEquals(client.getOwnJid(), '584129833320@s.whatsapp.net')
  },
)

Deno.test(
  '11.1 onConnectionOpen receives normalized own jid after open connection',
  async () => {
    const f = createFakeSocket()
    f.user = { id: '584129833320:12@s.whatsapp.net' }
    const ownJids: string[] = []

    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => f,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
      onConnectionOpen: (ownJid) => {
        ownJids.push(ownJid)
      },
    })

    await client.start()
    f._emit('connection.update', { connection: 'open' })

    assertEquals(ownJids, ['584129833320@s.whatsapp.net'])
  },
)

Deno.test(
  "2. 'connecting' sets status to 'connecting'",
  async () => {
    const f = createFakeSocket()

    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => f,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
    })

    await client.start()
    f._emit('connection.update', { connection: 'connecting' })

    assertEquals(client.getConnectionStatus(), 'connecting')
    assertEquals(client.getSessionState().phase, 'reconnecting')
  },
)

Deno.test(
  "3. 'open' sets status to 'open' and resets reconnectAttempts",
  async () => {
    const f = createFakeSocket()

    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => f,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
    })

    await client.start()
    f._emit('connection.update', { connection: 'open' })

    assertEquals(client.getConnectionStatus(), 'open')
    assertEquals(client.getSessionState().phase, 'connected')
  },
)

Deno.test(
  "4. 'close' + non-loggedOut schedules reconnect (~1s first attempt)",
  async () => {
    const f = createFakeSocket()
    const capturedTimeouts: Array<{ delay: number; callback: TimeoutCallback }> = []
    const orig = captureSetTimeout(capturedTimeouts)

    try {
      const client = makeWhatsAppClient({
        authFolder: 'test_auth',
        makeWASocket: () => f,
        loadAuthState: async () => makeInjectedAuthState(),
        useMultiFileAuthState: async () => ({
          state: {},
          saveCreds: async () => {},
        }),
        DisconnectReason: DISCONNECT_REASON,
      })

      await client.start()

      f._emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      })

      assertEquals(client.getConnectionStatus(), 'closed')
      assertEquals(client.getSessionState().phase, 'reconnecting')
      assertEquals(client.getSessionState().nextReconnectDelayMs, 1000)
      assertEquals(capturedTimeouts.length, 1)
      assertEquals(capturedTimeouts[0].delay, 1000)
    } finally {
      restoreSetTimeout(orig)
    }
  },
)

Deno.test('5. Multiple disconnects cap backoff at 30s', async () => {
  const f = createFakeSocket()
  const captured: Array<{ delay: number; callback: TimeoutCallback }> = []
  const orig = captureSetTimeout(captured)

  try {
    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => f,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
    })

    await client.start()

    for (let i = 0; i < 10; i++) {
      f._emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      })
    }

    const delays = captured.map((c) => c.delay)
    const maxDelay = Math.max(...delays)
    assertEquals(maxDelay, 30000)

    assertEquals(delays[0], 1000)
    assertEquals(delays[1], 2000)
    assertEquals(delays[2], 4000)
    assertEquals(delays[3], 8000)
    assertEquals(delays[4], 16000)
    assertEquals(delays[5], 30000)
    assertEquals(delays[6], 30000)
  } finally {
    restoreSetTimeout(orig)
  }
})

Deno.test(
  "6. 'close' + loggedOut clears auth state before relink socket recreation",
  async () => {
    const firstSocket = createFakeSocket()
    const secondSocket = createFakeSocket()
    const sockets = [firstSocket, secondSocket]
    const capturedTimeouts: Array<{ delay: number; callback: TimeoutCallback }> = []
    const events: string[] = []
    const orig = captureSetTimeout(capturedTimeouts)

    try {
      const client = makeWhatsAppClient({
        authFolder: 'test_auth',
        makeWASocket: () => {
          const socket = sockets.shift()
          if (!socket) throw new Error('No fake socket available')
          events.push('create-socket')
          return socket
        },
        loadAuthState: async () => makeInjectedAuthState(),
        useMultiFileAuthState: async () => ({
          state: {},
          saveCreds: async () => {},
        }),
        DisconnectReason: { loggedOut: 401 },
        clearAuthState: async (folder) => {
          events.push(`clear-auth:${folder}`)
        },
      })

      await client.start()

      firstSocket._emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      })

      assertEquals(client.getConnectionStatus(), 'loggedOut')
      assertEquals(client.getSessionState().phase, 'relink_required')
      assertEquals(capturedTimeouts.length, 1)
      assertEquals(capturedTimeouts[0].delay, 1000)

      await capturedTimeouts[0].callback()

      assertEquals(events, [
        'create-socket',
        'clear-auth:test_auth',
        'create-socket',
      ])
      assertEquals(client.getSocket(), secondSocket)
    } finally {
      restoreSetTimeout(orig)
    }
  },
)

Deno.test(
  '6.1 loggedOut relink proceeds to qr_pending after auth state reset',
  async () => {
    const firstSocket = createFakeSocket()
    const secondSocket = createFakeSocket()
    const sockets = [firstSocket, secondSocket]
    const capturedTimeouts: Array<{ delay: number; callback: TimeoutCallback }> = []
    const orig = captureSetTimeout(capturedTimeouts)

    try {
      const client = makeWhatsAppClient({
        authFolder: 'test_auth',
        makeWASocket: () => {
          const socket = sockets.shift()
          if (!socket) throw new Error('No fake socket available')
          return socket
        },
        loadAuthState: async () => makeInjectedAuthState(),
        useMultiFileAuthState: async () => ({
          state: {},
          saveCreds: async () => {},
        }),
        DisconnectReason: DISCONNECT_REASON,
        clearAuthState: async () => {},
        qrCode: QR_CODE_BINDINGS,
      })

      await client.start()

      firstSocket._emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      })

      await capturedTimeouts[0].callback()
      secondSocket._emit('connection.update', { qr: 'fresh-qr-after-logout' })
      await waitFor(() => client.getSessionState().qrDataUrl !== null)

      assertEquals(client.getConnectionStatus(), 'loggedOut')
      assertEquals(client.getSessionState().phase, 'qr_pending')
      assertEquals(client.getSessionState().requiresUserAction, true)
      assertEquals(
        client.getSessionState().qrDataUrl,
        'data:image/png;base64,fresh-qr-after-logout',
      )
    } finally {
      restoreSetTimeout(orig)
    }
  },
)

Deno.test('7. getSocket() returns current socket instance', async () => {
  const f = createFakeSocket()

  const client = makeWhatsAppClient({
    authFolder: 'test_auth',
    makeWASocket: () => f,
    useMultiFileAuthState: async () => ({
      state: {},
      saveCreds: async () => {},
    }),
    DisconnectReason: DISCONNECT_REASON,
  })

  assertEquals(client.getSocket(), null)

  await client.start()

  assertEquals(client.getSocket(), f)
})

Deno.test(
  '8. getConnectionStatus() returns current status after events',
  async () => {
    const f = createFakeSocket()

    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => f,
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
    })

    assertEquals(client.getConnectionStatus(), 'closed')

    await client.start()
    assertEquals(client.getConnectionStatus(), 'closed')

    f._emit('connection.update', { connection: 'open' })
    assertEquals(client.getConnectionStatus(), 'open')

    f._emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    })
    assertEquals(client.getConnectionStatus(), 'closed')

    // Clean up pending timer to avoid Deno leak detection
    await client.stop()
  },
)

Deno.test('9. stop() closes socket gracefully', async () => {
  const f = createFakeSocket()
  let endCalled = false

  f.end = () => {
    endCalled = true
  }

  const client = makeWhatsAppClient({
    authFolder: 'test_auth',
    makeWASocket: () => f,
    useMultiFileAuthState: async () => ({
      state: {},
      saveCreds: async () => {},
    }),
    DisconnectReason: DISCONNECT_REASON,
  })

  await client.start()
  assertEquals(client.getSocket(), f)

  await client.stop()
  assertEquals(endCalled, true)
  assertEquals(client.getSocket(), null)
  assertEquals(client.getConnectionStatus(), 'closed')
  assertEquals(client.getSessionState().phase, 'disconnected')
})

Deno.test('12. onSocket is called again after a reconnect creates a new socket', async () => {
  const firstSocket = createFakeSocket()
  const secondSocket = createFakeSocket()
  const sockets = [firstSocket, secondSocket]
  const attachedSockets: FakeSocket[] = []
  const capturedTimeouts: Array<{ delay: number; callback: TimeoutCallback }> = []
  const orig = captureSetTimeout(capturedTimeouts)

  try {
    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => {
        const nextSocket = sockets.shift()
        if (!nextSocket) throw new Error('No fake socket available')
        return nextSocket
      },
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
      onSocket: (socket) => {
        attachedSockets.push(socket as FakeSocket)
      },
    })

    await client.start()
    firstSocket._emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    })

    assertEquals(capturedTimeouts.length, 1)
    await capturedTimeouts[0].callback()

    assertEquals(attachedSockets, [firstSocket, secondSocket])
    assertEquals(client.getSocket(), secondSocket)
  } finally {
    restoreSetTimeout(orig)
  }
})

Deno.test('13. QR update exposes qr_pending session with qrDataUrl', async () => {
  const f = createFakeSocket()

  const client = makeWhatsAppClient({
    authFolder: 'test_auth',
    makeWASocket: () => f,
    useMultiFileAuthState: async () => ({
      state: {},
      saveCreds: async () => {},
    }),
    DisconnectReason: DISCONNECT_REASON,
    qrCode: QR_CODE_BINDINGS,
  })

  await client.start()
  f._emit('connection.update', { qr: 'test-qr-string-12345' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assertEquals(client.getSessionState().phase, 'qr_pending')
  assertEquals(client.getSessionState().requiresUserAction, true)
  assertEquals(
    client.getSessionState().qrDataUrl,
    'data:image/png;base64,test-qr-string-12345',
  )
})

Deno.test('14. QR update falls back to svg data url when png conversion fails', async () => {
  const f = createFakeSocket()

  const client = makeWhatsAppClient({
    authFolder: 'test_auth',
    makeWASocket: () => f,
    useMultiFileAuthState: async () => ({
      state: {},
      saveCreds: async () => {},
    }),
    DisconnectReason: DISCONNECT_REASON,
    qrCode: {
      toString: async (value: string, options: { type: 'terminal' | 'svg'; small?: boolean }) =>
        options.type === 'svg' ? `<svg data-qr="${value}"></svg>` : `QR:${value}`,
      toDataURL: async () => {
        throw new Error('png generation failed')
      },
    },
  })

  await client.start()
  f._emit('connection.update', { qr: 'fallback-qr-123' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assertEquals(client.getSessionState().phase, 'qr_pending')
  assertEquals(client.getSessionState().requiresUserAction, true)
  assertEquals(
    client.getSessionState().qrDataUrl,
    'data:image/svg+xml;charset=utf-8,%3Csvg%20data-qr%3D%22fallback-qr-123%22%3E%3C%2Fsvg%3E',
  )
})

Deno.test('15. default auth loader receives postgres database when provided', async () => {
  const f = createFakeSocket()
  const fakeDatabase = {
    query: async () => ({ rows: [], rowCount: 0 }),
  }
  const captured: Array<{ authFolder: string; hasDatabase: boolean }> = []

  const client = makeWhatsAppClient({
    authFolder: 'test_auth',
    database: fakeDatabase,
    makeWASocket: () => f,
    loadAuthState: async ({ authFolder, database }) => {
      captured.push({ authFolder, hasDatabase: Boolean(database) })
      return makeInjectedAuthState()
    },
    DisconnectReason: DISCONNECT_REASON,
  })

  await client.start()

  assertEquals(captured, [{ authFolder: 'test_auth', hasDatabase: true }])
})

Deno.test('16. onSessionStateChange receives connection updates', async () => {
  const f = createFakeSocket()
  const phases: string[] = []

  const client = makeWhatsAppClient({
    authFolder: 'test_auth',
    makeWASocket: () => f,
    useMultiFileAuthState: async () => ({
      state: {},
      saveCreds: async () => {},
    }),
    DisconnectReason: DISCONNECT_REASON,
    onSessionStateChange: (session) => {
      phases.push(session.phase)
    },
  })

  await client.start()
  f._emit('connection.update', { connection: 'connecting' })
  f._emit('connection.update', { connection: 'open' })

  assertEquals(phases.includes('reconnecting'), true)
  assertEquals(phases.includes('connected'), true)
})

Deno.test('17. unlink() logs out, clears auth, ends current socket and creates one fresh QR socket', async () => {
  const firstSocket = createFakeSocket()
  const secondSocket = createFakeSocket()
  const sockets = [firstSocket, secondSocket]
  const capturedTimeouts: Array<{ delay: number; callback: TimeoutCallback }> = []
  const events: string[] = []
  const orig = captureSetTimeout(capturedTimeouts)

  firstSocket.end = () => {
    events.push('end:first')
  }

  ;(firstSocket as FakeSocket & { logout: () => Promise<void> }).logout = async () => {
    events.push('logout:first')
  }

  try {
    const client = makeWhatsAppClient({
      authFolder: 'test_auth',
      makeWASocket: () => {
        const nextSocket = sockets.shift()
        if (!nextSocket) throw new Error('No fake socket available')
        events.push(`create:${nextSocket === firstSocket ? 'first' : 'second'}`)
        return nextSocket
      },
      loadAuthState: async () => makeInjectedAuthState(),
      useMultiFileAuthState: async () => ({
        state: {},
        saveCreds: async () => {},
      }),
      DisconnectReason: DISCONNECT_REASON,
      clearAuthState: async (folder) => {
        events.push(`clear-auth:${folder}`)
      },
      qrCode: QR_CODE_BINDINGS,
    })

    await client.start()
    firstSocket.user = { id: '584129833320:12@s.whatsapp.net' }
    firstSocket._emit('connection.update', { connection: 'open' })

    const result = await client.unlink()

    assertEquals(result.isFailure, false)
    assertEquals(events, [
      'create:first',
      'logout:first',
      'end:first',
      'clear-auth:test_auth',
      'create:second',
    ])
    assertEquals(capturedTimeouts.length, 0)
    assertEquals(client.getSocket(), secondSocket)
    assertEquals(client.getOwnJid(), '')

    secondSocket._emit('connection.update', { qr: 'unlink-fresh-qr' })
    await waitFor(() => client.getSessionState().qrDataUrl !== null)

    assertEquals(client.getConnectionStatus(), 'loggedOut')
    assertEquals(client.getSessionState().phase, 'qr_pending')
    assertEquals(client.getSessionState().qrDataUrl, 'data:image/png;base64,unlink-fresh-qr')
  } finally {
    restoreSetTimeout(orig)
  }
})

Deno.test('18. unlink() ignores stale QR events from the retired socket', async () => {
  const firstSocket = createFakeSocket()
  const secondSocket = createFakeSocket()
  const sockets = [firstSocket, secondSocket]
  const events: string[] = []

  ;(firstSocket as FakeSocket & { logout: () => Promise<void> }).logout = async () => {}

  const client = makeWhatsAppClient({
    authFolder: 'test_auth',
    makeWASocket: () => {
      const nextSocket = sockets.shift()
      if (!nextSocket) throw new Error('No fake socket available')
      events.push(nextSocket === firstSocket ? 'create:first' : 'create:second')
      return nextSocket
    },
    loadAuthState: async () => makeInjectedAuthState(),
    useMultiFileAuthState: async () => ({
      state: {},
      saveCreds: async () => {},
    }),
    DisconnectReason: DISCONNECT_REASON,
    clearAuthState: async () => {},
    qrCode: QR_CODE_BINDINGS,
  })

  await client.start()
  firstSocket.user = { id: '584129833320:12@s.whatsapp.net' }
  firstSocket._emit('connection.update', { connection: 'open' })
  await client.unlink()

  assertEquals(events, ['create:first', 'create:second'])
  assertEquals(client.getSocket(), secondSocket)

  firstSocket._emit('connection.update', { qr: 'stale-qr' })
  await flushMicrotasks()

  assertEquals(client.getSessionState().qr, null)
  assertEquals(client.getSessionState().qrDataUrl, null)

  secondSocket._emit('connection.update', { qr: 'fresh-qr' })
  await waitFor(() => client.getSessionState().qr === 'fresh-qr')

  assertEquals(client.getSessionState().qr, 'fresh-qr')
  assertEquals(client.getSessionState().qrDataUrl, 'data:image/png;base64,fresh-qr')
})

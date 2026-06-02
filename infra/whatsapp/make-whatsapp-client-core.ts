import { rm } from 'node:fs/promises'
import { failure, success, type Result } from '../../types/result.ts'
import type { PostgresQueryable } from '../postgres/postgres-types.ts'
import type {
  ConnectionStatus,
  WhatsAppClient,
  WhatsAppSessionState,
} from './whatsapp-types.ts'
import {
  loadDefaultBindings,
  type BaileysBindings,
  type QRCodeBindings,
  type WASocket,
} from './baileys-bindings.ts'
import type { ManagedWhatsAppAuthState, WhatsAppAuthState } from './whatsapp-auth-state.ts'
import { makeWhatsAppConnectionUpdateHandler } from './make-whatsapp-connection-update-handler.ts'
import {
  clearQrSession,
  createSessionState,
  nowIso,
} from './whatsapp-session-state.ts'

const normalizeOwnJid = (jid: string): string => jid.replace(/:\d+@/, '@')

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error

const toErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

export type SessionStateListener = (session: WhatsAppSessionState) => void

export interface MakeWhatsAppClientConfig extends Partial<BaileysBindings> {
  authFolder: string
  database?: PostgresQueryable
  clearAuthState?: (folder: string) => Promise<void>
  onSocket?: (socket: WASocket) => void
  onConnectionOpen?: (ownJid: string) => void
  onSessionStateChange?: SessionStateListener
  qrCode?: QRCodeBindings
  useMultiFileAuthState?: (folder: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>
}

export const makeWhatsAppClientCore = (
  config: MakeWhatsAppClientConfig,
): WhatsAppClient => {
  const { authFolder } = config

  let socket: WASocket | null = null
  let status: ConnectionStatus = 'closed'
  let reconnectAttempts = 0
  let reconnectTimer: NodeJS.Timeout | null = null
  let isStopping = false
  let isManualUnlinking = false
  let bindings: BaileysBindings | null = null
  let ownJid = ''
  let session = createSessionState()
  let relinkAttemptScheduled = false
  let authState: ManagedWhatsAppAuthState | null = null
  let retireSocketEvents: (() => void) | null = null
  let cleanupSocketListeners: (() => void) | null = null
  let socketGeneration = 0

  const updateSession = (next: Partial<WhatsAppSessionState>): WhatsAppSessionState => {
    session = {
      ...session,
      ...next,
      connectionStatus: status,
      updatedAt: nowIso(),
    }

    config.onSessionStateChange?.({ ...session })
    return session
  }

  const cancelReconnectTimer = (): void => {
    if (reconnectTimer === null) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const clearAuthState = async (): Promise<void> => {
    if (config.clearAuthState) {
      await config.clearAuthState(authFolder)
      return
    }

    if (authState) {
      await authState.clear()
      return
    }

    try {
      await rm(authFolder, { recursive: true, force: true })
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return
      throw error
    }
  }

  const resolveBindings = async (): Promise<BaileysBindings> => {
    if (bindings) return bindings

    if (config.makeWASocket && config.useMultiFileAuthState && config.DisconnectReason) {
      bindings = {
        makeWASocket: config.makeWASocket,
        DisconnectReason: config.DisconnectReason,
        loadAuthState: async ({ authFolder }) => {
          const { state, saveCreds } = await config.useMultiFileAuthState!(authFolder)
          return {
            state: state as WhatsAppAuthState,
            saveCreds,
            clear: async () => {
              await clearAuthState()
            },
          }
        },
      }
      return bindings
    }

    if (config.makeWASocket && config.loadAuthState && config.DisconnectReason) {
      bindings = {
        makeWASocket: config.makeWASocket,
        loadAuthState: config.loadAuthState,
        DisconnectReason: config.DisconnectReason,
      }
      return bindings
    }

    bindings = await loadDefaultBindings()
    return bindings
  }

  const scheduleReconnect = (delay: number, createSocket: () => Promise<void>): void => {
    cancelReconnectTimer()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      return createSocket()
    }, delay)
  }

  const createSocket = async (): Promise<void> => {
    const b = await resolveBindings()
    authState = await b.loadAuthState({ authFolder, database: config.database })

    const nextSocket = b.makeWASocket({
      auth: authState.state,
      qrTimeout: 120_000,
    })
    let isCurrentSocket = true
    const currentGeneration = ++socketGeneration

    const handleCredsUpdate = authState.saveCreds

    socket = nextSocket
    retireSocketEvents = () => {
      isCurrentSocket = false
    }
    updateSession({ nextReconnectDelayMs: null })
    config.onSocket?.(nextSocket)

    const syncOwnJid = (): void => {
      const jid = nextSocket.user?.id
      if (!jid) return
      ownJid = normalizeOwnJid(jid)
    }

    const handleConnectionUpdate = makeWhatsAppConnectionUpdateHandler({
      nextSocket,
      qrCode: config.qrCode,
      isStopping: () => isStopping,
      isManualUnlinking: () => isManualUnlinking,
      isActiveSocket: () => isCurrentSocket && socket === nextSocket && currentGeneration === socketGeneration,
      getStatus: () => status,
      setStatus: (nextStatus) => {
        status = nextStatus
      },
      getSession: () => session,
      updateSession,
      syncOwnJid,
      resetReconnectAttempts: () => {
        reconnectAttempts = 0
      },
      incrementReconnectAttempts: () => {
        reconnectAttempts += 1
        return reconnectAttempts
      },
      setRelinkAttemptScheduled: (value) => {
        relinkAttemptScheduled = value
      },
      onConnectionOpen: config.onConnectionOpen,
      getOwnJid: () => ownJid,
      loggedOutCode: b.DisconnectReason.loggedOut,
      scheduleReconnect,
      clearAuthState,
      createSocket,
    })

    cleanupSocketListeners = () => {
      nextSocket.ev.removeListener?.('creds.update', handleCredsUpdate)
      nextSocket.ev.removeListener?.('connection.update', handleConnectionUpdate)
    }

    syncOwnJid()
    nextSocket.ev.on('creds.update', handleCredsUpdate)
    nextSocket.ev.on('connection.update', handleConnectionUpdate)
  }

  const stop = async (): Promise<void> => {
    isStopping = true
    cancelReconnectTimer()

    if (socket) {
      const activeSocket = socket
      socket = null
      socketGeneration++
      retireSocketEvents?.()
      retireSocketEvents = null
      cleanupSocketListeners?.()
      cleanupSocketListeners = null
      activeSocket.end(undefined)
    }

    status = 'closed'
    ownJid = ''
    reconnectAttempts = 0
    relinkAttemptScheduled = false
    updateSession({
      phase: 'disconnected',
      requiresUserAction: false,
      canAutoReconnect: false,
      reconnectAttempt: 0,
      nextReconnectDelayMs: null,
      lastDisconnectCode: null,
      ...clearQrSession(),
    })
  }

  const unlink = async (): Promise<Result<WhatsAppSessionState, string>> => {
    if (!socket || session.phase !== 'connected') {
      return failure('No hay una sesión activa de WhatsApp para desvincular.')
    }

    const activeSocket = socket
    isManualUnlinking = true
    cancelReconnectTimer()
    socket = null
    socketGeneration++
    retireSocketEvents?.()
    retireSocketEvents = null
    cleanupSocketListeners?.()
    cleanupSocketListeners = null

    try {
      await activeSocket.logout?.()
      activeSocket.end(undefined)
      await clearAuthState()

      ownJid = ''
      reconnectAttempts = 0
      relinkAttemptScheduled = false
      status = 'loggedOut'
      updateSession({
        phase: 'relink_required',
        requiresUserAction: true,
        canAutoReconnect: false,
        reconnectAttempt: 0,
        nextReconnectDelayMs: null,
        lastDisconnectCode: null,
        ...clearQrSession(),
      })

      await createSocket()
      return success({ ...session })
    } catch (error) {
      status = 'closed'
      socket = null
      updateSession({
        phase: 'disconnected',
        requiresUserAction: false,
        canAutoReconnect: false,
        reconnectAttempt: 0,
        nextReconnectDelayMs: null,
        ...clearQrSession(),
      })
      return failure(toErrorMessage(error, 'No se pudo desvincular la sesión de WhatsApp.'))
    } finally {
      isManualUnlinking = false
    }
  }

  return {
    start: async () => {
      await createSocket()
    },
    stop,
    unlink,
    getSocket: () => socket,
    getConnectionStatus: () => status,
    getSessionState: () => ({ ...session }),
    getOwnJid: () => ownJid,
  }
}

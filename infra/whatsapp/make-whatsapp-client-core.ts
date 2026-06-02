import { rm } from 'node:fs/promises'
import type { PostgresQueryable } from '../postgres/postgres-types.ts'
import type { ConnectionStatus, WhatsAppSessionState } from './whatsapp-types.ts'
import {
  loadDefaultBindings,
  loadQRCode,
  type BaileysBindings,
  type QRCodeBindings,
  type WASocket,
} from './baileys-bindings.ts'
import type { ManagedWhatsAppAuthState, WhatsAppAuthState } from './whatsapp-auth-state.ts'

const encodeSvgDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

const normalizeOwnJid = (jid: string): string => jid.replace(/:\d+@/, '@')

const nowIso = (): string => new Date().toISOString()

const createSessionState = (
  overrides: Partial<WhatsAppSessionState> = {},
): WhatsAppSessionState => ({
  connectionStatus: 'closed',
  phase: 'disconnected',
  requiresUserAction: false,
  canAutoReconnect: false,
  reconnectAttempt: 0,
  nextReconnectDelayMs: null,
  qr: null,
  qrDataUrl: null,
  qrGeneratedAt: null,
  lastDisconnectCode: null,
  updatedAt: nowIso(),
  ...overrides,
})

export interface WhatsAppClient {
  start: () => Promise<void>
  stop: () => Promise<void>
  getSocket: () => WASocket | null
  getConnectionStatus: () => ConnectionStatus
  getSessionState: () => WhatsAppSessionState
  getOwnJid: () => string
}

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

const clearQrSession = (): Partial<WhatsAppSessionState> => ({ qr: null, qrDataUrl: null, qrGeneratedAt: null })

export const makeWhatsAppClientCore = (
  config: MakeWhatsAppClientConfig,
): WhatsAppClient => {
  const { authFolder } = config

  let socket: WASocket | null = null
  let status: ConnectionStatus = 'closed'
  let reconnectAttempts = 0
  let reconnectTimer: NodeJS.Timeout | null = null
  let isStopping = false
  let bindings: BaileysBindings | null = null
  let ownJid = ''
  let session = createSessionState()
  let relinkAttemptScheduled = false
  let authState: ManagedWhatsAppAuthState | null = null

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
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
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
      return bindings as BaileysBindings
    }

    if (config.makeWASocket && config.loadAuthState && config.DisconnectReason) {
      bindings = {
        makeWASocket: config.makeWASocket,
        loadAuthState: config.loadAuthState,
        DisconnectReason: config.DisconnectReason,
      }
      return bindings as BaileysBindings
    }

    bindings = await loadDefaultBindings()
    return bindings
  }

  const createSocket = async (): Promise<void> => {
    const b = await resolveBindings()
    authState = await b.loadAuthState({ authFolder, database: config.database })

    socket = b.makeWASocket({
      auth: authState.state,
      qrTimeout: 120_000,
    })
    updateSession({ nextReconnectDelayMs: null })
    config.onSocket?.(socket)

    const syncOwnJid = (): void => {
      const jid = socket?.user?.id
      if (!jid) return
      ownJid = normalizeOwnJid(jid)
    }

    syncOwnJid()
    socket.ev.on('creds.update', authState.saveCreds)

    socket.ev.on('connection.update', (update: Record<string, unknown>) => {
      const connection = update.connection as string | undefined
      const qr = update.qr as string | undefined
      const lastDisconnect = update.lastDisconnect as
        | { error?: { output?: { statusCode?: number } } }
        | undefined
      const disconnectCode = lastDisconnect?.error?.output?.statusCode ?? null

      if (qr) {
        status = status === 'loggedOut' ? 'loggedOut' : 'connecting'
        const qrGeneratedAt = nowIso()
        updateSession({
          phase: 'qr_pending',
          requiresUserAction: true,
          canAutoReconnect: false,
          reconnectAttempt: 0,
          nextReconnectDelayMs: null,
          qr,
          qrDataUrl: null,
          qrGeneratedAt,
          lastDisconnectCode: disconnectCode,
        })

        console.log('\n═══════════════════════════════════════════')
        console.log('  ESCANEA ESTE QR CON WHATSAPP EN TU CELULAR')
        console.log('  (WhatsApp → Dispositivos vinculados)')
        console.log('═══════════════════════════════════════════\n')

        const qrCodeLoader = config.qrCode ? Promise.resolve(config.qrCode) : loadQRCode()

        qrCodeLoader
          .then((qrCode) => qrCode.toString(qr, { type: 'terminal', small: true }))
          .then((qrAscii: string) => console.log(qrAscii))
          .catch(() => console.log(qr))

        qrCodeLoader
          .then((qrCode) => qrCode.toDataURL(qr))
          .then((qrDataUrl) => {
            updateSession({
              phase: 'qr_pending',
              requiresUserAction: true,
              canAutoReconnect: false,
              qr,
              qrDataUrl,
              qrGeneratedAt,
              lastDisconnectCode: disconnectCode,
            })
          })
          .catch(async () => {
            const fallbackQrDataUrl = await qrCodeLoader
              .then((qrCode) => qrCode.toString(qr, { type: 'svg' }))
              .then(encodeSvgDataUrl)
              .catch(() => null)

            updateSession({
              phase: 'qr_pending',
              requiresUserAction: true,
              canAutoReconnect: false,
              qr,
              qrDataUrl: fallbackQrDataUrl,
              qrGeneratedAt,
              lastDisconnectCode: disconnectCode,
            })
          })

        console.log('\n═══════════════════════════════════════════\n')
        relinkAttemptScheduled = false
      }

      if (connection === 'connecting') {
        status = 'connecting'
        const phase = session.requiresUserAction
          ? (session.qr ? 'qr_pending' : 'relink_required')
          : 'reconnecting'
        updateSession({
          phase,
          canAutoReconnect: !session.requiresUserAction,
          nextReconnectDelayMs: null,
        })
      } else if (connection === 'open') {
        syncOwnJid()
        status = 'open'
        reconnectAttempts = 0
        relinkAttemptScheduled = false
        updateSession({
          phase: 'connected',
          requiresUserAction: false,
          canAutoReconnect: false,
          reconnectAttempt: 0,
          nextReconnectDelayMs: null,
          lastDisconnectCode: null,
          ...clearQrSession(),
        })
        config.onConnectionOpen?.(ownJid)
      } else if (connection === 'close') {
        if (isStopping) return

        const isLoggedOut =
          lastDisconnect?.error?.output?.statusCode === b.DisconnectReason.loggedOut

        if (isLoggedOut) {
          status = 'loggedOut'
          reconnectAttempts = 0
          updateSession({
            phase: 'relink_required',
            requiresUserAction: true,
            canAutoReconnect: false,
            reconnectAttempt: 0,
            nextReconnectDelayMs: null,
            lastDisconnectCode: disconnectCode,
            ...clearQrSession(),
          })

          if (!relinkAttemptScheduled) {
            relinkAttemptScheduled = true
            reconnectTimer = setTimeout(async () => {
              reconnectTimer = null

              try {
                relinkAttemptScheduled = false
                await clearAuthState()
                await createSocket()
              } catch (error) {
                console.error(
                  'No se pudo limpiar la sesión de WhatsApp para re-vincular.',
                  error,
                )
              }
            }, 1000)
          }
          return
        }

        status = 'closed'
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000)
        reconnectAttempts++
        updateSession({
          phase: 'reconnecting',
          requiresUserAction: false,
          canAutoReconnect: true,
          reconnectAttempt: reconnectAttempts,
          nextReconnectDelayMs: delay,
          lastDisconnectCode: disconnectCode,
          ...clearQrSession(),
        })
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          return createSocket()
        }, delay)
      }
    })
  }

  return {
    start: async () => {
      await createSocket()
    },
    stop: async () => {
      isStopping = true

      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }

      if (socket) {
        socket.end(undefined)
        socket = null
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
    },
    getSocket: () => socket,
    getConnectionStatus: () => status,
    getSessionState: () => ({ ...session }),
    getOwnJid: () => ownJid,
  }
}

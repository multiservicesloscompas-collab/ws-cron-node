import { renderWhatsAppQr } from './render-whatsapp-qr.ts'
import { clearQrSession, nowIso } from './whatsapp-session-state.ts'
import type { QRCodeBindings, WASocket } from './baileys-bindings.ts'
import type { ConnectionStatus, WhatsAppSessionState } from './whatsapp-types.ts'

type SessionUpdater = (next: Partial<WhatsAppSessionState>) => WhatsAppSessionState

interface MakeWhatsAppConnectionUpdateHandlerDeps {
  nextSocket: WASocket
  qrCode?: QRCodeBindings
  isStopping: () => boolean
  isManualUnlinking: () => boolean
  isActiveSocket: () => boolean
  getStatus: () => ConnectionStatus
  setStatus: (status: ConnectionStatus) => void
  getSession: () => WhatsAppSessionState
  updateSession: SessionUpdater
  syncOwnJid: () => void
  resetReconnectAttempts: () => void
  incrementReconnectAttempts: () => number
  setRelinkAttemptScheduled: (value: boolean) => void
  onConnectionOpen?: (ownJid: string) => void
  getOwnJid: () => string
  loggedOutCode: number
  scheduleReconnect: (delay: number, createSocket: () => Promise<void>) => void
  clearAuthState: () => Promise<void>
  createSocket: () => Promise<void>
}

export const makeWhatsAppConnectionUpdateHandler = (
  deps: MakeWhatsAppConnectionUpdateHandlerDeps,
) => {
  return (update: Record<string, unknown>): void => {
    if (!deps.isActiveSocket()) return

    const connection = update.connection as string | undefined
    const qr = update.qr as string | undefined
    const lastDisconnect = update.lastDisconnect as
      | { error?: { output?: { statusCode?: number } } }
      | undefined
    const disconnectCode = lastDisconnect?.error?.output?.statusCode ?? null

    if (qr) {
      deps.setStatus(deps.getStatus() === 'loggedOut' ? 'loggedOut' : 'connecting')
      const qrGeneratedAt = nowIso()
      deps.updateSession({
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

      void renderWhatsAppQr(qr, deps.qrCode).then((qrDataUrl) => {
        if (!deps.isActiveSocket()) return
        deps.updateSession({
          phase: 'qr_pending',
          requiresUserAction: true,
          canAutoReconnect: false,
          qr,
          qrDataUrl,
          qrGeneratedAt,
          lastDisconnectCode: disconnectCode,
        })
      })

      deps.setRelinkAttemptScheduled(false)
    }

    if (connection === 'connecting') {
      deps.setStatus('connecting')
      const session = deps.getSession()
      deps.updateSession({
        phase: session.requiresUserAction
          ? (session.qr ? 'qr_pending' : 'relink_required')
          : 'reconnecting',
        canAutoReconnect: !session.requiresUserAction,
        nextReconnectDelayMs: null,
      })
      return
    }

    if (connection === 'open') {
      deps.syncOwnJid()
      deps.setStatus('open')
      deps.resetReconnectAttempts()
      deps.setRelinkAttemptScheduled(false)
      deps.updateSession({
        phase: 'connected',
        requiresUserAction: false,
        canAutoReconnect: false,
        reconnectAttempt: 0,
        nextReconnectDelayMs: null,
        lastDisconnectCode: null,
        ...clearQrSession(),
      })
      deps.onConnectionOpen?.(deps.getOwnJid())
      return
    }

    if (connection !== 'close' || deps.isStopping()) return

    const isLoggedOut =
      lastDisconnect?.error?.output?.statusCode === deps.loggedOutCode

    if (isLoggedOut) {
      deps.setStatus('loggedOut')
      deps.resetReconnectAttempts()
      deps.updateSession({
        phase: 'relink_required',
        requiresUserAction: true,
        canAutoReconnect: false,
        reconnectAttempt: 0,
        nextReconnectDelayMs: null,
        lastDisconnectCode: disconnectCode,
        ...clearQrSession(),
      })

      if (deps.isManualUnlinking()) return

      deps.setRelinkAttemptScheduled(true)
      deps.scheduleReconnect(1000, async () => {
        try {
          deps.setRelinkAttemptScheduled(false)
          await deps.clearAuthState()
          await deps.createSocket()
        } catch (error) {
          console.error(
            'No se pudo limpiar la sesión de WhatsApp para re-vincular.',
            error,
          )
        }
      })
      return
    }

    deps.setStatus('closed')
    const reconnectAttempt = deps.incrementReconnectAttempts()
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), 30_000)
    deps.updateSession({
      phase: 'reconnecting',
      requiresUserAction: false,
      canAutoReconnect: true,
      reconnectAttempt,
      nextReconnectDelayMs: delay,
      lastDisconnectCode: disconnectCode,
      ...clearQrSession(),
    })
    deps.scheduleReconnect(delay, deps.createSocket)
  }
}

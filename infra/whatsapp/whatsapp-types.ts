/**
 * Shared types for the WhatsApp communication layer.
 *
 * @see docs/spec-whatsapp-service.md section 7
 */

/**
 * Branded type for WhatsApp JID (Jabber ID).
 *
 * A JID identifies a WhatsApp contact or group.
 * Groups use format: `<id>-<timestamp>@g.us`
 * Contacts use format: `<number>@s.whatsapp.net`
 */
export type JID = string & { readonly __brand: 'JID' }

/**
 * Connection status for the Baileys WebSocket.
 *
 * - `connecting`: Initial connection or reconnecting
 * - `open`: Connected and ready
 * - `closing`: Gracefully closing
 * - `closed`: Disconnected (will reconnect unless loggedOut)
 * - `loggedOut`: Device was unlinked — requires re-scan
 */
export type ConnectionStatus =
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'loggedOut'

export type WhatsAppSessionPhase =
  | 'connected'
  | 'reconnecting'
  | 'qr_pending'
  | 'relink_required'
  | 'disconnected'

export interface WhatsAppSessionState {
  connectionStatus: ConnectionStatus
  phase: WhatsAppSessionPhase
  requiresUserAction: boolean
  canAutoReconnect: boolean
  reconnectAttempt: number
  nextReconnectDelayMs: number | null
  qr: string | null
  qrDataUrl: string | null
  qrGeneratedAt: string | null
  lastDisconnectCode: number | null
  updatedAt: string
}

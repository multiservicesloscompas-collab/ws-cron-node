import type { WhatsAppSessionState } from './whatsapp-types.ts'

export const nowIso = (): string => new Date().toISOString()

export const createSessionState = (
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

export const clearQrSession = (): Partial<WhatsAppSessionState> => ({
  qr: null,
  qrDataUrl: null,
  qrGeneratedAt: null,
})

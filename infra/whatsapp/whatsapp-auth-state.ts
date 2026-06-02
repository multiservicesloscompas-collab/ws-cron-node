export interface WhatsAppSignalKeyStore {
  get: (category: string, ids: string[]) => Promise<Record<string, unknown>>
  set: (
    data: Record<string, Record<string, unknown | null> | undefined>,
  ) => Promise<void>
  clear?: () => Promise<void>
}

export interface WhatsAppAuthState {
  creds: Record<string, unknown>
  keys: WhatsAppSignalKeyStore
}

export interface ManagedWhatsAppAuthState {
  state: WhatsAppAuthState
  saveCreds: () => Promise<void>
  clear: () => Promise<void>
}

import { rm } from 'node:fs/promises'
import type { PostgresQueryable } from '../postgres/postgres-types.ts'
import type {
  ManagedWhatsAppAuthState,
  WhatsAppAuthState,
  WhatsAppSignalKeyStore,
} from './whatsapp-auth-state.ts'
import { makePostgresBaileysAuthState } from './make-postgres-baileys-auth-state.ts'
import { migrateFilesystemAuthToPostgres } from './migrate-filesystem-auth-to-postgres.ts'
import NodeCache from '@cacheable/node-cache'

const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

export interface WASocket {
  ev: {
    on: (event: string, handler: (...args: any[]) => void) => void
    removeListener?: (event: string, handler: (...args: any[]) => void) => void
  }
  end: (input?: unknown) => void
  sendMessage?: (jid: string, content: { text: string }) => Promise<unknown>
  groupFetchAllParticipating?: () => Promise<Record<string, { subject: string; id: string }>>
  waUploadToServer?: (...args: unknown[]) => Promise<unknown>
  user?: {
    id?: string
  }
}

export interface QRCodeBindings {
  toString: (
    value: string,
    options: { type: 'terminal' | 'svg'; small?: boolean },
  ) => Promise<string>
  toDataURL: (value: string) => Promise<string>
}

export interface AuthStateConfig {
  authFolder: string
  database?: PostgresQueryable
}

export interface BaileysBindings {
  makeWASocket: (config: Record<string, unknown>) => WASocket
  loadAuthState: (config: AuthStateConfig) => Promise<ManagedWhatsAppAuthState>
  DisconnectReason: { loggedOut: number }
}

let cachedBindings: BaileysBindings | null = null
let cachedQRCode: QRCodeBindings | null = null

const createFilesystemAuthState = async (
  folder: string,
): Promise<ManagedWhatsAppAuthState> => {
  const mod = await import('baileys')
  const { state, saveCreds } = await mod.useMultiFileAuthState(folder)

  return {
    state: state as unknown as WhatsAppAuthState,
    saveCreds,
    clear: async () => {
      try {
        await rm(folder, { recursive: true, force: true })
      } catch (error) {
        if (isNotFoundError(error)) return
        throw error
      }
    },
  }
}

const createDefaultAuthState = async (
  config: AuthStateConfig,
): Promise<ManagedWhatsAppAuthState> => {
  if (!config.database) {
    return createFilesystemAuthState(config.authFolder)
  }

  const mod = await import('baileys')

  const migrationResult = await migrateFilesystemAuthToPostgres({
    database: config.database,
    authFolder: config.authFolder,
  })

  if (migrationResult.isFailure) {
    throw new Error(migrationResult.getError())
  }

  const authStateResult = await makePostgresBaileysAuthState({
    database: config.database,
  })

  if (authStateResult.isFailure) {
    throw new Error(authStateResult.getError())
  }

  const authState = authStateResult.getValue()
  const cachedKeys = mod.makeCacheableSignalKeyStore(
    authState.state.keys as never,
    undefined,
    new NodeCache({ stdTTL: 300, useClones: false }) as never,
  )

  const wrappedCachedKeys: WhatsAppSignalKeyStore = {
    get: async (category, ids) => {
      return await cachedKeys.get(category as never, ids) as Record<string, unknown>
    },
    set: async (data) => {
      await cachedKeys.set(data as never)
    },
    clear: cachedKeys.clear ? async () => {
      await cachedKeys.clear?.()
    } : undefined,
  }

  authState.state = {
    ...authState.state,
    keys: wrappedCachedKeys,
  }

  return authState
}

export const loadQRCode = async (): Promise<QRCodeBindings> => {
  if (cachedQRCode) return cachedQRCode

  const qrCode = await import('qrcode')
  cachedQRCode = {
    toString: (value, options) => {
      return options.type === 'terminal'
        ? qrCode.toString(value, { type: 'terminal', small: options.small })
        : qrCode.toString(value, { type: 'svg' })
    },
    toDataURL: (value) => qrCode.toDataURL(value),
  }
  return cachedQRCode
}

export const loadDefaultBindings = async (): Promise<BaileysBindings> => {
  if (cachedBindings) return cachedBindings

  const mod = await import('baileys')
  cachedBindings = {
    makeWASocket: (config) => mod.makeWASocket(config as never) as unknown as WASocket,
    loadAuthState: createDefaultAuthState,
    DisconnectReason: mod.DisconnectReason,
  }

  return cachedBindings
}

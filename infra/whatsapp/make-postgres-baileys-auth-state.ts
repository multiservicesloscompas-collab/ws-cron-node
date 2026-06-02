import { BufferJSON, initAuthCreds, proto } from 'baileys'
import { failure, success, type Result } from '../../types/result.ts'
import {
  makePostgresBaileysAuthRepository,
  type PostgresBaileysAuthRepository,
} from './make-postgres-baileys-auth-repository.ts'
import type { PostgresQueryable } from '../postgres/postgres-types.ts'
import type {
  ManagedWhatsAppAuthState,
  WhatsAppAuthState,
} from './whatsapp-auth-state.ts'

interface PostgresBaileysAuthStateDeps {
  database: PostgresQueryable
}

type SignalKeyValue = unknown

const parseJson = <T>(dataJson: string): T =>
  JSON.parse(dataJson, BufferJSON.reviver) as T

const stringifyJson = (value: unknown): string =>
  JSON.stringify(value, BufferJSON.replacer)

const toReason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const restoreSignalKey = (category: string, value: SignalKeyValue): SignalKeyValue => {
  if (category !== 'app-state-sync-key' || !value) {
    return value
  }

  return proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>)
}

const loadCreds = async (
  repository: PostgresBaileysAuthRepository,
): Promise<Result<Record<string, unknown>, string>> => {
  const credsResult = await repository.loadCreds()
  if (credsResult.isFailure) return failure(credsResult.getError())

  const serializedCreds = credsResult.getValue()
  if (!serializedCreds) {
    return success(initAuthCreds() as unknown as Record<string, unknown>)
  }

  try {
    return success(parseJson<Record<string, unknown>>(serializedCreds))
  } catch (error) {
    return failure(`Error al parsear credenciales de WhatsApp: ${toReason(error)}`)
  }
}

export const makePostgresBaileysAuthState = async (
  deps: PostgresBaileysAuthStateDeps,
): Promise<Result<ManagedWhatsAppAuthState, string>> => {
  const repository = makePostgresBaileysAuthRepository({ database: deps.database })
  const credsResult = await loadCreds(repository)
  if (credsResult.isFailure) return failure(credsResult.getError())

  let creds = credsResult.getValue()

  const saveCreds = async (): Promise<void> => {
    const result = await repository.saveCreds(stringifyJson(creds))
    if (result.isFailure) {
      throw new Error(result.getError())
    }
  }

  const state: WhatsAppAuthState = {
    creds,
    keys: {
      get: async (category: string, ids: string[]) => {
        const result = await repository.loadKeys(category, ids)
        if (result.isFailure) {
          throw new Error(result.getError())
        }

        return Object.entries(result.getValue()).reduce<Record<string, SignalKeyValue>>(
          (accumulator, [id, dataJson]) => {
            accumulator[id] = restoreSignalKey(category, parseJson<SignalKeyValue>(dataJson))
            return accumulator
          },
          {},
        )
      },
      set: async (data: Record<string, Record<string, SignalKeyValue | null> | undefined>) => {
        const inserts: Array<{ category: string; id: string; dataJson: string }> = []
        const removals: Array<{ category: string; id: string }> = []

        for (const [category, values] of Object.entries(data)) {
          if (!values) continue

          for (const [id, value] of Object.entries(values)) {
            if (value === null) {
              removals.push({ category, id })
              continue
            }

            inserts.push({
              category,
              id,
              dataJson: stringifyJson(value),
            })
          }
        }

        const saveResult = await repository.saveKeys(inserts)
        if (saveResult.isFailure) {
          throw new Error(saveResult.getError())
        }

        const removeResult = await repository.removeKeys(removals)
        if (removeResult.isFailure) {
          throw new Error(removeResult.getError())
        }
      },
      clear: async () => {
        const result = await repository.clear()
        if (result.isFailure) {
          throw new Error(result.getError())
        }
      },
    },
  }

  const clear = async (): Promise<void> => {
    const clearResult = await repository.clear()
    if (clearResult.isFailure) {
      throw new Error(clearResult.getError())
    }

    creds = initAuthCreds() as unknown as Record<string, unknown>
    state.creds = creds
  }

  return success({
    state,
    saveCreds,
    clear,
  })
}

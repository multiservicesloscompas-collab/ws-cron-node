import { failure, success, type Result } from '../../types/result.ts'
import type { PostgresQueryable } from '../postgres/postgres-types.ts'

export interface PostgresBaileysAuthRepositoryDeps {
  database: PostgresQueryable
}

export interface PersistedBaileysAuthKey {
  category: string
  id: string
  dataJson: string
}

interface SerializedCredsRow {
  data_json: string
}

interface SerializedKeyRow {
  category: string
  id: string
  data_json: string
}

export interface PostgresBaileysAuthRepository {
  hasState: () => Promise<Result<boolean, string>>
  loadCreds: () => Promise<Result<string | null, string>>
  saveCreds: (dataJson: string) => Promise<Result<void, string>>
  loadKeys: (
    category: string,
    ids: string[],
  ) => Promise<Result<Record<string, string>, string>>
  saveKeys: (keys: PersistedBaileysAuthKey[]) => Promise<Result<void, string>>
  removeKeys: (
    keys: Array<Pick<PersistedBaileysAuthKey, 'category' | 'id'>>,
  ) => Promise<Result<void, string>>
  clear: () => Promise<Result<void, string>>
}

const toReason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const makePostgresBaileysAuthRepository = (
  deps: PostgresBaileysAuthRepositoryDeps,
): PostgresBaileysAuthRepository => {
  const hasState = async (): Promise<Result<boolean, string>> => {
    try {
      const credsResult = await deps.database.query(
        'SELECT 1 FROM whatsapp_auth_credentials LIMIT 1',
      )

      if ((credsResult.rowCount ?? 0) > 0) {
        return success(true)
      }

      const keysResult = await deps.database.query(
        'SELECT 1 FROM whatsapp_auth_keys LIMIT 1',
      )

      return success((keysResult.rowCount ?? 0) > 0)
    } catch (error) {
      return failure(`Error al verificar auth de WhatsApp: ${toReason(error)}`)
    }
  }

  const loadCreds = async (): Promise<Result<string | null, string>> => {
    try {
      const result = await deps.database.query(
        `
          SELECT data_json
          FROM whatsapp_auth_credentials
          WHERE singleton_key = 'default'
        `,
      )

      const row = result.rows[0] as unknown as SerializedCredsRow | undefined
      return success(row?.data_json ?? null)
    } catch (error) {
      return failure(`Error al leer credenciales de WhatsApp: ${toReason(error)}`)
    }
  }

  const saveCreds = async (dataJson: string): Promise<Result<void, string>> => {
    try {
      const now = new Date().toISOString()
      await deps.database.query(
        `
          INSERT INTO whatsapp_auth_credentials (
            singleton_key,
            data_json,
            created_at,
            updated_at
          ) VALUES ('default', $1, $2, $3)
          ON CONFLICT(singleton_key) DO UPDATE SET
            data_json = excluded.data_json,
            updated_at = excluded.updated_at
        `,
        [dataJson, now, now],
      )

      return success(undefined)
    } catch (error) {
      return failure(`Error al guardar credenciales de WhatsApp: ${toReason(error)}`)
    }
  }

  const loadKeys = async (
    category: string,
    ids: string[],
  ): Promise<Result<Record<string, string>, string>> => {
    if (ids.length === 0) return success({})

    try {
      const placeholders = ids.map((_, index) => `$${index + 2}`).join(', ')
      const result = await deps.database.query(
        `
          SELECT category, id, data_json
          FROM whatsapp_auth_keys
          WHERE category = $1
            AND id IN (${placeholders})
        `,
        [category, ...ids],
      )

      const rows = result.rows as unknown as SerializedKeyRow[]
      const data = rows.reduce<Record<string, string>>((accumulator, row) => {
        accumulator[row.id] = row.data_json
        return accumulator
      }, {})

      return success(data)
    } catch (error) {
      return failure(`Error al leer llaves de WhatsApp: ${toReason(error)}`)
    }
  }

  const saveKeys = async (
    keys: PersistedBaileysAuthKey[],
  ): Promise<Result<void, string>> => {
    if (keys.length === 0) return success(undefined)

    try {
      const now = new Date().toISOString()

      for (const key of keys) {
        await deps.database.query(
          `
            INSERT INTO whatsapp_auth_keys (
              category,
              id,
              data_json,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT(category, id) DO UPDATE SET
              data_json = excluded.data_json,
              updated_at = excluded.updated_at
          `,
          [key.category, key.id, key.dataJson, now, now],
        )
      }

      return success(undefined)
    } catch (error) {
      return failure(`Error al guardar llaves de WhatsApp: ${toReason(error)}`)
    }
  }

  const removeKeys = async (
    keys: Array<Pick<PersistedBaileysAuthKey, 'category' | 'id'>>,
  ): Promise<Result<void, string>> => {
    if (keys.length === 0) return success(undefined)

    try {
      for (const key of keys) {
        await deps.database.query(
          `
            DELETE FROM whatsapp_auth_keys
            WHERE category = $1
              AND id = $2
          `,
          [key.category, key.id],
        )
      }

      return success(undefined)
    } catch (error) {
      return failure(`Error al eliminar llaves de WhatsApp: ${toReason(error)}`)
    }
  }

  const clear = async (): Promise<Result<void, string>> => {
    try {
      await deps.database.query('DELETE FROM whatsapp_auth_keys')
      await deps.database.query('DELETE FROM whatsapp_auth_credentials')
      return success(undefined)
    } catch (error) {
      return failure(`Error al limpiar auth de WhatsApp: ${toReason(error)}`)
    }
  }

  return {
    hasState,
    loadCreds,
    saveCreds,
    loadKeys,
    saveKeys,
    removeKeys,
    clear,
  }
}

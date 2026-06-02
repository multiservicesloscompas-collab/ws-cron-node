import { readdir, readFile } from 'node:fs/promises'
import { failure, success, type Result } from '../../types/result.ts'
import type { PostgresQueryable } from '../postgres/postgres-types.ts'
import { makePostgresBaileysAuthRepository } from './make-postgres-baileys-auth-repository.ts'

const toReason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const authKeyCategories = [
  'app-state-sync-version',
  'app-state-sync-key',
  'sender-key-memory',
  'identity-key',
  'device-list',
  'lid-mapping',
  'sender-key',
  'pre-key',
  'session',
  'tctoken',
] as const

const splitAuthFileName = (
  fileName: string,
): { category: string; id: string } | null => {
  if (!fileName.endsWith('.json') || fileName === 'creds.json') return null

  const withoutExtension = fileName.slice(0, -5)

  for (const category of authKeyCategories) {
    const prefix = `${category}-`
    if (!withoutExtension.startsWith(prefix)) continue

    return {
      category,
      id: withoutExtension.slice(prefix.length),
    }
  }

  return null
}

const hasFileSystemAuthState = async (authFolder: string): Promise<boolean> => {
  try {
    const entries = await readdir(authFolder)
    return entries.length > 0
  } catch (error) {
    if (isNotFoundError(error)) return false
    throw error
  }
}

export const migrateFilesystemAuthToPostgres = async (
  deps: { database: PostgresQueryable; authFolder: string },
): Promise<Result<'migrated' | 'skipped', string>> => {
  const repository = makePostgresBaileysAuthRepository({ database: deps.database })

  const hasStateResult = await repository.hasState()
  if (hasStateResult.isFailure) {
    return failure(hasStateResult.getError())
  }

  if (hasStateResult.getValue()) {
    return success('skipped')
  }

  let authFolderHasFiles = false

  try {
    authFolderHasFiles = await hasFileSystemAuthState(deps.authFolder)
  } catch (error) {
    return failure(`Error al inspeccionar auth folder de WhatsApp: ${toReason(error)}`)
  }

  if (!authFolderHasFiles) {
    return success('skipped')
  }

  try {
    const keyRows: Array<{ category: string; id: string; dataJson: string }> = []
    const entries = await readdir(deps.authFolder, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue

      const filePath = `${deps.authFolder}/${entry.name}`
      const dataJson = await readFile(filePath, 'utf-8')

      if (entry.name === 'creds.json') {
        const saveCredsResult = await repository.saveCreds(dataJson)
        if (saveCredsResult.isFailure) {
          return failure(saveCredsResult.getError())
        }
        continue
      }

      const keyReference = splitAuthFileName(entry.name)
      if (!keyReference) continue

      keyRows.push({
        category: keyReference.category,
        id: keyReference.id,
        dataJson,
      })
    }

    const saveKeysResult = await repository.saveKeys(keyRows)
    if (saveKeysResult.isFailure) {
      return failure(saveKeysResult.getError())
    }

    return success('migrated')
  } catch (error) {
    return failure(`Error al migrar auth folder de WhatsApp: ${toReason(error)}`)
  }
}

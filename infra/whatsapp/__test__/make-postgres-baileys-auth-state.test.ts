import { assertEquals, assert } from '#test-assert'
import { BufferJSON, initAuthCreds } from 'baileys'
import { makeTestPostgresDb } from '../../postgres/make-test-postgres-db.ts'
import { makePostgresBaileysAuthState } from '../make-postgres-baileys-auth-state.ts'
import { migrateFilesystemAuthToPostgres } from '../migrate-filesystem-auth-to-postgres.ts'

const parseJson = (value: string): unknown => JSON.parse(value, BufferJSON.reviver)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

Deno.test('postgres auth state persists creds and keys in PostgreSQL', async () => {
  const database = await makeTestPostgresDb()

  try {
    const authStateResult = await makePostgresBaileysAuthState({ database: database.pool })
    if (authStateResult.isFailure) throw new Error(authStateResult.getError())

    const authState = authStateResult.getValue()
    authState.state.creds.registered = true
    await authState.saveCreds()
    await authState.state.keys.set({
      'pre-key': {
        '1': {
          private: encoder.encode('private'),
          public: encoder.encode('public'),
        },
      },
    })

    const credsRows = await database.pool.query(
      'SELECT data_json FROM whatsapp_auth_credentials WHERE singleton_key = $1',
      ['default'],
    )
    const keyRows = await database.pool.query(
      'SELECT data_json FROM whatsapp_auth_keys WHERE category = $1 AND id = $2',
      ['pre-key', '1'],
    )

    assertEquals(credsRows.rowCount, 1)
    assertEquals((parseJson(credsRows.rows[0].data_json as string) as { registered: boolean }).registered, true)
    assertEquals(keyRows.rowCount, 1)

    const loadedKeys = await authState.state.keys.get('pre-key', ['1'])
    const loadedKey = loadedKeys['1'] as { private: Uint8Array; public: Uint8Array }
    assertEquals(decoder.decode(loadedKey.private), 'private')
    assertEquals(decoder.decode(loadedKey.public), 'public')
  } finally {
    await database.close()
  }
})

Deno.test('postgres auth clear removes persisted state and resets creds', async () => {
  const database = await makeTestPostgresDb()

  try {
    const authStateResult = await makePostgresBaileysAuthState({ database: database.pool })
    if (authStateResult.isFailure) throw new Error(authStateResult.getError())

    const authState = authStateResult.getValue()
    authState.state.creds.registered = true
    await authState.saveCreds()
    await authState.state.keys.set({ session: { abc: encoder.encode('session') } })

    await authState.clear()

    const credsRows = await database.pool.query('SELECT * FROM whatsapp_auth_credentials')
    const keyRows = await database.pool.query('SELECT * FROM whatsapp_auth_keys')

    assertEquals(credsRows.rowCount, 0)
    assertEquals(keyRows.rowCount, 0)
    assertEquals(authState.state.creds.registered, initAuthCreds().registered)
  } finally {
    await database.close()
  }
})

Deno.test('filesystem auth migrates into PostgreSQL with multi-dash categories', async () => {
  const database = await makeTestPostgresDb()
  const authFolder = await Deno.makeTempDir()

  try {
    await Deno.writeTextFile(
      `${authFolder}/creds.json`,
      JSON.stringify({ ...initAuthCreds(), registered: true }, BufferJSON.replacer),
    )
    await Deno.writeTextFile(
      `${authFolder}/app-state-sync-key-AAAA.json`,
      JSON.stringify({ keyData: encoder.encode('sync-key') }, BufferJSON.replacer),
    )

    const migrationResult = await migrateFilesystemAuthToPostgres({
      database: database.pool,
      authFolder,
    })

    if (migrationResult.isFailure) throw new Error(migrationResult.getError())
    assertEquals(migrationResult.getValue(), 'migrated')

    const authStateResult = await makePostgresBaileysAuthState({ database: database.pool })
    if (authStateResult.isFailure) throw new Error(authStateResult.getError())

    const loaded = await authStateResult.getValue().state.keys.get('app-state-sync-key', ['AAAA'])
    assert(loaded.AAAA)
  } finally {
    await database.close()
    await Deno.remove(authFolder, { recursive: true })
  }
})

/**
 * Supabase Client — Factory for creating a Supabase client instance.
 *
 * Reads credentials from environment variables.
 *
 * @see docs/spec-whatsapp-service.md section 9.2
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { success, failure, type Result } from '../../types/result.ts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SupabaseClientDeps {
  /** Supabase project URL */
  supabaseUrl: string
  /** Supabase anon/public key */
  supabaseKey: string
}

export interface SupabaseClientApi {
  /** The underlying Supabase client instance */
  client: SupabaseClient
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Creates a Supabase client from environment variables.
 *
 * Expects:
 *   - VITE_SUPABASE_URL
 *   - VITE_SUPABASE_ANON_KEY
 *
 * @example
 * const sb = makeSupabaseClient({ supabaseUrl, supabaseKey })
 * const { data } = await sb.client.from('sales').select('*')
 */
export const makeSupabaseClient = (
  deps: SupabaseClientDeps,
): Result<SupabaseClientApi, string> => {
  if (!deps.supabaseUrl || !deps.supabaseKey) {
    return failure(
      'Faltan credenciales de Supabase. Verifica VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env',
    )
  }

  try {
    const client = createClient(deps.supabaseUrl, deps.supabaseKey)
    return success({ client })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return failure(`Error al crear cliente Supabase: ${reason}`)
  }
}

/**
 * Reads Supabase credentials from environment variables.
 * Requires loading `.env` through the Node runtime scripts in `package.json`.
 */
export const getSupabaseEnv = (): SupabaseClientDeps => {
  return {
    supabaseUrl: process.env.VITE_SUPABASE_URL || '',
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || '',
  }
}

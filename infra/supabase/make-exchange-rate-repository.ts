/**
 * Exchange Rate Repository — Supabase queries for daily exchange rates.
 *
 * Queries the exchange_rates table for the latest available rate,
 * preferring the newest date and then the most recently updated entry.
 *
 * @see docs/spec-whatsapp-service.md section 9
 */

import { type SupabaseClient } from '@supabase/supabase-js'
import { success, failure, type Result } from '../../types/result.ts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExchangeRateRepositoryDeps {
  supabase: SupabaseClient
}

export interface ExchangeRateRepository {
  /**
   * Get the latest available exchange rate.
   * Returns null if no rate is found.
   */
  getRateForDate: (date: string) => Promise<Result<number | null, string>>
}

/**
 * Raw exchange_rate row from Supabase.
 */
interface ExchangeRateRow {
  id: string
  date: string
  rate: number
  updated_at: string
}

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeExchangeRateRepository = (
  deps: ExchangeRateRepositoryDeps,
): ExchangeRateRepository => {
  const getRateForDate = async (
    _date: string,
  ): Promise<Result<number | null, string>> => {
    try {
      const { data, error } = await deps.supabase
        .from('exchange_rates')
        .select('rate')
        .order('date', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1)

      if (error) {
        return failure(`Error al obtener tasa de cambio: ${error.message}`)
      }

      const rows = (data || []) as Pick<ExchangeRateRow, 'rate'>[]
      if (rows.length === 0) return success(null)

      return success(rows[0].rate)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return failure(`Error inesperado: ${reason}`)
    }
  }

  return { getRateForDate }
}

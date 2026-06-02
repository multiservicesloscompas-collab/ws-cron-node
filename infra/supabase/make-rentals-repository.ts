/**
 * Rentals Repository — Supabase queries for washer rentals.
 *
 * Real schema (discovered from Supabase):
 *   - Statuses: 'agendado', 'enviado', 'finalizado'
 *   - machine_id: UUID (references washing_machines.id)
 *   - No soft-delete (deleted_at not present)
 *
 * @see docs/spec-whatsapp-service.md section 9.1
 */

import { type SupabaseClient } from '@supabase/supabase-js'
import { success, failure, type Result } from '../../types/result.ts'
import {
  makeWasherRentalFromRow,
  type WasherRental,
  type WasherRentalRow,
} from '../../domain/entities/washer-rental.ts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RentalsRepositoryDeps {
  supabase: SupabaseClient
}

export interface RentalsRepository {
  /**
   * Get active rentals pending pickup for today.
   * Status = 'enviado' (sent out, awaiting return).
   */
  getPendingPickups: () => Promise<Result<WasherRental[], string>>

  /**
   * Get rentals for a specific date that are active (not finalizado).
   */
  getActiveRentalsForDate: (date: string) => Promise<Result<WasherRental[], string>>

  /**
   * Get unpaid rentals (is_paid = false).
   */
  getUnpaidRentals: () => Promise<Result<WasherRental[], string>>

  /**
   * Get all active rentals (agendado + enviado).
   */
  getAllActiveRentals: () => Promise<Result<WasherRental[], string>>

  /**
   * Get rentals that should appear as still in the street operationally.
   * Includes sent rentals and finalized-but-unpaid rentals.
   */
  getStreetWashers: () => Promise<Result<WasherRental[], string>>
}

// ─── Query Builder ─────────────────────────────────────────────────────────

const RENTAL_SELECT = `
  id,
  date,
  machine_id,
  shift,
  status,
  delivery_time,
  pickup_time,
  pickup_date,
  delivery_fee,
  total_usd,
  is_paid,
  payment_method,
  date_paid,
  notes,
  created_at,
  customer:customers(id, name, phone, address),
  machine:washing_machines(id, name)
`

// ─── Helpers ───────────────────────────────────────────────────────────────

const rowsToRentals = (rows: unknown[]): WasherRental[] => {
  const rentals: WasherRental[] = []
  for (const row of rows as unknown as WasherRentalRow[]) {
    const rental = makeWasherRentalFromRow(row)
    if (rental) rentals.push(rental)
  }
  return rentals
}

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeRentalsRepository = (
  deps: RentalsRepositoryDeps,
): RentalsRepository => {
  // ─── Pending pickups (enviado = sent out, awaiting return) ────────

  const getPendingPickups = async (): Promise<Result<WasherRental[], string>> => {
    try {
      const { data, error } = await deps.supabase
        .from('washer_rentals')
        .select(RENTAL_SELECT)
        .eq('status', 'enviado')
        .order('created_at', { ascending: false })

      if (error) {
        return failure(`Error al obtener alquileres pendientes: ${error.message}`)
      }

      return success(rowsToRentals(data || []))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return failure(`Error inesperado: ${reason}`)
    }
  }

  // ─── Active rentals for a specific date ────────────────────────────

  const getActiveRentalsForDate = async (
    date: string,
  ): Promise<Result<WasherRental[], string>> => {
    try {
      const { data, error } = await deps.supabase
        .from('washer_rentals')
        .select(RENTAL_SELECT)
        .neq('status', 'finalizado')
        .eq('date', date)
        .order('created_at', { ascending: false })

      if (error) {
        return failure(`Error al obtener alquileres: ${error.message}`)
      }

      return success(rowsToRentals(data || []))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return failure(`Error inesperado: ${reason}`)
    }
  }

  // ─── Unpaid rentals ────────────────────────────────────────────────

  const getUnpaidRentals = async (): Promise<Result<WasherRental[], string>> => {
    try {
      const { data, error } = await deps.supabase
        .from('washer_rentals')
        .select(RENTAL_SELECT)
        .eq('is_paid', false)
        .order('date', { ascending: false })

      if (error) {
        return failure(`Error al obtener alquileres no pagados: ${error.message}`)
      }

      return success(rowsToRentals(data || []))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return failure(`Error inesperado: ${reason}`)
    }
  }

  // ─── All active rentals ───────────────────────────────────────────

  const getAllActiveRentals = async (): Promise<Result<WasherRental[], string>> => {
    try {
      const { data, error } = await deps.supabase
        .from('washer_rentals')
        .select(RENTAL_SELECT)
        .neq('status', 'finalizado')
        .order('created_at', { ascending: false })

      if (error) {
        return failure(`Error al obtener alquileres activos: ${error.message}`)
      }

      return success(rowsToRentals(data || []))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return failure(`Error inesperado: ${reason}`)
    }
  }

  // ─── Street washers ─────────────────────────────────────────────

  const getStreetWashers = async (): Promise<Result<WasherRental[], string>> => {
    try {
      const { data, error } = await deps.supabase
        .from('washer_rentals')
        .select(RENTAL_SELECT)
        .or('status.neq.finalizado,and(status.eq.finalizado,is_paid.eq.false)')
        .order('pickup_date', { ascending: true, nullsFirst: true })
        .order('pickup_time', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false })

      if (error) {
        return failure(`Error al obtener lavadoras en la calle: ${error.message}`)
      }

      return success(rowsToRentals(data || []))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return failure(`Error inesperado: ${reason}`)
    }
  }

  return {
    getPendingPickups,
    getActiveRentalsForDate,
    getUnpaidRentals,
    getAllActiveRentals,
    getStreetWashers,
  }
}

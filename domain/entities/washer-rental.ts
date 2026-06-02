/**
 * WasherRental — Domain entity for washing machine rentals.
 *
 * Real schema (discovered from Supabase):
 *   - Shifts: "medio", "completo", "doble"
 *   - Statuses: "agendado" (scheduled), "enviado" (sent/picked up), "finalizado" (completed)
 *
 * @see docs/spec-whatsapp-service.md section 9.1
 */

import type { Customer } from './customer.ts'

// ─── Enums ─────────────────────────────────────────────────────────────────

/**
 * Rental shift types as stored in Supabase.
 */
export type RentalShift = 'medio' | 'completo' | 'doble'

/**
 * Rental status lifecycle as stored in Supabase.
 */
export type RentalStatus = 'agendado' | 'enviado' | 'finalizado'

// ─── Row types (Supabase snake_case) ───────────────────────────────────────

/**
 * Raw washer rental row from Supabase.
 */
export interface WasherRentalRow {
  id: string
  date: string
  customer_id: string
  machine_id: string // UUID
  shift: string
  status: string
  delivery_time: string | null
  pickup_time: string | null
  pickup_date: string | null
  delivery_fee: number | null
  total_usd: number | null
  is_paid: boolean
  payment_method: string | null
  date_paid: string | null
  notes: string | null
  created_at?: string | null
  // Joined customer data
  customer?: {
    id: string
    name: string
    phone: string | null
    address: string | null
  } | null
  // Joined machine data
  machine?: {
    id: string // UUID
    name: string
  } | null
}

// ─── Domain entity ─────────────────────────────────────────────────────────

/**
 * Validated washer rental entity.
 */
export interface WasherRental {
  id: string
  date: string
  machineId: string // UUID
  machineLabel: string
  shift: RentalShift
  status: RentalStatus
  deliveryTime: string | null
  pickupTime: string | null
  pickupDate: string | null
  deliveryFee: number | null
  totalUsd: number | null
  isPaid: boolean
  paymentMethod: string | null
  datePaid: string | null
  notes: string | null
  customer: Customer | null
}

// ─── Validation ────────────────────────────────────────────────────────────

const VALID_SHIFTS: RentalShift[] = ['medio', 'completo', 'doble']
const VALID_STATUSES: RentalStatus[] = ['agendado', 'enviado', 'finalizado']

/**
 * Normalizes a shift string to a valid RentalShift.
 */
export const normalizeShift = (shift: string): RentalShift => {
  const normalized = shift.toLowerCase().trim() as RentalShift
  return VALID_SHIFTS.includes(normalized) ? normalized : 'completo'
}

/**
 * Normalizes a status string to a valid RentalStatus.
 */
export const normalizeStatus = (status: string): RentalStatus => {
  const normalized = status.toLowerCase().trim() as RentalStatus
  return VALID_STATUSES.includes(normalized) ? normalized : 'agendado'
}

/**
 * Checks if a rental is still active (not finalizado).
 */
export const isRentalActive = (status: RentalStatus): boolean => {
  return status !== 'finalizado'
}

/**
 * Checks if a rental is pending pickup.
 */
export const isRentalPendingPickup = (
  status: RentalStatus,
  pickupDate: string | null,
  today: string,
): boolean => {
  if (status === 'finalizado') return false
  if (!pickupDate) return true
  return pickupDate <= today
}

/**
 * Checks if a rental should appear in the street washers block.
 * Includes rentals still out in the street and finalized rentals with pending payment.
 */
export const isStreetWasherPending = (rental: WasherRental): boolean => {
  if (rental.status !== 'finalizado') return true
  return !rental.isPaid
}

// ─── Constructor ───────────────────────────────────────────────────────────

/**
 * Creates a WasherRental from a database row.
 */
export const makeWasherRentalFromRow = (
  row: WasherRentalRow,
): WasherRental | null => {
  const customer = row.customer
    ? {
        id: row.customer.id,
        name: row.customer.name,
        phone: row.customer.phone as Customer['phone'],
        address: row.customer.address,
      }
    : null

  return {
    id: row.id,
    date: row.date,
    machineId: row.machine_id,
    machineLabel: row.machine?.name || `Lavadora`,
    shift: normalizeShift(row.shift),
    status: normalizeStatus(row.status),
    deliveryTime: row.delivery_time,
    pickupTime: row.pickup_time,
    pickupDate: row.pickup_date,
    deliveryFee: row.delivery_fee,
    totalUsd: row.total_usd,
    isPaid: row.is_paid,
    paymentMethod: row.payment_method,
    datePaid: row.date_paid,
    notes: row.notes,
    customer,
  }
}

// ─── Display helpers ───────────────────────────────────────────────────────

/**
 * Shift labels in Spanish for WhatsApp display.
 */
export const SHIFT_LABELS: Record<RentalShift, string> = {
  medio: 'Medio',
  completo: 'Completo',
  doble: 'Doble',
}

/**
 * Status labels in Spanish.
 */
export const STATUS_LABELS: Record<RentalStatus, string> = {
  agendado: 'Agendado',
  enviado: 'Enviado / En curso',
  finalizado: 'Finalizado',
}

/**
 * Formats a washer rental for the morning checklist message.
 *
 * Example:
 * 🟢 Nº 3 — María Pérez
 *    📍 Calle Principal #24, PB
 *    🕐 Retiro: 3:00 PM
 *    💰 Pagó: Sí ($6 - Completo)
 *
 * 🔴 Nº 5 — Juan García
 *    📍 Av. Los Ilustres
 *    🕐 Retiro: 5:00 PM
 *    💰 Pagó: No (Pendiente)
 */
export const formatRentalForChecklist = (rental: WasherRental): string => {
  const icon = rental.isPaid ? '🟢' : '🔴'
  const lines: string[] = [
    `${icon} ${rental.machineLabel} — ${rental.customer?.name || 'Cliente desconocido'}`,
  ]

  if (rental.customer?.address) {
    lines.push(`   📍 ${rental.customer.address}`)
  }

  if (rental.pickupTime) {
    lines.push(`   🕐 Retiro: ${rental.pickupTime}`)
  }

  const paidStatus = rental.isPaid
    ? `Sí ($${rental.totalUsd?.toFixed(2) || '?'} - ${SHIFT_LABELS[rental.shift]})`
    : 'No (Pendiente)'
  lines.push(`   💰 Pagó: ${paidStatus}`)

  return lines.join('\n')
}

const getStreetWasherPickupLabel = (rental: WasherRental): string => {
  if (rental.status === 'finalizado') return 'Retiro hecho ✅'
  if (rental.pickupTime) return `Retirar ${rental.pickupTime}`
  return 'Retirar por coordinar'
}

const getStreetWasherPaymentLabel = (rental: WasherRental): string => {
  return rental.isPaid ? 'Pagado ✅' : '🚨Pago pendiente🚨'
}

/**
 * Formats a washer rental for the morning {{street_washers}} variable.
 */
export const formatStreetWasherForWhatsApp = (rental: WasherRental): string => {
  const customerName = rental.customer?.name || 'Cliente desconocido'
  const address = rental.customer?.address || 'Sin dirección registrada'

  return [
    `${customerName} - ${address}`,
    `${getStreetWasherPickupLabel(rental)} - ${getStreetWasherPaymentLabel(rental)}`,
  ].join('\n')
}

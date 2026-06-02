/**
 * Sale — Domain entity for daily sales records.
 *
 * Real schema (from Supabase):
 *   - payment_method: 'efectivo' | 'pago_movil' | 'punto_venta' | 'divisa'
 *   - items: JSON array of sale line items
 *   - exchange_rate: nullable, rate used at time of sale
 *
 * @see docs/spec-whatsapp-service.md section 9
 */

import type { PaymentMethod } from '../value-objects/payment-method.ts'

// ─── Row types (Supabase snake_case) ───────────────────────────────────────

/**
 * Raw sale row from Supabase.
 */
export interface SaleRow {
  id: string
  daily_number: number
  date: string
  items: unknown[]
  payment_method: string
  total_bs: number
  total_usd: number
  exchange_rate: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ─── Domain entity ─────────────────────────────────────────────────────────

/**
 * Validated sale entity.
 */
export interface Sale {
  id: string
  dailyNumber: number
  date: string
  items: unknown[]
  paymentMethod: PaymentMethod
  totalBs: number
  totalUsd: number
  exchangeRate: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

// ─── Summary type ──────────────────────────────────────────────────────────

/**
 * Aggregated daily sales summary.
 */
export interface DailySalesSummary {
  totalBs: number
  totalUsd: number
  byPaymentMethod: Record<
    string,
    { count: number; bs: number; usd: number }
  >
  exchangeRate: number | null
  saleCount: number
  expenseItems: DailyExpenseItem[]
  totalExpensesBs: number
  balanceMovements: PaymentBalanceMovement[]
}

export interface DailyExpenseItem {
  label: string
  amountBs: number
}

export type PaymentBalanceOperationType = 'avance' | 'equilibrio'

export interface PaymentBalanceMovement {
  operationType: PaymentBalanceOperationType
  fromMethod: PaymentMethod
  toMethod: PaymentMethod
  amount: number
  amountOutBs: number
  amountOutUsd: number
  amountInBs: number
  amountInUsd: number
  note: string | null
}

// ─── Constructor ───────────────────────────────────────────────────────────

/**
 * Creates a Sale entity from a database row.
 * Returns null if the row is missing critical fields.
 */
export const makeSaleFromRow = (row: SaleRow): Sale | null => {
  if (!row.id) return null

  return {
    id: row.id,
    dailyNumber: row.daily_number,
    date: row.date,
    items: row.items || [],
    paymentMethod: row.payment_method as PaymentMethod,
    totalBs: row.total_bs,
    totalUsd: row.total_usd,
    exchangeRate: row.exchange_rate ?? null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ─── Display helpers ───────────────────────────────────────────────────────

/**
 * Formats a number with es-VE locale thousands separator.
 *
 * @example
 * formatCurrency(1500) // "1.500"
 * formatCurrency(0)    // "0"
 */
export const formatCurrency = (bs: number): string => {
  return new Intl.NumberFormat('es-VE').format(bs)
}

/**
 * Sales Repository — Supabase queries for daily sales data.
 *
 * Aggregates sales by payment method, handling both direct payments
 * and multi-method splits via the sale_payment_splits table.
 *
 * @see docs/spec-whatsapp-service.md section 9
 */

import { type SupabaseClient } from '@supabase/supabase-js'
import { success, failure, isFailure, type Result } from '../../types/result.ts'
import type {
  DailyExpenseItem,
  DailySalesSummary,
  PaymentBalanceMovement,
  PaymentBalanceOperationType,
  SaleRow,
} from '../../domain/entities/sale.ts'
import type { PaymentMethod } from '../../domain/value-objects/payment-method.ts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SalesRepositoryDeps {
  supabase: SupabaseClient
}

export interface SalesRepository {
  /**
   * Get aggregated sales summary for a specific date.
   * If sale has payment splits, aggregates from splits.
   * Otherwise uses direct payment_method and totals.
   */
  getTodaySales: (date: string) => Promise<Result<DailySalesSummary, string>>
}

/**
 * Raw sale_payment_splits row from Supabase.
 */
interface SaleSplitRow {
  id: string
  sale_id: string
  payment_method: string
  amount_bs: number
  amount_usd: number
}

/**
 * Sale row with nested payment splits from the Supabase join.
 */
interface SaleWithSplitsRow extends SaleRow {
  sale_payment_splits: SaleSplitRow[]
}

interface ExpenseRow {
  description: string | null
  category: string | null
  amount: number
}

interface TipRow {
  amount_bs: number
}

interface PaymentBalanceMovementRow {
  operation_type: PaymentBalanceOperationType
  from_method: PaymentMethod
  to_method: PaymentMethod
  amount: number
  amount_out_bs: number
  amount_out_usd: number
  amount_in_bs: number
  amount_in_usd: number
  notes: string | null
}

const isPaymentBalanceOperationType = (
  value: string,
): value is PaymentBalanceOperationType => {
  return value === 'equilibrio' || value === 'avance'
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const createEmptySummary = (): DailySalesSummary => ({
  totalBs: 0,
  totalUsd: 0,
  byPaymentMethod: {},
  exchangeRate: null,
  saleCount: 0,
  expenseItems: [],
  totalExpensesBs: 0,
  balanceMovements: [],
})

const formatExpenseLabel = (expense: ExpenseRow): string => {
  const description = expense.description?.trim()
  if (description) return description

  const category = expense.category?.trim()
  if (category) {
    return category.charAt(0).toUpperCase() + category.slice(1)
  }

  return 'Sin descripción'
}

const normalizeMovementNote = (note: string | null): string | null => {
  const trimmed = note?.trim()
  return trimmed ? trimmed : null
}

const getExpenseItems = async (
  supabase: SupabaseClient,
  date: string,
): Promise<Result<DailyExpenseItem[], string>> => {
  const { data, error } = await supabase
    .from('expenses')
    .select('description, category, amount')
    .eq('date', date)

  if (error) {
    return failure(`Error al obtener egresos: ${error.message}`)
  }

  return success(
    ((data || []) as ExpenseRow[]).map((expense) => ({
      label: formatExpenseLabel(expense),
      amountBs: expense.amount,
    })),
  )
}

const getTipsExpenseItem = async (
  supabase: SupabaseClient,
  date: string,
): Promise<Result<DailyExpenseItem | null, string>> => {
  const { data, error } = await supabase
    .from('tips')
    .select('amount_bs')
    .eq('tip_date', date)
    .eq('status', 'paid')

  if (error) {
    return failure(`Error al obtener propinas: ${error.message}`)
  }

  const totalTipsBs = ((data || []) as TipRow[])
    .reduce((sum, tip) => sum + tip.amount_bs, 0)

  if (totalTipsBs === 0) return success(null)

  return success({
    label: 'Propinas',
    amountBs: totalTipsBs,
  })
}

const getBalanceMovements = async (
  supabase: SupabaseClient,
  date: string,
): Promise<Result<PaymentBalanceMovement[], string>> => {
  const { data, error } = await supabase
    .from('payment_balance_transacction')
    .select(
      'operation_type, from_method, to_method, amount, amount_out_bs, amount_out_usd, amount_in_bs, amount_in_usd, notes',
    )
    .eq('date', date)
    .order('created_at', { ascending: true })

  if (error) {
    return failure(`Error al obtener movimientos internos: ${error.message}`)
  }

  return success(
    ((data || []) as PaymentBalanceMovementRow[])
      .filter((movement) => isPaymentBalanceOperationType(movement.operation_type))
      .map((movement) => ({
        operationType: movement.operation_type,
        fromMethod: movement.from_method,
        toMethod: movement.to_method,
        amount: movement.amount,
        amountOutBs: movement.amount_out_bs,
        amountOutUsd: movement.amount_out_usd,
        amountInBs: movement.amount_in_bs,
        amountInUsd: movement.amount_in_usd,
        note: normalizeMovementNote(movement.notes),
      })),
  )
}

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeSalesRepository = (
  deps: SalesRepositoryDeps,
): SalesRepository => {
  const getTodaySales = async (
    date: string,
  ): Promise<Result<DailySalesSummary, string>> => {
    try {
      const salesQuery = deps.supabase
        .from('sales')
        .select('*, sale_payment_splits(*)')
        .eq('date', date)

      const [salesResponse, expensesResult, tipsResult, movementsResult] = await Promise.all([
        salesQuery,
        getExpenseItems(deps.supabase, date),
        getTipsExpenseItem(deps.supabase, date),
        getBalanceMovements(deps.supabase, date),
      ])

      const { data, error } = salesResponse

      if (error) {
        return failure(`Error al obtener ventas: ${error.message}`)
      }

      const expenseItems = isFailure(expensesResult)
        ? []
        : expensesResult.getValue()
      const tipExpenseItem = isFailure(tipsResult)
        ? null
        : tipsResult.getValue()
      const expensesWithTips = tipExpenseItem
        ? [...expenseItems, tipExpenseItem]
        : expenseItems
      const totalExpensesBs = expensesWithTips.reduce(
        (sum, expense) => sum + expense.amountBs,
        0,
      )
      const balanceMovements = isFailure(movementsResult)
        ? []
        : movementsResult.getValue()

      const rows = (data || []) as SaleWithSplitsRow[]
      if (rows.length === 0) {
        return success({
          ...createEmptySummary(),
          expenseItems: expensesWithTips,
          totalExpensesBs,
          balanceMovements,
        })
      }

      let totalBs = 0
      let totalUsd = 0
      let exchangeRate: number | null = null
      const byPaymentMethod: Record<
        string,
        { count: number; bs: number; usd: number }
      > = {}

      for (const sale of rows) {
        // Track the latest non-null exchange rate
        if (sale.exchange_rate != null) {
          exchangeRate = sale.exchange_rate
        }

        const splits = sale.sale_payment_splits

        if (splits && splits.length > 0) {
          // Aggregate from splits
          for (const split of splits) {
            const method = split.payment_method
            if (!byPaymentMethod[method]) {
              byPaymentMethod[method] = { count: 0, bs: 0, usd: 0 }
            }
            byPaymentMethod[method].count += 1
            byPaymentMethod[method].bs += split.amount_bs
            byPaymentMethod[method].usd += split.amount_usd
            totalBs += split.amount_bs
            totalUsd += split.amount_usd
          }
        } else {
          // Use direct fields from the sale
          const method = sale.payment_method
          if (!byPaymentMethod[method]) {
            byPaymentMethod[method] = { count: 0, bs: 0, usd: 0 }
          }
          byPaymentMethod[method].count += 1
          byPaymentMethod[method].bs += sale.total_bs
          byPaymentMethod[method].usd += sale.total_usd
          totalBs += sale.total_bs
          totalUsd += sale.total_usd
        }
      }

      return success({
        totalBs,
        totalUsd,
        byPaymentMethod,
        exchangeRate,
        saleCount: rows.length,
        expenseItems: expensesWithTips,
        totalExpensesBs,
        balanceMovements,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return failure(`Error inesperado: ${reason}`)
    }
  }

  return { getTodaySales }
}

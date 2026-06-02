/**
 * Tests for Sale domain entity.
 *
 * @see domain/entities/sale.ts
 */

import { assertEquals, assert } from '#test-assert'
import {
  makeSaleFromRow,
  formatCurrency,
  type SaleRow,
  type DailySalesSummary,
} from '../sale.ts'

// ─── Helpers ───────────────────────────────────────────────────────────────

const createSaleRow = (
  overrides: Partial<SaleRow> = {},
): SaleRow => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  daily_number: 1,
  date: '2024-01-15',
  items: [],
  payment_method: 'efectivo',
  total_bs: 1500,
  total_usd: 15,
  exchange_rate: 100,
  notes: null,
  created_at: '2024-01-15T10:00:00.000Z',
  updated_at: '2024-01-15T10:00:00.000Z',
  ...overrides,
})

// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test('1. makeSaleFromRow returns Sale for happy path with all fields', () => {
  const row = createSaleRow()
  const sale = makeSaleFromRow(row)

  assert(sale !== null, 'Should return a Sale entity')
  assertEquals(sale.id, row.id)
  assertEquals(sale.dailyNumber, 1)
  assertEquals(sale.date, '2024-01-15')
  assertEquals(sale.paymentMethod, 'efectivo')
  assertEquals(sale.totalBs, 1500)
  assertEquals(sale.totalUsd, 15)
  assertEquals(sale.exchangeRate, 100)
  assertEquals(sale.notes, null)
  assertEquals(sale.createdAt, '2024-01-15T10:00:00.000Z')
  assertEquals(sale.updatedAt, '2024-01-15T10:00:00.000Z')
})

Deno.test('2. makeSaleFromRow handles missing exchange_rate', () => {
  const row = createSaleRow({ exchange_rate: null })
  const sale = makeSaleFromRow(row)

  assert(sale !== null, 'Should return a Sale')
  assertEquals(sale.exchangeRate, null)
})

Deno.test('3. formatCurrency formats 1500 as 1.500 (es-VE locale)', () => {
  assertEquals(formatCurrency(1500), '1.500')
})

Deno.test('4. formatCurrency formats 0 as 0', () => {
  assertEquals(formatCurrency(0), '0')
})

Deno.test('5. formatCurrency formats 1234567 as 1.234.567', () => {
  assertEquals(formatCurrency(1234567), '1.234.567')
})

Deno.test('6. DailySalesSummary type has correct shape', () => {
  const summary: DailySalesSummary = {
    totalBs: 1500,
    totalUsd: 15,
    byPaymentMethod: {
      efectivo: { count: 1, bs: 1500, usd: 15 },
    },
    exchangeRate: 100,
    saleCount: 1,
    expenseItems: [],
    totalExpensesBs: 0,
    balanceMovements: [],
  }

  assertEquals(summary.totalBs, 1500)
  assertEquals(summary.totalUsd, 15)
  assertEquals(summary.byPaymentMethod.efectivo.count, 1)
  assertEquals(summary.byPaymentMethod.efectivo.bs, 1500)
  assertEquals(summary.saleCount, 1)
  assertEquals(summary.exchangeRate, 100)
})

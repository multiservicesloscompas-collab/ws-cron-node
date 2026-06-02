/**
 * Tests for makeSalesRepository factory.
 *
 * @see infra/supabase/make-sales-repository.ts
 */

import { assertEquals, assert } from '#test-assert'
import { makeSalesRepository } from '../make-sales-repository.ts'
import { isFailure } from '../../../types/result.ts'

type QueryResult = { data: unknown[] | null; error: { message: string } | null }

type QueryMap = Record<string, QueryResult>

const createMockSupabase = (queries: QueryMap) => ({
  from: (table: string) => ({
    select: () => {
      const query = queries[table] ?? { data: [], error: null }

      const promise = Promise.resolve(query)
      const builder = {
        eq: () => builder,
        order: () => builder,
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
      }

      return builder
    },
  }),
})

const createBaseQueries = (): QueryMap => ({
  sales: { data: [], error: null },
  expenses: { data: [], error: null },
  tips: { data: [], error: null },
  payment_balance_transacction: { data: [], error: null },
})

Deno.test('1. getTodaySales returns summary with direct payment method', async () => {
  const queries = createBaseQueries()
  queries.sales = {
    data: [
      {
        id: 'sale-1',
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
        sale_payment_splits: [],
      },
    ],
    error: null,
  }

  const repo = makeSalesRepository({
    supabase: createMockSupabase(queries) as any,
  })

  const result = await repo.getTodaySales('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  const summary = result.getValue()
  assertEquals(summary.totalBs, 1500)
  assertEquals(summary.totalUsd, 15)
  assertEquals(summary.saleCount, 1)
  assertEquals(summary.exchangeRate, 100)
  assertEquals(summary.byPaymentMethod.efectivo.count, 1)
  assertEquals(summary.byPaymentMethod.efectivo.bs, 1500)
  assertEquals(summary.byPaymentMethod.efectivo.usd, 15)
  assertEquals(summary.totalExpensesBs, 0)
  assertEquals(summary.expenseItems.length, 0)
  assertEquals(summary.balanceMovements.length, 0)
})

Deno.test('2. getTodaySales aggregates from splits when present', async () => {
  const queries = createBaseQueries()
  queries.sales = {
    data: [
      {
        id: 'sale-2',
        daily_number: 2,
        date: '2024-01-15',
        items: [],
        payment_method: 'efectivo',
        total_bs: 5000,
        total_usd: 50,
        exchange_rate: 100,
        notes: null,
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
        sale_payment_splits: [
          { id: 'split-1', sale_id: 'sale-2', payment_method: 'efectivo', amount_bs: 2000, amount_usd: 20 },
          { id: 'split-2', sale_id: 'sale-2', payment_method: 'pago_movil', amount_bs: 3000, amount_usd: 30 },
        ],
      },
    ],
    error: null,
  }

  const repo = makeSalesRepository({
    supabase: createMockSupabase(queries) as any,
  })

  const result = await repo.getTodaySales('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  const summary = result.getValue()
  assertEquals(summary.totalBs, 5000)
  assertEquals(summary.totalUsd, 50)
  assertEquals(summary.saleCount, 1)
  assertEquals(summary.byPaymentMethod.efectivo.bs, 2000)
  assertEquals(summary.byPaymentMethod.efectivo.usd, 20)
  assertEquals(summary.byPaymentMethod.pago_movil.bs, 3000)
  assertEquals(summary.byPaymentMethod.pago_movil.usd, 30)
})

Deno.test('3. getTodaySales returns empty sales summary but keeps expenses and movements', async () => {
  const queries = createBaseQueries()
  queries.expenses = {
    data: [
      { description: 'Gasolina', category: 'transporte', amount: 1750 },
    ],
    error: null,
  }
  queries.tips = {
    data: [
      { amount_bs: 2000 },
      { amount_bs: 1200 },
    ],
    error: null,
  }
  queries.payment_balance_transacction = {
    data: [
      {
        operation_type: 'equilibrio',
        from_method: 'pago_movil',
        to_method: 'efectivo',
        amount: 700,
        amount_out_bs: 700,
        amount_out_usd: 0,
        amount_in_bs: 700,
        amount_in_usd: 0,
        notes: 'Cambio de caja',
      },
    ],
    error: null,
  }

  const repo = makeSalesRepository({
    supabase: createMockSupabase(queries) as any,
  })

  const result = await repo.getTodaySales('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  const summary = result.getValue()
  assertEquals(summary.totalBs, 0)
  assertEquals(summary.totalUsd, 0)
  assertEquals(summary.saleCount, 0)
  assertEquals(Object.keys(summary.byPaymentMethod).length, 0)
  assertEquals(summary.exchangeRate, null)
  assertEquals(summary.expenseItems.length, 2)
  assertEquals(summary.expenseItems[0].label, 'Gasolina')
  assertEquals(summary.expenseItems[1].label, 'Propinas')
  assertEquals(summary.totalExpensesBs, 4950)
  assertEquals(summary.balanceMovements.length, 1)
  assertEquals(summary.balanceMovements[0].operationType, 'equilibrio')
})

Deno.test('4. getTodaySales returns failure on sales query error', async () => {
  const queries = createBaseQueries()
  queries.sales = { data: null, error: { message: 'Connection timeout' } }

  const repo = makeSalesRepository({
    supabase: createMockSupabase(queries) as any,
  })

  const result = await repo.getTodaySales('2024-01-15')

  assert(isFailure(result), 'Result should be failure')
  assert(
    result.getError().includes('Connection timeout'),
    'Error should contain Supabase message',
  )
})

Deno.test('5. getTodaySales aggregates multiple sales with mixed methods', async () => {
  const queries = createBaseQueries()
  queries.sales = {
    data: [
      {
        id: 'sale-3',
        daily_number: 3,
        date: '2024-01-15',
        items: [],
        payment_method: 'efectivo',
        total_bs: 1000,
        total_usd: 10,
        exchange_rate: 100,
        notes: null,
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
        sale_payment_splits: [],
      },
      {
        id: 'sale-4',
        daily_number: 4,
        date: '2024-01-15',
        items: [],
        payment_method: 'pago_movil',
        total_bs: 2000,
        total_usd: 20,
        exchange_rate: 110,
        notes: null,
        created_at: '2024-01-15T11:00:00.000Z',
        updated_at: '2024-01-15T11:00:00.000Z',
        sale_payment_splits: [],
      },
    ],
    error: null,
  }
  queries.expenses = {
    data: [
      { description: '', category: 'gasolina', amount: 500 },
    ],
    error: null,
  }
  queries.payment_balance_transacction = {
    data: [
      {
        operation_type: 'avance',
        from_method: 'pago_movil',
        to_method: 'efectivo',
        amount: 700,
        amount_out_bs: 700,
        amount_out_usd: 0,
        amount_in_bs: 600,
        amount_in_usd: 0,
        notes: '',
      },
    ],
    error: null,
  }

  const repo = makeSalesRepository({
    supabase: createMockSupabase(queries) as any,
  })

  const result = await repo.getTodaySales('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  const summary = result.getValue()
  assertEquals(summary.totalBs, 3000)
  assertEquals(summary.totalUsd, 30)
  assertEquals(summary.saleCount, 2)
  assertEquals(summary.exchangeRate, 110)
  assertEquals(summary.byPaymentMethod.efectivo.bs, 1000)
  assertEquals(summary.byPaymentMethod.pago_movil.bs, 2000)
  assertEquals(summary.expenseItems[0].label, 'Gasolina')
  assertEquals(summary.totalExpensesBs, 500)
  assertEquals(summary.balanceMovements[0].note, null)
  assertEquals(summary.balanceMovements[0].amountInBs, 600)
})

Deno.test('6. getTodaySales ignores unsupported balance movement operation types', async () => {
  const queries = createBaseQueries()
  queries.payment_balance_transacction = {
    data: [
      {
        operation_type: 'equilibrio',
        from_method: 'pago_movil',
        to_method: 'efectivo',
        amount: 700,
        amount_out_bs: 700,
        amount_out_usd: 0,
        amount_in_bs: 700,
        amount_in_usd: 0,
        notes: 'Cambio de caja',
      },
      {
        operation_type: 'otro',
        from_method: 'efectivo',
        to_method: 'divisa',
        amount: 100,
        amount_out_bs: 100,
        amount_out_usd: 0,
        amount_in_bs: 0,
        amount_in_usd: 1,
        notes: 'Debe ignorarse',
      },
    ],
    error: null,
  }

  const repo = makeSalesRepository({
    supabase: createMockSupabase(queries) as any,
  })

  const result = await repo.getTodaySales('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  const summary = result.getValue()
  assertEquals(summary.balanceMovements.length, 1)
  assertEquals(summary.balanceMovements[0].operationType, 'equilibrio')
})

Deno.test('7. getTodaySales fails open when auxiliary payment summary queries fail', async () => {
  const queries = createBaseQueries()
  queries.sales = {
    data: [
      {
        id: 'sale-5',
        daily_number: 5,
        date: '2024-01-15',
        items: [],
        payment_method: 'efectivo',
        total_bs: 1200,
        total_usd: 12,
        exchange_rate: 100,
        notes: null,
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
        sale_payment_splits: [],
      },
    ],
    error: null,
  }
  queries.expenses = { data: null, error: { message: 'expenses unavailable' } }
  queries.tips = { data: null, error: { message: 'tips unavailable' } }
  queries.payment_balance_transacction = {
    data: null,
    error: { message: 'movements unavailable' },
  }

  const repo = makeSalesRepository({
    supabase: createMockSupabase(queries) as any,
  })

  const result = await repo.getTodaySales('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  const summary = result.getValue()
  assertEquals(summary.totalBs, 1200)
  assertEquals(summary.totalUsd, 12)
  assertEquals(summary.saleCount, 1)
  assertEquals(summary.byPaymentMethod.efectivo.bs, 1200)
  assertEquals(summary.expenseItems, [])
  assertEquals(summary.totalExpensesBs, 0)
  assertEquals(summary.balanceMovements, [])
})

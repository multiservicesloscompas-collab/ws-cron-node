import { assert, assertEquals } from '#test-assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeRentalsRepository } from '../make-rentals-repository.ts'
import { isFailure } from '../../../types/result.ts'
import type { WasherRentalRow } from '../../../domain/entities/washer-rental.ts'

type QueryOrder = {
  column: string
  options?: { ascending?: boolean; nullsFirst?: boolean }
}

const RENTAL_QUERY = 'status.neq.finalizado,and(status.eq.finalizado,is_paid.eq.false)'

const createRentalRow = (
  id: string,
  status: WasherRentalRow['status'],
  isPaid: boolean,
): WasherRentalRow => ({
  id,
  date: '2024-01-15',
  customer_id: `customer-${id}`,
  machine_id: `machine-${id}`,
  shift: 'completo',
  status,
  delivery_time: null,
  pickup_time: '3:00 PM',
  pickup_date: '2024-01-15',
  delivery_fee: null,
  total_usd: 6,
  is_paid: isPaid,
  payment_method: isPaid ? 'efectivo' : null,
  date_paid: isPaid ? '2024-01-15' : null,
  notes: null,
  created_at: '2024-01-15T08:00:00.000Z',
  customer: {
    id: `customer-${id}`,
    name: `Cliente ${id}`,
    phone: null,
    address: `Dirección ${id}`,
  },
  machine: {
    id: `machine-${id}`,
    name: `Lavadora ${id}`,
  },
})

const matchesStreetWashersFilter = (
  row: WasherRentalRow,
  query: string | null,
): boolean => {
  if (!query) return true
  if (query !== RENTAL_QUERY) return false
  return row.status !== 'finalizado' || !row.is_paid
}

const createMockSupabase = (
  rows: WasherRentalRow[] | null,
  returnError: { message: string } | null = null,
): {
  supabase: SupabaseClient
  calls: {
    filters: string[]
    orders: QueryOrder[]
  }
} => {
  const calls = {
    filters: [] as string[],
    orders: [] as QueryOrder[],
  }

  let currentFilter: string | null = null

  const query = {
    or: (filter: string) => {
      currentFilter = filter
      calls.filters.push(filter)
      return query
    },
    order: (column: string, options?: QueryOrder['options']) => {
      calls.orders.push({ column, options })
      if (calls.orders.length < 3) return query

      const filteredRows = (rows || []).filter((row) =>
        matchesStreetWashersFilter(row, currentFilter)
      )

      return Promise.resolve({ data: filteredRows, error: returnError })
    },
  }

  return {
    supabase: {
      from: () => ({
        select: () => query,
      }),
    } as unknown as SupabaseClient,
    calls,
  }
}

Deno.test('1. getStreetWashers includes agendado, enviado and finalizado unpaid', async () => {
  const mixedRows = [
    createRentalRow('agendado', 'agendado', false),
    createRentalRow('enviado', 'enviado', true),
    createRentalRow('finalizado-unpaid', 'finalizado', false),
    createRentalRow('finalizado-paid', 'finalizado', true),
  ]

  const { supabase, calls } = createMockSupabase(mixedRows)
  const repository = makeRentalsRepository({ supabase })

  const result = await repository.getStreetWashers()

  assert(!isFailure(result), 'Result should be success')

  const rentals = result.getValue()
  assertEquals(calls.filters, [RENTAL_QUERY])
  assertEquals(
    calls.orders.map((order) => order.column),
    ['pickup_date', 'pickup_time', 'created_at'],
  )
  assertEquals(
    rentals.map((rental) => rental.id),
    ['agendado', 'enviado', 'finalizado-unpaid'],
  )
  assertEquals(
    rentals.map((rental) => rental.status),
    ['agendado', 'enviado', 'finalizado'],
  )
  assert(
    !rentals.some((rental) => rental.id === 'finalizado-paid'),
    'Should exclude finalized paid rentals',
  )
})

Deno.test('2. getStreetWashers returns failure on Supabase error', async () => {
  const { supabase } = createMockSupabase([], { message: 'Connection timeout' })
  const repository = makeRentalsRepository({ supabase })

  const result = await repository.getStreetWashers()

  assert(isFailure(result), 'Result should be failure')
  assertEquals(
    result.getError(),
    'Error al obtener lavadoras en la calle: Connection timeout',
  )
})

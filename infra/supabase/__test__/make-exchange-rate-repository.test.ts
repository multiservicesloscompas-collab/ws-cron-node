/**
 * Tests for makeExchangeRateRepository factory.
 *
 * @see infra/supabase/make-exchange-rate-repository.ts
 */

import { assertEquals, assert } from '#test-assert'
import { makeExchangeRateRepository } from '../make-exchange-rate-repository.ts'
import { isFailure } from '../../../types/result.ts'

// ─── Helpers ───────────────────────────────────────────────────────────────

const createMockSupabase = (
  returnData: unknown[] | null,
  returnError: { message: string } | null = null,
) => ({
  from: () => ({
    select: () => ({
      order: (firstColumn: string, firstOptions: { ascending: boolean }) => ({
        order: (secondColumn: string, secondOptions: { ascending: boolean }) => ({
          limit: () =>
            Promise.resolve({
              data: returnData,
              error: returnError,
              queryMeta: {
                firstColumn,
                firstOptions,
                secondColumn,
                secondOptions,
              },
            }),
        }),
      }),
    }),
  }),
})

const createTrackingSupabase = (
  returnData: unknown[] | null,
  returnError: { message: string } | null = null,
) => {
  const calls: Array<{ column: string; ascending: boolean }> = []

  return {
    calls,
    client: {
      from: () => ({
        select: () => ({
          order: (column: string, options: { ascending: boolean }) => {
            calls.push({ column, ascending: options.ascending })

            return {
              order: (nextColumn: string, nextOptions: { ascending: boolean }) => {
                calls.push({ column: nextColumn, ascending: nextOptions.ascending })

                return {
                  limit: () => Promise.resolve({ data: returnData, error: returnError }),
                }
              },
            }
          },
        }),
      }),
    },
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test('1. getRateForDate returns rate when found', async () => {
  const mockData = [
    { id: 'rate-1', date: '2024-01-15', rate: 100, updated_at: '2024-01-15T10:00:00.000Z' },
  ]

  const repo = makeExchangeRateRepository({
    supabase: createMockSupabase(mockData) as any,
  })

  const result = await repo.getRateForDate('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  assertEquals(result.getValue(), 100)
})

Deno.test('2. getRateForDate returns null when no rate found', async () => {
  const repo = makeExchangeRateRepository({
    supabase: createMockSupabase([]) as any,
  })

  const result = await repo.getRateForDate('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  assertEquals(result.getValue(), null)
})

Deno.test('3. getRateForDate returns failure on Supabase error', async () => {
  const repo = makeExchangeRateRepository({
    supabase: createMockSupabase(null, { message: 'Database error' }) as any,
  })

  const result = await repo.getRateForDate('2024-01-15')

  assert(isFailure(result), 'Result should be failure')
  assert(
    result.getError().includes('Database error'),
    'Error should contain Supabase message',
  )
})

Deno.test('4. getRateForDate requests latest available rate by date and updated_at', async () => {
  const trackingSupabase = createTrackingSupabase([
    { id: 'rate-2', date: '2024-01-16', rate: 110, updated_at: '2024-01-16T12:00:00.000Z' },
  ])

  const repo = makeExchangeRateRepository({
    supabase: trackingSupabase.client as any,
  })

  const result = await repo.getRateForDate('2024-01-15')

  assert(!isFailure(result), 'Result should be success')
  assertEquals(result.getValue(), 110)
  assertEquals(trackingSupabase.calls, [
    { column: 'date', ascending: false },
    { column: 'updated_at', ascending: false },
  ])
})

/**
 * Tests for makeChecklistService factory.
 *
 * @see domain/services/make-checklist-service.ts
 */

import { assertEquals, assert } from '#test-assert'
import { makeChecklistService } from '../make-checklist-service.ts'
import { success, failure, isFailure } from '../../../types/result.ts'
import type { WasherRental } from '../../entities/washer-rental.ts'

// ─── Helpers ───────────────────────────────────────────────────────────────

const createMockRentalsRepo = (
  rentals: WasherRental[] | null,
  error: string | null = null,
  streetWashers: WasherRental[] | null = rentals,
) => ({
  getPendingPickups: async () =>
    error ? failure(error) : success(rentals!),
  getActiveRentalsForDate: async () => failure('not mocked'),
  getUnpaidRentals: async () => failure('not mocked'),
  getAllActiveRentals: async () => failure('not mocked'),
  getStreetWashers: async () =>
    error ? failure(error) : success(streetWashers!),
})

const createSampleRental = (
  overrides: Partial<WasherRental> = {},
): WasherRental => ({
  id: 'rental-1',
  date: '2024-01-15',
  machineId: 'machine-1',
  machineLabel: 'Lavadora 1',
  shift: 'completo',
  status: 'enviado',
  deliveryTime: null,
  pickupTime: '3:00 PM',
  pickupDate: '2024-01-15',
  deliveryFee: null,
  totalUsd: 6,
  isPaid: true,
  paymentMethod: 'efectivo',
  datePaid: null,
  notes: null,
  customer: {
    id: 'cust-1',
    name: 'María Pérez',
    phone: null,
    address: 'Calle Principal #24, PB',
  },
  ...overrides,
})

// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test('1. buildMorningMessage formats message with pending pickups', async () => {
  const rentals = [
    createSampleRental({
      id: 'r1',
      machineLabel: 'Nº 3',
      customer: { id: 'c1', name: 'María Pérez', phone: null, address: 'Calle Principal #24, PB' },
      pickupTime: '3:00 PM',
      isPaid: true,
      totalUsd: 6,
      shift: 'completo',
    }),
    createSampleRental({
      id: 'r2',
      machineLabel: 'Nº 5',
      customer: { id: 'c2', name: 'Juan García', phone: null, address: 'Av. Los Ilustres' },
      pickupTime: '5:00 PM',
      isPaid: false,
      totalUsd: null,
      shift: 'completo',
    }),
  ]

  const service = makeChecklistService({
    rentalsRepo: createMockRentalsRepo(rentals),
  })

  const result = await service.buildMorningMessage()
  assert(!isFailure(result), 'Result should be success')

  const message = result.getValue()
  assert(message.includes('¡Feliz'), 'Should include greeting')
  assert(message.includes('Recordemos hoy:'), 'Should include reminders header')
  assert(message.includes('Limpieza del frente del local'), 'Should include cleaning reminder')
  assert(message.includes('Revisar niveles del agua'), 'Should include water reminder')
  assert(message.includes('📋 TENEMOS 2 PENDIENTES PARA RETIRAR HOY:'), 'Should show count header')
  assert(message.includes('María Pérez'), 'Should include first customer')
  assert(message.includes('Juan García'), 'Should include second customer')
  assert(message.includes('🟢'), 'Paid rental should have green icon')
  assert(message.includes('🔴'), 'Unpaid rental should have red icon')
  assert(message.includes('¡A darle con toda!'), 'Should include closing')
})

Deno.test('2. buildMorningMessage shows no-pending message when empty', async () => {
  const service = makeChecklistService({
    rentalsRepo: createMockRentalsRepo([]),
  })

  const result = await service.buildMorningMessage()
  assert(!isFailure(result), 'Result should be success')

  const message = result.getValue()
  assert(message.includes('¡Feliz'), 'Should include greeting')
  assert(message.includes('Recordemos hoy:'), 'Should include reminders')
  assert(
    message.includes('No hay lavadoras pendientes de retiro'),
    'Should show no-pending message',
  )
  assert(message.includes('¡Buen trabajo!'), 'Should include encouragement')
  assert(message.includes('¡A darle con toda!'), 'Should include closing')
})

Deno.test('3. buildMorningMessage returns failure when repo fails', async () => {
  const service = makeChecklistService({
    rentalsRepo: createMockRentalsRepo(null, 'Database timeout'),
  })

  const result = await service.buildMorningMessage()
  assert(isFailure(result), 'Result should be failure')
  assert(
    result.getError().includes('Database timeout'),
    'Should propagate error',
  )
})

Deno.test('4. buildMorningMessage limits to 15 items max', async () => {
  const rentals = Array.from({ length: 20 }, (_, i) =>
    createSampleRental({
      id: `r${i}`,
      machineLabel: `Nº ${i + 1}`,
      customer: { id: `c${i}`, name: `Cliente ${i + 1}`, phone: null, address: null },
    })
  )

  const service = makeChecklistService({
    rentalsRepo: createMockRentalsRepo(rentals),
  })

  const result = await service.buildMorningMessage()
  assert(!isFailure(result), 'Result should be success')

  const message = result.getValue()
  assert(message.includes('¡Feliz'), 'Should include greeting')
  // Count occurrences of "Nº" in the message (should be max 15)
  const matches = message.match(/Nº/g)
  assert(matches !== null, 'Should have machine entries')
  assert(matches.length <= 15, 'Should not exceed 15 items')
  // Header should show original count, not truncated
  assert(message.includes('TENEMOS 20 PENDIENTES'), 'Header should show total count')
  assert(message.includes('¡A darle con toda!'), 'Should include closing')
})

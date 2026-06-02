/**
 * Tests for makeGroupFinder factory.
 *
 * @see infra/whatsapp/make-group-finder.ts
 */

import { assertEquals, assert } from '#test-assert'
import { makeGroupFinder } from '../make-group-finder.ts'
import { isFailure } from '../../../types/result.ts'
import { type ConnectionStatus } from '../whatsapp-types.ts'

// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test(
  '1. Returns success with matching JID when group name found (case-insensitive)',
  async () => {
    const groups: Record<string, { subject: string; id: string }> = {
      '123@g.us': { subject: 'Multiservicio Los Compas', id: '123@g.us' },
      '456@g.us': { subject: 'Family Group', id: '456@g.us' },
    }

    const findGroup = makeGroupFinder({
      getSocket: () =>
        ({
          groupFetchAllParticipating: async () => groups,
        }) as any,
      getConnectionStatus: () => 'open' as ConnectionStatus,
    })

    const result = await findGroup('MULTISERVICIO LOS COMPAS')

    assert(!isFailure(result), 'Result should be success')
    assertEquals(result.getValue(), '123@g.us')
  },
)

Deno.test(
  "2. Returns failure with 'No se encontró el grupo' when no match",
  async () => {
    const groups: Record<string, { subject: string; id: string }> = {
      '123@g.us': { subject: 'Multiservicio Los Compas', id: '123@g.us' },
    }

    const findGroup = makeGroupFinder({
      getSocket: () =>
        ({
          groupFetchAllParticipating: async () => groups,
        }) as any,
      getConnectionStatus: () => 'open' as ConnectionStatus,
    })

    const result = await findGroup('Nonexistent')

    assert(isFailure(result), 'Result should be failure')
    assertEquals(
      result.getError(),
      "No se encontró el grupo 'Nonexistent'",
    )
  },
)

Deno.test(
  "3. Returns failure with 'WhatsApp no está conectado' when not open",
  async () => {
    const findGroup = makeGroupFinder({
      getSocket: () => null,
      getConnectionStatus: () => 'closed' as ConnectionStatus,
    })

    const result = await findGroup('Anything')

    assert(isFailure(result), 'Result should be failure')
    assertEquals(result.getError(), 'WhatsApp no está conectado')
  },
)

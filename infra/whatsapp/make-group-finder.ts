/**
 * Group Finder — Search WhatsApp groups by name.
 *
 * @see docs/spec-whatsapp-service.md section 7
 */

import { success, failure, type Result } from '../../types/result.ts'
import { type ConnectionStatus } from './whatsapp-types.ts'
import type { WASocket } from './make-whatsapp-client.ts'

/**
 * Factory: creates a group finder function.
 *
 * @param deps.getSocket — Returns the current WASocket or null
 * @param deps.getConnectionStatus — Returns current connection status
 *
 * @example
 * const findGroup = makeGroupFinder({ getSocket, getConnectionStatus })
 * const result = await findGroup('Multiservicio Los Compas')
 */
export const makeGroupFinder = (
  deps: {
    getSocket: () => WASocket | null
    getConnectionStatus: () => ConnectionStatus
  },
) =>
async (groupName: string): Promise<Result<string, string>> => {
  const status = deps.getConnectionStatus()

  if (status !== 'open') {
    return failure('WhatsApp no está conectado')
  }

  const sock = deps.getSocket()

  if (!sock?.groupFetchAllParticipating) {
    return failure('WhatsApp no está conectado')
  }

  try {
    const groups = await sock.groupFetchAllParticipating()

    const entry = Object.entries(groups).find(
      ([_, group]) =>
        group.subject.toLowerCase() === groupName.toLowerCase(),
    )

    if (!entry) {
      return failure(`No se encontró el grupo '${groupName}'`)
    }

    return success(entry[0])
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return failure(`Error al buscar grupo: ${reason}`)
  }
}

/**
 * Send Message — Send a text message via Baileys socket.
 *
 * @see docs/spec-whatsapp-service.md section 7
 */

import { success, failure, type Result } from '../../types/result.ts'
import type { WASocket } from './make-whatsapp-client.ts'

/**
 * Factory: creates a sendMessage function.
 *
 * @param deps.getSocket — Returns the current WASocket or null
 *
 * @example
 * const sendMessage = makeSendMessage({ getSocket })
 * const result = await sendMessage('123@g.us', 'Hola')
 */
export const makeSendMessage = (
  deps: { getSocket: () => WASocket | null },
) =>
async (jid: string, text: string): Promise<Result<void, string>> => {
  const sock = deps.getSocket()

  if (!sock?.sendMessage) {
    return failure('WhatsApp no está conectado')
  }

  try {
    await sock.sendMessage(jid, { text })
    return success(undefined)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return failure(`Error al enviar mensaje: ${reason}`)
  }
}

/**
 * Media Downloader — Downloads WhatsApp media messages using Baileys.
 *
 * Provides a safe wrapper around Baileys' downloadMediaMessage function.
 * Returns raw bytes that can be served via the web UI.
 *
 * @see infra/whatsapp/make-message-store.ts
 */

import { downloadMediaMessage } from 'baileys'
import type { WASocket } from './make-whatsapp-client.ts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MediaMessageKey {
  id: string
  remoteJid: string
  fromMe: boolean
}

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeMediaDownloader = (deps: { getSocket: () => WASocket | null }) => {
  /**
   * Download a media message by its key and content.
   * Returns null if the socket is not connected or download fails.
   */
  const download = async (
    messageKey: MediaMessageKey,
    messageContent: Record<string, unknown>,
  ): Promise<Uint8Array | null> => {
    const socket = deps.getSocket()
    if (!socket?.waUploadToServer) return null
    const reuploadRequest = socket.waUploadToServer

    try {
      // Construct a minimal WAMessage-like object for Baileys
      const msg = {
        key: {
          id: messageKey.id,
          remoteJid: messageKey.remoteJid,
          fromMe: messageKey.fromMe,
        },
        message: messageContent,
      }

      const buffer = await downloadMediaMessage(
        msg as any,
        'buffer',
        {},
        {
          reuploadRequest: async (m: any) => {
            return reuploadRequest(m as any) as any
          },
          logger: console as any,
        },
      )

      return new Uint8Array(buffer.buffer ?? buffer)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`[Media] Error descargando multimedia: ${reason}`)
      return null
    }
  }

  return { download }
}

export type MediaDownloader = ReturnType<typeof makeMediaDownloader>

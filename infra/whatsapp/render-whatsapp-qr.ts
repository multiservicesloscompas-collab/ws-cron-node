import {
  loadQRCode,
  type QRCodeBindings,
} from './baileys-bindings.ts'

const encodeSvgDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export const renderWhatsAppQr = async (
  qr: string,
  qrCode?: QRCodeBindings,
): Promise<string | null> => {
  console.log('\n═══════════════════════════════════════════')
  console.log('  ESCANEA ESTE QR CON WHATSAPP EN TU CELULAR')
  console.log('  (WhatsApp → Dispositivos vinculados)')
  console.log('═══════════════════════════════════════════\n')

  const qrCodeBindings = qrCode ?? await loadQRCode()

  try {
    const qrAscii = await qrCodeBindings.toString(qr, { type: 'terminal', small: true })
    console.log(qrAscii)
  } catch {
    console.log(qr)
  }

  console.log('\n═══════════════════════════════════════════\n')

  try {
    return await qrCodeBindings.toDataURL(qr)
  } catch {
    try {
      const svg = await qrCodeBindings.toString(qr, { type: 'svg' })
      return encodeSvgDataUrl(svg)
    } catch {
      return null
    }
  }
}

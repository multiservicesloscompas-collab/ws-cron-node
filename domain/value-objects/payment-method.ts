/**
 * PaymentMethod — Value Object for payment methods used in the business.
 *
 * Valid methods:
 *   - efectivo: Cash in Bs
 *   - pago_movil: Mobile transfer (Venezuela)
 *   - punto_venta: Point of sale / card payment
 *   - divisa: Foreign currency (USD)
 *
 * @see docs/spec-whatsapp-service.md section 4.7
 */

import { success, failure, type Result } from '../../types/result.ts'

/**
 * Branded type for validated payment methods.
 */
export type PaymentMethod =
  | 'efectivo'
  | 'pago_movil'
  | 'punto_venta'
  | 'divisa'

const VALID_METHODS: PaymentMethod[] = [
  'efectivo',
  'pago_movil',
  'punto_venta',
  'divisa',
]

/**
 * Creates a PaymentMethod from a raw string.
 *
 * @example
 * const pm = makePaymentMethod('pago_movil')
 * if (isFailure(pm)) return console.error(pm.getError())
 * console.log(pm.getValue()) // "pago_movil"
 */
export const makePaymentMethod = (
  input: string,
): Result<PaymentMethod, string> => {
  const normalized = input.toLowerCase().trim() as PaymentMethod
  if (!VALID_METHODS.includes(normalized)) {
    return failure(
      `Método de pago inválido: "${input}". Válidos: ${VALID_METHODS.join(', ')}`,
    )
  }
  return success(normalized)
}

/**
 * Human-readable labels for WhatsApp messages.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: '💵 Efectivo',
  pago_movil: '📱 Pago Móvil',
  punto_venta: '💳 Punto de Venta',
  divisa: '💶 Divisa',
}

/**
 * Returns the emoji + label for a payment method.
 */
export const formatPaymentMethod = (method: PaymentMethod): string => {
  return PAYMENT_METHOD_LABELS[method]
}

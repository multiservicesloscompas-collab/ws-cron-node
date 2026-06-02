/**
 * Price — Value Object for monetary amounts in Bs or USD.
 *
 * @see docs/spec-whatsapp-service.md section 4.2
 */

import { success, failure, type Result } from '../../types/result.ts'

/**
 * Supported currencies for pricing.
 */
export type Currency = 'Bs' | 'USD'

/**
 * Branded type for validated prices.
 */
export type Price = number & { readonly __brand: 'Price' }

/**
 * Creates a Price from a numeric amount and currency.
 *
 * @example
 * const p = makePrice(25.50, 'USD')
 * if (isFailure(p)) return console.error(p.getError())
 * console.log(p.getValue()) // 25.50
 */
export const makePrice = (
  amount: number,
  currency: Currency,
): Result<Price, string> => {
  if (amount < 0) {
    return failure(`El monto en ${currency} no puede ser negativo`)
  }
  if (amount === 0) {
    return failure(`El monto en ${currency} debe ser mayor a 0`)
  }
  return success(amount as Price)
}

/**
 * Formats a price for display in WhatsApp messages.
 */
export const formatPrice = (price: Price, currency: Currency): string => {
  if (currency === 'USD') {
    return `$${price.toFixed(2)}`
  }
  return `${price.toFixed(2)} Bs`
}

/**
 * Sums an array of prices (all assumed same currency).
 */
export const sumPrices = (prices: Price[]): Price => {
  const total = prices.reduce((acc, p) => acc + p, 0)
  return total as Price
}

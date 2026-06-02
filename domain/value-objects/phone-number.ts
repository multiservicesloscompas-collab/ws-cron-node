/**
 * PhoneNumber — Value Object for Venezuelan phone numbers.
 *
 * Format: +58XXXYYYYYYY (XXX = operator code, YYYYYYY = number)
 *
 * @see docs/spec-whatsapp-service.md section 4.1
 */

import { success, failure, type Result } from '../../types/result.ts'

/**
 * Branded type for validated Venezuelan phone numbers.
 */
export type PhoneNumber = string & { readonly __brand: 'PhoneNumber' }

const VZLA_PHONE_RE = /^\+58(412|414|424|416|426)\d{7}$/

/**
 * Creates a PhoneNumber from a raw string.
 * Accepts formats: +584121234567, 04121234567, 0412-1234567, etc.
 *
 * @example
 * const phone = makePhoneNumber('+584129833320')
 * if (isFailure(phone)) return console.error(phone.getError())
 * console.log(phone.getValue()) // "+584129833320"
 */
export const makePhoneNumber = (input: string): Result<PhoneNumber, string> => {
  const cleaned = input.replace(/[\s\-]/g, '')
  if (!VZLA_PHONE_RE.test(cleaned)) {
    return failure(
      'Número telefónico inválido. Debe ser +58XXXYYYYYYY (ej. +584129833320)',
    )
  }
  return success(cleaned as PhoneNumber)
}

/**
 * Strips the country code for display purposes.
 * "+584129833320" -> "0412-9833320"
 */
export const formatPhoneDisplay = (phone: PhoneNumber): string => {
  const code = phone.substring(3, 6)
  const number = phone.substring(6)
  return `0${code}-${number}`
}

/**
 * Strips the +58 prefix and returns just the digits for WhatsApp JID format.
 * "+584129833320" -> "584129833320@s.whatsapp.net"
 */
export const phoneToJid = (phone: PhoneNumber): string => {
  const digits = phone.replace('+', '')
  return `${digits}@s.whatsapp.net`
}

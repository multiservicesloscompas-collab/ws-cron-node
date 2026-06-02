/**
 * Customer — Domain entity for a business customer.
 *
 * @see docs/spec-whatsapp-service.md section 9
 */

import type { PhoneNumber } from '../value-objects/phone-number.ts'

/**
 * Raw customer data as it comes from Supabase.
 */
export interface CustomerRow {
  id: string
  name: string
  phone: string | null
  address: string | null
  created_at?: string | null
  deleted_at?: string | null
}

/**
 * Validated customer entity.
 */
export interface Customer {
  id: string
  name: string
  phone: PhoneNumber | null
  address: string | null
}

/**
 * Creates a Customer from a database row.
 * Returns null if the customer is soft-deleted.
 */
export const makeCustomerFromRow = (
  row: CustomerRow,
): Customer | null => {
  if (row.deleted_at) return null

  return {
    id: row.id,
    name: row.name,
    phone: row.phone as PhoneNumber | null,
    address: row.address,
  }
}

/**
 * Formats customer info for display in WhatsApp messages.
 */
export const formatCustomerInfo = (customer: Customer): string => {
  let info = customer.name
  if (customer.address) {
    info += `\n   📍 ${customer.address}`
  }
  if (customer.phone) {
    info += `\n   📞 ${customer.phone}`
  }
  return info
}

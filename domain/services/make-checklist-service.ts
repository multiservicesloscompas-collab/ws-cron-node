/**
 * Checklist Service — Builds the morning message with pending pickup list.
 *
 * Uses the existing rentals repository and formatRentalForChecklist helper
 * to generate the morning checklist WhatsApp message.
 *
 * @see docs/spec-whatsapp-service.md section 4.2
 */

import { success, failure, isFailure, type Result } from '../../types/result.ts'
import {
  formatRentalForChecklist,
} from '../entities/washer-rental.ts'
import {
  getStreetWashersReferenceFromDate,
  renderStreetWashersBlock,
  renderStreetWashersFailureBlock,
} from '../entities/render-street-washers-block.ts'
import type { WasherRental } from '../entities/washer-rental.ts'
import type { RentalsRepository } from '../../infra/supabase/make-rentals-repository.ts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChecklistServiceDeps {
  rentalsRepo: RentalsRepository
}

export interface ChecklistService {
  /**
   * Builds the complete morning message with greeting, reminders, and pending pickups.
   * @param date Optional date string (YYYY-MM-DD). Defaults to today.
   */
  buildMorningMessage: (
    date?: string,
    template?: string,
    referenceDate?: Date,
  ) => Promise<Result<string, string>>
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_CHECKLIST_ITEMS = 15
const MORNING_CLOSING = '¡A darle con toda!'
const CHECKLIST_HEADER = 'Recordemos hoy:'
const MORNING_REMINDERS = [
  '✅ Limpieza del frente del local',
  '✅ Limpieza del baño',
  '✅ Revisar niveles del agua',
  '✅ Ser siempre amables con nuestros clientes',
]

// ─── Helpers ───────────────────────────────────────────────────────────────

const getDateValue = (date?: string): string => {
  if (date) return date
  return new Date().toISOString().slice(0, 10)
}

const getDateForTemplate = (date?: string): Date => {
  if (!date) return new Date()
  return new Date(`${date}T12:00:00`)
}

const getDayName = (date?: string): string => {
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  return days[getDateForTemplate(date).getDay()]
}

const formatTime = (): string => {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

const renderMorningTemplate = (
  template: string,
  date: string | undefined,
  streetWashersBlock: string,
): string => {
  return template
    .replace(/\{\{date\}\}/g, getDateValue(date))
    .replace(/\{\{day\}\}/g, getDayName(date))
    .replace(/\{\{time\}\}/g, formatTime())
    .replace(/\{\{street_washers\}\}/g, streetWashersBlock)
}

const buildChecklistSection = (allRentals: WasherRental[]): string => {
  const totalCount = allRentals.length
  const parts: string[] = [CHECKLIST_HEADER, ...MORNING_REMINDERS, '']

  if (totalCount === 0) {
    parts.push('📋 No hay lavadoras pendientes de retiro. ¡Buen trabajo!')
    return parts.join('\n')
  }

  const displayRentals = allRentals.slice(0, MAX_CHECKLIST_ITEMS)
  const checklistItems = displayRentals.map(formatRentalForChecklist)
  parts.push(`📋 TENEMOS ${totalCount} PENDIENTES PARA RETIRAR HOY:`)
  parts.push('')
  parts.push(...checklistItems)

  return parts.join('\n')
}

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeChecklistService = (
  deps: ChecklistServiceDeps,
): ChecklistService => {
  const buildMorningMessage = async (
    date?: string,
    template?: string,
    referenceDate?: Date,
  ): Promise<Result<string, string>> => {
    const shouldIncludeStreetWashers = template?.includes('{{street_washers}}') ?? false

    if (template && shouldIncludeStreetWashers) {
      const streetWashersResult = await deps.rentalsRepo.getStreetWashers()
      if (isFailure(streetWashersResult)) {
        return success(
          renderMorningTemplate(template, date, renderStreetWashersFailureBlock()).trim(),
        )
      }

      return success(
        renderMorningTemplate(
          template,
          date,
          renderStreetWashersBlock(
            streetWashersResult.getValue(),
            referenceDate ? getStreetWashersReferenceFromDate(referenceDate) : undefined,
          ),
        ).trim(),
      )
    }

    const rentalsResult = await deps.rentalsRepo.getPendingPickups()
    if (isFailure(rentalsResult)) return failure(rentalsResult.getError())

    const allRentals = rentalsResult.getValue()
    const checklistSection = buildChecklistSection(allRentals)

    const dayName = getDayName(date)
    const parts: string[] = [
      `🌞 ¡Feliz ${dayName} equipo! Vamos con todo.`,
      '',
      checklistSection,
    ]

    parts.push('')
    parts.push(MORNING_CLOSING)

    return success(parts.join('\n'))
  }

  return { buildMorningMessage }
}

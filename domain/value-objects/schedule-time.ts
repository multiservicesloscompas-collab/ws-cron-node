/**
 * ScheduleTime — Value Object para horas de programación CRON.
 *
 * Formato: "HH:mm" en hora Caracas (America/Caracas, UTC-4).
 *
 * @see docs/spec-whatsapp-service.md section 4.3
 */

import { success, failure, type Result } from '../../types/result.ts'

/**
 * Branded type for schedule time strings.
 */
export type ScheduleTime = string & { readonly __brand: 'ScheduleTime' }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Creates a ScheduleTime from a "HH:mm" string.
 *
 * @example
 * const t = makeScheduleTime('08:30')
 * if (isFailure(t)) return console.error(t.getError())
 * console.log(t.getValue()) // "08:30"
 */
export const makeScheduleTime = (input: string): Result<ScheduleTime, string> => {
  if (!TIME_RE.test(input)) {
    return failure('Formato de hora inválido. Use HH:mm (ej. 08:30, 19:30)')
  }
  return success(input as ScheduleTime)
}

/**
 * Converts ScheduleTime to CRON expression for daily execution.
 * "08:30" -> "30 8 * * *"
 */
export const scheduleTimeToCron = (time: ScheduleTime): string => {
  const [hours, minutes] = time.split(':')
  return `${minutes} ${hours} * * *`
}

/**
 * Converts ScheduleTime to CRON expression with day-of-week filter.
 * "19:30" + "1-6" -> "30 19 * * 1-6"
 */
export const scheduleTimeToCronWithDays = (
  time: ScheduleTime,
  days: string,
): string => {
  const [hours, minutes] = time.split(':')
  return `${minutes} ${hours} * * ${days}`
}

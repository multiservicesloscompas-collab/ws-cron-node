/**
 * CRON Config — Read/write persistent CRON configuration from a JSON file.
 *
 * Stores:
 *   - morning: { time, message, days }
 *   - night:   { time, message, days }
 *   - targetJid: the WhatsApp JID to send messages to
 *
 * @see docs/spec-whatsapp-service.md section 8
 */

import { readFile, writeFile } from "node:fs/promises";
import { failure, type Result, success } from "../../types/result.ts";
import {
  makeScheduleTime,
  type ScheduleTime,
} from "../../domain/value-objects/schedule-time.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CronEntryConfig {
  /** Schedule time in HH:mm (Caracas timezone) */
  time: string;
  /** CRON days expression: "*" = daily, "1-6" = Mon-Sat, etc. */
  days: string;
  /** Message template to send. Supports {{date}}, {{day}}, {{time}}, {{street_washers}}. */
  message: string;
  /** Whether this cron is enabled */
  enabled: boolean;
}

export interface CronConfig {
  morning: CronEntryConfig;
  night: CronEntryConfig;
  /** JID of the target group or contact */
  targetJid: string;
  /** Timezone for scheduling */
  timezone: string;
}

const normalizeCronEntry = (
  rawEntry: unknown,
  defaults: CronEntryConfig,
): CronEntryConfig => {
  const entry = typeof rawEntry === "object" && rawEntry !== null &&
      !Array.isArray(rawEntry)
    ? rawEntry as Partial<CronEntryConfig>
    : {};

  return {
    time: typeof entry.time === "string" ? entry.time : defaults.time,
    days: typeof entry.days === "string" ? entry.days : defaults.days,
    message: typeof entry.message === "string"
      ? entry.message
      : defaults.message,
    enabled: typeof entry.enabled === "boolean"
      ? entry.enabled
      : defaults.enabled,
  };
};

export const normalizeCronConfig = (
  rawConfig: unknown,
): Result<CronConfig, string> => {
  const config = typeof rawConfig === "object" && rawConfig !== null &&
      !Array.isArray(rawConfig)
    ? rawConfig as Partial<CronConfig>
    : {};

  const normalizedConfig: CronConfig = {
    morning: normalizeCronEntry(config.morning, DEFAULT_CONFIG.morning),
    night: normalizeCronEntry(config.night, DEFAULT_CONFIG.night),
    targetJid: typeof config.targetJid === "string"
      ? config.targetJid
      : DEFAULT_CONFIG.targetJid,
    timezone: typeof config.timezone === "string"
      ? config.timezone
      : DEFAULT_CONFIG.timezone,
  };

  const morningTime = makeScheduleTime(normalizedConfig.morning.time);
  if (morningTime.isFailure) {
    return failure(`Hora matutina inválida: ${morningTime.getError()}`);
  }

  const nightTime = makeScheduleTime(normalizedConfig.night.time);
  if (nightTime.isFailure) {
    return failure(`Hora nocturna inválida: ${nightTime.getError()}`);
  }

  return success(normalizedConfig);
};

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CronConfig = {
  morning: {
    time: "08:30",
    days: "*",
    message: `🌞 ¡Feliz {{day}} equipo! Vamos con todo.

Recordemos hoy:
✅ Limpieza del frente del local
✅ Limpieza del baño
✅ Revisar niveles del agua
✅ Ser siempre amables con nuestros clientes

¡A darle con toda!`,
    enabled: true,
  },
  night: {
    time: "19:30",
    days: "1-6",
    message: `🌙 Buenas equipo, cerramos el día.

Por favor, recordemos:
✅ Desconectar la lámpara del agua
✅ Dejar el local limpio y ordenado
✅ Limpiar la mesa de trabajo y la cocina

¡Gracias por el esfuerzo de hoy! 🙌`,
    enabled: true,
  },
  targetJid: "120363394083049638@g.us",
  timezone: "America/Caracas",
};

// ─── Factory ───────────────────────────────────────────────────────────────

export interface CronConfigDeps {
  /** Path to the JSON config file */
  configPath: string;
}

const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export const makeCronConfig = (deps: CronConfigDeps) => {
  // ─── Read ──────────────────────────────────────────────────────────

  const read = async (): Promise<Result<CronConfig, string>> => {
    try {
      const content = await readFile(deps.configPath, "utf-8");
      return normalizeCronConfig(JSON.parse(content));
    } catch (error) {
      if (isNotFoundError(error)) {
        // File doesn't exist yet — return defaults
        return success({
          ...DEFAULT_CONFIG,
          targetJid: DEFAULT_CONFIG.targetJid,
        });
      }
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al leer configuración: ${reason}`);
    }
  };

  // ─── Write ─────────────────────────────────────────────────────────

  const write = async (config: CronConfig): Promise<Result<void, string>> => {
    try {
      const normalizedConfig = normalizeCronConfig(config);
      if (normalizedConfig.isFailure) {
        return failure(normalizedConfig.getError());
      }

      const json = JSON.stringify(normalizedConfig.getValue(), null, 2);
      await writeFile(deps.configPath, json, "utf-8");
      return success(undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al guardar configuración: ${reason}`);
    }
  };

  // ─── Get defaults ──────────────────────────────────────────────────

  const getDefaults = (): CronConfig => ({
    ...DEFAULT_CONFIG,
    morning: { ...DEFAULT_CONFIG.morning },
    night: { ...DEFAULT_CONFIG.night },
  });

  return { read, write, getDefaults };
};

/** Extract type from factory */
export type CronConfigManager = ReturnType<typeof makeCronConfig>;

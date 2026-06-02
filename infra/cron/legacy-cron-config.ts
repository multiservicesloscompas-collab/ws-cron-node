import { readFile } from "node:fs/promises";
import { failure, success, type Result } from "../../types/result.ts";
import { makeScheduleTime } from "../../domain/value-objects/schedule-time.ts";

const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export interface LegacyCronEntryConfig {
  time: string;
  days: string;
  message: string;
  enabled: boolean;
}

export interface LegacyCronConfig {
  morning: LegacyCronEntryConfig;
  night: LegacyCronEntryConfig;
  targetJid: string;
  timezone: string;
}

export const DEFAULT_LEGACY_CRON_CONFIG: LegacyCronConfig = {
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

const normalizeEntry = (
  value: unknown,
  defaults: LegacyCronEntryConfig,
): LegacyCronEntryConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const raw = value as Partial<LegacyCronEntryConfig>;

  return {
    time: typeof raw.time === "string" ? raw.time : defaults.time,
    days: typeof raw.days === "string" ? raw.days : defaults.days,
    message: typeof raw.message === "string" ? raw.message : defaults.message,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
  };
};

export const normalizeLegacyCronConfig = (
  value: unknown,
): Result<LegacyCronConfig, string> => {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<LegacyCronConfig>
    : {};

  const config: LegacyCronConfig = {
    morning: normalizeEntry(raw.morning, DEFAULT_LEGACY_CRON_CONFIG.morning),
    night: normalizeEntry(raw.night, DEFAULT_LEGACY_CRON_CONFIG.night),
    targetJid: typeof raw.targetJid === "string"
      ? raw.targetJid
      : DEFAULT_LEGACY_CRON_CONFIG.targetJid,
    timezone: typeof raw.timezone === "string"
      ? raw.timezone
      : DEFAULT_LEGACY_CRON_CONFIG.timezone,
  };

  const morningTime = makeScheduleTime(config.morning.time);
  if (morningTime.isFailure) return failure(morningTime.getError());

  const nightTime = makeScheduleTime(config.night.time);
  if (nightTime.isFailure) return failure(nightTime.getError());

  return success(config);
};

export const readLegacyCronConfig = async (
  configPath: string,
): Promise<Result<LegacyCronConfig, string>> => {
  try {
    const raw = await readFile(configPath, "utf-8");
    return normalizeLegacyCronConfig(JSON.parse(raw));
  } catch (error) {
    if (isNotFoundError(error)) {
      return success(DEFAULT_LEGACY_CRON_CONFIG);
    }

    const reason = error instanceof Error ? error.message : String(error);
    return failure(`Error al leer configuración legacy: ${reason}`);
  }
};

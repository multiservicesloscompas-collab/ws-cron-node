import { failure, success, type Result } from "../../types/result.ts";

export interface AppSettings {
  defaultTargetJid: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettingsInput {
  defaultTargetJid: string;
  timezone: string;
}

export const normalizeAppSettingsInput = (
  value: unknown,
): Result<AppSettingsInput, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failure("Se requiere un objeto de configuración válido");
  }

  const raw = value as Record<string, unknown>;
  const defaultTargetJid = typeof raw.defaultTargetJid === "string"
    ? raw.defaultTargetJid.trim()
    : "";
  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "";

  if (!timezone) {
    return failure("La zona horaria es obligatoria");
  }

  return success({ defaultTargetJid, timezone });
};

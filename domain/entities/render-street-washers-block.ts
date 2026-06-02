import type { WasherRental } from "./washer-rental.ts";
import {
  formatStreetWasherForWhatsApp,
  isStreetWasherPending,
} from "./washer-rental.ts";

const CARACAS_TIME_ZONE = "America/Caracas";
const STREET_WASHERS_EMPTY_STATE = "No hay lavadoras pendientes por ahora";
const STREET_WASHERS_PENDING_HEADER = "🧺 *Lavadoras Pendientes:*";
const STREET_WASHERS_ALERT_HEADER = "⚠️ **Qué paso con el retiro de ?:**";
const STREET_WASHERS_LATE_PAYMENT_HEADER = "🚨 *Pago retrasado:*";
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const TEMPORARY_HIDDEN_STREET_WASHER = {
  name: "Mary Meléndez",
  address: "San Bernardino",
};

const normalizeTemporaryHiddenStreetWasherValue = (
  value: string | null | undefined,
): string => {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
};

export interface StreetWashersReference {
  date: string;
  time: string;
}

export const getStreetWashersReferenceFromDate = (
  referenceDate = new Date(),
): StreetWashersReference => getCaracasNowParts(referenceDate);

const getCaracasNowParts = (
  referenceDate = new Date(),
): {
  date: string;
  time: string;
} => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CARACAS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(referenceDate);
  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    time: `${getPart("hour")}:${getPart("minute")}`,
  };
};

const normalizePickupTime = (pickupTime: string | null): string | null => {
  if (!pickupTime) return null;

  const twelveHourMatch = pickupTime
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (twelveHourMatch) {
    const [, hoursText, minutes, period] = twelveHourMatch;
    const hours = Number(hoursText);
    const normalizedHours =
      period.toUpperCase() === "PM" ? (hours % 12) + 12 : hours % 12;

    return `${String(normalizedHours).padStart(2, "0")}:${minutes}`;
  }

  const twentyFourHourMatch = pickupTime
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!twentyFourHourMatch) return null;

  const [, hoursText, minutes] = twentyFourHourMatch;
  return `${hoursText.padStart(2, "0")}:${minutes}`;
};

const getComparableTimestamp = (
  pickupDate: string | null,
  pickupTime: string | null,
): number | null => {
  const normalizedPickupTime = normalizePickupTime(pickupTime);
  if (!pickupDate || !normalizedPickupTime) return null;

  const [year, month, day] = pickupDate.split("-").map(Number);
  const [hours, minutes] = normalizedPickupTime.split(":").map(Number);

  if ([year, month, day, hours, minutes].some(Number.isNaN)) return null;

  return Date.UTC(year, month - 1, day, hours, minutes);
};

const getReferenceTimestamp = (reference?: StreetWashersReference): number => {
  const currentReference = reference || getCaracasNowParts();
  return (
    getComparableTimestamp(currentReference.date, currentReference.time) ||
    Date.now()
  );
};

const isOverduePaidNotFinalized = (
  rental: WasherRental,
  reference?: StreetWashersReference,
): boolean => {
  if (!rental.isPaid || rental.status === "finalizado" || !rental.pickupDate)
    return false;

  const pickupTimestamp = getComparableTimestamp(
    rental.pickupDate,
    rental.pickupTime,
  );
  if (pickupTimestamp === null) return false;

  return pickupTimestamp <= getReferenceTimestamp(reference);
};

const isLatePaymentStreetWasher = (
  rental: WasherRental,
  reference?: StreetWashersReference,
): boolean => {
  if (rental.isPaid) return false;

  const pickupTimestamp = getComparableTimestamp(
    rental.pickupDate,
    rental.pickupTime,
  );
  if (pickupTimestamp === null) return false;

  return getReferenceTimestamp(reference) - pickupTimestamp > ONE_DAY_IN_MS;
};

const formatOverdueStreetWasherAlert = (rental: WasherRental): string => {
  const customerName = rental.customer?.name || "Cliente desconocido";
  const address = rental.customer?.address || "Sin dirección registrada";
  const pickupLabel = [rental.pickupDate, rental.pickupTime]
    .filter(Boolean)
    .join(" ");

  return [
    `${customerName} - ${address}`,
    `⚠️ OJO: retiro vencido ${pickupLabel} - Pagado ✅ - Falta finalizar`,
  ].join("\n");
};

const formatLatePaymentStreetWasherAlert = (rental: WasherRental): string => {
  const customerName = rental.customer?.name || "Cliente desconocido";
  const address = rental.customer?.address || "Sin dirección registrada";
  const pickupLabel = [rental.pickupDate, rental.pickupTime]
    .filter(Boolean)
    .join(" ");

  return [
    `${customerName} - ${address}`,
    `⚠️ Pendiente desde ${pickupLabel}`,
  ].join("\n");
};

const shouldHideStreetWasherTemporarily = (rental: WasherRental): boolean => {
  const customerName = normalizeTemporaryHiddenStreetWasherValue(
    rental.customer?.name,
  );
  const address = normalizeTemporaryHiddenStreetWasherValue(
    rental.customer?.address,
  );

  return (
    customerName ===
      normalizeTemporaryHiddenStreetWasherValue(
        TEMPORARY_HIDDEN_STREET_WASHER.name,
      ) &&
    address ===
      normalizeTemporaryHiddenStreetWasherValue(
        TEMPORARY_HIDDEN_STREET_WASHER.address,
      )
  );
};

export const renderStreetWashersBlock = (
  rentals: WasherRental[],
  reference?: StreetWashersReference,
): string => {
  // TODO: eliminar este filtro temporal cuando Mary Meléndez de San Bernardino deba volver a aparecer.
  const visibleRentals = rentals.filter(
    (rental) => !shouldHideStreetWasherTemporarily(rental),
  );

  const latePaymentAlerts = visibleRentals.filter((rental) =>
    isLatePaymentStreetWasher(rental, reference),
  );
  const overdueAlerts = visibleRentals.filter((rental) =>
    isOverduePaidNotFinalized(rental, reference),
  );
  const pendingRentals = visibleRentals.filter(
    (rental) =>
      isStreetWasherPending(rental) &&
      !isOverduePaidNotFinalized(rental, reference) &&
      !isLatePaymentStreetWasher(rental, reference),
  );

  const parts: string[] = [];

  if (pendingRentals.length > 0) {
    parts.push(
      STREET_WASHERS_PENDING_HEADER,
      "",
      pendingRentals.map(formatStreetWasherForWhatsApp).join("\n\n"),
    );
  }

  if (overdueAlerts.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push(
      STREET_WASHERS_ALERT_HEADER,
      "",
      overdueAlerts.map(formatOverdueStreetWasherAlert).join("\n\n"),
    );
  }

  if (latePaymentAlerts.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push(
      STREET_WASHERS_LATE_PAYMENT_HEADER,
      "",
      latePaymentAlerts.map(formatLatePaymentStreetWasherAlert).join("\n\n"),
    );
  }

  if (parts.length === 0) return STREET_WASHERS_EMPTY_STATE;

  return parts.join("\n");
};

export const renderStreetWashersFailureBlock = (): string => {
  return [
    "⚠️ No se pudo consultar las lavadoras pendientes en la calle.",
    "Por favor revisen el sistema antes de salir.",
  ].join("\n");
};

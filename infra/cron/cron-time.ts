export interface ZonedDateParts {
  date: string;
  dayOfWeek: number;
  time: string;
}

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const getZonedDateParts = (
  timezone: string,
  date = new Date(),
): ZonedDateParts => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dayOfWeek: WEEKDAY_TO_NUMBER[get("weekday")] ?? date.getDay(),
    time: `${get("hour")}:${get("minute")}`,
  };
};

export const isDayMatch = (daysExpr: string, dayOfWeek: number): boolean => {
  if (daysExpr === "*") return true;

  for (const part of daysExpr.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map(Number);
      if (dayOfWeek >= start && dayOfWeek <= end) return true;
      continue;
    }

    if (Number(trimmed) === dayOfWeek) return true;
  }

  return false;
};

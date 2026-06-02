/**
 * Sales Report Service — Builds the night message with daily sales summary.
 *
 * Combines data from the sales repository and exchange rate repository
 * into a formatted WhatsApp message for the team.
 *
 * @see docs/spec-whatsapp-service.md section 4.3
 */

import {
  failure,
  isFailure,
  type Result,
  success,
} from "../../types/result.ts";
import { formatCurrency } from "../entities/sale.ts";
import { renderPaymentCategorySummary } from "../entities/render-payment-category-summary.ts";
import type { SalesRepository } from "../../infra/supabase/make-sales-repository.ts";
import type { ExchangeRateRepository } from "../../infra/supabase/make-exchange-rate-repository.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SalesReportServiceDeps {
  salesRepo: SalesRepository;
  exchangeRateRepo: ExchangeRateRepository;
}

export interface SalesReportService {
  /**
   * Builds the complete night message for a given date.
   */
  buildNightMessage: (
    date: string,
    template?: string,
    time?: string,
  ) => Promise<Result<string, string>>;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const PAYMENT_METHOD_LINES = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "pago_movil", label: "📱 Pago Móvil" },
  { key: "punto_venta", label: "💳 Punto de Venta" },
  { key: "divisa", label: "💶 Divisa" },
] as const;

const getDateForTemplate = (date: string): Date => new Date(`${date}T12:00:00`);

const getDayName = (date: string): string => {
  const days = [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
  ];

  return days[getDateForTemplate(date).getDay()];
};

const replaceNightTemplateVariable = (
  template: string,
  key: string,
  value: string,
): string => template.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);

const renderNightTemplate = (
  template: string,
  values: Record<string, string>,
): string => {
  return Object.keys(values).reduce(
    (message, key) => replaceNightTemplateVariable(message, key, values[key]),
    template,
  );
};

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeSalesReportService = (
  deps: SalesReportServiceDeps,
): SalesReportService => {
  const buildNightMessage = async (
    date: string,
    template?: string,
    time?: string,
  ): Promise<Result<string, string>> => {
    // Get sales data
    const salesResult = await deps.salesRepo.getTodaySales(date);
    if (isFailure(salesResult)) return failure(salesResult.getError());

    const summary = salesResult.getValue();

    // Get exchange rate (non-fatal — service continues if it fails)
    const rateResult = await deps.exchangeRateRepo.getRateForDate(date);
    const exchangeRate = !isFailure(rateResult) ? rateResult.getValue() : null;

    // Build payment method lines
    const paymentLines = PAYMENT_METHOD_LINES.map(({ key, label }) => {
      const data = summary.byPaymentMethod[key];
      const bs = data ? data.bs : 0;
      return `${label}: ${formatCurrency(bs)} Bs`;
    });

    // Exchange rate line
    const rateLine = exchangeRate !== null
      ? `📊 Tasa del día: 1 USD = ${exchangeRate} Bs`
      : "📊 Tasa del día: No disponible";

    const paymentCategorySummary = renderPaymentCategorySummary(
      summary,
      exchangeRate,
    );

    // USD total with 2 decimal places
    const usdFormatted = summary.totalUsd.toFixed(2);

    // No-sales note
    const noSalesNote = summary.saleCount === 0
      ? "\nHoy no se registraron ventas."
      : "";

    const message = [
      `🌙 Buenas equipo, el día de hoy ${date} los montos registrados son:`,
      "",
      ...paymentLines,
      "",
      `💰 Total Bs: ${formatCurrency(summary.totalBs)} Bs`,
      `💵 Total USD: ${usdFormatted} USD`,
      "",
      rateLine,
      "",
      "Por favor, recordemos:",
      "✅ Desconectar la lámpara del agua",
      "✅ Dejar el local limpio y ordenado",
      "✅ Limpiar la mesa de trabajo y la cocina",
      noSalesNote,
      "¡Gracias por el esfuerzo de hoy! 🙌",
    ].filter(Boolean).join("\n");

    if (template) {
      return success(
        renderNightTemplate(template, {
          date,
          day: getDayName(date),
          time: time ?? "",
          total_bs: formatCurrency(summary.totalBs),
          total_usd: usdFormatted,
          exchange_rate: exchangeRate !== null
            ? String(exchangeRate)
            : "No disponible",
          efectivo_bs: formatCurrency(
            summary.byPaymentMethod.efectivo?.bs ?? 0,
          ),
          pago_movil_bs: formatCurrency(
            summary.byPaymentMethod.pago_movil?.bs ?? 0,
          ),
          punto_venta_bs: formatCurrency(
            summary.byPaymentMethod.punto_venta?.bs ?? 0,
          ),
          divisa_bs: formatCurrency(summary.byPaymentMethod.divisa?.bs ?? 0),
          payment_category_summary: paymentCategorySummary,
        }),
      );
    }

    return success(message);
  };

  return { buildNightMessage };
};

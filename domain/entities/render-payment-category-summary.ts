import { formatCurrency, type DailySalesSummary } from "./sale.ts";
import type { PaymentMethod } from "../value-objects/payment-method.ts";

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  pago_movil: "Pago móvil",
  punto_venta: "Punto de venta",
  divisa: "Divisas",
};

const PAYMENT_METHOD_ORDER: PaymentMethod[] = [
  "efectivo",
  "pago_movil",
  "punto_venta",
  "divisa",
];

const formatDecimal = (value: number): string => {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatUsdAmount = (value: number): string => `$ ${formatDecimal(value)}`;

const formatRateLine = (exchangeRate: number | null): string => {
  return exchangeRate !== null && exchangeRate > 0
    ? `• 1 USD = ${formatDecimal(exchangeRate)} Bs`
    : "• No disponible";
};

const formatConvertedUsd = (
  amountBs: number,
  exchangeRate: number | null,
): string => {
  if (exchangeRate === null || exchangeRate <= 0) return "No disponible";
  return formatUsdAmount(amountBs / exchangeRate);
};

const formatMovementAmount = (
  method: PaymentMethod,
  amountBs: number,
  amountUsd: number,
): string => {
  if (method === "divisa") return formatUsdAmount(amountUsd);
  return `${formatCurrency(amountBs)} Bs`;
};

const renderExpenseSection = (summary: DailySalesSummary): string[] => {
  if (summary.expenseItems.length === 0) return ["• Sin egresos registrados"];

  return summary.expenseItems.map((item) =>
    `• ${formatCurrency(item.amountBs)} Bs (${item.label})`
  );
};

const renderMovementSection = (
  summary: DailySalesSummary,
  type: "equilibrio" | "avance",
): string[] => {
  const filteredMovements = summary.balanceMovements.filter((movement) =>
    movement.operationType === type
  );

  if (filteredMovements.length === 0) {
    return [type === "equilibrio"
      ? "• Sin equilibrios registrados"
      : "• Sin avances registrados"];
  }

  return filteredMovements.flatMap((movement) => {
    const lines = [
      `• ${PAYMENT_METHOD_LABELS[movement.fromMethod]} -> ${PAYMENT_METHOD_LABELS[movement.toMethod]}`,
      `  ${formatMovementAmount(movement.fromMethod, movement.amountOutBs, movement.amountOutUsd)} -> ${formatMovementAmount(movement.toMethod, movement.amountInBs, movement.amountInUsd)}`,
    ];

    if (movement.note) lines.push(`  ${movement.note}`);

    return lines;
  });
};

export const renderPaymentCategorySummary = (
  summary: DailySalesSummary,
  exchangeRate: number | null,
): string => {
  const grossIncomeBs = summary.totalBs;
  const netIncomeBs = grossIncomeBs - summary.totalExpensesBs;

  return [
    "📈 Tasa del día",
    formatRateLine(exchangeRate),
    "",
    "💵 INGRESOS POR PAGO",
    ...PAYMENT_METHOD_ORDER.map((method) => {
      if (method === "divisa") {
        return `• ${PAYMENT_METHOD_LABELS[method]}: ${formatUsdAmount(summary.byPaymentMethod.divisa?.usd ?? 0)}`;
      }

      return `• ${PAYMENT_METHOD_LABELS[method]}: ${formatCurrency(summary.byPaymentMethod[method]?.bs ?? 0)} Bs`;
    }),
    "",
    "📤 EGRESOS",
    ...renderExpenseSection(summary),
    "",
    "⚖️ EQUILIBRIOS",
    ...renderMovementSection(summary, "equilibrio"),
    "",
    "🔁 AVANCES",
    ...renderMovementSection(summary, "avance"),
    "",
    "📊 CIERRE DEL DÍA",
    `• Ingreso bruto: ${formatCurrency(grossIncomeBs)} Bs | ${formatConvertedUsd(grossIncomeBs, exchangeRate)}`,
    `• Ingreso neto: ${formatCurrency(netIncomeBs)} Bs | ${formatConvertedUsd(netIncomeBs, exchangeRate)}`,
  ].join("\n");
};

/**
 * Tests for makeSalesReportService factory.
 *
 * @see domain/services/make-sales-report-service.ts
 */

import { assert, assertEquals } from "#test-assert";
import { makeSalesReportService } from "../make-sales-report-service.ts";
import { failure, isFailure, success } from "../../../types/result.ts";
import type { DailySalesSummary } from "../../entities/sale.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

const createMockSalesRepo = (
  summary: DailySalesSummary | null,
  error: string | null = null,
) => ({
  getTodaySales: async (_date: string) =>
    error ? failure(error) : success(summary!),
});

const createMockExchangeRateRepo = (
  rate: number | null,
  error: string | null = null,
) => ({
  getRateForDate: async (_date: string) =>
    error ? failure(error) : success(rate),
});

const allMethodsSummary: DailySalesSummary = {
  totalBs: 6500,
  totalUsd: 65,
  byPaymentMethod: {
    efectivo: { count: 3, bs: 2500, usd: 25 },
    pago_movil: { count: 2, bs: 2000, usd: 20 },
    punto_venta: { count: 1, bs: 1500, usd: 15 },
    divisa: { count: 1, bs: 500, usd: 5 },
  },
  exchangeRate: 100,
  saleCount: 7,
  expenseItems: [
    { label: "Gasolina", amountBs: 1750 },
    { label: "Propinas", amountBs: 3200 },
  ],
  totalExpensesBs: 4950,
  balanceMovements: [
    {
      operationType: "equilibrio",
      fromMethod: "pago_movil",
      toMethod: "efectivo",
      amount: 700,
      amountOutBs: 700,
      amountOutUsd: 0,
      amountInBs: 700,
      amountInUsd: 0,
      note: "Cambio de caja",
    },
    {
      operationType: "avance",
      fromMethod: "pago_movil",
      toMethod: "efectivo",
      amount: 700,
      amountOutBs: 700,
      amountOutUsd: 0,
      amountInBs: 600,
      amountInUsd: 0,
      note: null,
    },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

Deno.test(
  "1. buildNightMessage formats message with all payment methods",
  async () => {
    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(allMethodsSummary),
      exchangeRateRepo: createMockExchangeRateRepo(100),
    });

    const result = await service.buildNightMessage("2024-01-15");

    assert(!isFailure(result), "Result should be success");
    const message = result.getValue();

    assert(message.includes("2024-01-15"), "Should include date");
    assert(
      message.includes("💵 Efectivo: 2.500 Bs"),
      "Should include efectivo",
    );
    assert(
      message.includes("📱 Pago Móvil: 2.000 Bs"),
      "Should include pago_movil",
    );
    assert(
      message.includes("💳 Punto de Venta: 1.500 Bs"),
      "Should include punto_venta",
    );
    assert(message.includes("💶 Divisa: 500 Bs"), "Should include divisa");
    assert(message.includes("💰 Total Bs: 6.500 Bs"), "Should include total");
    assert(
      message.includes("💵 Total USD: 65.00 USD"),
      "Should include USD total",
    );
    assert(
      message.includes("📊 Tasa del día: 1 USD = 100 Bs"),
      "Should include rate",
    );
    assert(
      message.includes("¡Gracias por el esfuerzo de hoy! 🙌"),
      "Should include closing",
    );
  },
);

Deno.test(
  "2. buildNightMessage shows all zeros and no-sales note when no sales",
  async () => {
    const emptySummary: DailySalesSummary = {
      totalBs: 0,
      totalUsd: 0,
      byPaymentMethod: {},
      exchangeRate: null,
      saleCount: 0,
      expenseItems: [],
      totalExpensesBs: 0,
      balanceMovements: [],
    };

    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(emptySummary),
      exchangeRateRepo: createMockExchangeRateRepo(null),
    });

    const result = await service.buildNightMessage("2024-01-15");

    assert(!isFailure(result), "Result should be success");
    const message = result.getValue();

    assert(message.includes("💵 Efectivo: 0 Bs"), "Should show 0 for efectivo");
    assert(
      message.includes("📱 Pago Móvil: 0 Bs"),
      "Should show 0 for pago_movil",
    );
    assert(
      message.includes("💳 Punto de Vent") || message.includes("0 Bs"),
      "Should show 0",
    );
    assert(message.includes("💰 Total Bs: 0 Bs"), "Should show total 0");
    assert(message.includes("💵 Total USD: 0.00 USD"), "Should show USD 0");
    assert(
      message.includes("📊 Tasa del día: No disponible"),
      "Should show no rate",
    );
    assert(
      message.includes("Hoy no se registraron ventas."),
      "Should include no-sales note",
    );
  },
);

Deno.test(
  '3. buildNightMessage shows "No disponible" when no exchange rate',
  async () => {
    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(allMethodsSummary),
      exchangeRateRepo: createMockExchangeRateRepo(null),
    });

    const result = await service.buildNightMessage("2024-01-15");

    assert(!isFailure(result), "Result should be success");
    const message = result.getValue();

    assert(
      message.includes("📊 Tasa del día: No disponible"),
      "Should show no rate",
    );
    // Should still include sales data
    assert(message.includes("💰 Total Bs: 6.500 Bs"), "Should include total");
  },
);

Deno.test(
  "4. buildNightMessage returns failure when sales repo fails",
  async () => {
    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(null, "Database connection failed"),
      exchangeRateRepo: createMockExchangeRateRepo(100),
    });

    const result = await service.buildNightMessage("2024-01-15");

    assert(isFailure(result), "Result should be failure");
    assert(
      result.getError().includes("Database connection failed"),
      "Should propagate error",
    );
  },
);

Deno.test(
  "5. buildNightMessage includes reminder checklist items",
  async () => {
    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(allMethodsSummary),
      exchangeRateRepo: createMockExchangeRateRepo(100),
    });

    const result = await service.buildNightMessage("2024-01-15");

    assert(!isFailure(result), "Result should be success");
    const message = result.getValue();

    assert(
      message.includes("✅ Desconectar la lámpara del agua"),
      "Should include lamp reminder",
    );
    assert(
      message.includes("✅ Dejar el local limpio y ordenado"),
      "Should include cleanup reminder",
    );
    assert(
      message.includes("✅ Limpiar la mesa de trabajo y la cocina"),
      "Should include table reminder",
    );
  },
);

Deno.test(
  "6. buildNightMessage renders current draft template variables for manual tests",
  async () => {
    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(allMethodsSummary),
      exchangeRateRepo: createMockExchangeRateRepo(100),
    });

    const result = await service.buildNightMessage(
      "2024-01-15",
      "Cierre {{date}} {{day}} {{time}} | Bs {{total_bs}} | USD {{total_usd}} | PM {{pago_movil_bs}}",
      "19:30",
    );

    assert(!isFailure(result), "Result should be success");
    const message = result.getValue();

    assert(message.includes("2024-01-15"), "Should include date variable");
    assert(message.includes("lunes"), "Should include day variable");
    assert(message.includes("19:30"), "Should include provided time variable");
    assert(message.includes("Bs 6.500"), "Should include total bs variable");
    assert(message.includes("USD 65.00"), "Should include total usd variable");
    assert(
      message.includes("PM 2.000"),
      "Should include payment split variable",
    );
  },
);

Deno.test(
  "7. buildNightMessage leaves time empty when custom nightly template omits zoned time",
  async () => {
    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(allMethodsSummary),
      exchangeRateRepo: createMockExchangeRateRepo(100),
    });

    const result = await service.buildNightMessage(
      "2024-01-15",
      "Hora {{time}}",
    );

    assert(!isFailure(result), "Result should be success");
    assertEquals(result.getValue(), "Hora ");
  },
);

Deno.test(
  "8. buildNightMessage renders payment_category_summary with requested section order",
  async () => {
    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(allMethodsSummary),
      exchangeRateRepo: createMockExchangeRateRepo(90),
    });

    const result = await service.buildNightMessage(
      "2024-01-15",
      "{{payment_category_summary}}",
    );

    assert(!isFailure(result), "Result should be success");
    const message = result.getValue();

    assert(message.startsWith("📈 Tasa del día"), "Should start with rate section");
    assert(message.includes("• 1 USD = 90,00 Bs"), "Should format daily rate first");
    assert(message.includes("💵 INGRESOS POR PAGO"), "Should include payment section");
    assert(message.includes("• Efectivo: 2.500 Bs"), "Should include efectivo total");
    assert(message.includes("• Divisas: $ 5,00"), "Should show divisa in USD");
    assert(message.includes("📤 EGRESOS"), "Should include expenses section");
    assert(message.includes("• 1.750 Bs (Gasolina)"), "Should include expense item");
    assert(message.includes("• 3.200 Bs (Propinas)"), "Should include tips item");
    assert(message.includes("⚖️ EQUILIBRIOS"), "Should include equilibrio section");
    assert(
      message.includes("• Pago móvil -> Efectivo\n  700 Bs -> 700 Bs\n  Cambio de caja"),
      "Should render equilibrio in multiline format",
    );
    assert(message.includes("🔁 AVANCES"), "Should include avance section");
    assert(
      message.includes("• Pago móvil -> Efectivo\n  700 Bs -> 600 Bs"),
      "Should render avance amounts",
    );
    assert(message.includes("📊 CIERRE DEL DÍA"), "Should include closing section");
    assert(
      message.includes("• Ingreso bruto: 6.500 Bs | $ 72,22"),
      "Should include gross income conversion",
    );
    assert(
      message.includes("• Ingreso neto: 1.550 Bs | $ 17,22"),
      "Should include net income minus expenses",
    );
  },
);

Deno.test(
  '9. buildNightMessage keeps payment_category_summary useful when exchange rate is unavailable',
  async () => {
    const summaryWithoutExtras: DailySalesSummary = {
      totalBs: 1000,
      totalUsd: 0,
      byPaymentMethod: {
        efectivo: { count: 1, bs: 1000, usd: 0 },
      },
      exchangeRate: null,
      saleCount: 1,
      expenseItems: [],
      totalExpensesBs: 0,
      balanceMovements: [],
    };

    const service = makeSalesReportService({
      salesRepo: createMockSalesRepo(summaryWithoutExtras),
      exchangeRateRepo: createMockExchangeRateRepo(null),
    });

    const result = await service.buildNightMessage(
      "2024-01-15",
      "{{payment_category_summary}}",
    );

    assert(!isFailure(result), "Result should be success");
    const message = result.getValue();

    assert(message.includes("• No disponible"), "Should show unavailable rate line");
    assert(
      message.includes("• Sin egresos registrados"),
      "Should show empty expenses fallback",
    );
    assert(
      message.includes("• Sin equilibrios registrados"),
      "Should show empty equilibrio fallback",
    );
    assert(
      message.includes("• Sin avances registrados"),
      "Should show empty avance fallback",
    );
    assert(
      message.includes("• Ingreso bruto: 1.000 Bs | No disponible"),
      "Should preserve gross total without conversion",
    );
    assert(
      message.includes("• Ingreso neto: 1.000 Bs | No disponible"),
      "Should preserve net total without conversion",
    );
  },
);

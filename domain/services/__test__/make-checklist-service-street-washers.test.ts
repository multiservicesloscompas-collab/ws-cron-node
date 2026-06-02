import { assert, assertEquals, assertStringIncludes } from "#test-assert";
import { makeChecklistService } from "../make-checklist-service.ts";
import { success, failure, isFailure } from "../../../types/result.ts";
import type { WasherRental } from "../../entities/washer-rental.ts";

const MORNING_SEND_REFERENCE = new Date("2024-01-15T12:30:00.000Z");

const createMockRentalsRepo = (
  rentals: WasherRental[] | null,
  error: string | null = null,
  streetWashers: WasherRental[] | null = rentals,
) => ({
  getPendingPickups: async () => (error ? failure(error) : success(rentals!)),
  getActiveRentalsForDate: async () => failure("not mocked"),
  getUnpaidRentals: async () => failure("not mocked"),
  getAllActiveRentals: async () => failure("not mocked"),
  getStreetWashers: async () =>
    error ? failure(error) : success(streetWashers!),
});

const createSampleRental = (
  overrides: Partial<WasherRental> = {},
): WasherRental => ({
  id: "rental-1",
  date: "2024-01-15",
  machineId: "machine-1",
  machineLabel: "Lavadora 1",
  shift: "completo",
  status: "enviado",
  deliveryTime: null,
  pickupTime: "3:00 PM",
  pickupDate: "2024-01-15",
  deliveryFee: null,
  totalUsd: 6,
  isPaid: true,
  paymentMethod: "efectivo",
  datePaid: null,
  notes: null,
  customer: {
    id: "cust-1",
    name: "María Pérez",
    phone: null,
    address: "Calle Principal #24, PB",
  },
  ...overrides,
});

Deno.test(
  "5. buildMorningMessage injects {{street_washers}} block when present",
  async () => {
    const pendingPickups = [
      createSampleRental({
        id: "pickup-1",
        machineLabel: "Nº 3",
        customer: {
          id: "pickup-c1",
          name: "Ana Gómez",
          phone: null,
          address: "Calle 1",
        },
        pickupTime: "2:00 PM",
        isPaid: true,
      }),
    ];

    const streetWashers = [
      createSampleRental({
        id: "street-1",
        status: "finalizado",
        isPaid: false,
        customer: {
          id: "c1",
          name: "María Pérez",
          phone: null,
          address: "Calle Principal #24, PB",
        },
      }),
      createSampleRental({
        id: "street-2",
        status: "enviado",
        isPaid: true,
        pickupTime: "3:00 PM",
        customer: {
          id: "c2",
          name: "Juan García",
          phone: null,
          address: "Av. Los Ilustres",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo(pendingPickups, null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "🌞 {{day}}\n\n{{street_washers}}\n\nExtra note",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assert(
      message.startsWith("🌞 lunes"),
      "Should preserve custom template prefix and placement",
    );
    assertStringIncludes(message, "Extra note");
    assert(
      message.indexOf("María Pérez - Calle Principal #24, PB") <
        message.indexOf("Extra note"),
      "Street washers block should stay where template placed it",
    );
    assert(
      !message.includes("Recordemos hoy:"),
      "Should not append checklist to custom placeholder template",
    );
    assert(
      !message.includes("Ana Gómez"),
      "Should not append pending pickups outside the custom template",
    );
    assert(
      !message.includes("Lavadoras en la calle"),
      "Should not include removed street washers header",
    );
    assert(
      message.includes("María Pérez - Calle Principal #24, PB"),
      "Should include finalized unpaid rental",
    );
    assert(
      message.includes("Retiro hecho ✅ - 🚨Pago pendiente🚨"),
      "Should render finalized unpaid state",
    );
    assertStringIncludes(message, "🧺 *Lavadoras Pendientes:*");
    assert(
      message.includes("Juan García - Av. Los Ilustres"),
      "Should include sent paid rental",
    );
    assert(
      message.includes("Retirar 3:00 PM - Pagado ✅"),
      "Should keep same-day later pickup in regular list during morning send",
    );
    assert(
      !message.includes("OJO con estas lavadoras pagadas:"),
      "Should not mark same-day later pickup as overdue during morning send",
    );
    assert(
      !message.includes("¡A darle con toda!"),
      "Should not append closing to custom placeholder template",
    );
  },
);

Deno.test(
  "6. buildMorningMessage returns only rendered {{street_washers}} block for placeholder-only template",
  async () => {
    const streetWashers = [
      createSampleRental({
        id: "street-1",
        status: "enviado",
        pickupTime: "1:00 PM",
        isPaid: false,
        customer: {
          id: "street-c1",
          name: "Luisa Toro",
          phone: null,
          address: "Av. Bolívar",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "{{street_washers}}",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assertEquals(
      message,
      "🧺 *Lavadoras Pendientes:*\n\nLuisa Toro - Av. Bolívar\nRetirar 1:00 PM - 🚨Pago pendiente🚨",
    );
    assert(
      !message.includes("Recordemos hoy:"),
      "Should not append checklist to placeholder-only template",
    );
    assert(
      !message.includes("¡A darle con toda!"),
      "Should not append closing to placeholder-only template",
    );
  },
);

Deno.test(
  "7. buildMorningMessage preserves custom template text without appending checklist",
  async () => {
    const streetWashers = [
      createSampleRental({
        id: "street-1",
        status: "enviado",
        pickupTime: "1:00 PM",
        customer: {
          id: "street-c1",
          name: "Luisa Toro",
          phone: null,
          address: "Av. Bolívar",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "Inicio personalizado\n\n{{street_washers}}\n\nCierre intermedio",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assert(
      message.startsWith("Inicio personalizado"),
      "Should keep custom template text",
    );
    assert(
      message.includes("Cierre intermedio"),
      "Should keep trailing custom text",
    );
    assertStringIncludes(message, "🧺 *Lavadoras Pendientes:*");
    assert(
      !message.includes("Recordemos hoy:"),
      "Should not append checklist when using custom street washer template",
    );
    assertStringIncludes(message, "Luisa Toro - Av. Bolívar");
    assert(
      !message.includes("¡A darle con toda!"),
      "Should not append closing when template is custom",
    );
  },
);

Deno.test(
  "7.1 buildMorningMessage hides Mary Meléndez from San Bernardino despite casing, accents, or extra spaces",
  async () => {
    const streetWashers = [
      createSampleRental({
        id: "street-hidden",
        status: "enviado",
        pickupTime: "1:00 PM",
        isPaid: false,
        customer: {
          id: "street-hidden-c1",
          name: "  mary melendez  ",
          phone: null,
          address: "  SAN   BERNARDINO  ",
        },
      }),
      createSampleRental({
        id: "street-visible",
        status: "enviado",
        pickupTime: "2:00 PM",
        isPaid: false,
        customer: {
          id: "street-visible-c1",
          name: "Luisa Toro",
          phone: null,
          address: "Av. Bolívar",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "{{street_washers}}",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assert(!message.includes("Mary Meléndez - San Bernardino"));
    assertStringIncludes(message, "Luisa Toro - Av. Bolívar");
  },
);

Deno.test(
  "8. buildMorningMessage shows empty {{street_washers}} block when there are no pending street washers",
  async () => {
    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, []),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "Inicio\n\n{{street_washers}}",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assertEquals(message, "Inicio\n\nNo hay lavadoras pendientes por ahora");
  },
);

Deno.test(
  "9. buildMorningMessage shows failure {{street_washers}} block when query fails",
  async () => {
    const service = makeChecklistService({
      rentalsRepo: {
        getPendingPickups: async () => success([]),
        getActiveRentalsForDate: async () => failure("not mocked"),
        getUnpaidRentals: async () => failure("not mocked"),
        getAllActiveRentals: async () => failure("not mocked"),
        getStreetWashers: async () => failure("street washers timeout"),
      },
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "Inicio\n\n{{street_washers}}",
    );

    assert(
      !isFailure(result),
      "Result should be success with visible fallback block",
    );

    const message = result.getValue();
    assertStringIncludes(
      message,
      "⚠️ No se pudo consultar las lavadoras pendientes en la calle.",
    );
    assertStringIncludes(
      message,
      "Por favor revisen el sistema antes de salir.",
    );
    assert(
      !message.includes("No hay lavadoras pendientes por ahora"),
      "Should not show empty-state text on query failure",
    );
  },
);

Deno.test(
  "10. buildMorningMessage moves overdue paid non-finalized rentals into alert section",
  async () => {
    const streetWashers = [
      createSampleRental({
        id: "street-overdue",
        status: "enviado",
        isPaid: true,
        pickupDate: "2024-01-15",
        pickupTime: "7:00 AM",
        customer: {
          id: "street-c2",
          name: "Rosa Pérez",
          phone: null,
          address: "Calle Sucre",
        },
      }),
      createSampleRental({
        id: "street-normal",
        status: "enviado",
        isPaid: false,
        pickupDate: "2024-01-15",
        pickupTime: "5:00 PM",
        customer: {
          id: "street-c3",
          name: "Carlos Díaz",
          phone: null,
          address: "Av. Lara",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "{{street_washers}}",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assertStringIncludes(message, "Carlos Díaz - Av. Lara");
    assertStringIncludes(message, "Retirar 5:00 PM - 🚨Pago pendiente🚨");
    assertStringIncludes(message, "⚠️ **Qué paso con el retiro de ?:**");
    assertStringIncludes(message, "Rosa Pérez - Calle Sucre");
    assertStringIncludes(
      message,
      "⚠️ OJO: retiro vencido 2024-01-15 7:00 AM - Pagado ✅ - Falta finalizar",
    );
    assert(
      !message.includes(
        "Rosa Pérez - Calle Sucre\nRetirar 7:00 AM - Pagado ✅",
      ),
      "Overdue paid rental should not remain in normal street washer list",
    );
  },
);

Deno.test(
  "11. buildMorningMessage moves unpaid rentals overdue by more than 24 hours into late-payment section",
  async () => {
    const streetWashers = [
      createSampleRental({
        id: "street-late-payment",
        status: "finalizado",
        isPaid: false,
        pickupDate: "2024-01-14",
        pickupTime: "7:00 AM",
        customer: {
          id: "street-c4",
          name: "Elena Mora",
          phone: null,
          address: "Av. Fuerzas Armadas",
        },
      }),
      createSampleRental({
        id: "street-normal",
        status: "enviado",
        isPaid: false,
        pickupDate: "2024-01-15",
        pickupTime: "5:00 PM",
        customer: {
          id: "street-c5",
          name: "Pedro León",
          phone: null,
          address: "Calle Páez",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "{{street_washers}}",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assertStringIncludes(message, "Pedro León - Calle Páez");
    assertStringIncludes(message, "Retirar 5:00 PM - 🚨Pago pendiente🚨");
    assertStringIncludes(message, "🧺 *Lavadoras Pendientes:*");
    assertStringIncludes(message, "🚨 *Pago retrasado:*");
    assertStringIncludes(message, "Elena Mora - Av. Fuerzas Armadas");
    assertStringIncludes(
      message,
      "⚠️ Pendiente desde 2024-01-14 7:00 AM",
    );
    assert(
      !message.includes(
        "Elena Mora - Av. Fuerzas Armadas\nRetiro hecho ✅ - 🚨Pago pendiente🚨",
      ),
      "Late-payment rental should not remain in normal street washer list",
    );
  },
);

Deno.test(
  "12. buildMorningMessage keeps unpaid rentals within first 24 overdue hours in normal list",
  async () => {
    const streetWashers = [
      createSampleRental({
        id: "street-not-late-yet",
        status: "enviado",
        isPaid: false,
        pickupDate: "2024-01-14",
        pickupTime: "1:00 PM",
        customer: {
          id: "street-c6",
          name: "Nora Gil",
          phone: null,
          address: "Av. Libertador",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "{{street_washers}}",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assertEquals(
      message,
      "🧺 *Lavadoras Pendientes:*\n\nNora Gil - Av. Libertador\nRetirar 1:00 PM - 🚨Pago pendiente🚨",
    );
    assert(
      !message.includes("🚨 *Pago retrasado:*"),
      "Should not move rental before it is more than 24 hours overdue",
    );
  },
);

Deno.test(
  "13. buildMorningMessage keeps paid non-finalized rentals before pickup time in normal list",
  async () => {
    const streetWashers = [
      createSampleRental({
        id: "street-paid-scheduled",
        status: "agendado",
        isPaid: true,
        pickupDate: "2024-01-15",
        pickupTime: "1:00 PM",
        customer: {
          id: "street-c7",
          name: "Laura Rivas",
          phone: null,
          address: "Calle Comercio",
        },
      }),
    ];

    const service = makeChecklistService({
      rentalsRepo: createMockRentalsRepo([], null, streetWashers),
    });

    const result = await service.buildMorningMessage(
      "2024-01-15",
      "{{street_washers}}",
      MORNING_SEND_REFERENCE,
    );

    assert(!isFailure(result), "Result should be success");

    const message = result.getValue();
    assertEquals(
      message,
      "🧺 *Lavadoras Pendientes:*\n\nLaura Rivas - Calle Comercio\nRetirar 1:00 PM - Pagado ✅",
    );
    assert(
      !message.includes("⚠️ **Qué paso con el retiro de ?:**"),
      "Should keep rental in normal list before pickup time",
    );
  },
);

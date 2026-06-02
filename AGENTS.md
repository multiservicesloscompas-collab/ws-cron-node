# AGENTS.md — whatsapp-cron-manager-node

## Proyecto

**WhatsApp Bot — Multiservicio Los Compas**

Bot de WhatsApp para automatizar mensajes CRON:

- **Matutino (8:30 AM)**: Checklist diario + lavadoras pendientes de retiro
- **Nocturno (7:30 PM, Lun-Sáb)**: Reporte de ventas del día

## Stack

- **Runtime**: Node.js 22+ con TypeScript
- **App Layer**: servidor HTTP nativo de Node + Web UI local
- **WhatsApp**: Baileys vía WebSocket persistente
- **DB**: Supabase (lectura de negocio) + PostgreSQL interno
- **CRON**: scheduler propio del proyecto con timezone `America/Caracas`

## Mindset

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

## Reglas de Código (Obligatorias)

Cuando escribas o revises código en este proyecto, APLICA estas reglas:

### 1. Sin clases — todo con funciones

No uses `class`, `new`, `this`, ni `constructor`. Usa funciones, closures, y objetos planos.

### 2. Value Objects con `make*` factories

Cada primitiva de dominio tiene una fábrica que retorna `Result<T, E>`:

```typescript
export type PhoneNumber = string & { readonly __brand: "PhoneNumber" };
export const makePhoneNumber = (input: string): Result<PhoneNumber, string> =>
  VZLA_PHONE_RE.test(input)
    ? success(input as PhoneNumber)
    : failure("Teléfono inválido");
```

### 3. Result Pattern con getValue/getError

Toda operación fallible retorna `Result<T, E>`. Nunca lances excepciones. Un solo check: `isFailure()`:

```typescript
import { success, failure, isFailure, type Result } from "../types/result.ts";

const divide = (a: number, b: number): Result<number> =>
  b === 0 ? failure("No se puede dividir entre cero") : success(a / b);

const r = divide(10, 2);
if (isFailure(r)) return console.error(r.getError());
console.log(r.getValue()); // 5
```

### 4. Make Pattern para DI

Dependencias vía currying: `makeService(deps) => (data) => Promise<Result<T, E>>`

```typescript
export const makeSalesReportService = (deps: { supabase: SupabaseClient }) =>
  (date: string): Promise<Result<SalesSummary, string>> => { ... }
```

### 5. No `any` — usa branded types

Evita `any`. Usa `T & { __brand: 'X' }` para tipos de dominio.

### 6. Un archivo = una responsabilidad

Sin archivos "utils". Cada archivo exporta una fábrica o un Value Object.

### 7. Inglés en código, Español para usuarios

- Nombres de variables, funciones, archivos → inglés
- Mensajes de WhatsApp, logs, errores → español (Venezuela)

### 8. Arquitectura Screaming

```
domain/    → Lógica pura, sin I/O (Value Objects, entities, result.ts)
infra/     → I/O, conexiones externas (Supabase, WhatsApp, CRON)
app/       → Orquestación HTTP/UI y wiring de endpoints
```

### 9. Node app/web para wiring, make\* para lógica

Los handlers y servidores en `app/` solo hacen wiring. Toda la lógica de negocio vive en `domain/` e `infra/` con make pattern.

### 10. Máximo 350 líneas por archivo

Ningún archivo debe exceder 350 líneas. Si al escribir o refactorizar un archivo supera ese límite, DIVÍDELO. Si encuentras un archivo existente que lo supere, sugiere refactor. Archivos más pequeños son más fáciles de leer y mantener.

### 11. Strict TypeScript, sin verbosidad

Usa `strict` mode siempre. Prefiere tipos implícitos cuando sean obvios (el tipo en `const x = 5` sobra). Sé explícito solo cuando aporte claridad.

### 12. DRY — verifica antes de crear

Antes de crear cualquier nuevo helper, type, interface, función, o pieza de código, VERIFICA si ya existe algo reusable en el proyecto. Busca primero en `types/`, `domain/` y archivos cercanos. No dupliques lógica existente.

### 13. Legibilidad humana > performance

Escribe código para que un humano lo entienda rápidamente. Nombres descriptivos, flujo lineal, lógica simple. La optimización de performance solo se hace cuando hay una razón medida (nunca por adelantado).

### 14. Código autodocumentable > comentarios innecesarios

Escribir código humanamente legible no significa dejar comentarios regados por el código. Los comentarios solo deben agregarse cuando sean estrictamente necesarios y como último recurso. La legibilidad humana significa escribir código autodocumentable: nombres de variables, funciones y piezas de código que permitan entender el flujo con solo leer sus nombres y estructura.

### 15. Kebab case para archivos

Todos los archivos usan kebab-case: `phone-number.ts`, `make-supabase-client.ts`, `sales-report-service.ts`. Nunca camelCase ni snake_case para nombres de archivo.

### 16. Tests en `__test__/` — siempre

Todos los archivos de test (`*.test.ts`) deben vivir dentro de una carpeta `__test__` en el mismo directorio del código que prueban. Ejemplo:

```
infra/whatsapp/
├── make-whatsapp-client.ts
├── __test__/
│   ├── make-whatsapp-client.test.ts
│   └── make-group-finder.test.ts
```

Esto mantiene los tests cerca del código pero separados visualmente, y evita que los tests aparezcan mezclados con los archivos de implementación en el editor.

## Database Reference

Ver `docs/spec-whatsapp-service.md` sección 9 para las consultas SQL necesarias.
Ver el schema completo en la referencia del proyecto:

- Tablas: `customers`, `sales`, `washer_rentals`, `expenses`, `washing_machines`, `products`, `prepaid_orders`, `liter_pricing`, `exchange_rates`, `sale_payment_splits`, `rental_payment_splits`, `expense_payment_splits`, `tips`
- Métodos de pago: `efectivo`, `pago_movil`, `punto_venta`, `divisa`

## Referencias

- `docs/spec-whatsapp-service.md` — Especificación completa del proyecto
- `.atl/skill-registry.md` — Registro de skills del proyecto

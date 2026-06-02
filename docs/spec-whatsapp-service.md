# Especificación: Servicio WhatsApp Bot — Multiservicio Los Compas

> **Versión:** 1.0.0  
> **Última actualización:** 2026-05-17  
> **Stack:** Node.js + TypeScript + Baileys + Supabase  
> **Timezone:** America/Caracas (UTC -4)

---

## 1. Propósito

Construir un servicio en Node.js que:

1. Se conecte a WhatsApp Web mediante **Baileys** (WebSocket persistente) usando un número personal como dispositivo vinculado.
2. Envíe **mensajes programados (CRON)** a un grupo de WhatsApp del local con:
   - **Checklist matutino** (8:30 AM, todos los días).
   - **Reporte de ventas nocturno** (7:30 PM, lunes a sábado, no domingos).
3. Lea datos desde **Supabase** (PostgreSQL) para generar el reporte de ventas y las notificaciones de entregas pendientes.
4. Siga principios **DDD lite**: Value Objects para validación centralizada + Result Pattern funcional.
5. Use un bootstrap funcional en Node.js con patrón **make** para inyección de dependencias.
6. Use **Screaming Architecture**: la estructura de carpetas refleja el dominio del negocio.

---

## 2. Stack Tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Runtime | **Node.js 22+** | Runtime actual del clon, compatible con TypeScript vía `tsx` |
| App Layer | **Node HTTP + Web UI** | Wiring simple para API local, status y administración |
| WhatsApp | **Baileys** (`npm:@whiskeysockets/baileys`) | WebSocket directo, multi-device, battle-tested |
| Base de Datos | **Supabase + PostgreSQL interno** | Supabase para datos del negocio y PostgreSQL para runtime/auth internos |
| CRON | **Scheduler propio** | Programación de tareas con timezone y recarga de runtime |
| Timezone | `America/Caracas` | Huso horario de Venezuela |
| DI Pattern | **make pattern** (currying) | Sin clases, funcional, explícito |

### 2.1 Dependencias en `package.json`

```json
{
  "imports": {
    "@supabase/supabase-js": "^2.0.0",
    "baileys": "7.0.0-rc11",
    "pg": "^8.16.3",
    "tsx": "^4.20.6",
    "vitest": "^4.1.6"
  }
}
```

---

## 3. Screaming Architecture (Estructura de Carpetas)

La arquitectura **grita** "Multiservicio Los Compas — WhatsApp Bot". Las carpetas se organizan por **capas del dominio**, no por tecnología.

```
whatsapp-cron-manager-node/
├── app/
│   └── web/                   # HTTP server + Web UI local
├── domain/
│   ├── value-objects/         # Value Objects
│   │   ├── phone-number.ts
│   │   ├── price.ts
│   │   ├── schedule-time.ts
│   │   └── payment-method.ts
│   ├── entities/              # Entidades del dominio
│   │   ├── sale.ts
│   │   ├── washer-rental.ts
│   │   └── customer.ts
│   └── services/              # Casos de uso puros
├── infra/
│   ├── whatsapp/              # Conexión Baileys
│   │   ├── make-whatsapp-client.ts
│   │   └── make-send-message.ts
│   ├── postgres/              # Runtime interno y auth/session state
│   ├── contacts/              # Contactos internos y sincronización
│   ├── supabase/              # Cliente Supabase
│   │   ├── make-supabase-client.ts
│   │   ├── make-sales-repository.ts
│   │   ├── make-rentals-repository.ts
│   │   └── make-exchange-rate-repository.ts
│   ├── cron/                  # Programación y runtime de jobs
│   └── llm/                   # Adaptador Gemini para contenido dinámico
├── types/                     # Tipos compartidos
│   ├── result.ts
│   └── test-assert.ts
├── main.ts                    # Entry point (bootstrap Node)
├── package.json
└── AGENTS.md                  # Instrucciones para el LLM
```

> **Principio Screaming Architecture:** Un desarrollador que abra este proyecto por primera vez debe entender en **5 segundos** que esto es un bot de WhatsApp para un negocio de recarga de agua y alquiler de lavadoras.

---

## 4. Value Objects

Cada Value Object es una función `make*` que recibe un valor crudo y retorna `Result<T, ValidationError>`.

### 4.1 `PhoneNumber`

```typescript
// domain/value-objects/phone-number.ts
import { ok, err, type Result } from '../../types/result.ts'

export type PhoneNumber = string & { readonly __brand: 'PhoneNumber' }

const VZLA_PHONE_RE = /^\+58(412|414|424|416|426)\d{7}$/

export const makePhoneNumber = (input: string): Result<PhoneNumber, string> => {
  const cleaned = input.replace(/[\s\-]/g, '')
  if (!VZLA_PHONE_RE.test(cleaned)) {
    return failure('Número telefónico inválido. Debe ser +58XXXYYYYYYY')
  }
  return success(cleaned as PhoneNumber)
}
```

### 4.2 `Price`

```typescript
// domain/value-objects/price.ts
export type Price = number & { readonly __brand: 'Price' }

export const makePrice = (amount: number, currency: 'Bs' | 'USD'): Result<Price, string> => {
  if (amount < 0) return failure(`El monto en ${currency} no puede ser negativo`)
  if (amount === 0) return failure(`El monto en ${currency} debe ser mayor a 0`)
  return success(amount as Price)
}
```

### 4.3 `ScheduleTime`

```typescript
// domain/value-objects/schedule-time.ts
export type ScheduleTime = string & { readonly __brand: 'ScheduleTime' }
// Formato: "HH:mm" en hora Caracas

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export const makeScheduleTime = (input: string): Result<ScheduleTime, string> => {
  if (!TIME_RE.test(input)) return failure('Formato de hora inválido. Use HH:mm')
  return success(input as ScheduleTime)
}
```

### 4.4 `WaterBottleSize`

```typescript
// domain/value-objects/water-bottle-size.ts
export type WaterBottleSize = 5 | 8 | 15 | 19

export const makeWaterBottleSize = (liters: number): Result<WaterBottleSize, string> => {
  const valid = [5, 8, 15, 19]
  if (!valid.includes(liters)) return failure(`Tamaño inválido. Válidos: ${valid.join(', ')}L`)
  return success(liters as WaterBottleSize)
}
```

### 4.5 `ServiceStatus`

```typescript
// domain/value-objects/service-status.ts
export type ServiceStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export const makeServiceStatus = (input: string): Result<ServiceStatus, string> => {
  const valid = ['pending', 'in_progress', 'completed', 'cancelled']
  if (!valid.includes(input)) return failure(`Status inválido: ${input}`)
  return success(input as ServiceStatus)

export const makeRentalTurn = (input: string): Result<RentalTurn, string> => {
  const valid = ['express', 'nocturno', 'full_day']
  if (!valid.includes(input)) return failure(`Turno inválido: ${input}. Válidos: ${valid.join(', ')}`)
  return success(input as RentalTurn)
}
```

### 4.7 `PaymentMethod`

```typescript
// domain/value-objects/payment-method.ts
export type PaymentMethod = 'efectivo' | 'pago_movil' | 'punto_venta' | 'divisa'

export const makePaymentMethod = (input: string): Result<PaymentMethod, string> => {
  const valid = ['efectivo', 'pago_movil', 'punto_venta', 'divisa']
  if (!valid.includes(input)) return failure(`Método de pago inválido: ${input}`)
  return success(input as PaymentMethod)
}
```

---

## 5. Result Pattern

Patrón funcional con un solo check: `isFailure(result)`. Si no es failure, es success.

```typescript
// types/result.ts

// --- Tipo principal ---
export type Result<T, E = string> = {
  getValue(): T       // retorna el valor o lanza si es error
  getError(): E       // retorna el error o lanza si es exitoso
  isFailure: boolean  // true si falló, false si es exitoso
}

// --- Constructores ---
export const success = <T>(value: T): Result<T, never> => ({
  getValue: () => value,
  getError: () => { throw new Error('Cannot getError on a success result') },
  isFailure: false,
})

export const failure = <E>(error: E): Result<never, E> => ({
  getValue: () => { throw new Error('Cannot getValue on a failure result') },
  getError: () => error,
  isFailure: true,
})

// --- Guard ---
export const isFailure = <T, E>(r: Result<T, E>): boolean => r.isFailure

// --- Combinadores ---
export const mapErr = <T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  r.isFailure ? failure(fn(r.getError())) : r as Result<T, F>

export const chain = <T, E, U>(r: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> =>
  r.isFailure ? r as Result<U, E> : fn(r.getValue())

export const tap = <T, E>(r: Result<T, E>, fn: (value: T) => void): Result<T, E> => {
  if (!r.isFailure) fn(r.getValue())
  return r
}

export const tapErr = <T, E>(r: Result<T, E>, fn: (error: E) => void): Result<T, E> => {
  if (r.isFailure) fn(r.getError())
  return r
}

// --- Async ---
export const asyncChain = async <T, E, U>(
  r: Result<T, E>,
  fn: (value: T) => Promise<Result<U, E>>,
): Promise<Result<U, E>> => r.isFailure ? r as Result<U, E> : fn(r.getValue())
```

---

## 6. Make Pattern (Inyección de Dependencias Funcional)

En lugar de clases con DI por constructor, usamos **currying**: la primera llamada recibe las dependencias, la segunda recibe los datos de negocio.

```typescript
// Ejemplo genérico:
// makeCreateService(deps) => (data) => Result<Entity, Error>

// infra/supabase/make-sales-repository.ts
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js'
import { success, failure, type Result } from '../../types/result.ts'

type SalesRepoDeps = {
  supabase: SupabaseClient
  exchangeRate: number // tasa del día
}

export type DailySalesSummary = {
  totalBs: number
  totalUsd: number
  byPaymentMethod: Record<string, { bs: number; usd: number }>
  details: Array<{
    dailyNumber: number
    items: string
    totalBs: number
    totalUsd: number
  }>
}

export const makeSalesRepository = (deps: SalesRepoDeps) => {
  const getTodaySales = async (date: string): Promise<Result<DailySalesSummary, string>> => {
    const { data, error } = await deps.supabase
      .from('sales')
      .select('*')
      .eq('date', date)
      .is('deleted_at', null)

    if (error) return failure(`Error al obtener ventas: ${error.message}`)

    // ... agregación
    return success(/* DailySalesSummary */)
  }

  return { getTodaySales }
}
```

```typescript
// app/sales-report/service.ts
import { makeSalesRepository } from '../../infra/supabase/make-sales-repository.ts'
import { makeSendMessage } from '../../infra/whatsapp/make-send-message.ts'

type SalesReportServiceDeps = {
  salesRepo: ReturnType<typeof makeSalesRepository>
  sendMessage: ReturnType<typeof makeSendMessage>
  groupId: string
}

export const makeSalesReportService = (deps: SalesReportServiceDeps) => {
  const sendDailyReport = async (date: string): Promise<Result<void, string>> => {
    const salesResult = await deps.salesRepo.getTodaySales(date)
    if (isErr(salesResult)) return salesResult

    const message = buildReportMessage(salesResult.value)
    return deps.sendMessage(deps.groupId, message)
  }

  return { sendDailyReport }
}
```

### 6.1 Wiring en Danet (App Module)

Danet se usa como **orquestador** — los controladores Danet llaman a servicios construidos con make pattern.

```typescript
// app/app.module.ts
import { Module } from 'npm:@danet/core'
import { ChecklistModule } from './checklist/module.ts'
import { SalesReportModule } from './sales-report/module.ts'

@Module({
  imports: [ChecklistModule, SalesReportModule],
})
export class AppModule {}
```

Los módulos Danet exponen controladores que se encargan del scheduling CRON. La lógica real vive en los servicios con make pattern.

---

## 7. Conexión WhatsApp (Baileys)

### 7.1 Flujo de conexión

1. Al iniciar la app, `makeWhatsAppClient(deps)` crea el socket Baileys.
2. Si no hay sesión guardada, genera código QR en terminal.
3. El usuario escanea con su WhatsApp personal (Multi-Device).
4. La sesión se persiste en Supabase o en el sistema de archivos del VPS.
5. El WebSocket se mantiene conectado 24/7 con auto-reconnect.
6. Se emite un evento `connection.update` que el sistema usa para saber si está listo.

### 7.2 `infra/whatsapp/make-whatsapp-client.ts`

```typescript
import makeWASocket, {
  type WASocket,
  type BaileysEventMap,
  useMultiFileAuthState,
  DisconnectReason,
} from 'npm:@whiskeysockets/baileys'
import { success, failure, type Result } from '../../types/result.ts'
import { type ScheduleTime } from '../../domain/value-objects/schedule-time.ts'

type WhatsAppDeps = {
  authFolder: string  // carpeta VPS donde se guarda la sesión
}

export const makeWhatsAppClient = (deps: WhatsAppDeps) => {
  let sock: WASocket | null = null
  let isConnected = false

  const start = async (): Promise<Result<void, string>> => {
    const { state, saveCreds } = await useMultiFileAuthState(deps.authFolder)

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      syncFullHistory: false,
    })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update
      isConnected = connection === 'open'

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut
        if (shouldReconnect) start() // reconexión automática
      }
    })

    return success(undefined)
  }

  const getGroupId = async (groupName: string): Promise<Result<string, string>> => {
    if (!sock) return failure('WhatsApp no conectado')
    const groups = await sock.groupFetchAllParticipating()
    const group = Object.entries(groups).find(([_, g]) => g.subject === groupName)
    if (!group) return failure(`Grupo "${groupName}" no encontrado`)
    return success(group[0])
  }

  const sendMessage = async (jid: string, text: string): Promise<Result<void, string>> => {
    if (!sock) return failure('WhatsApp no conectado')
    await sock.sendMessage(jid, { text })
    return success(undefined)
  }

  return { start, getGroupId, sendMessage }
}
```

### 7.3 Detección del Grupo

Al iniciar, el bot busca el grupo por nombre (ej. "Multiservicio Los Compas") usando `groupFetchAllParticipating()`. El nombre del grupo se configura en variable de entorno `WHATSAPP_GROUP_NAME`.

---

## 8. Mensajes CRON

### 8.1 Horarios (America/Caracas)

| Mensaje | Días | Hora | ¿Qué incluye? |
|---------|------|------|---------------|
| **Matutino** | Lun-Dom | 8:30 AM | Saludo + Checklist + Lavadoras pendientes de retiro |
| **Nocturno** | Lun-Sáb | 7:30 PM | Reporte de ventas + Recordatorio cierre |

### 8.2 Mensaje Matutino (8:30 AM)

```
🌞 ¡Feliz [día de la semana] equipo! Vamos con todo.

Recordemos hoy:
✅ Limpieza del frente del local
✅ Limpieza del baño
✅ Revisar niveles del agua
✅ Ser siempre amables con nuestros clientes

📋 TENEMOS PENDIENTES PARA RETIRAR HOY:
{lista de lavadoras con: máquina, cliente, dirección, hora de retiro, y si pagó o no}

¡A darle con toda!
```

**Formato de pendientes:**
```
🟢 Lavadora #3 — María Pérez
   📍 Calle Principal #24, PB
   🕐 Retiro: 3:00 PM
   💰 Pagó: Sí ($6 - Full Day)

🔴 Lavadora #5 — Juan García
   📍 Av. Los Ilustres, Edif. 7, Piso 3
   🕐 Retiro: 5:00 PM
   💰 Pagó: No (Pendiente)
```

### 8.3 Mensaje Nocturno (7:30 PM)

```
🌙 Buenas equipo, el día de hoy [fecha] los montos registrados son:

💵 Efectivo: X.XXX Bs
📱 Pago Móvil: X.XXX Bs
💳 Punto de Venta: X.XXX Bs
💶 Divisa: XXX USD

💰 Total Bs: X.XXX Bs
💵 Total USD: XXX USD

📊 Tasa del día: 1 USD = XX Bs

Por favor, recordemos:
✅ Desconectar la lámpara del agua
✅ Dejar el local limpio y ordenado
✅ Limpiar la mesa de trabajo y la cocina

¡Gracias por el esfuerzo de hoy! 🙌
```

### 8.4 Implementación CRON

Usar el scheduler actual del proyecto para programar las tareas. La configuración de horarios debe ser fácilmente modificable mediante runtime state y variables de entorno cuando aplique.

```typescript
// infra/cron/make-morning-cron.ts
import { cron } from 'npm:@std/cron'
import { isFailure, type Result } from '../../types/result.ts'

type MorningCronDeps = {
  checklistService: ReturnType<typeof makeChecklistService>
  timezone: string
}

export const makeMorningCron = (deps: MorningCronDeps) => {
  const start = () => {
    // "30 8 * * *" = 8:30 AM todos los días
    cron('30 8 * * *', { timezone: deps.timezone }, async () => {
      const result = await deps.checklistService.sendMorningChecklist()
      if (isFailure(result)) {
        console.error('Error en CRON matutino:', result.getError())
      }
    })
    console.log('CRON matutino registrado: 8:30 AM Caracas')
  }

  return { start }
}
```

```typescript
// infra/cron/make-night-cron.ts
import { cron } from 'npm:@std/cron'
import { isFailure, type Result } from '../../types/result.ts'

type NightCronDeps = {
  salesReportService: ReturnType<typeof makeSalesReportService>
  timezone: string
}

export const makeNightCron = (deps: NightCronDeps) => {
  const start = () => {
    // "30 19 * * 1-6" = 7:30 PM lunes a sábado (no domingo)
    cron('30 19 * * 1-6', { timezone: deps.timezone }, async () => {
      const today = getTodayCaracasDate()
      const result = await deps.salesReportService.sendDailyReport(today)
      if (isFailure(result)) {
        console.error('Error en CRON nocturno:', result.getError())
      }
    })
    console.log('CRON nocturno registrado: 7:30 PM Lun-Sáb Caracas')
  }

  return { start }
}
```

---

## 9. Integración Supabase

### 9.1 Consultas necesarias

**Reporte nocturno de ventas:**
```sql
-- Ventas del día con splits de pago
SELECT 
  s.daily_number,
  s.total_bs,
  s.total_usd,
  sps.payment_method,
  sps.amount_bs,
  sps.amount_usd
FROM sales s
LEFT JOIN sale_payment_splits sps ON sps.sale_id = s.id
WHERE s.date = 'YYYY-MM-DD'
  AND s.deleted_at IS NULL
```

**Alquileres pendientes para el matutino:**
```sql
SELECT 
  wr.id,
  wr.machine_id,
  wr.shift,
  wr.delivery_time,
  wr.pickup_time,
  wr.pickup_date,
  wr.delivery_fee,
  wr.total_usd,
  wr.is_paid,
  c.name AS customer_name,
  c.address,
  c.phone
FROM washer_rentals wr
JOIN customers c ON c.id = wr.customer_id
WHERE wr.pickup_date = 'YYYY-MM-DD'
  AND wr.status = 'in_progress'
  AND wr.deleted_at IS NULL
```

**Tasa de cambio del día:**
```sql
SELECT rate FROM exchange_rates
WHERE date = 'YYYY-MM-DD'
ORDER BY created_at DESC
LIMIT 1
```

### 9.2 Repositorio con make pattern

```typescript
// infra/supabase/make-supabase-client.ts
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js'

type SupabaseDeps = {
  supabaseUrl: string
  supabaseKey: string
}

export const makeSupabaseClient = (deps: SupabaseDeps) => {
  const client = createClient(deps.supabaseUrl, deps.supabaseKey)
  return { client }
}
```

```typescript
// infra/supabase/make-rentals-repository.ts
import { type SupabaseClient } from 'npm:@supabase/supabase-js'
import { success, failure, type Result } from '../../types/result.ts'
import type { WasherRental } from '../../domain/entities/washer-rental.ts'

type RentalsRepoDeps = {
  supabase: SupabaseClient
}

export const makeRentalsRepository = (deps: RentalsRepoDeps) => {
  const getPendingPickupsForDate = async (
    date: string,
  ): Promise<Result<WasherRental[], string>> => {
    const { data, error } = await deps.supabase
      .from('washer_rentals')
      .select(`
        id, machine_id, shift, delivery_time, pickup_time,
        pickup_date, delivery_fee, total_usd, is_paid,
        customer:customers(id, name, phone, address)
      `)
      .eq('pickup_date', date)
      .eq('status', 'in_progress')
      .is('deleted_at', null)

    if (error) return failure(`Error al obtener alquileres: ${error.message}`)
    return success(data as unknown as WasherRental[])
  }

  return { getPendingPickupsForDate }
}
```

---

## 10. Configuración y Variables de Entorno

```bash
# Archivo .env (crear en el VPS)
WHATSAPP_GROUP_NAME=Multiservicio Los Compas
WHATSAPP_AUTH_FOLDER=./auth_info

SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxxx...

CRON_TIMEZONE=America/Caracas
CRON_MORNING=30 8 * * *
CRON_NIGHT=30 19 * * 1-6
```

---

## 11. Entry Point (`main.ts`)

```typescript
import { App } from 'npm:@danet/core'
import { isFailure, type Result } from './types/result.ts'
import { AppModule } from './app/app.module.ts'

// 1. Crear clientes de infraestructura
const supabase = makeSupabaseClient({
  supabaseUrl: process.env.VITE_SUPABASE_URL!,
  supabaseKey: process.env.VITE_SUPABASE_ANON_KEY!,
})

const whatsapp = makeWhatsAppClient({
  authFolder: 'auth_info',
})

// 2. Iniciar WhatsApp
await whatsapp.start()

// 3. Detectar grupo
const groupResult = await whatsapp.getGroupId(
  process.env.WHATSAPP_GROUP_NAME || 'Multiservicio Los Compas'
)

// 4. Construir servicios con make pattern
const salesRepo = makeSalesRepository({ supabase: supabase.client })
const rentalsRepo = makeRentalsRepository({ supabase: supabase.client })

const salesReportService = makeSalesReportService({
  salesRepo,
  sendMessage: whatsapp.sendMessage,
  groupId: !isFailure(groupResult) ? groupResult.getValue() : '',
})

const checklistService = makeChecklistService({
  rentalsRepo,
  sendMessage: whatsapp.sendMessage,
  groupId: !isFailure(groupResult) ? groupResult.getValue() : '',
})

// 5. Iniciar CRONs
const morningCron = makeMorningCron({ checklistService, timezone: 'America/Caracas' })
const nightCron = makeNightCron({ salesReportService, timezone: 'America/Caracas' })
morningCron.start()
nightCron.start()

// 6. Iniciar servidor web local
const app = makeWebServer({ port: 3000 })
await app.start()

console.log('🚀 Multiservicio WhatsApp Bot iniciado')
```

---

## 12. Reglas de Código (para el LLM)

Estas reglas están formalizadas en el archivo `AGENTS.md`. Resumen:

1. **Sin clases** — Todo el código es basado en funciones.
2. **Value Objects** — Toda validación de dominio pasa por VOs con `make*`.
3. **Result Pattern** — Toda operación fallible retorna `Result<T, E>`. Un solo check: `isFailure(result)`. Extraer con `getValue()` / `getError()`.
4. **Make Pattern** — La DI se hace con currying: `make*(deps) => (data) => Result<T, E>`.
5. **Nombres en inglés** para código, **español** para mensajes al usuario.
6. **Un archivo = una responsabilidad** — Sin archivos "utils". Cada archivo exporta una fábrica o un VO.
7. **No `any`** — Usar branded types para tipos de dominio.
8. **Máximo 350 líneas por archivo** — Si un archivo lo excede, dividirlo.
9. **Strict TypeScript sin verbosidad** — Tipos implícitos cuando sea obvio, explícitos cuando aporte claridad.
10. **DRY** — Verificar si ya existe código reusable antes de crear algo nuevo.
11. **Legibilidad humana > performance** — Código claro y descriptivo primero.
12. **Kebab case** para nombres de archivo.

---

## 13. Roadmap / Próximos Pasos

- [x] Especificación aprobada
- [ ] Ajustar la spec completa al runtime Node cuando se haga una limpieza profunda
- [ ] Implementar Value Objects + Result Pattern
- [ ] Implementar conexión WhatsApp (Baileys) con QR
- [ ] Implementar repositorios Supabase
- [ ] Implementar servicio de Checklist Matutino
- [ ] Implementar servicio de Reporte Nocturno
- [ ] Implementar CRON jobs
- [ ] Configurar y probar en VPS
- [ ] Documentar el flujo operativo real de la Web UI y el scheduler

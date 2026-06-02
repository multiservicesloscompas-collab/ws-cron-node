## WhatsApp Cron Manager (Node Clone)

Node.js + TypeScript clone of the Multiservicio Los Compas WhatsApp bot. It connects to WhatsApp through Baileys, serves a small web UI/API, reads business data from Supabase/PostgreSQL, and runs scheduled WhatsApp messages for daily operations.

## Runtime

- Node.js `>=22.5.0`
- TypeScript in `NodeNext` mode
- `tsx` for local execution
- `vitest` for tests

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill the required values.

3. Start the app:

```bash
npm run dev
```

The current entrypoint is `main.ts`. The web UI/API starts on port `3000`.

## Environment

Required for the current clone:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `INTERNAL_POSTGRES_URL`

Supported fallbacks already handled in code:

- `DATABASE_URL` instead of `INTERNAL_POSTGRES_URL`
- `PGSSLMODE` instead of `INTERNAL_POSTGRES_SSL`

Notes:

- `INTERNAL_POSTGRES_SSL` is treated as a boolean-like flag.
- WhatsApp auth state is stored through the current PostgreSQL-backed flow.
- Legacy cron config import still points to `config/cron-config.json` when that file exists.

## Main Scripts

- `npm run dev`: run with watch mode using `tsx`
- `npm start`: run once using `tsx`
- `npm run typecheck`: TypeScript validation with `tsc --noEmit`
- `npm test`: run the Vitest suite

## Validation Status

Current handoff status for this clone:

- `npm run typecheck` passes
- `npm test` passes
- Test suite result at audit time: `21` files, `130` tests passing

Not validated in this documentation pass:

- live WhatsApp session bootstrap
- real Supabase connectivity
- real PostgreSQL connectivity

## Project Shape

- `main.ts`: bootstrap and wiring
- `app/web/`: Node HTTP server and browser UI
- `domain/`: pure business/domain logic
- `infra/`: WhatsApp, cron, Supabase, PostgreSQL, and LLM integrations
- `docs/spec-whatsapp-service.md`: inherited product/spec reference, partially refreshed for the Node clone

## Handoff Notes

- This clone is the Node runtime variant of the original project.
- Business logic was not changed in this pass.
- Documentation and naming were cleaned up only where Deno-era wording would confuse a handoff reader.

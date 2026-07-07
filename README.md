# Finance OS

Personal financial intelligence assistant — mobile-first Next.js PWA with local-first Dexie storage and optional Supabase sync.

**Live:** [finance-os-orpin-phi.vercel.app](https://finance-os-orpin-phi.vercel.app/)

## Features (MVP)

- Income / expense / transfer tracking (BDT default)
- Category budgets with overspend alerts and rules-based suggestions
- **Smart Buy** deterministic decision engine
- Held money (liability) tracking — excluded from net worth
- Net worth, cashflow forecast, financial maturity score
- Debt, loans given, goals, basic investments
- On-demand monthly reports (not stored in cloud)

## Quick start

```bash
cd finance-os
npm install
cp .env.example .env.local
# Optional: add Supabase URL + anon key for cloud sync
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → complete onboarding → use the app offline.

## Supabase setup

1. Create a free Supabase project
2. Run migration: `supabase/migrations/001_mvp_schema.sql`
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`

Without Supabase, the app runs fully offline with IndexedDB.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run test` | Vitest (rules engine) |

## Architecture

- `src/domain/rules-engine/` — pure deterministic finance intelligence
- `src/infrastructure/db/dexie/` — local-first storage
- `src/infrastructure/sync/` — lean Supabase sync queue
- `docs/POST_MVP.md` — future features (OCR, AI, etc.)

## Smart Buy example

Income ৳20,000, iPhone ৳120,000 → **Financially Unsafe**, safe gadget range ~৳15,000–25,000.

Tests: `tests/domain/rules-engine/`

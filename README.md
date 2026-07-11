# Finance OS

[![CI](https://github.com/NafisianCastle/finance-os/actions/workflows/ci.yml/badge.svg)](https://github.com/NafisianCastle/finance-os/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8)](#quick-start)

**Your money, your device, your rules.** A local-first, installable personal finance PWA that works fully offline — no account required, cloud sync optional.

**Live demo:** [finance-os-orpin-phi.vercel.app](https://finance-os-orpin-phi.vercel.app/)

---

## Why Finance OS?

Most finance apps demand an account before you can add a single transaction, and quietly ship your data to a server you don't control. Finance OS flips that:

- **Local-first** — all data lives in IndexedDB (via Dexie) on your device. Works offline, installs like a native app.
- **Sync is optional** — plug in your own free Supabase project for cross-device sync, or skip it entirely.
- **Deterministic intelligence, no black box** — budgeting, forecasting, and the Smart Buy engine are plain rules you can read and audit, not an opaque model.
- **BDT-first, currency-agnostic by design** — built for Bangladeshi Taka out of the box, adaptable to other currencies.

## Features

- Income / expense / transfer tracking (BDT default)
- Category budgets with overspend alerts and rules-based suggestions
- **Smart Buy** — deterministic "can I afford this?" decision engine
- Held money (liability) tracking — excluded from net worth
- Net worth, cashflow forecast, financial maturity score
- Debt, loans given, goals, basic investments
- On-demand monthly reports (never stored in the cloud)
- Installable PWA with offline support and background sync queue

## Quick start

```bash
git clone https://github.com/NafisianCastle/finance-os.git
cd finance-os
npm install
cp .env.example .env.local
# Optional: add Supabase URL + anon key for cloud sync
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → complete onboarding → use the app offline.

## Supabase setup (optional)

1. Create a free [Supabase](https://supabase.com) project
2. Run migration: `supabase/migrations/001_mvp_schema.sql`
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`

Without Supabase, the app runs fully offline with IndexedDB — no server, no signup.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run test` | Vitest (rules engine) |
| `npm run lint` | ESLint |

## Architecture

- `src/domain/rules-engine/` — pure deterministic finance intelligence
- `src/infrastructure/db/dexie/` — local-first storage
- `src/infrastructure/sync/` — lean Supabase sync queue
- `docs/` — design notes and post-MVP roadmap

## Smart Buy example

Income ৳20,000, iPhone ৳120,000 → **Financially Unsafe**, safe gadget range ~৳15,000–25,000.

Tests: `tests/domain/rules-engine/`

## Tech stack

Next.js 15 · TypeScript · Dexie (IndexedDB) · Supabase · Tailwind CSS · Radix UI · Vitest

## Contributing

Issues and PRs are welcome. For non-trivial changes, please open an issue first to discuss what you'd like to change. Run `npm run lint && npm run test && npm run build` before submitting.

## License

[MIT](LICENSE) © Md Nafisur Rahman

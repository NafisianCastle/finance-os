# finance-os

Local-first PWA (Next.js + Dexie + Supabase) for personal finance tracking. BDT currency.

## Schema Evolution & Versioning

Schema lives in two places: Supabase Postgres (server) + thousands of client browsers (Dexie, IndexedDB). Old client can't be force-upgraded — must keep working until it syncs.

Risk if broken: old client writes record missing new required field → server validation rejects → sync queue stalls forever for that user.

Rules:

1. **Supabase additions stay lax.** New columns: nullable, or `NOT NULL DEFAULT <value>`. Never add `NOT NULL` without a default to a table with existing rows. See `supabase/migrations/001-006` for the established pattern (e.g. `003_investments_relax_legacy_columns.sql` even relaxed old `NOT NULL` → nullable).

2. **Dexie migrations are non-destructive.** New `.version(N).stores()` block = additive only (new stores/indexes). If old data needs reshaping, use `.upgrade(tx => ...)` to transform in place — never `.clear()`/`.delete()` a table inside a version migration. See `src/infrastructure/db/dexie/database.ts` v1→v2 for the pattern (adds `investmentEvents` store, backfills new investment fields via `.upgrade()`).

3. `resetLocalDatabase()` (`database.ts`) calling `Dexie.delete()` is a manual recovery escape hatch, not part of the migration chain — don't reuse that pattern inside a `.version()` block.

Before adding a new field to synced data: check both sides satisfy the above.

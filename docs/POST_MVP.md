# Post-MVP Backlog

MVP acceptance criteria must pass before starting these items.

## P2a — Wealth depth

- Investment portfolio analytics (allocation pie, best/worst performers)
- Passive income trend charts
- Loan overdue automation and reminders
- Debt pressure analysis dashboard

## P2b — Insights

- Spending pattern intelligence (money leaks, lifestyle creep, micro-spend)
- Persisted weekly/monthly review snapshots (optional Supabase table)
- In-app notification center (local-first, then sync)

## P3 — Capture

- Receipt photo (local IndexedDB blob)
- Optional Supabase Storage bucket (compress images)
- OCR API route for receipt scanning
- Voice input via Web Speech API
- SMS/email paste parser for transactions
- Merchant auto-detection from history

## P4 — AI augmentation

- `HybridIntelligenceProvider` behind existing `IntelligenceProvider` interface
- LLM narrative insights **on top of** deterministic rules output
- Hard safety tiers (e.g. >3× income) **never** overridden by AI
- Smart category suggestions

## P5 — Platform

- Web Push notifications
- Supabase Realtime sync
- Transaction archive/cold storage (>24 months)
- JSON/CSV export
- Multi-currency conversion

## Storage notes for post-MVP

- Enable Storage only with image compression (max 200KB/receipt)
- Keep `report_snapshots` optional and pruned
- Continue storing `reason_codes[]` not full text in `buy_evaluations`

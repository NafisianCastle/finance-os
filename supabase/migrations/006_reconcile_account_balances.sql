-- One-time reconciliation for balances that drifted before migration 005's
-- trigger existed: two offline devices adding transactions to the same
-- account could each push an absolute balance_poisha computed from their own
-- stale local snapshot, silently losing the other device's delta.
--
-- Transactions themselves were never corrupted (append-only, no in-place
-- edits) — only the derived balance could drift. This recomputes
-- balance_poisha as the net of each account's non-deleted transactions.
--
-- CAVEAT: if an account had a real-world opening balance entered manually at
-- creation (Settings → Add account → non-zero starting balance) rather than
-- built up purely from logged transactions, this will zero out that opening
-- amount. Re-check any such account's balance in Settings after running this
-- and correct it manually if needed — that edit becomes the new safe
-- checkpoint going forward, protected by migration 005's trigger.
--
-- Safe to re-run: idempotent, only touches accounts that have at least one
-- transaction.

update accounts a
set balance_poisha = t.net, updated_at = now()
from (
  select account_id as acc_id, sum(delta) as net
  from (
    select account_id, amount_poisha as delta
    from transactions
    where deleted_at is null and type_smallint = 1 -- income
    union all
    select account_id, -amount_poisha as delta
    from transactions
    where deleted_at is null and type_smallint in (2, 3) -- expense, transfer-out
    union all
    select to_account_id as account_id, amount_poisha as delta
    from transactions
    where deleted_at is null and type_smallint = 3 and to_account_id is not null -- transfer-in
  ) deltas
  group by account_id
) t
where a.id = t.acc_id;

-- Scope all financial data tables to optionally belong to a household group
-- instead of (or in addition to) a lone user. group_id stays nullable: rows
-- with group_id = null are personal (unchanged single-owner behavior), rows
-- with a group_id are visible/writable by every member of that group.
-- user_profiles (personal prefs) and categories (never synced) are
-- intentionally excluded.

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'transactions', 'budgets', 'debts', 'loans_given',
    'held_liabilities', 'goals', 'investments', 'investment_events',
    'buy_evaluations', 'planned_payments', 'shopping_lists',
    'shopping_list_items'
  ]
  loop
    execute format(
      'alter table %1$I add column if not exists group_id uuid references groups(id) on delete set null;',
      t
    );
    execute format(
      'create index if not exists idx_%1$s_group on %1$I(group_id);',
      t
    );
    execute format('drop policy if exists "%1$s_own" on %1$I;', t);
    execute format('drop policy if exists "%1$s_access" on %1$I;', t);
    execute format(
      $f$create policy "%1$s_access" on %1$I for all
        using (
          (group_id is null and auth.uid() = user_id)
          or (group_id is not null and is_member_of(group_id))
        )
        with check (
          (group_id is null and auth.uid() = user_id)
          or (group_id is not null and is_member_of(group_id))
        );$f$,
      t
    );
  end loop;
end $$;

-- Shared household budgets: one row per category+month for the whole group,
-- alongside the existing per-user unique constraint for personal budgets.
create unique index if not exists idx_budgets_group_unique
  on budgets(group_id, ym_char6, category_id) where group_id is not null;

-- Fix: the balance-delta trigger matched accounts by (id, user_id), which
-- silently no-ops when the transacting member differs from the account's
-- original creator in a shared group. RLS already guarantees the caller has
-- access to both the transaction and the account, so match by id alone.
create or replace function apply_transaction_balance_delta()
returns trigger as $$
declare
  sign int;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null then
      return new;
    end if;
    sign := 1;
  elsif tg_op = 'UPDATE' then
    if (old.deleted_at is null) = (new.deleted_at is null) then
      return new;
    end if;
    sign := case when new.deleted_at is not null then -1 else 1 end;
  else
    return new;
  end if;

  if new.type_smallint = 1 then -- income
    update accounts set balance_poisha = balance_poisha + sign * new.amount_poisha
      where id = new.account_id;
  elsif new.type_smallint = 2 then -- expense
    update accounts set balance_poisha = balance_poisha - sign * new.amount_poisha
      where id = new.account_id;
  elsif new.type_smallint = 3 then -- transfer
    update accounts set balance_poisha = balance_poisha - sign * new.amount_poisha
      where id = new.account_id;
    if new.to_account_id is not null then
      update accounts set balance_poisha = balance_poisha + sign * new.amount_poisha
        where id = new.to_account_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

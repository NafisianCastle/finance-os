-- 1. Server-authoritative updated_at: client clocks can be wrong/tampered.
-- Overwrite whatever the client sent with the true DB server timestamp before
-- any row is broadcast to other devices, so LWW conflict resolution can't be
-- gamed by clock skew.
create or replace function set_updated_at_now()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles', 'accounts', 'categories', 'transactions', 'budgets',
    'debts', 'loans_given', 'held_liabilities', 'goals', 'investments',
    'investment_events', 'buy_evaluations'
  ]
  loop
    execute format(
      'drop trigger if exists trg_%1$s_updated_at on %1$s;
       create trigger trg_%1$s_updated_at
       before insert or update on %1$s
       for each row execute function set_updated_at_now();',
      t
    );
  end loop;
end $$;

-- 2. Atomic account balance: two offline devices adding transactions to the
-- same account concurrently must not have one push's absolute balance
-- silently clobber the other's. Instead of trusting a client-computed
-- balance_poisha upsert, the server derives the balance delta from the
-- transaction row itself and applies it atomically. Transactions are
-- append-only + soft-delete only (no in-place edits from the client), so we
-- only need to handle insert and the deleted_at transition.
create or replace function apply_transaction_balance_delta()
returns trigger as $$
declare
  sign int;
begin
  -- INSERT of an already-deleted row (shouldn't happen, but be safe): no-op.
  if tg_op = 'INSERT' then
    if new.deleted_at is not null then
      return new;
    end if;
    sign := 1;
  elsif tg_op = 'UPDATE' then
    -- No delta unless the soft-delete state actually changed.
    if (old.deleted_at is null) = (new.deleted_at is null) then
      return new;
    end if;
    -- Was active, now deleted: reverse the original effect.
    -- Was deleted, now restored: reapply it.
    sign := case when new.deleted_at is not null then -1 else 1 end;
  else
    return new;
  end if;

  if new.type_smallint = 1 then -- income
    update accounts set balance_poisha = balance_poisha + sign * new.amount_poisha
      where id = new.account_id and user_id = new.user_id;
  elsif new.type_smallint = 2 then -- expense
    update accounts set balance_poisha = balance_poisha - sign * new.amount_poisha
      where id = new.account_id and user_id = new.user_id;
  elsif new.type_smallint = 3 then -- transfer
    update accounts set balance_poisha = balance_poisha - sign * new.amount_poisha
      where id = new.account_id and user_id = new.user_id;
    if new.to_account_id is not null then
      update accounts set balance_poisha = balance_poisha + sign * new.amount_poisha
        where id = new.to_account_id and user_id = new.user_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_transactions_balance on transactions;
create trigger trg_transactions_balance
  after insert or update on transactions
  for each row execute function apply_transaction_balance_delta();

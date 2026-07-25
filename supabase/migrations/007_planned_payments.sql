-- Planned payments: future one-off or recurring payments, either owed by the
-- user (direction=pay) or owed to the user (direction=receive).

create table if not exists planned_payments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction_smallint smallint not null,
  amount_poisha bigint not null,
  account_id uuid not null,
  category_id varchar(32) not null default 'other',
  counterparty varchar(80),
  next_due_date date not null,
  is_recurring boolean not null default false,
  recurrence_interval_smallint smallint,
  status_smallint smallint not null default 1,
  note varchar(200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_planned_payments_user_due on planned_payments(user_id, next_due_date);

alter table planned_payments enable row level security;
create policy "planned_payments_own" on planned_payments for all using (auth.uid() = user_id);

-- Reuse set_updated_at_now() from 005_server_authoritative_sync.sql.
drop trigger if exists trg_planned_payments_updated_at on planned_payments;
create trigger trg_planned_payments_updated_at
  before insert or update on planned_payments
  for each row execute function set_updated_at_now();

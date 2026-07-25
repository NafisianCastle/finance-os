-- Investment enhancements + events (lean)

alter table investments
  add column if not exists investor_name varchar(80),
  add column if not exists declared_profit_poisha bigint not null default 0,
  add column if not exists project_start_date date,
  add column if not exists project_end_date date,
  add column if not exists status_smallint smallint not null default 1;

update investments set project_start_date = start_date where project_start_date is null;
update investments set project_end_date = maturity_date where project_end_date is null and maturity_date is not null;

create table if not exists investment_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  investment_id uuid not null,
  type_smallint smallint not null,
  amount_poisha bigint not null,
  event_date date not null,
  note varchar(200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_inv_events_user on investment_events(user_id, investment_id);

alter table investment_events enable row level security;
create policy "investment_events_own" on investment_events for all using (auth.uid() = user_id);

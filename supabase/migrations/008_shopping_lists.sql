-- Shopping lists: pre-purchase planning that collapses into a single
-- aggregated expense transaction on checkout. Items are planning/checklist
-- state, not ledger entries — the itemized breakdown lives denormalized on
-- transactions.line_items once the trip is finished.

create table if not exists shopping_lists (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(80) not null,
  status varchar(16) not null default 'active',
  linked_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_shopping_lists_user_status on shopping_lists(user_id, status);

alter table shopping_lists enable row level security;
create policy "shopping_lists_own" on shopping_lists for all using (auth.uid() = user_id);

drop trigger if exists trg_shopping_lists_updated_at on shopping_lists;
create trigger trg_shopping_lists_updated_at
  before insert or update on shopping_lists
  for each row execute function set_updated_at_now();

create table if not exists shopping_list_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  name varchar(80) not null,
  category_id varchar(32),
  quantity numeric,
  unit varchar(16),
  estimated_price_poisha bigint,
  actual_price_poisha bigint,
  checked boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_shopping_list_items_list on shopping_list_items(list_id);

alter table shopping_list_items enable row level security;
create policy "shopping_list_items_own" on shopping_list_items for all using (auth.uid() = user_id);

drop trigger if exists trg_shopping_list_items_updated_at on shopping_list_items;
create trigger trg_shopping_list_items_updated_at
  before insert or update on shopping_list_items
  for each row execute function set_updated_at_now();

alter table transactions add column if not exists line_items jsonb;

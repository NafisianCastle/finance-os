-- Finance OS MVP lean schema (Supabase free tier)

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  monthly_income_poisha bigint not null default 0,
  currency_code char(3) not null default 'BDT',
  locale varchar(10) not null default 'bn-BD',
  emergency_months smallint not null default 3,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists accounts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type_smallint smallint not null,
  name varchar(80) not null,
  balance_poisha bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(80) not null,
  parent_id uuid,
  icon_key varchar(32) not null default 'circle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type_smallint smallint not null,
  amount_poisha bigint not null,
  account_id uuid not null,
  to_account_id uuid,
  category_id varchar(32) not null,
  tx_date date not null,
  note varchar(200),
  tags text[],
  merchant varchar(80),
  recurring_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_tx_user_date on transactions(user_id, tx_date desc);

create table if not exists budgets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ym_char6 char(6) not null,
  category_id varchar(32) not null,
  allocated_poisha bigint not null default 0,
  carry_poisha bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(user_id, ym_char6, category_id)
);

create table if not exists debts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lender varchar(80) not null,
  principal_poisha bigint not null,
  interest_rate smallint,
  remaining_poisha bigint not null,
  borrow_date date not null,
  due_date date,
  status_smallint smallint not null default 1,
  note varchar(200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists loans_given (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  borrower varchar(80) not null,
  amount_poisha bigint not null,
  remaining_poisha bigint not null,
  borrow_date date not null,
  due_date date,
  status_smallint smallint not null default 1,
  note varchar(200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists held_liabilities (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner varchar(80) not null,
  amount_poisha bigint not null,
  hold_date date not null,
  return_date date,
  purpose varchar(120),
  status_smallint smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists goals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(80) not null,
  target_poisha bigint not null,
  saved_poisha bigint not null default 0,
  deadline date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists investments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type_smallint smallint not null,
  name varchar(80) not null,
  invested_poisha bigint not null,
  current_value_poisha bigint not null,
  start_date date not null,
  maturity_date date,
  note varchar(200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists buy_evaluations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_name varchar(80) not null,
  category_id varchar(32) not null,
  price_poisha bigint not null,
  priority smallint not null,
  score smallint not null,
  tier smallint not null,
  recommendation smallint not null,
  reason_codes smallint[] not null default '{}',
  save_months smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- RLS
alter table user_profiles enable row level security;
alter table accounts enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;
alter table budgets enable row level security;
alter table debts enable row level security;
alter table loans_given enable row level security;
alter table held_liabilities enable row level security;
alter table goals enable row level security;
alter table investments enable row level security;
alter table buy_evaluations enable row level security;

create policy "user_profiles_own" on user_profiles for all using (auth.uid() = user_id);
create policy "accounts_own" on accounts for all using (auth.uid() = user_id);
create policy "categories_own" on categories for all using (auth.uid() = user_id);
create policy "transactions_own" on transactions for all using (auth.uid() = user_id);
create policy "budgets_own" on budgets for all using (auth.uid() = user_id);
create policy "debts_own" on debts for all using (auth.uid() = user_id);
create policy "loans_given_own" on loans_given for all using (auth.uid() = user_id);
create policy "held_liabilities_own" on held_liabilities for all using (auth.uid() = user_id);
create policy "goals_own" on goals for all using (auth.uid() = user_id);
create policy "investments_own" on investments for all using (auth.uid() = user_id);
create policy "buy_evaluations_own" on buy_evaluations for all using (auth.uid() = user_id);

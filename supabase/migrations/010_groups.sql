-- Household group sharing: a user can create/join at most one group at a
-- time. Members have equal edit rights over all shared financial data
-- (scoped in migration 011); "owner" is a minimal admin role for
-- group-lifecycle actions only (delete group, remove member, regen invite).

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name varchar(80) not null,
  invite_code varchar(12) not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role varchar(16) not null default 'member', -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- A user can only be an active member of one group at a time (simplifies
-- effective-scope resolution in the sync engine).
create unique index if not exists idx_group_members_one_group_per_user
  on group_members(user_id);

alter table groups enable row level security;
alter table group_members enable row level security;

-- security definer helper: avoids RLS self-referencing-subquery footguns
-- when group_members' own policies need to check group_members membership.
create or replace function is_member_of(gid uuid)
returns boolean as $$
  select exists (
    select 1 from group_members where group_id = gid and user_id = auth.uid()
  );
$$ language sql security definer stable;

create or replace function is_owner_of(gid uuid)
returns boolean as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and role = 'owner'
  );
$$ language sql security definer stable;

create policy "groups_select_member" on groups for select
  using (is_member_of(id));
create policy "groups_insert_self" on groups for insert
  with check (created_by = auth.uid());
create policy "groups_update_owner" on groups for update
  using (is_owner_of(id));
create policy "groups_delete_owner" on groups for delete
  using (is_owner_of(id));

create policy "group_members_select_own_group" on group_members for select
  using (is_member_of(group_id));
create policy "group_members_insert_self" on group_members for insert
  with check (user_id = auth.uid());
create policy "group_members_delete_self_or_owner" on group_members for delete
  using (user_id = auth.uid() or is_owner_of(group_id));

drop trigger if exists trg_groups_updated_at on groups;
create trigger trg_groups_updated_at
  before insert or update on groups
  for each row execute function set_updated_at_now();

-- Lets a non-member resolve an invite code to a group (name/id) before
-- joining, which the membership-gated select policy above would otherwise
-- block. security definer bypasses RLS internally; only exposes minimal
-- columns needed for a join confirmation screen.
create or replace function resolve_invite_code(code text)
returns table (id uuid, name varchar) as $$
  select g.id, g.name from groups g where g.invite_code = code;
$$ language sql security definer stable;

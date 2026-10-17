-- Groups hardening + mixed-model budget uniqueness. Additive/relaxing only
-- (see CLAUDE.md): old clients must keep syncing until they upgrade.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on the existing security-definer helpers (010). Same
--    signatures/return types, so `create or replace` keeps every RLS policy
--    that references them intact.
-- ---------------------------------------------------------------------------
create or replace function is_member_of(gid uuid)
returns boolean as $$
  select exists (
    select 1 from group_members where group_id = gid and user_id = auth.uid()
  );
$$ language sql security definer stable set search_path = public;

create or replace function is_owner_of(gid uuid)
returns boolean as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and role = 'owner'
  );
$$ language sql security definer stable set search_path = public;

create or replace function resolve_invite_code(code text)
returns table (id uuid, name varchar) as $$
  select g.id, g.name from groups g where g.invite_code = code;
$$ language sql security definer stable set search_path = public;

-- Functions are executable by PUBLIC by default, so revoking from anon alone
-- would be a no-op — revoke from both and grant back to signed-in users only.
revoke execute on function resolve_invite_code(text) from public, anon;
grant execute on function resolve_invite_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Close the RLS hole: any signed-in user could insert themselves into any
--    group (even as 'owner') given its id. Membership is now only created by
--    the security-definer RPCs below. NOTE: pre-012 clients that create/join
--    via direct inserts get an error from those two actions until they
--    update; their sync queue is unaffected (group_members isn't synced).
-- ---------------------------------------------------------------------------
drop policy if exists "group_members_insert_self" on group_members;

-- ---------------------------------------------------------------------------
-- 3. Group lifecycle RPCs. Errors are raised with stable machine-readable
--    messages the client maps to translated text.
-- ---------------------------------------------------------------------------
create or replace function create_group(p_name text)
returns groups as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  v_code text;
  v_group groups;
  v_attempt int := 0;
  v_bytes bytea;
  v_idx int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'invalid_group_name' using errcode = '22023';
  end if;
  if exists (select 1 from group_members where user_id = v_uid) then
    raise exception 'already_in_group' using errcode = 'P0001';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := '';
    -- CSPRNG bytes: gen_random_uuid() (core since PG13) draws from
    -- pg_strong_random. random() is predictable, and the code is the only
    -- secret gating group membership. Bytes 6 and 8 carry the UUID
    -- version/variant bits, so take bytes 0-5 and 10-11. 256 % 32 = 0, so
    -- the modulo is unbiased over the 32-char alphabet.
    v_bytes := uuid_send(gen_random_uuid());
    foreach v_idx in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
      v_code := v_code || substr(v_chars, 1 + get_byte(v_bytes, v_idx) % length(v_chars), 1);
    end loop;
    begin
      insert into groups (name, invite_code, created_by)
        values (v_name, v_code, v_uid)
        returning * into v_group;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  -- One-group-per-user unique index (010) makes a concurrent double create
  -- fail here, rolling back the group insert too.
  insert into group_members (group_id, user_id, role)
    values (v_group.id, v_uid, 'owner');

  return v_group;
end;
$$ language plpgsql security definer volatile set search_path = public;

create or replace function join_group_by_code(p_code text)
returns groups as $$
declare
  v_uid uuid := auth.uid();
  v_group groups;
  v_current uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_group from groups
    where invite_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'invalid_invite_code' using errcode = 'P0002';
  end if;

  select group_id into v_current from group_members where user_id = v_uid;
  if v_current is not null then
    if v_current = v_group.id then
      return v_group; -- already a member of this group: idempotent
    end if;
    raise exception 'already_in_group' using errcode = 'P0001';
  end if;

  insert into group_members (group_id, user_id, role)
    values (v_group.id, v_uid, 'member');

  return v_group;
end;
$$ language plpgsql security definer volatile set search_path = public;

create or replace function leave_group(p_group_id uuid)
returns void as $$
declare
  v_uid uuid := auth.uid();
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Serialize concurrent leaves of the same group so ownership hand-off and
  -- last-member deletion can't race.
  perform 1 from groups where id = p_group_id for update;

  delete from group_members where group_id = p_group_id and user_id = v_uid;
  if not found then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  if not exists (select 1 from group_members where group_id = p_group_id) then
    -- Last member out: delete the group. Shared rows fall back to personal
    -- rows of their authors via group_id's ON DELETE SET NULL (011).
    delete from groups where id = p_group_id;
    return;
  end if;

  if not exists (
    select 1 from group_members where group_id = p_group_id and role = 'owner'
  ) then
    select user_id into v_next from group_members
      where group_id = p_group_id
      order by joined_at asc, user_id asc
      limit 1;
    update group_members set role = 'owner'
      where group_id = p_group_id and user_id = v_next;
  end if;
end;
$$ language plpgsql security definer volatile set search_path = public;

create or replace function delete_group(p_group_id uuid)
returns void as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not is_owner_of(p_group_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  -- group_members cascade; shared financial rows revert to their authors'
  -- personal rows (group_id ON DELETE SET NULL).
  delete from groups where id = p_group_id;
end;
$$ language plpgsql security definer volatile set search_path = public;

revoke execute on function create_group(text) from public, anon;
revoke execute on function join_group_by_code(text) from public, anon;
revoke execute on function leave_group(uuid) from public, anon;
revoke execute on function delete_group(uuid) from public, anon;
grant execute on function create_group(text) to authenticated;
grant execute on function join_group_by_code(text) to authenticated;
grant execute on function leave_group(uuid) to authenticated;
grant execute on function delete_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Budgets uniqueness for the mixed model: one budget per scope (group if
--    shared, else the author) + month + category.
--
--    budget_scope is a stored generated column, so old clients never send it
--    and keep working. New clients upsert with
--    onConflict = 'budget_scope,ym_char6,category_id'.
--
--    001's unique(user_id, ym_char6, category_id) is KEPT: pre-012 clients
--    name it as their onConflict target for personal budgets.
-- ---------------------------------------------------------------------------
alter table budgets
  add column if not exists budget_scope uuid
  generated always as (coalesce(group_id, user_id)) stored;

-- Pre-012 clients in group mode upsert with onConflict
-- 'group_id,ym_char6,category_id'. 011's index was partial, which ON CONFLICT
-- can't infer without a matching predicate; a non-partial unique index on the
-- same columns has identical semantics (NULL group_ids never collide) and is
-- inferable, so those clients keep (or start) working.
create unique index if not exists idx_budgets_group_ym_category
  on budgets(group_id, ym_char6, category_id);
drop index if exists idx_budgets_group_unique;

-- Existing data can't violate the new key: personal rows (group_id null) are
-- already unique per (user_id, ym, category) via 001's constraint, shared rows
-- per (group_id, ym, category) via 011's index, and a group id never equals a
-- user id. Soft-deleted rows were covered by those constraints too. Rather
-- than silently hard-deleting financial data if that invariant was somehow
-- broken, fail loudly so an operator can resolve the duplicates.
do $$
begin
  if exists (
    select 1 from budgets
    group by coalesce(group_id, user_id), ym_char6, category_id
    having count(*) > 1
  ) then
    raise exception
      'budgets has duplicate (budget_scope, ym_char6, category_id) rows; resolve them before applying 012';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'budgets_scope_ym_category_key'
      and conrelid = 'public.budgets'::regclass
  ) then
    alter table budgets
      add constraint budgets_scope_ym_category_key
      unique (budget_scope, ym_char6, category_id);
  end if;
end $$;

-- Drop existing recursive policies
drop policy if exists "members can view their groups" on groups;
drop policy if exists "members can see group members" on group_members;
drop policy if exists "group members can view expenses" on expenses;
drop policy if exists "group members can add expenses" on expenses;
drop policy if exists "group members can view splits" on expense_splits;
drop policy if exists "group members can insert splits" on expense_splits;

-- SECURITY DEFINER function — bypasses RLS, breaks recursion
create or replace function is_member_of(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from group_members
    where group_id = gid and user_id = auth.uid()
  )
$$;

-- Profiles table (display names)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_color text not null default '#6366f1',
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "users can view all profiles" on profiles for select using (true);
create policy "users can update own profile" on profiles for update using (auth.uid() = id);
create policy "users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup (uses display_name from user metadata if provided)
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Recreate groups policies (non-recursive)
create policy "members can view their groups" on groups
  for select using (is_member_of(id) or created_by = auth.uid());

-- Recreate group_members policies (uses SECURITY DEFINER fn)
create policy "members can see group members" on group_members
  for select using (is_member_of(group_id));

-- Recreate expenses policies
create policy "group members can view expenses" on expenses
  for select using (is_member_of(group_id));

create policy "group members can add expenses" on expenses
  for insert with check (is_member_of(group_id) and auth.uid() = paid_by);

-- Recreate expense_splits policies
create policy "group members can view splits" on expense_splits
  for select using (
    exists (
      select 1 from expenses e where e.id = expense_splits.expense_id
      and is_member_of(e.group_id)
    )
  );

create policy "group members can insert splits" on expense_splits
  for insert with check (
    exists (
      select 1 from expenses e where e.id = expense_splits.expense_id
      and is_member_of(e.group_id)
    )
  );

-- Backfill profiles for existing users (best effort)
insert into profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

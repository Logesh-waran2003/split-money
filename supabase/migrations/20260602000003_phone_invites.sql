-- Add phone to profiles
alter table profiles add column if not exists phone text;
create unique index if not exists profiles_phone_idx on profiles(phone) where phone is not null;

-- Pending group invites by phone
create table if not exists group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade not null,
  invited_by uuid references auth.users(id) not null,
  phone text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now()
);
alter table group_invites enable row level security;

-- Helper: reuse is_member_of if it exists, otherwise inline the check
-- Group members can create invites
create policy "group members can invite" on group_invites
  for insert with check (
    exists (select 1 from group_members where group_id = group_invites.group_id and user_id = auth.uid())
    and auth.uid() = invited_by
  );

-- Group members can view invites for their group
create policy "group members can view invites" on group_invites
  for select using (
    exists (select 1 from group_members where group_id = group_invites.group_id and user_id = auth.uid())
  );

-- Anyone authenticated can accept invites (needed during signup flow)
create policy "users can accept invites" on group_invites
  for update using (auth.uid() is not null)
  with check (status = 'accepted');

-- Safe phone lookup — returns user_id if profile with that phone exists
create or replace function find_user_by_phone(phone_input text)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  found_id uuid;
begin
  select id into found_id from profiles where phone = trim(phone_input) limit 1;
  return found_id;
end;
$$;
grant execute on function find_user_by_phone(text) to authenticated;

-- Accept all pending invites for a phone number — called on signup
create or replace function accept_phone_invites(phone_input text, new_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  for inv in
    select * from group_invites
    where phone = trim(phone_input) and status = 'pending'
  loop
    -- Add to group_members (ignore if already there)
    insert into group_members (group_id, user_id)
    values (inv.group_id, new_user_id)
    on conflict do nothing;
    -- Mark invite accepted
    update group_invites set status = 'accepted' where id = inv.id;
  end loop;
end;
$$;
grant execute on function accept_phone_invites(text, uuid) to authenticated;

-- Safe email lookup function — returns user_id if they exist, null if not
create or replace function find_user_by_email(email_input text)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  found_id uuid;
begin
  select id into found_id from auth.users where email = lower(trim(email_input)) limit 1;
  return found_id;
end;
$$;

-- Grant execute to authenticated users
grant execute on function find_user_by_email(text) to authenticated;

-- Allow existing group members to add others (not just creators)
drop policy if exists "group creators can add members" on group_members;
create policy "group members can add others" on group_members
  for insert with check (
    is_member_of(group_id) or user_id = auth.uid()
  );

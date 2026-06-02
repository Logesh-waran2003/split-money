create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade not null,
  from_user uuid references auth.users(id) not null,
  to_user uuid references auth.users(id) not null,
  amount numeric(10,2) not null,
  note text not null default '',
  created_at timestamptz default now()
);
alter table settlements enable row level security;
create policy "group members can view settlements" on settlements
  for select using (is_member_of(group_id));
create policy "group members can record settlements" on settlements
  for insert with check (is_member_of(group_id) and auth.uid() = from_user);

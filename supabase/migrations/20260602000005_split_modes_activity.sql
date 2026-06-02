alter table expenses add column if not exists split_mode text not null default 'equal'
  check (split_mode in ('equal', 'exact', 'percentage', 'shares'));

create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  action text not null,
  meta jsonb not null default '{}',
  created_at timestamptz default now()
);
alter table activity enable row level security;
create policy "group members can view activity" on activity
  for select using (is_member_of(group_id));
create policy "group members can insert activity" on activity
  for insert with check (is_member_of(group_id) and auth.uid() = user_id);

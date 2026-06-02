-- Groups
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now()
);

-- Group members
create table group_members (
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- Expenses
create table expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade not null,
  paid_by uuid references auth.users(id) not null,
  amount numeric(10,2) not null,
  description text not null,
  created_at timestamptz default now()
);

-- Expense splits (who owes what for each expense)
create table expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid references expenses(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  amount numeric(10,2) not null,
  settled boolean default false
);

-- RLS
alter table groups enable row level security;
alter table group_members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;

-- Groups: members can see their groups
create policy "members can view their groups" on groups
  for select using (
    exists (select 1 from group_members where group_id = id and user_id = auth.uid())
    or created_by = auth.uid()
  );

create policy "authenticated users can create groups" on groups
  for insert with check (auth.uid() = created_by);

-- Group members
create policy "members can see group members" on group_members
  for select using (
    exists (select 1 from group_members gm where gm.group_id = group_members.group_id and gm.user_id = auth.uid())
  );

create policy "group creators can add members" on group_members
  for insert with check (
    exists (select 1 from groups where id = group_id and created_by = auth.uid())
    or user_id = auth.uid()
  );

-- Expenses
create policy "group members can view expenses" on expenses
  for select using (
    exists (select 1 from group_members where group_id = expenses.group_id and user_id = auth.uid())
  );

create policy "group members can add expenses" on expenses
  for insert with check (
    exists (select 1 from group_members where group_id = expenses.group_id and user_id = auth.uid())
    and auth.uid() = paid_by
  );

-- Expense splits
create policy "group members can view splits" on expense_splits
  for select using (
    exists (
      select 1 from expenses e
      join group_members gm on gm.group_id = e.group_id
      where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
    )
  );

create policy "group members can insert splits" on expense_splits
  for insert with check (
    exists (
      select 1 from expenses e
      join group_members gm on gm.group_id = e.group_id
      where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
    )
  );

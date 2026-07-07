-- ============================================================================
-- FinTrack AI — Phase 1 schema, RLS, triggers, balance view, storage, realtime.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: everything is idempotent.
-- ============================================================================

create extension if not exists pgcrypto;

-- --- Tables -----------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  currency text not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  type text not null check (type in ('bank','cash','wallet','credit_card')),
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  amount numeric not null check (amount >= 0),
  type text not null default 'expense' check (type in ('expense','income')),
  merchant text,
  txn_date date not null,
  source text not null check (source in ('manual','nl','receipt','upi','csv')),
  raw_text text,
  receipt_path text,               -- path in the private 'receipts' storage bucket
  confidence numeric,              -- 0..1 categorization confidence
  needs_review boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  limit_amount numeric not null check (limit_amount >= 0),
  period text not null default 'monthly' check (period in ('monthly','weekly')),
  unique (user_id, category_id, period)
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  deadline date,
  current_amount numeric not null default 0,
  created_at timestamptz not null default now()
);

-- --- Indexes ----------------------------------------------------------------
create index if not exists transactions_user_date_idx on transactions (user_id, txn_date desc);
create index if not exists transactions_user_cat_idx on transactions (user_id, category_id);
create index if not exists categories_user_idx on categories (user_id);
create index if not exists budgets_user_idx on budgets (user_id);

-- --- Row-Level Security -----------------------------------------------------
-- Non-negotiable for a finance app: a user can only ever read/write their own rows.
alter table profiles     enable row level security;
alter table accounts     enable row level security;
alter table categories   enable row level security;
alter table transactions enable row level security;
alter table budgets      enable row level security;
alter table goals        enable row level security;

do $$
begin
  -- profiles keyed on id; the rest on user_id
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='own profile') then
    create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where tablename='accounts' and policyname='own accounts') then
    create policy "own accounts" on accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='categories' and policyname='own categories') then
    create policy "own categories" on categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='transactions' and policyname='own transactions') then
    create policy "own transactions" on transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='budgets' and policyname='own budgets') then
    create policy "own budgets" on budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='goals' and policyname='own goals') then
    create policy "own goals" on goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- --- New-user bootstrap: profile + default categories + a Cash account -------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name)
    values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
    on conflict (id) do nothing;

  insert into categories (user_id, name, is_default) values
    (new.id,'Food & Dining',true),(new.id,'Groceries',true),(new.id,'Transport',true),
    (new.id,'Shopping',true),(new.id,'Bills & Utilities',true),(new.id,'Rent',true),
    (new.id,'Entertainment',true),(new.id,'Health',true),(new.id,'Income',true),(new.id,'Others',true);

  insert into accounts (user_id, name, type) values (new.id, 'Cash', 'cash');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- --- Running balance (derived, never stored) --------------------------------
-- security_invoker => the view respects the caller's RLS on transactions.
create or replace view v_balances with (security_invoker = on) as
  select user_id,
         coalesce(sum(case when type = 'income' then amount else -amount end), 0) as balance
  from transactions
  group by user_id;

grant select on v_balances to authenticated;

-- --- Storage: private 'receipts' bucket, per-user folders --------------------
insert into storage.buckets (id, name, public)
  values ('receipts','receipts', false)
  on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='receipts owner rw') then
    create policy "receipts owner rw" on storage.objects for all
      using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- --- Realtime: broadcast row changes so the dashboard updates live ----------
do $$
declare t text;
begin
  foreach t in array array['transactions','budgets','accounts','categories','goals'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;  -- already added
    end;
  end loop;
end $$;

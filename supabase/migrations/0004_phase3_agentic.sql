-- ============================================================================
-- FinTrack AI — Phase 3: agentic layer.
-- In-app notification center + deterministic SQL nudge generation, run daily
-- by pg_cron and on-demand per user. Detection is pure SQL — explainable and
-- testable; no LLM involved in deciding WHAT to nudge about. Idempotent.
-- ============================================================================

-- --- Notification center ------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('budget','forecast','anomaly','subscription','trend','tip')),
  severity text not null default 'info' check (severity in ('info','warn','alert')),
  title text not null,
  body text not null,
  dedupe_key text not null,          -- prevents re-nudging the same fact
  read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='own notifications') then
    create policy "own notifications" on notifications for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

do $$ begin
  execute 'alter publication supabase_realtime add table public.notifications';
exception when duplicate_object then null; end $$;

-- --- Deterministic nudge generation -------------------------------------------
-- Inserts unread nudges for one user; dedupe_key + ON CONFLICT keep it idempotent.
create or replace function generate_nudges(u uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  ym text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYYMM');
  today date := (now() at time zone 'Asia/Kolkata')::date;
  day_of_month int := extract(day from (now() at time zone 'Asia/Kolkata'))::int;
  days_total int := extract(day from (date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month - 1 day'))::int;
  inserted int := 0;
  n int;
begin
  -- 1) Budget usage this month: >=100% (alert) or >=80% (warn)
  with spend as (
    select b.id bid, coalesce(c.name,'?') cat, b.limit_amount,
           coalesce(sum(t.amount) filter (where t.type='expense'
             and date_trunc('month', t.txn_date) = date_trunc('month', today)), 0) spent
    from budgets b
    join categories c on c.id = b.category_id
    left join transactions t on t.user_id = b.user_id and t.category_id = b.category_id
    where b.user_id = u and b.limit_amount > 0
    group by b.id, c.name, b.limit_amount
  )
  insert into notifications (user_id, kind, severity, title, body, dedupe_key)
  select u, 'budget',
         case when spent >= limit_amount then 'alert' else 'warn' end,
         case when spent >= limit_amount then cat || ' budget exceeded'
              else round(100*spent/limit_amount) || '% through ' || cat || ' budget' end,
         'You''ve spent ₹' || to_char(round(spent), 'FM9,99,99,999') || ' of your ₹'
           || to_char(round(limit_amount), 'FM9,99,99,999') || ' ' || cat || ' budget this month.',
         'budget-' || bid || '-' || ym || case when spent >= limit_amount then '-100' else '-80' end
  from spend
  where spent >= 0.8 * limit_amount
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count; inserted := inserted + n;

  -- 2) Pace: projected month-end (linear day rate) overshoots budget by >5%
  if day_of_month >= 5 then
    with spend as (
      select b.id bid, coalesce(c.name,'?') cat, b.limit_amount,
             coalesce(sum(t.amount) filter (where t.type='expense'
               and date_trunc('month', t.txn_date) = date_trunc('month', today)), 0) spent
      from budgets b
      join categories c on c.id = b.category_id
      left join transactions t on t.user_id = b.user_id and t.category_id = b.category_id
      where b.user_id = u and b.limit_amount > 0
      group by b.id, c.name, b.limit_amount
    )
    insert into notifications (user_id, kind, severity, title, body, dedupe_key)
    select u, 'forecast', 'warn',
           'On pace to overshoot ' || cat,
           'At this rate you''ll spend about ₹' || to_char(round(spent / day_of_month * days_total), 'FM9,99,99,999')
             || ' on ' || cat || ' this month — over your ₹' || to_char(round(limit_amount), 'FM9,99,99,999') || ' budget.',
           'pace-' || bid || '-' || ym
    from spend
    where spent > 0 and (spent / day_of_month * days_total) > limit_amount * 1.05
      and spent < limit_amount  -- the >=100% case is covered by the budget nudge
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;
  end if;

  -- 3) Anomalies: last-14-day expenses > 3x the category median (60d) and > ₹1500
  with med as (
    select category_id, percentile_cont(0.5) within group (order by amount) m
    from transactions
    where user_id = u and type = 'expense' and txn_date >= today - 60 and category_id is not null
    group by category_id
    having count(*) >= 4
  )
  insert into notifications (user_id, kind, severity, title, body, dedupe_key)
  select u, 'anomaly', 'alert',
         'Unusual ' || coalesce(c.name,'') || ' charge',
         '₹' || to_char(round(t.amount), 'FM9,99,99,999') || ' at ' || coalesce(t.merchant,'an unknown merchant')
           -- med.m is double precision (percentile_cont); round(double, int) doesn't exist
           || ' is ' || round((t.amount / med.m)::numeric, 1) || 'x your typical ' || coalesce(c.name,'') || ' spend.',
         'anom-' || t.id
  from transactions t
  join med on med.category_id = t.category_id
  left join categories c on c.id = t.category_id
  where t.user_id = u and t.type = 'expense'
    and t.txn_date >= today - 14
    and t.amount > 3 * med.m and t.amount > 1500
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count; inserted := inserted + n;

  -- 4) Possibly-unused subscriptions: recurring same-amount merchant charges
  --    (>=2 occurrences across >=2 months) not seen for > 40 days
  with rec as (
    select merchant, round(amount) amt, count(*) cnt,
           count(distinct date_trunc('month', txn_date)) months, max(txn_date) last_seen
    from transactions
    where user_id = u and type = 'expense' and merchant is not null
      and coalesce((select cc.name from categories cc where cc.id = category_id), '') <> 'Rent'
    group by merchant, round(amount)
    having count(*) >= 2 and count(distinct date_trunc('month', txn_date)) >= 2
  )
  insert into notifications (user_id, kind, severity, title, body, dedupe_key)
  select u, 'subscription', 'info',
         'Unused ' || merchant || ' subscription?',
         merchant || ' charged ₹' || to_char(amt, 'FM9,99,99,999') || ' for ' || months
           || ' months but hasn''t recurred since ' || to_char(last_seen, 'DD Mon') || '. Cancel if unused.',
         'subun-' || merchant || '-' || amt
  from rec
  where last_seen < today - 40
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count; inserted := inserted + n;

  return inserted;
end $$;

-- On-demand refresh for the signed-in user (called when the app opens).
create or replace function refresh_my_nudges() returns int
language sql security definer set search_path = public as $$
  select generate_nudges(auth.uid());
$$;
grant execute on function refresh_my_nudges() to authenticated;

-- --- Daily schedule (9:00 IST) -------------------------------------------------
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('fintrack-daily-nudges'); exception when others then null; end $$;
select cron.schedule('fintrack-daily-nudges', '30 3 * * *',
  $$select generate_nudges(id) from profiles$$);

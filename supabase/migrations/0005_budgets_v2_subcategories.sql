-- ============================================================================
-- FinTrack AI — budgets v2 + hierarchical categories.
--  · categories get parent_id (subcategories); default taxonomy seeded for
--    existing users and for new signups (trigger updated).
--  · budgets become named, multi-category (uuid[]), weekly/monthly/yearly,
--    with per-budget notification toggles.
--  · generate_nudges rewritten for budgets v2 (period windows, subcat rollup,
--    notify flags respected).
-- Idempotent.
-- ============================================================================

-- --- 1. Subcategories --------------------------------------------------------
alter table categories add column if not exists parent_id uuid references categories(id) on delete cascade;
create index if not exists categories_parent_idx on categories (user_id, parent_id);

-- Default taxonomy (top-level name -> subcategories). Kept in one place so the
-- user's own taxonomy can replace it later with a pure data update.
create or replace function seed_subcategories(u uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  taxonomy jsonb := '{
    "Food & Dining":    ["Restaurants","Cafes & Coffee","Fast Food","Food Delivery"],
    "Groceries":        ["Supermarket","Vegetables & Fruits","Quick Commerce"],
    "Transport":        ["Fuel","Cab & Auto","Metro & Bus","Train & Flights"],
    "Shopping":         ["Clothes & Shoes","Electronics","Home & Garden","Beauty & Care","Gifts"],
    "Bills & Utilities":["Electricity","Mobile & Internet","Water & Gas","OTT & Subscriptions"],
    "Rent":             ["House Rent","Maintenance"],
    "Entertainment":    ["Movies & Events","Games","Streaming","Hobbies"],
    "Health":           ["Pharmacy","Doctor & Hospital","Fitness","Insurance"],
    "Income":           ["Salary","Freelance","Refunds & Cashback","Interest"],
    "Others":           ["Education","Charity","Fees & Charges","Miscellaneous"]
  }'::jsonb;
  parent record;
  sub text;
begin
  for parent in
    select id, name from categories where user_id = u and parent_id is null
  loop
    if taxonomy ? parent.name then
      for sub in select jsonb_array_elements_text(taxonomy -> parent.name)
      loop
        insert into categories (user_id, name, is_default, parent_id)
        select u, sub, true, parent.id
        where not exists (
          select 1 from categories c where c.user_id = u and c.name = sub and c.parent_id = parent.id
        );
      end loop;
    end if;
  end loop;
end $$;

-- Seed for every existing user.
do $$
declare p record;
begin
  for p in select id from profiles loop
    perform seed_subcategories(p.id);
  end loop;
end $$;

-- New signups get top-level categories + taxonomy + Cash account.
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

  perform seed_subcategories(new.id);
  insert into accounts (user_id, name, type) values (new.id, 'Cash', 'cash');
  return new;
end $$;

-- --- 2. Budgets v2 ------------------------------------------------------------
alter table budgets add column if not exists name text;
alter table budgets add column if not exists category_ids uuid[] not null default '{}';
alter table budgets add column if not exists notify_trending boolean not null default true;
alter table budgets add column if not exists notify_over boolean not null default true;

-- period: weekly | monthly | yearly
alter table budgets drop constraint if exists budgets_period_check;
alter table budgets add constraint budgets_period_check check (period in ('weekly','monthly','yearly'));

-- migrate legacy single-category rows, then retire the old shape
update budgets set category_ids = array[category_id]
  where category_id is not null and (category_ids is null or cardinality(category_ids) = 0);
alter table budgets drop constraint if exists budgets_user_id_category_id_period_key;
alter table budgets alter column category_id drop not null;

-- name legacy budgets after their category
update budgets b set name = c.name
  from categories c
  where b.name is null and c.id = b.category_ids[1];

-- --- 3. Nudges v2 --------------------------------------------------------------
create or replace function generate_nudges(u uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  inserted int := 0;
  n int;
  b record;
  period_start date;
  period_end date;
  period_key text;
  elapsed int;
  total_days int;
  spent numeric;
  label text;
begin
  -- 1) Budget usage + pace, per budget (multi-category, subcats roll up)
  for b in
    select id, coalesce(name, 'Budget') as bname, limit_amount, period,
           category_ids, notify_trending, notify_over
    from budgets where user_id = u and limit_amount > 0 and cardinality(category_ids) > 0
  loop
    if b.period = 'weekly' then
      period_start := date_trunc('week', today)::date;
      period_end := period_start + 6;
      period_key := to_char(today, 'IYYY"w"IW');
    elsif b.period = 'yearly' then
      period_start := date_trunc('year', today)::date;
      period_end := (date_trunc('year', today) + interval '1 year - 1 day')::date;
      period_key := to_char(today, 'YYYY');
    else
      period_start := date_trunc('month', today)::date;
      period_end := (date_trunc('month', today) + interval '1 month - 1 day')::date;
      period_key := to_char(today, 'YYYYMM');
    end if;
    elapsed := (today - period_start) + 1;
    total_days := (period_end - period_start) + 1;
    label := b.bname;

    select coalesce(sum(t.amount), 0) into spent
    from transactions t
    where t.user_id = u and t.type = 'expense'
      and t.txn_date between period_start and today
      and (t.category_id = any(b.category_ids)
           or t.category_id in (select id from categories where parent_id = any(b.category_ids)));

    if b.notify_over then
      if spent >= b.limit_amount then
        insert into notifications (user_id, kind, severity, title, body, dedupe_key)
        values (u, 'budget', 'alert', label || ' budget exceeded',
                'You''ve spent ₹' || to_char(round(spent), 'FM9,99,99,999') || ' of your ₹'
                  || to_char(round(b.limit_amount), 'FM9,99,99,999') || ' ' || label || ' budget this ' ||
                  case b.period when 'weekly' then 'week' when 'yearly' then 'year' else 'month' end || '.',
                'budget-' || b.id || '-' || period_key || '-100')
        on conflict (user_id, dedupe_key) do nothing;
        get diagnostics n = row_count; inserted := inserted + n;
      elsif spent >= 0.8 * b.limit_amount then
        insert into notifications (user_id, kind, severity, title, body, dedupe_key)
        values (u, 'budget', 'warn', round(100 * spent / b.limit_amount) || '% through ' || label || ' budget',
                'You''ve spent ₹' || to_char(round(spent), 'FM9,99,99,999') || ' of ₹'
                  || to_char(round(b.limit_amount), 'FM9,99,99,999') || '.',
                'budget-' || b.id || '-' || period_key || '-80')
        on conflict (user_id, dedupe_key) do nothing;
        get diagnostics n = row_count; inserted := inserted + n;
      end if;
    end if;

    if b.notify_trending and elapsed >= greatest(3, total_days / 6) and spent > 0 and spent < b.limit_amount
       and (spent / elapsed * total_days) > b.limit_amount * 1.05 then
      insert into notifications (user_id, kind, severity, title, body, dedupe_key)
      values (u, 'forecast', 'warn', 'On pace to overshoot ' || label,
              'At this rate you''ll spend about ₹' || to_char(round(spent / elapsed * total_days), 'FM9,99,99,999')
                || ' — over your ₹' || to_char(round(b.limit_amount), 'FM9,99,99,999') || ' ' || label || ' budget.',
              'pace-' || b.id || '-' || period_key)
      on conflict (user_id, dedupe_key) do nothing;
      get diagnostics n = row_count; inserted := inserted + n;
    end if;
  end loop;

  -- 2) Anomalies (unchanged: >3x the 60-day category median, last 14 days)
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

  -- 3) Possibly-unused subscriptions (unchanged)
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

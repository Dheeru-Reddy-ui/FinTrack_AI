-- ============================================================================
-- FinTrack AI — Phase 2, step 2: deterministic aggregation tools for the RAG
-- agent. All SECURITY INVOKER + explicit auth.uid() filter + RLS: a caller can
-- only ever aggregate their own rows. The LLM never does arithmetic — these do.
-- Idempotent.
-- ============================================================================

-- Overall totals for a date range.
create or replace function agg_summary(from_date date default null, to_date date default null)
returns table (income numeric, expense numeric, net numeric, txn_count bigint)
language sql stable set search_path = public as $$
  select
    coalesce(sum(amount) filter (where type = 'income'), 0)  as income,
    coalesce(sum(amount) filter (where type = 'expense'), 0) as expense,
    coalesce(sum(case when type = 'income' then amount else -amount end), 0) as net,
    count(*) as txn_count
  from transactions
  where user_id = auth.uid()
    and (from_date is null or txn_date >= from_date)
    and (to_date  is null or txn_date <= to_date);
$$;

-- Spend grouped by category (expenses by default).
create or replace function agg_by_category(from_date date default null, to_date date default null, txn_type text default 'expense')
returns table (category text, total numeric, txn_count bigint)
language sql stable set search_path = public as $$
  select coalesce(c.name, 'Uncategorized') as category, sum(t.amount) as total, count(*) as txn_count
  from transactions t
  left join categories c on c.id = t.category_id
  where t.user_id = auth.uid() and t.type = txn_type
    and (from_date is null or t.txn_date >= from_date)
    and (to_date  is null or t.txn_date <= to_date)
  group by 1
  order by 2 desc;
$$;

-- Largest transactions in a range.
create or replace function agg_top_txns(from_date date default null, to_date date default null, k int default 5, txn_type text default 'expense')
returns table (id uuid, merchant text, category text, amount numeric, txn_date date)
language sql stable set search_path = public as $$
  select t.id, t.merchant, coalesce(c.name, 'Uncategorized') as category, t.amount, t.txn_date
  from transactions t
  left join categories c on c.id = t.category_id
  where t.user_id = auth.uid() and t.type = txn_type
    and (from_date is null or t.txn_date >= from_date)
    and (to_date  is null or t.txn_date <= to_date)
  order by t.amount desc
  limit greatest(1, least(coalesce(k, 5), 20));
$$;

-- Stats for merchants matching a substring (e.g. "swiggy").
create or replace function agg_merchant(merchant_q text, from_date date default null, to_date date default null)
returns table (merchant text, total numeric, txn_count bigint, avg_amount numeric, last_date date)
language sql stable set search_path = public as $$
  select t.merchant, sum(t.amount) as total, count(*) as txn_count,
         round(avg(t.amount), 2) as avg_amount, max(t.txn_date) as last_date
  from transactions t
  where t.user_id = auth.uid()
    and t.merchant ilike '%' || merchant_q || '%'
    and (from_date is null or t.txn_date >= from_date)
    and (to_date  is null or t.txn_date <= to_date)
  group by t.merchant
  order by 2 desc;
$$;

-- The user's distinct merchants (helps the planner map words → merchants).
create or replace function agg_merchant_list()
returns table (merchant text)
language sql stable set search_path = public as $$
  select distinct merchant from transactions
  where user_id = auth.uid() and merchant is not null
  limit 200;
$$;

grant execute on function agg_summary(date, date) to authenticated;
grant execute on function agg_by_category(date, date, text) to authenticated;
grant execute on function agg_top_txns(date, date, int, text) to authenticated;
grant execute on function agg_merchant(text, date, date) to authenticated;
grant execute on function agg_merchant_list() to authenticated;

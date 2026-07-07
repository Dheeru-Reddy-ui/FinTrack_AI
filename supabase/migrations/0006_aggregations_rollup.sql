-- ============================================================================
-- FinTrack AI — roll subcategories up to their top-level parent in the RAG
-- aggregation tools, so category-level questions ("how much on Food & Dining")
-- correctly include spend classified into subcategories ("Restaurants",
-- "Food Delivery", …). match_transactions keeps the precise (sub)category for
-- retrieval context. Idempotent (create or replace).
-- ============================================================================

-- top-level group name for a transaction's category (self if already top-level)
create or replace function agg_by_category(from_date date default null, to_date date default null, txn_type text default 'expense')
returns table (category text, total numeric, txn_count bigint)
language sql stable set search_path = public as $$
  select coalesce(p.name, c.name, 'Uncategorized') as category, sum(t.amount) as total, count(*) as txn_count
  from transactions t
  left join categories c on c.id = t.category_id
  left join categories p on p.id = c.parent_id
  where t.user_id = auth.uid() and t.type = txn_type
    and (from_date is null or t.txn_date >= from_date)
    and (to_date  is null or t.txn_date <= to_date)
  group by 1
  order by 2 desc;
$$;

create or replace function agg_top_txns(from_date date default null, to_date date default null, k int default 5, txn_type text default 'expense')
returns table (id uuid, merchant text, category text, amount numeric, txn_date date)
language sql stable set search_path = public as $$
  select t.id, t.merchant, coalesce(p.name, c.name, 'Uncategorized') as category, t.amount, t.txn_date
  from transactions t
  left join categories c on c.id = t.category_id
  left join categories p on p.id = c.parent_id
  where t.user_id = auth.uid() and t.type = txn_type
    and (from_date is null or t.txn_date >= from_date)
    and (to_date  is null or t.txn_date <= to_date)
  order by t.amount desc
  limit greatest(1, least(coalesce(k, 5), 20));
$$;

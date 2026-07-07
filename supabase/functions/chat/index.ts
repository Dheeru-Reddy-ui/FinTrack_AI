// FinTrack AI — `chat` Edge Function: the conversational RAG agent.
//
// Flow: plan (LLM, deterministic fallback) → deterministic SQL aggregation
// tools (never LLM arithmetic) → pgvector retrieval for supporting rows →
// LLM phrasing constrained to the computed numbers (template fallback).
// Every step degrades gracefully: with Gemini fully down the user still gets a
// correct, templated answer straight from SQL.
//
// Security: verify_jwt is ON; we additionally build an RLS-scoped client from
// the caller's Authorization header, so every query/RPC only touches the
// caller's rows. The Gemini key exists only as a server-side secret. No
// transaction data is ever logged.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const EMBED_MODEL = 'gemini-embedding-001';
// Fallback chain: Gemini models first; Gemma last — it has a separate (much
// larger) free-tier quota, so phrasing survives Gemini daily-quota exhaustion.
const GEN_MODELS = [
  Deno.env.get('GEMINI_GEN_MODEL') ?? 'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemma-4-31b-it',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------- Gemini ----
// Every upstream call is time-capped: a stalled connection must never hang the
// whole function (clients time out and the request burns wall-clock quota).
async function gemini(model: string, body: unknown, timeoutMs: number): Promise<Response> {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** generateContent across the model fallback chain with 429 backoff, under a
 *  total time budget. Gemma models: no systemInstruction / JSON mode; they
 *  emit `thought` parts and code fences, so those are stripped in extraction. */
async function genText(system: string, user: string, json = false, budgetMs = 25_000): Promise<string | null> {
  if (!GEMINI_KEY) return null;
  const deadline = Date.now() + budgetMs;
  for (const model of GEN_MODELS) {
    const isGemma = model.startsWith('gemma');
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) return null;
      try {
        const body = isGemma
          ? {
              contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
            }
          : {
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts: [{ text: user }] }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 512,
                ...(json ? { responseMimeType: 'application/json' } : {}),
              },
            };
        const res = await gemini(model, body, Math.min(15_000, remaining));
        if (res.status === 429) {
          await res.body?.cancel();
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          break; // try next model
        }
        const data = await res.json();
        const cand = data?.candidates?.[0];
        const parts: { text?: string; thought?: boolean }[] = cand?.content?.parts ?? [];
        let text = parts
          .filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join('')
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        // Thinking models can hit the cap mid-sentence: for prose keep only
        // whole sentences; JSON is validated by the caller anyway.
        if (cand?.finishReason === 'MAX_TOKENS' && !json) text = text.replace(/[^.!?]*$/, '').trim();
        if (text) return text;
        break;
      } catch {
        break;
      }
    }
  }
  return null;
}

async function embedText(text: string): Promise<number[] | null> {
  if (!GEMINI_KEY) return null;
  const deadline = Date.now() + 12_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1500) return null;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }),
          signal: AbortSignal.timeout(Math.min(8_000, remaining)),
        },
      );
      if (res.status === 429) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return null;
      }
      const data = await res.json();
      const v = data?.embedding?.values;
      return Array.isArray(v) && v.length === 768 ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ------------------------------------------------------------------ dates ----
/** Today in IST (Asia/Kolkata) as a Date whose UTC getters hold IST values. */
function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 3600 * 1000);
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function istDate(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d));
}

// ------------------------------------------------------------------- plan ----
interface Plan {
  intent: 'total_spend' | 'breakdown' | 'top_expenses' | 'income' | 'savings' | 'compare' | 'compare_categories' | 'merchant' | 'count' | 'general';
  dateFrom: string | null;
  dateTo: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
  categories: string[];
  merchant: string | null;
  rangeLabel: string;
  source: 'llm' | 'rules';
}

const CATEGORY_ALIASES: Record<string, string> = {
  food: 'Food & Dining', dining: 'Food & Dining', restaurant: 'Food & Dining', eat: 'Food & Dining', eating: 'Food & Dining',
  grocery: 'Groceries', groceries: 'Groceries',
  transport: 'Transport', travel: 'Transport', cab: 'Transport', fuel: 'Transport', petrol: 'Transport', commute: 'Transport',
  shopping: 'Shopping', clothes: 'Shopping', electronics: 'Shopping',
  bill: 'Bills & Utilities', bills: 'Bills & Utilities', utilities: 'Bills & Utilities', electricity: 'Bills & Utilities', recharge: 'Bills & Utilities', internet: 'Bills & Utilities',
  rent: 'Rent',
  entertainment: 'Entertainment', netflix: 'Entertainment', spotify: 'Entertainment', movie: 'Entertainment', subscription: 'Entertainment', subscriptions: 'Entertainment',
  health: 'Health', gym: 'Health', medicine: 'Health', pharmacy: 'Health',
  salary: 'Income',
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function rulesPlan(question: string, merchants: string[]): Plan {
  const q = question.toLowerCase();
  const now = nowIST();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();

  // date range
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let rangeLabel = 'the last 30 days';
  const monthIdx = MONTHS.findIndex((m) => q.includes(m));
  const nDays = q.match(/last\s+(\d+)\s*days/);
  if (q.includes('last month') || q.includes('previous month')) {
    const s = istDate(y, m0 - 1, 1);
    dateFrom = iso(s); dateTo = iso(istDate(y, m0, 0)); rangeLabel = 'last month';
  } else if (q.includes('this month')) {
    dateFrom = iso(istDate(y, m0, 1)); dateTo = iso(now); rangeLabel = 'this month';
  } else if (q.includes('this week')) {
    const dow = (now.getUTCDay() + 6) % 7;
    dateFrom = iso(istDate(y, m0, now.getUTCDate() - dow)); dateTo = iso(now); rangeLabel = 'this week';
  } else if (q.includes('today')) {
    dateFrom = iso(now); dateTo = iso(now); rangeLabel = 'today';
  } else if (nDays) {
    const n = Math.min(365, parseInt(nDays[1], 10) || 30);
    dateFrom = iso(new Date(now.getTime() - n * 86400000)); dateTo = iso(now); rangeLabel = `the last ${n} days`;
  } else if (monthIdx >= 0) {
    const yy = monthIdx > m0 ? y - 1 : y; // a future-named month means last year's
    dateFrom = iso(istDate(yy, monthIdx, 1)); dateTo = iso(istDate(yy, monthIdx + 1, 0));
    rangeLabel = `${MONTHS[monthIdx][0].toUpperCase()}${MONTHS[monthIdx].slice(1)} ${yy}`;
  } else if (q.includes('year')) {
    dateFrom = iso(new Date(now.getTime() - 365 * 86400000)); dateTo = iso(now); rangeLabel = 'the last year';
  } else {
    dateFrom = iso(new Date(now.getTime() - 30 * 86400000)); dateTo = iso(now);
  }

  // categories
  const categories = [...new Set(Object.entries(CATEGORY_ALIASES).filter(([a]) => q.includes(a)).map(([, c]) => c))];

  // merchant: match against the user's real merchant list
  const merchant = merchants.find((m) => m && q.includes(m.toLowerCase())) ?? null;

  // intent
  let intent: Plan['intent'] = 'total_spend';
  if (q.includes('compare') || q.includes(' vs ') || q.includes('versus')) intent = 'compare';
  else if (categories.length >= 2 && (q.includes(' or ') || q.includes('more on'))) intent = 'compare_categories';
  else if (q.includes('which category') || (q.includes('categor') && (q.includes('most') || q.includes('highest'))) || q.includes('breakdown') || q.includes('where did')) intent = 'breakdown';
  else if (q.includes('biggest') || q.includes('largest') || q.includes('top ') || q.includes('most expensive')) intent = 'top_expenses';
  else if (q.includes('how many') || q.includes('count') || q.includes('number of') || q.includes('orders')) intent = 'count';
  else if (q.includes('income') || q.includes('earn') || q.includes('salary')) intent = 'income';
  else if (q.includes('save') || q.includes('saving') || q.includes('left over')) intent = 'savings';
  else if (merchant) intent = 'merchant';

  let plan: Plan = { intent, dateFrom, dateTo, categories, merchant, rangeLabel, source: 'rules' };
  if (intent === 'compare') {
    // default comparison: this month vs last month
    plan.dateFrom = iso(istDate(y, m0, 1)); plan.dateTo = iso(now);
    plan.compareFrom = iso(istDate(y, m0 - 1, 1)); plan.compareTo = iso(istDate(y, m0, 0));
    plan.rangeLabel = 'this month vs last month';
  }
  return plan;
}

async function llmPlan(question: string, merchants: string[], categories: string[]): Promise<Plan | null> {
  const today = iso(nowIST());
  const sys = `You convert a personal-finance question into a JSON retrieval plan. Today is ${today} (India).
Return ONLY JSON:
{"intent":"total_spend"|"breakdown"|"top_expenses"|"income"|"savings"|"compare"|"compare_categories"|"merchant"|"count"|"general",
 "dateFrom":"YYYY-MM-DD"|null,"dateTo":"YYYY-MM-DD"|null,
 "compareFrom":"YYYY-MM-DD"|null,"compareTo":"YYYY-MM-DD"|null,
 "categories":[...], "merchant":string|null, "rangeLabel":string}
Rules: categories must be from: ${categories.join(', ')}. merchant must be one of: ${merchants.slice(0, 60).join(', ')} or null.
If no timeframe is given use the last 30 days. compare* only for period comparisons (this vs last month).
Use "compare_categories" when asked which of two categories they spent more on (list both in categories).
Use "breakdown" when asked which category they spent the most on. rangeLabel is a short human phrase like "last month".`;
  const out = await genText(sys, question, true);
  if (!out) return null;
  try {
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    const p = JSON.parse(out.slice(start, end + 1));
    if (!p.intent) return null;
    return {
      intent: p.intent, dateFrom: p.dateFrom ?? null, dateTo: p.dateTo ?? null,
      compareFrom: p.compareFrom ?? null, compareTo: p.compareTo ?? null,
      categories: Array.isArray(p.categories) ? p.categories.filter((c: string) => categories.includes(c)) : [],
      merchant: typeof p.merchant === 'string' ? p.merchant : null,
      rangeLabel: p.rangeLabel || 'the selected period', source: 'llm',
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ facts ----
interface CatRow { category: string; total: number; txn_count: number }
interface Facts {
  summary: { income: number; expense: number; net: number; txn_count: number };
  byCategory: CatRow[];
  compareSummary?: { income: number; expense: number; net: number; txn_count: number };
  compareByCategory?: CatRow[];
  top?: { id: string; merchant: string | null; category: string; amount: number; txn_date: string }[];
  merchantStats?: { merchant: string; total: number; txn_count: number; avg_amount: number; last_date: string }[];
}

async function gatherFacts(db: SupabaseClient, plan: Plan): Promise<Facts> {
  const range = { from_date: plan.dateFrom, to_date: plan.dateTo };
  const [sumRes, catRes] = await Promise.all([
    db.rpc('agg_summary', range),
    db.rpc('agg_by_category', { ...range, txn_type: 'expense' }),
  ]);
  if (sumRes.error) throw sumRes.error;
  const facts: Facts = {
    summary: Array.isArray(sumRes.data) ? sumRes.data[0] : sumRes.data,
    byCategory: (catRes.data ?? []) as CatRow[],
  };
  if (plan.intent === 'compare' && plan.compareFrom) {
    const cmpRange = { from_date: plan.compareFrom, to_date: plan.compareTo };
    const [s2, c2] = await Promise.all([
      db.rpc('agg_summary', cmpRange),
      db.rpc('agg_by_category', { ...cmpRange, txn_type: 'expense' }),
    ]);
    facts.compareSummary = Array.isArray(s2.data) ? s2.data[0] : s2.data;
    facts.compareByCategory = (c2.data ?? []) as CatRow[];
  }
  if (plan.intent === 'top_expenses' || plan.intent === 'general') {
    const top = await db.rpc('agg_top_txns', { ...range, k: 5, txn_type: 'expense' });
    facts.top = top.data ?? [];
  }
  if (plan.merchant) {
    const m = await db.rpc('agg_merchant', { merchant_q: plan.merchant, ...range });
    facts.merchantStats = m.data ?? [];
  }
  return facts;
}

// -------------------------------------------------------------- retrieval ----
interface Retrieved { id: string; merchant: string | null; amount: number; type: string; txn_date: string; category: string; similarity: number }

async function retrieve(db: SupabaseClient, question: string, plan: Plan): Promise<Retrieved[]> {
  const vec = await embedText(question);
  if (!vec) return [];
  const { data, error } = await db.rpc('match_transactions', {
    query_embedding: `[${vec.join(',')}]`,
    match_count: 6,
    from_date: plan.dateFrom,
    to_date: plan.dateTo,
  });
  if (error) return [];
  return (data ?? []) as Retrieved[];
}

// ---------------------------------------------------------------- phrasing ----
const inr = (n: number) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;

function catTotal(facts: Facts, categories: string[], compare = false): number {
  const rows = (compare ? facts.compareByCategory : facts.byCategory) ?? [];
  if (!categories.length) return Number((compare ? facts.compareSummary : facts.summary)?.expense ?? 0);
  return rows.filter((r) => categories.includes(r.category)).reduce((a, r) => a + Number(r.total), 0);
}

function templateAnswer(plan: Plan, facts: Facts): string {
  const L = plan.rangeLabel;
  switch (plan.intent) {
    case 'income':
      return `Your income in ${L} was ${inr(facts.summary.income)}.`;
    case 'savings': {
      const net = Number(facts.summary.net);
      return `In ${L} you earned ${inr(facts.summary.income)} and spent ${inr(facts.summary.expense)}, ${net >= 0 ? 'saving' : 'overspending by'} ${inr(Math.abs(net))}.`;
    }
    case 'top_expenses': {
      if (!facts.top?.length) return `No expenses found in ${L}.`;
      const lines = facts.top.map((t, i) => `${i + 1}. ${inr(t.amount)} — ${t.merchant ?? t.category} (${t.category}, ${t.txn_date})`);
      return `Your biggest expenses in ${L}:\n${lines.join('\n')}`;
    }
    case 'compare': {
      const a = catTotal(facts, plan.categories);
      const b = catTotal(facts, plan.categories, true);
      const what = plan.categories.length ? plan.categories.join(' & ') : 'overall spending';
      const diff = a - b;
      const pct = b > 0 ? ` (${diff >= 0 ? '+' : ''}${Math.round((diff / b) * 100)}%)` : '';
      return `${what[0].toUpperCase()}${what.slice(1)}: ${inr(a)} this month vs ${inr(b)} last month — ${inr(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'}${pct}.`;
    }
    case 'merchant':
    case 'count': {
      const m = facts.merchantStats?.[0];
      if (m) return `${m.merchant}: ${m.txn_count} transactions in ${L}, totalling ${inr(m.total)} (avg ${inr(m.avg_amount)}).`;
      return `You made ${facts.summary.txn_count} transactions in ${L}, spending ${inr(facts.summary.expense)} in total.`;
    }
    case 'breakdown': {
      const top = facts.byCategory[0];
      if (!top) return `No expenses found in ${L}.`;
      const rest = facts.byCategory.slice(1, 3).map((c) => `${c.category} ${inr(c.total)}`).join(', ');
      return `Your top spending category in ${L} was ${top.category} at ${inr(top.total)}${rest ? `, followed by ${rest}` : ''}. Total spent: ${inr(facts.summary.expense)}.`;
    }
    case 'compare_categories': {
      const rows = plan.categories
        .map((c) => ({ c, v: catTotal(facts, [c]) }))
        .sort((a, b) => b.v - a.v);
      if (rows.length < 2) return `In ${L} you spent ${inr(catTotal(facts, plan.categories))} on ${plan.categories.join(' & ') || 'everything'}.`;
      return `In ${L}: ${rows.map((r) => `${r.c} ${inr(r.v)}`).join(' vs ')} — you spent more on ${rows[0].c}.`;
    }
    default: {
      const t = catTotal(facts, plan.categories);
      const what = plan.categories.length ? ` on ${plan.categories.join(' & ')}` : '';
      return `You spent ${inr(t)}${what} in ${L}.`;
    }
  }
}

async function phrase(question: string, plan: Plan, facts: Facts, retrieved: Retrieved[]): Promise<{ answer: string; phrasing: 'llm' | 'template' }> {
  const template = templateAnswer(plan, facts);
  const sys = `You are FinTrack AI, a friendly personal-finance assistant for an Indian user (₹).
Answer the question in 1-3 short sentences (or a short list for rankings) using ONLY the numbers given in FACTS.
Never invent or recompute numbers — restate them exactly. Mention the timeframe. Be warm but concise. No investment advice.`;
  const user = `Question: ${question}

FACTS (exact, already computed from the user's ledger):
- Timeframe: ${plan.rangeLabel} (${plan.dateFrom ?? 'start'} to ${plan.dateTo ?? 'today'})
- Precomputed answer: ${template}
- Summary: income ${inr(facts.summary.income)}, expenses ${inr(facts.summary.expense)}, net ${inr(facts.summary.net)}, ${facts.summary.txn_count} transactions
- By category: ${facts.byCategory.slice(0, 8).map((c) => `${c.category}=${inr(c.total)} (${c.txn_count})`).join('; ') || 'none'}
${facts.compareSummary ? `- Comparison period: expenses ${inr(facts.compareSummary.expense)}; by category: ${facts.compareByCategory?.slice(0, 8).map((c) => `${c.category}=${inr(c.total)}`).join('; ')}` : ''}
${facts.merchantStats?.length ? `- Merchant stats: ${facts.merchantStats.map((m) => `${m.merchant}: ${m.txn_count} txns, ${inr(m.total)} total, avg ${inr(m.avg_amount)}`).join('; ')}` : ''}
${facts.top?.length ? `- Largest: ${facts.top.map((t) => `${t.merchant ?? t.category} ${inr(t.amount)} on ${t.txn_date}`).join('; ')}` : ''}

Supporting transactions (for color only, never for totals): ${retrieved.slice(0, 5).map((r) => `${r.merchant ?? '—'} ${inr(r.amount)} ${r.category} ${r.txn_date}`).join('; ') || 'none'}`;
  const out = await genText(sys, user);
  if (out?.trim()) return { answer: out.trim(), phrasing: 'llm' };
  return { answer: template, phrasing: 'template' };
}

// ------------------------------------------------------------------ serve ----
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const db = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await db.auth.getUser();
    if (!userData?.user) return json({ error: 'Not signed in.' }, 401);

    const body = await req.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 500) return json({ error: 'Send a question up to 500 characters.' }, 400);

    // Context the planner needs: the user's merchants + category names.
    const [merchRes, catRes] = await Promise.all([
      db.rpc('agg_merchant_list'),
      db.from('categories').select('name'),
    ]);
    const merchants: string[] = (merchRes.data ?? []).map((r: { merchant: string }) => r.merchant);
    const catNames: string[] = (catRes.data ?? []).map((r: { name: string }) => r.name);

    // 1) Plan (LLM first, deterministic fallback — dates/categories validated).
    const plan = (await llmPlan(question, merchants, catNames)) ?? rulesPlan(question, merchants);

    // 2) Deterministic aggregation (SQL — exact numbers).
    const facts = await gatherFacts(db, plan);

    // 3) pgvector retrieval for supporting citations.
    const retrieved = await retrieve(db, question, plan);

    // 4) Grounded phrasing.
    const { answer, phrasing } = await phrase(question, plan, facts, retrieved);

    // Cite the rows the answer actually uses: top txns first (for rankings),
    // then semantically retrieved rows, deduped.
    const cited = new Map<string, { id: string; merchant: string | null; amount: number; txn_date: string; category: string }>();
    for (const t of facts.top ?? []) cited.set(t.id, { id: t.id, merchant: t.merchant, amount: Number(t.amount), txn_date: t.txn_date, category: t.category });
    for (const r of retrieved) if (!cited.has(r.id)) cited.set(r.id, { id: r.id, merchant: r.merchant, amount: Number(r.amount), txn_date: r.txn_date, category: r.category });

    return json({
      answer,
      citations: [...cited.values()].slice(0, 8),
      meta: {
        planner: plan.source,
        phrasing,
        intent: plan.intent,
        range: { from: plan.dateFrom, to: plan.dateTo, label: plan.rangeLabel },
        summary: facts.summary,
      },
    });
  } catch (e) {
    console.error('chat error:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'Could not answer right now — please try again.' }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

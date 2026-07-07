/**
 * FinTrack AI — end-to-end backend test suite (`npm run test:e2e`).
 *
 * Exercises the deployed system exactly as the app does — via the public API
 * with user JWTs. Covers: auth, RLS isolation (two accounts), AI ingestion
 * contract, auto-embedding, derived balance, RAG chat vs SQL ground truth,
 * nudge generation, goals CRUD, and Edge Function auth gates.
 *
 * Env (.env): EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
 *             EVAL_EMAIL / EVAL_PASSWORD           (primary test account)
 *             EVAL_EMAIL_B / EVAL_PASSWORD_B       (isolation account; auto-created)
 * Exit code: 0 = all hard assertions pass; 1 = at least one failure.
 * "DEGRADED" = the AI was unavailable but the contract held (fallbacks work) —
 * reported, not failed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}
const env = { ...loadEnv(join(ROOT, '.env')), ...process.env };
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const A = { email: env.EVAL_EMAIL, password: env.EVAL_PASSWORD };
const B = { email: env.EVAL_EMAIL_B ?? 'fintrack.e2e.b@gmail.com', password: env.EVAL_PASSWORD_B ?? 'E2eTester@123' };
if (!URL || !ANON || !A.email || !A.password) {
  console.error('Missing env: EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY / EVAL_EMAIL / EVAL_PASSWORD');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Never throws: network errors/timeouts return { status: 0 } so a flaky call
 *  records a FAIL instead of crashing the suite and skipping cleanup. */
async function api(path, { method = 'GET', token, body, headers } = {}) {
  try {
    const res = await fetch(`${URL}${path}`, {
      method,
      headers: {
        apikey: ANON,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: { error: e?.name === 'TimeoutError' ? 'client timeout' : String(e?.message ?? e) } };
  }
}

const results = [];
let degradedNotes = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS ' : '  FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n== ${title} ==`); }

async function signin(acc) {
  const { status, json } = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: acc });
  return status === 200 ? json : null;
}

// ============================== RUN ==============================
console.log(`FinTrack AI — E2E backend suite\nBackend: ${URL}`);
const marker = `E2E-${Date.now().toString(36)}`;

// ---- 1. AUTH ----
section('1. Authentication');
const a = await signin(A);
record('login with valid credentials', !!a?.access_token);
if (!a) { console.error('Cannot continue without account A.'); process.exit(1); }
const tokA = a.access_token;
const uidA = a.user.id;

const bad = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: A.email, password: 'WrongPass123' } });
record('wrong password rejected (400, invalid_credentials)', bad.status === 400 && bad.json?.error_code === 'invalid_credentials');

let b = await signin(B);
if (!b) {
  const su = await api('/auth/v1/signup', { method: 'POST', body: { ...B, data: { name: 'E2E Tester B' } } });
  b = su.json?.access_token ? su.json : await signin(B);
}
record('second account (B) available', !!b?.access_token);
const tokB = b?.access_token;

// ---- 2. EDGE FUNCTION AUTH GATES ----
section('2. Edge Function auth gates');
for (const fn of ['chat', 'insights', 'parse-txn']) {
  const r = await api(`/functions/v1/${fn}`, { method: 'POST', body: { question: 'x', facts: 'x', kind: 'nl', text: 'x' } });
  record(`${fn} without JWT -> 401`, r.status === 401, `got ${r.status}`);
}
const embedNoSecret = await api('/functions/v1/embed', { method: 'POST', body: { transaction_id: '00000000-0000-0000-0000-000000000000' } });
record('embed without shared secret -> 401', embedNoSecret.status === 401, `got ${embedNoSecret.status}`);

// ---- 3. INGESTION: transaction lifecycle + auto-embed + derived balance ----
section('3. Transaction lifecycle, auto-embedding, derived balance');
// Self-heal: remove leftovers from any previously crashed run before baselining.
await api('/rest/v1/transactions?merchant=like.E2E-*', { method: 'DELETE', token: tokA });
await api('/rest/v1/goals?name=like.E2E-*', { method: 'DELETE', token: tokA });
await api('/rest/v1/budgets?name=like.E2E-*', { method: 'DELETE', token: tokA });
const bal0 = await api('/rest/v1/v_balances?select=balance', { token: tokA });
const startBalance = Number(bal0.json?.[0]?.balance ?? 0);
record('read derived balance (v_balances)', bal0.status === 200);

const cats = await api('/rest/v1/categories?select=id,name,parent_id', { token: tokA });
const topLevel = (cats.json ?? []).filter((c) => !c.parent_id);
record('10 top-level categories seeded', topLevel.length === 10, `got ${topLevel.length} top (of ${cats.json?.length} total)`);
const foodId = topLevel.find((c) => c.name === 'Food & Dining')?.id;
// name -> top-level name (subcategories map to their parent) for category assertions
const parentOf = new Map((cats.json ?? []).map((c) => [c.id, c.parent_id]));
const nameById = new Map((cats.json ?? []).map((c) => [c.id, c.name]));
const topNameOf = (name) => {
  const c = (cats.json ?? []).find((x) => x.name === name);
  if (!c) return name;
  return c.parent_id ? nameById.get(c.parent_id) ?? name : name;
};

const ins = await api('/rest/v1/transactions', {
  method: 'POST', token: tokA, headers: { Prefer: 'return=representation' },
  body: { user_id: uidA, amount: 333, type: 'expense', merchant: marker, txn_date: new Date().toISOString().slice(0, 10), source: 'manual', category_id: foodId },
});
const markerId = ins.json?.[0]?.id;
record('insert transaction', ins.status === 201 && !!markerId);

const bal1 = await api('/rest/v1/v_balances?select=balance', { token: tokA });
record('balance updated by exactly -333', Math.round(Number(bal1.json?.[0]?.balance) - startBalance) === -333, `Δ=${Number(bal1.json?.[0]?.balance) - startBalance}`);

let embedded = false;
for (let i = 0; i < 12; i++) {
  await sleep(2500);
  const chk = await api(`/rest/v1/transactions?select=embedding&id=eq.${markerId}`, { token: tokA });
  if (chk.json?.[0]?.embedding) { embedded = true; break; }
}
record('auto-embedding within ~30s of insert (trigger → Edge Function)', embedded);

// ---- 4. RLS ISOLATION (the non-negotiable) ----
section('4. RLS isolation between accounts');
if (tokB) {
  const bTxns = await api(`/rest/v1/transactions?select=id&merchant=eq.${marker}`, { token: tokB });
  record("B cannot see A's transaction via REST", Array.isArray(bTxns.json) && bTxns.json.length === 0, `rows=${bTxns.json?.length}`);
  const bAll = await api('/rest/v1/transactions?select=id', { token: tokB });
  const bProfiles = await api('/rest/v1/profiles?select=id', { token: tokB });
  record('B sees only own profile (1 row)', Array.isArray(bProfiles.json) && bProfiles.json.length === 1, `rows=${bProfiles.json?.length}`);
  const bChat = await api('/functions/v1/chat', { method: 'POST', token: tokB, body: { question: 'What were my biggest expenses last month?' } });
  const leak = JSON.stringify(bChat.json ?? {}).includes(marker) || (bChat.json?.citations ?? []).length > (bAll.json?.length ?? 0);
  record("B's chat cannot surface A's data", bChat.status === 200 && !leak, `citations=${bChat.json?.citations?.length}`);
  const bNotifs = await api('/rest/v1/notifications?select=id', { token: tokB });
  const bGoals = await api('/rest/v1/goals?select=id&user_id=eq.' + uidA, { token: tokB });
  record("B cannot see A's notifications/goals", bNotifs.status === 200 && Array.isArray(bGoals.json) && bGoals.json.length === 0);
} else {
  record('RLS isolation (account B)', false, 'account B unavailable');
}

// ---- 5. AI INGESTION CONTRACT ----
section('5. AI ingestion (parse-txn)');
const nl = await api('/functions/v1/parse-txn', { method: 'POST', token: tokA, body: { kind: 'nl', text: 'spent 450 on dinner at Swiggy yesterday' } });
const nlOk = nl.status === 200 && (nl.json?.ok === true || nl.json?.reason === 'ai_unavailable');
record('NL parse: valid contract (parsed or clean degradation)', nlOk, JSON.stringify(nl.json)?.slice(0, 100));
if (nl.json?.ok) {
  const p = nl.json.parsed;
  record('NL parse: amount=450, type=expense, valid date', p.amount === 450 && p.type === 'expense' && /^\d{4}-\d{2}-\d{2}$/.test(p.txn_date));
  // AI may pick the precise subcategory (e.g. "Food Delivery"); accept it or its parent
  record('NL parse: categorized under Food & Dining', p.category === 'Food & Dining' || topNameOf(p.category) === 'Food & Dining', `got ${p.category}`);
} else { degradedNotes.push('NL parse degraded to heuristic (LLM quota) — app falls back on-device by design'); }

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const vis = await api('/functions/v1/parse-txn', { method: 'POST', token: tokA, body: { kind: 'upi', image: TINY_PNG, mime: 'image/png' } });
record('vision parse: graceful contract on unreadable image (no 5xx)', vis.status === 200 && (vis.json?.ok === true || vis.json?.ok === false));

const catz = await api('/functions/v1/parse-txn', { method: 'POST', token: tokA, body: { kind: 'categorize', rows: [{ merchant: 'Zomato' }, { merchant: 'Uber' }, { merchant: 'BESCOM Electricity' }] } });
const catzOk = catz.status === 200 && (catz.json?.ok === false || (Array.isArray(catz.json?.results) && catz.json.results.length === 3));
record('batch categorize: valid contract', catzOk);
if (catz.json?.ok) {
  const [r1, r2] = catz.json.results;
  record('batch categorize: Zomato→Food, Uber→Transport (subcat or parent)',
    topNameOf(r1.category) === 'Food & Dining' && topNameOf(r2.category) === 'Transport', `${r1.category}, ${r2.category}`);
} else { degradedNotes.push('Batch categorize degraded (LLM quota) — CSV import keeps on-device categories by design'); }

const badParse = await api('/functions/v1/parse-txn', { method: 'POST', token: tokA, body: { kind: 'nl' } });
record('malformed input -> 400 (not a crash)', badParse.status === 400);

// ---- 6. RAG CHAT vs SQL GROUND TRUTH ----
section('6. RAG chat vs SQL ground truth');
const rpc = (name, args) => api(`/rest/v1/rpc/${name}`, { method: 'POST', token: tokA, body: args });
const now = new Date(Date.now() + 5.5 * 3600 * 1000);
const lmFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
const lmTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
const truthSum = await rpc('agg_summary', { from_date: lmFrom, to_date: lmTo });
const truthExpense = Math.round(Number(truthSum.json?.[0]?.expense ?? 0));
const chat1 = await api('/functions/v1/chat', { method: 'POST', token: tokA, body: { question: 'How much did I spend in total last month?' } });
const nums1 = (chat1.json?.answer ?? '').replace(/[₹,]/g, '').match(/\d+/g)?.map(Number) ?? [];
record('chat: total-last-month matches SQL', chat1.status === 200 && nums1.some((n) => Math.abs(n - truthExpense) <= Math.max(50, truthExpense * 0.02)), `truth=${truthExpense}`);

const truthTop = await rpc('agg_top_txns', { from_date: lmFrom, to_date: lmTo, k: 1, txn_type: 'expense' });
const topAmt = Math.round(Number(truthTop.json?.[0]?.amount ?? 0));
const topMerchant = truthTop.json?.[0]?.merchant ?? '';
const chat2 = await api('/functions/v1/chat', { method: 'POST', token: tokA, body: { question: 'What was my single biggest expense last month?' } });
const ans2 = chat2.json?.answer ?? '';
record('chat: biggest-expense matches SQL (amount + merchant)', chat2.status === 200 && ans2.replace(/[₹,]/g, '').includes(String(topAmt)) && ans2.includes(topMerchant), `truth=${topMerchant} ${topAmt}`);
record('chat: citations returned', (chat2.json?.citations ?? []).length > 0, `${chat2.json?.citations?.length} citations`);

// ---- 7. AGENTIC: nudges + notifications ----
section('7. Agentic nudges + notification center');
const nudge = await api('/rest/v1/rpc/refresh_my_nudges', { method: 'POST', token: tokA, body: {} });
record('refresh_my_nudges RPC runs', nudge.status === 200, `inserted=${nudge.json}`);
const notifs = await api('/rest/v1/notifications?select=id,kind,title,severity&order=created_at.desc', { token: tokA });
record('notifications readable via RLS', notifs.status === 200 && Array.isArray(notifs.json));
const hasAnom = (notifs.json ?? []).some((n) => n.kind === 'anomaly');
record('anomaly nudge generated for seeded ₹18,990 outlier', hasAnom, (notifs.json ?? []).slice(0, 3).map((n) => n.kind).join(','));
const rerun = await api('/rest/v1/rpc/refresh_my_nudges', { method: 'POST', token: tokA, body: {} });
record('nudge generation is idempotent (rerun inserts 0)', rerun.status === 200 && Number(rerun.json) === 0, `inserted=${rerun.json}`);

// ---- 7b. HIERARCHICAL CATEGORIES + BUDGETS v2 ----
section('7b. Subcategories + budgets v2');
const catsFull = await api('/rest/v1/categories?select=id,name,parent_id', { token: tokA });
const tops = (catsFull.json ?? []).filter((c) => !c.parent_id);
const subs = (catsFull.json ?? []).filter((c) => c.parent_id);
record('top-level categories = 10', tops.length === 10, `got ${tops.length}`);
record('subcategories seeded (38 in default taxonomy)', subs.length === 38, `got ${subs.length}`);
const foodTop = tops.find((c) => c.name === 'Food & Dining');
const foodSubs = subs.filter((c) => c.parent_id === foodTop?.id);
record('Food & Dining has subcategories', foodSubs.length >= 3, `${foodSubs.map((s) => s.name).join(', ')}`);

// budget CRUD (weekly, multi-category, notify flags)
const shopTop = tops.find((c) => c.name === 'Shopping');
const bIns = await api('/rest/v1/budgets', {
  method: 'POST', token: tokA, headers: { Prefer: 'return=representation' },
  body: { user_id: uidA, name: marker + '-budget', category_ids: [foodTop.id, shopTop.id], limit_amount: 1500, period: 'weekly', notify_trending: true, notify_over: false },
});
const budgetId = bIns.json?.[0]?.id;
record('create budget v2 (weekly, 2 categories, notify flags)', bIns.status === 201 && !!budgetId && bIns.json[0].period === 'weekly' && bIns.json[0].category_ids.length === 2 && bIns.json[0].notify_over === false);
const bUpd = await api(`/rest/v1/budgets?id=eq.${budgetId}`, { method: 'PATCH', token: tokA, headers: { Prefer: 'return=representation' }, body: { limit_amount: 2000, period: 'monthly' } });
record('edit budget (amount + period)', bUpd.status === 200 && Number(bUpd.json?.[0]?.limit_amount) === 2000 && bUpd.json?.[0]?.period === 'monthly');
if (tokB) {
  const bLeak = await api(`/rest/v1/budgets?select=id&name=eq.${marker}-budget`, { token: tokB });
  record("B cannot see A's budget (RLS)", Array.isArray(bLeak.json) && bLeak.json.length === 0, `rows=${bLeak.json?.length}`);
}
const bDel = await api(`/rest/v1/budgets?id=eq.${budgetId}`, { method: 'DELETE', token: tokA });
record('delete budget', bDel.status === 204);

// nudge engine still works with budgets v2 (period-aware) + idempotency
const nudge2 = await api('/rest/v1/rpc/refresh_my_nudges', { method: 'POST', token: tokA, body: {} });
record('nudge engine runs on budgets v2', nudge2.status === 200, `inserted=${nudge2.json}`);

// ---- 8. GOALS CRUD ----
section('8. Goals (planner) CRUD');
const gIns = await api('/rest/v1/goals', { method: 'POST', token: tokA, headers: { Prefer: 'return=representation' }, body: { user_id: uidA, name: marker + '-goal', target_amount: 50000, deadline: null } });
const goalId = gIns.json?.[0]?.id;
record('create goal', gIns.status === 201 && !!goalId);
const gUpd = await api(`/rest/v1/goals?id=eq.${goalId}`, { method: 'PATCH', token: tokA, headers: { Prefer: 'return=representation' }, body: { current_amount: 1000 } });
record('contribute to goal', gUpd.status === 200 && Number(gUpd.json?.[0]?.current_amount) === 1000);
const gDel = await api(`/rest/v1/goals?id=eq.${goalId}`, { method: 'DELETE', token: tokA });
record('delete goal', gDel.status === 204);

// ---- 9. INSIGHTS PHRASING CONTRACT ----
section('9. Insights phrasing');
const insSum = await api('/functions/v1/insights', { method: 'POST', token: tokA, body: { facts: 'Projected spend ₹20,000. Unusual charge ₹18,990 at Croma (5.9x typical).' } });
const insOk = insSum.status === 200 && (typeof insSum.json?.summary === 'string' || insSum.json?.phrasing === 'unavailable');
record('insights: summary or clean degradation (no 5xx)', insOk, insSum.json?.phrasing);
if (insSum.json?.phrasing === 'unavailable') degradedNotes.push('Insights phrasing degraded — UI shows deterministic digest by design');

// ---- cleanup ----
section('Cleanup');
const del = await api(`/rest/v1/transactions?id=eq.${markerId}`, { method: 'DELETE', token: tokA });
record('marker transaction removed', del.status === 204);
const balEnd = await api('/rest/v1/v_balances?select=balance', { token: tokA });
record('balance restored after delete', Math.round(Number(balEnd.json?.[0]?.balance) - startBalance) === 0, `Δ=${Number(balEnd.json?.[0]?.balance) - startBalance}`);

// ============================== SUMMARY ==============================
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`\n==================== E2E SUMMARY ====================`);
console.log(`${pass}/${results.length} assertions passed${fail ? ` — ${fail} FAILED` : ''}`);
if (degradedNotes.length) {
  console.log(`\nDegraded (AI quota) — contract held, fallbacks active:`);
  for (const d of degradedNotes) console.log(`  ~ ${d}`);
}
if (fail) {
  console.log(`\nFailures:`);
  for (const f of results.filter((r) => !r.ok)) console.log(`  ✗ ${f.name} ${f.detail}`);
}
process.exit(fail ? 1 : 0);

/**
 * FinTrack AI — RAG agent evaluation harness (LLM-as-Judge).
 *
 * For each case in cases.mjs:
 *   1. compute ground truth via the deterministic SQL RPCs (harness-fixed dates)
 *   2. ask the deployed `chat` Edge Function the natural-language question
 *   3. deterministic numeric check — expected figures appear in the answer
 *   4. LLM-as-Judge (Gemini) — scores correctness + faithfulness with reasons
 * Outputs a console summary and evals/REPORT.md.
 *
 * Run:  npm run eval
 * Env:  EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (.env),
 *       EVAL_EMAIL, EVAL_PASSWORD, GEMINI_API_KEY (dev-only; never shipped —
 *       only EXPO_PUBLIC_* vars are bundled into the app).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CASES } from './cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...loadEnv(join(ROOT, '.env')), ...process.env };
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const GEMINI = env.GEMINI_API_KEY;
const EMAIL = env.EVAL_EMAIL;
const PASSWORD = env.EVAL_PASSWORD;
// Gemma models share the API key but have a separate free-tier quota, so
// judging survives Gemini daily-quota exhaustion.
const JUDGE_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];

for (const [k, v] of Object.entries({ URL, ANON, GEMINI, EMAIL, PASSWORD })) {
  if (!v) {
    console.error(`Missing config: ${k}. Set EXPO_PUBLIC_SUPABASE_URL/KEY in .env and EVAL_EMAIL, EVAL_PASSWORD, GEMINI_API_KEY in env or .env.`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}`);
  return json;
}

// ---- IST date ranges (harness-fixed, independent of the agent's planner) ----
const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const iso = (d) => d.toISOString().slice(0, 10);
function monthRange(offset) {
  const n = ist();
  const y = n.getUTCFullYear();
  const m = n.getUTCMonth();
  if (offset === 0) return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(n) };
  return { from: iso(new Date(Date.UTC(y, m + offset, 1))), to: iso(new Date(Date.UTC(y, m + offset + 1, 0))) };
}
function lastDays(nDays) {
  const n = ist();
  return { from: iso(new Date(n.getTime() - nDays * 86400000)), to: iso(n) };
}
const nowIst = ist();
const juneYear = nowIst.getUTCMonth() >= 5 ? nowIst.getUTCFullYear() : nowIst.getUTCFullYear() - 1;
const RANGES = {
  last30: lastDays(30),
  last90: lastDays(90),
  thisMonth: monthRange(0),
  lastMonth: monthRange(-1),
  june: { from: `${juneYear}-06-01`, to: `${juneYear}-06-30` },
};

// ---- ground-truth tools (same deterministic SQL RPCs the agent uses) ----
function makeTools(token) {
  const rpc = (name, args) => api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: args });
  const tools = {
    summary: async (r) => (await rpc('agg_summary', { from_date: r.from, to_date: r.to }))[0],
    byCategory: (r) => rpc('agg_by_category', { from_date: r.from, to_date: r.to, txn_type: 'expense' }),
    catTotal: async (r, name) => Number((await tools.byCategory(r)).find((c) => c.category === name)?.total ?? 0),
    top: (r, k = 5) => rpc('agg_top_txns', { from_date: r.from, to_date: r.to, k, txn_type: 'expense' }),
    merchant: async (q, r) => (await rpc('agg_merchant', { merchant_q: q, from_date: r.from, to_date: r.to }))[0] ?? { total: 0, txn_count: 0 },
  };
  return tools;
}

// ---- LLM-as-Judge (returns null when no judge model is reachable) ----
async function judge(question, facts, answer) {
  const sys = `You grade a personal-finance assistant. Return ONLY JSON: {"correct": boolean, "faithful": boolean, "reason": string (short)}.
- correct: the answer's key figure(s)/claim match the GROUND TRUTH. Allow ±2% or ±₹50 on currency (timeframe boundaries may differ by a day); counts must be exact. Judge the substance, not the wording.
- faithful: the answer does not introduce figures with no basis in the ground truth. Restatements and simple derivations of ground-truth numbers (differences, percentages, averages, dates, counts) ARE faithful.`;
  const user = `Question: ${question}\n\nGROUND TRUTH (exact, from SQL over the user's ledger):\n${facts}\n\nAssistant's answer:\n${answer}`;
  for (const model of JUDGE_MODELS) {
    const isGemma = model.startsWith('gemma');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = isGemma
          ? {
              contents: [{ role: 'user', parts: [{ text: `${sys}\n\n${user}` }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 2048 },
            }
          : {
              systemInstruction: { parts: [{ text: sys }] },
              contents: [{ role: 'user', parts: [{ text: user }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' },
            };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 429) {
          await sleep(1500 * 2 ** attempt);
          continue;
        }
        if (!res.ok) break;
        const data = await res.json();
        const text = (data?.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join('');
        const s = text.indexOf('{');
        const e = text.lastIndexOf('}');
        const parsed = JSON.parse(text.slice(s, e + 1));
        return { correct: !!parsed.correct, faithful: !!parsed.faithful, reason: String(parsed.reason ?? ''), model };
      } catch {
        break;
      }
    }
  }
  return null; // judge unavailable — reported separately, never counted as incorrect
}

// ---- deterministic numeric check ----
function numericCheck(answer, checks, textChecks) {
  const nums = (answer.replace(/[₹,]/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const numsOk = (checks ?? []).every((c) => nums.some((n) => Math.abs(n - c.value) <= c.tol));
  const textOk = (textChecks ?? []).every((t) => answer.toLowerCase().includes(String(t).toLowerCase()));
  return numsOk && textOk;
}

// ------------------------------------------------------------------- main ----
console.log('FinTrack AI — RAG agent evaluation');
console.log(`Backend: ${URL}`);
const auth = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
const token = auth.access_token;
console.log(`Signed in as ${EMAIL}\nRunning ${CASES.length} cases...\n`);

const tools = makeTools(token);
const results = [];

/** Fuller reference for the judge: the same SQL facts the agent can see, so
 *  correct volunteered context (counts, dates, sibling totals) is verifiable
 *  instead of being flagged as unfaithful. */
async function refBlock(range) {
  const [s, cats, top] = await Promise.all([tools.summary(range), tools.byCategory(range), tools.top(range, 3)]);
  return `Reference data for the same period (also exact, from SQL): income ₹${s.income}, expenses ₹${s.expense}, net ₹${s.net}, ${s.txn_count} transactions total. By category: ${cats
    .map((x) => `${x.category} ₹${x.total} (${x.txn_count} txns)`)
    .join('; ')}. Largest transactions: ${top.map((t) => `₹${t.amount} at ${t.merchant} (${t.category}) on ${t.txn_date}`).join('; ')}.`;
}

/** Chat call with one retry on transient platform errors (5xx / worker limits). */
async function askAgent(question) {
  try {
    return await api('/functions/v1/chat', { method: 'POST', token, body: { question } });
  } catch {
    await sleep(6000); // free-tier workers recycle; a fresh one usually succeeds
    return await api('/functions/v1/chat', { method: 'POST', token, body: { question } });
  }
}

for (const c of CASES) {
  process.stdout.write(`• ${c.id} ... `);
  let row = { id: c.id, question: c.question };
  try {
    const truth = await c.truth(tools, RANGES);
    const facts = `${truth.facts}\n${await refBlock(RANGES[c.range] ?? RANGES.lastMonth)}`;
    const res = await askAgent(c.question);
    const answer = res.answer ?? '';
    const numeric = numericCheck(answer, truth.checks, truth.textChecks);
    const j = await judge(c.question, facts, answer);
    if (j) {
      row = { ...row, facts: truth.facts, answer, numeric, ...j, meta: res.meta };
      console.log(`${j.correct ? 'PASS' : 'FAIL'} (numeric=${numeric ? 'ok' : 'x'}, faithful=${j.faithful ? 'ok' : 'x'})`);
    } else {
      row = { ...row, facts: truth.facts, answer, numeric, correct: null, faithful: null, reason: 'judge unavailable (LLM quota)', model: 'none', meta: res.meta };
      console.log(`NOJUDGE (numeric=${numeric ? 'ok' : 'x'})`);
    }
  } catch (e) {
    row = { ...row, facts: '-', answer: `ERROR: ${e.message}`, numeric: false, correct: false, faithful: false, reason: e.message, model: '-' };
    console.log('ERROR');
  }
  results.push(row);
  await sleep(4000); // stay under free-tier RPM
}

// ---- summary (judge-unavailable cases are reported, never counted as wrong) ----
const n = results.length;
const judged = results.filter((r) => r.correct !== null);
const unjudged = n - judged.length;
const correct = judged.filter((r) => r.correct).length;
const numeric = results.filter((r) => r.numeric).length;
const faithful = judged.filter((r) => r.faithful).length;
const pctOf = (x, total) => (total ? `${Math.round((x / total) * 100)}%` : 'n/a');

console.log(`\n================= SUMMARY =================`);
console.log(`Numeric match : ${numeric}/${n}  (${pctOf(numeric, n)})   [deterministic]`);
console.log(`Judge-correct : ${correct}/${judged.length}  (${pctOf(correct, judged.length)})   [LLM-as-Judge${unjudged ? `; ${unjudged} unavailable` : ''}]`);
console.log(`Faithful      : ${faithful}/${judged.length}  (${pctOf(faithful, judged.length)})`);
const failures = results.filter((r) => r.correct === false || !r.numeric);
if (failures.length) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f.id}: ${f.reason}\n    truth: ${f.facts}\n    answer: ${f.answer.slice(0, 160)}`);
}

// ---- markdown report ----
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const md = `# FinTrack AI — RAG agent eval report

**Run:** ${stamp} UTC · **Cases:** ${n} · **Agent:** \`chat\` Edge Function (plan → SQL aggregation → pgvector → grounded phrasing)

| Metric | Score |
|---|---|
| **Numeric accuracy (deterministic check)** | **${numeric}/${n} (${pctOf(numeric, n)})** |
| Correctness (LLM-as-Judge, ${judged.length} judged${unjudged ? `; ${unjudged} judge-unavailable` : ''}) | ${correct}/${judged.length} (${pctOf(correct, judged.length)}) |
| Faithfulness (no invented figures) | ${faithful}/${judged.length} (${pctOf(faithful, judged.length)}) |

## Method
Ground truth is computed by the same deterministic SQL RPCs the agent uses (\`agg_summary\`, \`agg_by_category\`, \`agg_top_txns\`, \`agg_merchant\`) with **harness-fixed date ranges**, so expected answers are known independent of the agent's planner. Each question runs through the deployed agent; a deterministic check asserts the expected figures appear in the answer (±2%/₹50 for currency to absorb day-boundary drift, exact for counts), and a Gemini judge (temperature 0) scores correctness and faithfulness with reasons.

## Cases

| # | Case | Question | Numeric | Correct | Faithful | Judge note |
|---|---|---|---|---|---|---|
${results.map((r, i) => `| ${i + 1} | ${r.id} | ${r.question} | ${r.numeric ? '✅' : '❌'} | ${r.correct === null ? '⚠️ n/a' : r.correct ? '✅' : '❌'} | ${r.correct === null ? '—' : r.faithful ? '✅' : '❌'} | ${(r.reason ?? '').replace(/\|/g, '/').slice(0, 90)} |`).join('\n')}

## Transcript

${results.map((r, i) => `### ${i + 1}. ${r.id}
**Q:** ${r.question}
**Ground truth:** ${r.facts}
**Agent:** ${r.answer}
**Judge (${r.model}):** correct=${r.correct} faithful=${r.faithful} — ${r.reason}
`).join('\n')}
`;
writeFileSync(join(ROOT, 'evals', 'REPORT.md'), md);
console.log(`\nReport written to evals/REPORT.md`);
// Exit 1 only on real failures (numeric fail or judged-incorrect) — not on judge unavailability.
process.exit(results.some((r) => r.correct === false || !r.numeric) ? 1 : 0);

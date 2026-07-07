# FinTrack AI 🇮🇳

A production-grade, AI-powered personal finance tracker for India. **React Native + Expo**
frontend, **Supabase** backend (Postgres + Auth + RLS + Realtime + pgvector), and AI that runs
**only in Edge Functions** — no keys ever ship in the app bundle.

Log spending, watch the dashboard update **in real time**, then **chat with your money** — a RAG
agent answers questions about your finances with numbers computed by SQL, never guessed by the
LLM. Forecasting, anomaly alerts and subscription detection are deterministic and explainable,
with the LLM used only to phrase findings in plain English.

---

## Features

**Foundation (live)**
- Email auth with persisted sessions; every table protected by **Row-Level Security**
- **Wallet-style home**: balance trend + spending trend charts (toggle **Weekly / Monthly / Yearly**),
  budgets & goals overview, upcoming planned payments (predicted from recurring charges),
  spend-by-category donut, last-records — all updating instantly via Supabase Realtime
- **Hierarchical categories**: 10 top-level groups each with subcategories (e.g. Food & Dining →
  Restaurants, Food Delivery…); analytics roll subcategory spend up to the parent
- **Budget planner**: named budgets over any category set, **weekly/monthly/yearly**, with per-budget
  "trending over" and "over budget" nudge toggles; first-run onboarding leads with budget planning
- Real-time dashboard: balance (derived, never stored), income/expense/savings
- **Four ways to add spending**: manual form · natural language (*"paid 799 to Airtel for wifi
  bill yesterday"* → amount/merchant/category/date extracted by AI) · **UPI-screenshot / receipt
  photo** vision extraction · **bank CSV import** with batch AI categorization — every AI path has
  an on-device deterministic fallback, and low-confidence items are flagged for one-tap review
- Full ledger (search, filters, one-tap recategorize, delete-with-confirm), editable budgets

**Intelligence (live)**
- **Conversational RAG agent** (`chat` Edge Function): plans the query (LLM w/ deterministic
  fallback) → runs **SQL aggregation tools** for exact figures → pgvector similarity retrieval →
  LLM phrases a grounded answer **with citations to the actual transactions used**
- **Auto-embeddings**: every new transaction is embedded (Gemini `gemini-embedding-001`, 768-dim)
  via a DB trigger → Edge Function pipeline; HNSW cosine index for retrieval
- **Forecasting / budget pacing**: history-blended daily-rate projection per category (pure math),
  surfaced on the dashboard and the Insights tab
- **Anomaly & subscription detection**: statistical outliers and recurring same-amount charges,
  detected deterministically, explained in plain English by the `insights` Edge Function
- **Graceful degradation everywhere**: model fallback chain (Gemini 2.0 → lite → 2.5 → **Gemma**,
  which has a separate free-tier quota) with 429 backoff and hard time budgets on every upstream
  call; if every LLM is down the app still returns correct, SQL-templated answers

**Agentic (live)**
- **Proactive nudges**: a pure-SQL engine (`generate_nudges`) scans budgets and transactions for
  budget breaches (80% / 100%), pace-based overshoot projections, statistical anomalies (>3× the
  category median), and stale subscriptions — run daily by **pg_cron** and on every app open
  (idempotent via dedupe keys). Delivered to an in-app **notification center** with unread badges,
  live via Realtime
- **Goal planner**: set a target ("₹40,000 by November") → a deterministic monthly plan computed
  from your *actual* average surplus, with honest feasibility ("needs ₹9,800/month, your surplus
  averages ₹6,574 — consider extending the deadline"), AI-phrased summaries, and one-tap
  contributions

## Evaluation — LLM-as-Judge harness (`npm run eval`)

The repo ships an eval framework ([`evals/`](evals/)) that grades the deployed agent against
ground truth computed by the same deterministic SQL RPCs with harness-fixed date ranges:

| Metric (13 ground-truth cases) | Score |
|---|---|
| **Numeric accuracy** (expected figures appear in the answer) | **13/13 — 100%** |
| **Correctness** (Gemini judge, temperature 0; 12 judged, 1 judge-unavailable) | **12/12 — 100%** |
| Faithfulness (no figures beyond the verifiable ground truth) | 11/12 — 92%* |

\* The one flag: asked for the *single* biggest expense, the agent also volunteered the (real,
correct) runners-up beyond what the judge could verify. Full transcript with judge reasoning:
[`evals/REPORT.md`](evals/REPORT.md).

Cases cover totals, category/date filtering, month-name parsing, merchant counting, comparisons,
rankings and savings math. Judge-unavailable runs are reported separately — never counted as
correct *or* incorrect. Earlier runs caught two real intent-routing bugs and a missing-timeout
hang (all fixed) — the harness is a working regression net, not a demo.

## Architecture

```
React Native (Expo Router) ── React Query ── supabase-js
        │                                        │ (user JWT)
        ▼                                        ▼
   Supabase Postgres ◄──────────────── Edge Functions (Deno)
   · RLS on every table                 · embed     → gemini-embedding-001 (768d)
   · v_balances (derived balance)       · chat      → plan → SQL tools → pgvector → phrase
   · agg_* SQL aggregation RPCs         · insights  → phrases deterministic findings
   · match_transactions (pgvector)      · parse-txn → NL / receipt / UPI vision / categorize
   · generate_nudges (SQL, pg_cron)     keys live ONLY in function secrets;
   · pg_net trigger → auto-embed        every upstream call is time-capped
   · Realtime → live dashboard + nudges
```

**Why the numbers are trustworthy:** quantitative answers come from `agg_summary`,
`agg_by_category`, `agg_top_txns`, `agg_merchant` — SECURITY INVOKER SQL functions scoped to
`auth.uid()`. The LLM only converts a question into a retrieval plan and phrases the computed
facts. Retrieval (`match_transactions`) applies the same user scoping; verified with two accounts
that one user's chat can never surface another's data.

## Setup

```bash
npm install
cp .env.example .env        # add your Supabase URL + publishable key
npm run web                 # or: npm run android / ios
```

1. Create a [Supabase](https://supabase.com) project and run, in the SQL editor:
   [`supabase/schema.sql`](supabase/schema.sql), then the migrations in
   [`supabase/migrations/`](supabase/migrations/) in order.
2. Deploy the Edge Functions (`embed`, `chat`, `insights`) and set secrets
   `GEMINI_API_KEY` ([free key](https://aistudio.google.com/apikey)) and `EMBED_SECRET`
   (any random string; the auto-embed DB trigger must send it as `x-embed-secret`).
3. For `npm run eval`: set `EVAL_EMAIL`, `EVAL_PASSWORD`, `GEMINI_API_KEY` in `.env`
   (dev-only — Expo bundles only `EXPO_PUBLIC_*` vars).

## Security & privacy
- RLS on every table and RPC — verified with two test accounts
- No financial data in URLs or logs; AI keys exist only as server-side secrets
- The auto-embed function is gated by a shared secret; `chat`/`insights` require a valid JWT
- Insights are descriptive, not financial advice

## Build the Android APK

The project is EAS-ready ([`eas.json`](eas.json): `preview` builds an installable **APK**,
`production` builds a Play-Store **AAB** with auto-incrementing versionCode). Camera and
photo-library permissions are declared via the `expo-image-picker` plugin and requested at
runtime with graceful denial handling. The `EXPO_PUBLIC_*` values baked into builds are
client-public by design (the publishable key ships in every app bundle; RLS protects the data).

```bash
npx eas-cli login                                  # once — free Expo account
npx eas-cli build -p android --profile preview     # ~10-15 min in EAS cloud
```

The build finishes with a QR code / URL — open it on your phone to download and install the APK.

## Testing
| Command | What it covers |
|---|---|
| `npm run typecheck` | Full TypeScript check |
| `npm run test:e2e` | **44-assertion backend suite** against the deployed system: auth, Edge Function auth gates, transaction lifecycle, auto-embedding, derived balance, **two-account RLS isolation**, AI ingestion contracts, hierarchical categories, budgets-v2 CRUD, chat vs SQL ground truth, nudge idempotency, goals CRUD |
| `npm run eval` | LLM-as-Judge RAG eval (13 ground-truth cases) → `evals/REPORT.md` |

Testing found and fixed real bugs: a `round(double)` SQL error in nudge generation, missing
upstream timeouts in Edge Functions (a stalled LLM connection could hang a request), and a
double-tap double-save race in the Add form. The suites are regression nets, not demos.

## Roadmap
- Push notifications for nudges (the notification center is already Realtime-live in-app)
- Play Store submission via `eas submit` (production profile is configured)

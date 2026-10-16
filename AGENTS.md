# FinTrack AI — notes for agents

AI-powered personal finance tracker for India. **React Native + Expo (Expo Router, SDK 57)**,
one codebase shipping to Android and web. iOS is targeted in `app.json` but has never been
built or run — don't claim it works. Expo changed a lot in SDK 57 — check
https://docs.expo.dev/versions/v57.0.0/ before writing framework code.

## Run / preview
- `npm run web` (Metro serves on port 8081) — how the app is previewed.
- `npm run typecheck` before finishing changes.
- First web bundle takes ~15s.

## Architecture
- **Supabase is required** — there is no demo mode. `AuthProvider` refuses to fake a session;
  with no `EXPO_PUBLIC_*` vars the login screen shows a setup notice (see `.env.example` /
  `src/data/config.ts`). `DEMO_MODE` is still exported from `config.ts` but has zero call sites.
- **Server state** lives in React Query hooks in `src/data/api.ts` (queries, mutations, and
  `useRealtimeSync`). Analytics/aggregation are pure functions in `src/data/analytics.ts`.
  AI goes through the Edge Functions client in `src/data/ai.ts`. Design tokens in
  `src/theme/index.ts`.
- **Local-only state**: goal colour/icon/note/archived live in AsyncStorage via
  `src/data/goalMeta.tsx` and are merged at read time by `enrichGoal()` — the `goals` table
  holds financial fields only.
- Screens: `app/(tabs)/` = Overview / Ledger / Add / Insights / Settings; plus `app/chat.tsx`
  (RAG), `app/goals.tsx` + `app/goal-edit.tsx` (planner), `app/budget-new.tsx`,
  `app/notifications.tsx`, `app/login.tsx`.
- **Orphaned demo-era code — do not build on it**: nothing imports `src/data/store.tsx`
  (`useApp()`), which also orphans `src/data/seed.ts`, `src/ai/chat.ts`, `src/ai/llm.ts` and
  `src/ai/vision.ts`. In `src/ai/parse.ts` only `parseNLHeuristic` and `categorizeHeuristic`
  are live (used as on-device fallbacks); its LLM paths have no callers. `legacy_ui/` sits
  outside the router entirely.

## Gotchas
- Use `localISO()` (not `toISOString()`) for dates — avoids UTC off-by-one in IST.
- Headline stats use rolling-30-day windows (`rollingStats`) so they aren't empty on the 1st.
- react-native-svg on web dislikes `<G transform>` / `origin` — rotate via a style transform.
- Path alias `@/*` → `src/*` (needs `baseUrl` in tsconfig for Metro; deprecation silenced).
- Postgres: `percentile_cont` returns `double precision`; `round(double, int)` doesn't exist —
  cast to `::numeric` first.
- Gemini free tier exhausts daily; Gemma (`gemma-4-31b-it`, same key) has separate quota but no
  systemInstruction/JSON mode, emits `thought:true` parts (filter) + code fences (strip), and its
  thinking eats `maxOutputTokens` (use 8192 + trim to whole sentences on MAX_TOKENS).
- ALL upstream fetches in Edge Functions need `AbortSignal.timeout(...)` — a stalled Gemini
  connection otherwise hangs the function until the platform kills it.
- Save buttons need a synchronous re-entry guard (`useRef`) — `isPending` updates async, so a
  rapid double-tap can double-submit.
- Tests: `npm run test:e2e` (44-assertion backend suite), `npm run eval` (LLM-judged RAG eval).
  Both run against the **deployed** backend and assert over relative windows ("last month").
  The shared test account's seeded ledger ends 2026-07-05 and is never regenerated, so those
  windows empty out as real time passes and assertions start failing with no code change —
  check the fixture's date coverage before treating a red suite as a regression.
- `EXPO_PUBLIC_*` env vars MUST be read as direct static `process.env.EXPO_PUBLIC_X` expressions.
  Aliasing (`const env = process.env; env.EXPO_PUBLIC_X`) works on the Metro dev server but
  compiles to `undefined` in release APK/AAB builds — the babel inline transform only matches
  literal member expressions.

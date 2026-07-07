# FinTrack AI — notes for agents

AI-powered personal finance tracker for India. **React Native + Expo (Expo Router, SDK 57)**,
runs on iOS / Android / web from one codebase. Expo changed a lot in SDK 57 — check
https://docs.expo.dev/versions/v57.0.0/ before writing framework code.

## Run / preview
- `npm run web` (Metro serves on port 8081) — how the app is previewed.
- `npm run typecheck` before finishing changes.
- First web bundle takes ~15s.

## Architecture
- **Demo-mode-first**: with no env vars the app uses seeded local data (`src/data/seed.ts`,
  persisted to AsyncStorage) + on-device AI fallbacks. It switches to real Supabase + LLM when
  `EXPO_PUBLIC_*` vars are set (see `.env.example` / `src/data/config.ts`).
- State lives in `src/data/store.tsx` (`useApp()` context). Analytics/aggregation are pure
  functions in `src/data/analytics.ts`. AI features in `src/ai/*` (each has an LLM path + a
  deterministic fallback). Design tokens in `src/theme/index.ts`.
- Screens: `app/(tabs)/` = Overview / Ledger / Add / Insights / Settings; `app/chat.tsx` (RAG),
  `app/goals.tsx` (planner), `app/login.tsx`.

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
- Tests: `npm run test:e2e` (36-assertion backend suite), `npm run eval` (LLM-judged RAG eval).
- `EXPO_PUBLIC_*` env vars MUST be read as direct static `process.env.EXPO_PUBLIC_X` expressions.
  Aliasing (`const env = process.env; env.EXPO_PUBLIC_X`) works on the Metro dev server but
  compiles to `undefined` in release APK/AAB builds — the babel inline transform only matches
  literal member expressions.

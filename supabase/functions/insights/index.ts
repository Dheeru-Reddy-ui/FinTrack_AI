// FinTrack AI — `insights` Edge Function.
// Detection (forecasting, budget pacing, anomalies, subscriptions) is fully
// deterministic and happens before this is called. This function does ONE
// thing: rewrite the computed findings into a short, warm, plain-English
// summary. Numbers must be restated exactly — never recomputed. If every LLM
// is unavailable the client falls back to its deterministic text, so this
// function failing never breaks the feature.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
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

async function genText(system: string, user: string, budgetMs = 25_000): Promise<string | null> {
  if (!GEMINI_KEY) return null;
  const deadline = Date.now() + budgetMs;
  for (const model of GEN_MODELS) {
    const isGemma = model.startsWith('gemma');
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) return null;
      try {
        const body = isGemma
          ? { contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } }
          : { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 300 } };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(15_000, remaining)),
        });
        if (res.status === 429) {
          await res.body?.cancel();
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          break;
        }
        const data = await res.json();
        const cand = data?.candidates?.[0];
        let text = (cand?.content?.parts ?? [])
          .filter((p: { thought?: boolean }) => !p.thought)
          .map((p: { text?: string }) => p.text ?? '')
          .join('')
          .replace(/```[a-z]*/gi, '')
          .trim();
        // Thinking models can hit the token cap mid-sentence: keep only whole
        // sentences; if nothing whole survives, treat as failure.
        if (cand?.finishReason === 'MAX_TOKENS') text = text.replace(/[^.!?]*$/, '').trim();
        if (text) return text;
        break;
      } catch {
        break;
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: userData } = await db.auth.getUser();
    if (!userData?.user) return json({ error: 'Not signed in.' }, 401);

    const body = await req.json().catch(() => ({}));
    const facts = typeof body.facts === 'string' ? body.facts.slice(0, 4000) : '';
    if (!facts) return json({ error: 'Send { facts } to summarize.' }, 400);

    const sys = `You are FinTrack AI. Rewrite the user's computed finance findings into 2-4 warm, plain-English sentences (₹, Indian context).
Restate the given numbers EXACTLY — never recompute or invent figures. Lead with the most important thing (overspend risk > anomaly > subscription > good news). Descriptive only — no investment advice.`;
    const out = await genText(sys, `Computed findings:\n${facts}`);
    if (!out) return json({ summary: null, phrasing: 'unavailable' });
    return json({ summary: out, phrasing: 'llm' });
  } catch (e) {
    console.error('insights error:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'Could not summarize right now.' }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

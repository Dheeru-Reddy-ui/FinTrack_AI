// FinTrack AI — `parse-txn` Edge Function: AI ingestion.
//   { kind: 'nl', text }                          → parse free text into a transaction
//   { kind: 'receipt'|'upi', image, mime }        → vision-extract from a photo/screenshot
//   { kind: 'categorize', rows: [{merchant,note}] }→ batch-categorize (CSV import)
// Returns structured JSON validated server-side; the client always has a
// deterministic heuristic fallback, so LLM unavailability degrades gracefully.
// JWT-verified; the Gemini key exists only as a server-side secret. No
// transaction contents are logged.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const TEXT_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash', 'gemma-4-31b-it'];
const VISION_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash']; // Gemma: no vision

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GenPart { text?: string; inlineData?: { mimeType: string; data: string } }

async function generate(models: string[], system: string, parts: GenPart[], budgetMs = 30_000): Promise<string | null> {
  if (!GEMINI_KEY) return null;
  const deadline = Date.now() + budgetMs;
  for (const model of models) {
    const isGemma = model.startsWith('gemma');
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) return null;
      try {
        const body = isGemma
          ? { contents: [{ role: 'user', parts: [{ text: system }, ...parts] }], generationConfig: { temperature: 0, maxOutputTokens: 8192 } }
          : {
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts }],
              generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' },
            };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(20_000, remaining)),
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
        const text = (data?.candidates?.[0]?.content?.parts ?? [])
          .filter((p: { thought?: boolean }) => !p.thought)
          .map((p: { text?: string }) => p.text ?? '')
          .join('')
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        if (text) return text;
        break;
      } catch {
        break;
      }
    }
  }
  return null;
}

function extractJSON<T>(text: string): T | null {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  const arrA = text.indexOf('[');
  const arrB = text.lastIndexOf(']');
  try {
    if (arrA !== -1 && (a === -1 || arrA < a)) return JSON.parse(text.slice(arrA, arrB + 1)) as T;
    if (a !== -1) return JSON.parse(text.slice(a, b + 1)) as T;
  } catch { /* fall through */ }
  return null;
}

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

interface Parsed {
  amount: number;
  merchant: string | null;
  category: string;
  txn_date: string;
  type: 'expense' | 'income';
  confidence: number;
}

function validateParsed(p: Partial<Parsed> | null, categories: string[]): Parsed | null {
  if (!p || typeof p.amount !== 'number' || !isFinite(p.amount) || p.amount <= 0) return null;
  const date = typeof p.txn_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.txn_date) ? p.txn_date : todayIST();
  const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.7;
  return {
    amount: Math.round(p.amount * 100) / 100,
    merchant: typeof p.merchant === 'string' && p.merchant.trim() ? p.merchant.trim().slice(0, 80) : null,
    category: typeof p.category === 'string' && categories.includes(p.category) ? p.category : 'Others',
    txn_date: date,
    type: p.type === 'income' ? 'income' : 'expense',
    confidence,
  };
}

const parsePrompt = (categories: string[], kind: string) => `You extract ONE financial transaction from ${
  kind === 'nl' ? 'informal Indian personal-finance text'
  : kind === 'upi' ? 'an Indian UPI / PhonePe / Paytm / GPay payment screenshot'
  : 'a photo of an Indian shop receipt'
}.
Return ONLY JSON: {"amount": number, "merchant": string|null, "category": string, "txn_date": "YYYY-MM-DD", "type": "expense"|"income", "confidence": number 0-1}.
- Amounts are INR (₹). For receipts use the grand total actually paid.
- category MUST be one of: ${categories.join(', ')}.
- Today is ${todayIST()} (India). Resolve relative dates ("yesterday"); if no date is visible use today.
- "received/credited/salary/refund" → type "income", category "Income".
- confidence reflects how sure you are about amount+category together.`;

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
    const { data: catRows } = await db.from('categories').select('name');
    const categories: string[] = (catRows ?? []).map((r: { name: string }) => r.name);
    if (!categories.length) return json({ error: 'No categories found.' }, 400);

    // --- natural language ---
    if (body.kind === 'nl') {
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : '';
      if (!text) return json({ error: 'Send { text } to parse.' }, 400);
      const out = await generate(TEXT_MODELS, parsePrompt(categories, 'nl'), [{ text }]);
      const parsed = validateParsed(out ? extractJSON<Parsed>(out) : null, categories);
      if (!parsed) return json({ ok: false, reason: 'ai_unavailable' });
      return json({ ok: true, parsed });
    }

    // --- receipt / UPI screenshot vision ---
    if (body.kind === 'receipt' || body.kind === 'upi') {
      const image = typeof body.image === 'string' ? body.image : '';
      const mime = typeof body.mime === 'string' && body.mime.startsWith('image/') ? body.mime : 'image/jpeg';
      if (!image || image.length > 6_000_000) return json({ error: 'Send { image } as base64 (max ~4MB).' }, 400);
      const out = await generate(VISION_MODELS, parsePrompt(categories, body.kind), [
        { inlineData: { mimeType: mime, data: image } },
        { text: 'Extract the transaction from this image.' },
      ]);
      const parsed = validateParsed(out ? extractJSON<Parsed>(out) : null, categories);
      if (!parsed) return json({ ok: false, reason: 'ai_unavailable' });
      return json({ ok: true, parsed });
    }

    // --- batch categorization (CSV import) ---
    if (body.kind === 'categorize') {
      const rows: { merchant?: string; note?: string }[] = Array.isArray(body.rows) ? body.rows.slice(0, 100) : [];
      if (!rows.length) return json({ error: 'Send { rows: [{merchant}] }.' }, 400);
      const listing = rows.map((r, i) => `${i}: ${String(r.merchant ?? '').slice(0, 60)} ${String(r.note ?? '').slice(0, 40)}`).join('\n');
      const sys = `Classify each numbered Indian transaction into exactly one category from: ${categories.join(', ')}.
Return ONLY a JSON array, same order and length as the input: [{"category": string, "confidence": number 0-1}, ...]`;
      const out = await generate(TEXT_MODELS, sys, [{ text: listing }]);
      const arr = out ? extractJSON<{ category: string; confidence: number }[]>(out) : null;
      if (!Array.isArray(arr) || arr.length !== rows.length) return json({ ok: false, reason: 'ai_unavailable' });
      return json({
        ok: true,
        results: arr.map((r) => ({
          category: categories.includes(r?.category) ? r.category : 'Others',
          confidence: typeof r?.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
        })),
      });
    }

    return json({ error: 'Unknown kind.' }, 400);
  } catch (e) {
    console.error('parse-txn error:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'Could not parse right now — please try again.' }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

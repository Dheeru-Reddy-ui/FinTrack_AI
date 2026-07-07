// FinTrack AI — `embed` Edge Function.
// Generates a 768-dim Gemini embedding of a compact transaction summary and stores
// it in transactions.embedding. Invoked three ways:
//   1) Supabase Database Webhook on INSERT/UPDATE of transactions  -> { type, record }
//   2) On-demand for one row                                       -> { transaction_id }
//   3) One-time backfill of all rows missing an embedding          -> { backfill: true }
// The Gemini key lives only in Supabase secrets; it never reaches the client.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const EMBED_SECRET = Deno.env.get('EMBED_SECRET') ?? '';
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMS = 768;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface TxnRow {
  id: string;
  amount: number;
  type: string;
  merchant: string | null;
  txn_date: string;
  category_id: string | null;
}

async function categoryName(categoryId: string | null): Promise<string> {
  if (!categoryId) return 'uncategorized';
  const { data } = await admin.from('categories').select('name').eq('id', categoryId).maybeSingle();
  return data?.name ?? 'uncategorized';
}

function summarize(t: TxnRow, category: string): string {
  const amt = `₹${Number(t.amount).toLocaleString('en-IN')}`;
  const who = t.merchant ? ` at ${t.merchant}` : '';
  return `${amt} ${category}${who} on ${t.txn_date} (${t.type})`;
}

async function embedText(text: string, attempt = 0): Promise<number[]> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not configured');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBED_DIMS }),
      signal: AbortSignal.timeout(10_000), // never hang on a stalled upstream
    },
  );
  // Back off on rate limits (free tier RPM caps).
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return embedText(text, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const values = json?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIMS) throw new Error('Unexpected embedding shape');
  return values;
}

async function embedRow(t: TxnRow): Promise<void> {
  const category = await categoryName(t.category_id);
  const vector = await embedText(summarize(t, category));
  const { error } = await admin.from('transactions').update({ embedding: vector }).eq('id', t.id);
  if (error) throw error;
}

Deno.serve(async (req) => {
  try {
    // verify_jwt is off (DB webhooks can't sign JWTs), so gate with a shared
    // secret instead: only the pg_net trigger / server-side callers know it.
    if (!EMBED_SECRET || req.headers.get('x-embed-secret') !== EMBED_SECRET) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    const body = await req.json().catch(() => ({}));

    // (3) Backfill — embed every row still missing an embedding, in batches.
    if (body.backfill) {
      let total = 0;
      for (;;) {
        const { data, error } = await admin
          .from('transactions')
          .select('id, amount, type, merchant, txn_date, category_id')
          .is('embedding', null)
          .limit(50);
        if (error) throw error;
        if (!data?.length) break;
        for (const row of data as TxnRow[]) await embedRow(row);
        total += data.length;
        if (data.length < 50) break;
      }
      return json({ ok: true, embedded: total });
    }

    // (1) Database Webhook payload, or (2) explicit transaction_id.
    let row: TxnRow | null = body.record ?? null;
    if (!row && body.transaction_id) {
      const { data, error } = await admin
        .from('transactions')
        .select('id, amount, type, merchant, txn_date, category_id')
        .eq('id', body.transaction_id)
        .maybeSingle();
      if (error) throw error;
      row = data as TxnRow | null;
    }
    if (!row?.id) return json({ ok: false, error: 'No transaction provided' }, 400);

    await embedRow(row);
    return json({ ok: true, id: row.id });
  } catch (e) {
    console.error('embed error:', e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

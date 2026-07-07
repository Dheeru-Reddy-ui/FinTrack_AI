/**
 * Client for the AI Edge Functions. The app never talks to Gemini directly —
 * questions go to the `chat` function with the user's JWT; all numbers are
 * computed by SQL server-side and the answer comes back grounded + cited.
 */
import { getSupabase } from './supabase';

export interface ChatCitation {
  id: string;
  merchant: string | null;
  amount: number;
  txn_date: string;
  category: string;
}

export interface ChatResult {
  answer: string;
  citations: ChatCitation[];
  meta?: {
    planner: 'llm' | 'rules';
    phrasing: 'llm' | 'template';
    intent: string;
    range: { from: string | null; to: string | null; label: string };
  };
}

export async function askFinance(question: string): Promise<ChatResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Backend not configured.');
  const { data, error } = await supabase.functions.invoke('chat', { body: { question } });
  if (error) {
    // supabase-js wraps non-2xx; surface a friendly message.
    throw new Error('The assistant is unreachable right now. Check your connection and try again.');
  }
  if (data?.error) throw new Error(String(data.error));
  if (!data?.answer) throw new Error('No answer returned — please try again.');
  return data as ChatResult;
}

/**
 * LLM phrasing for the insights screen. Detection is deterministic and happens
 * client-side; this only asks the `insights` Edge Function to phrase the
 * computed findings. Returns null when the LLM is unavailable — callers must
 * fall back to their deterministic text.
 */
export async function explainInsights(facts: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('insights', { body: { facts } });
    if (error || !data?.summary) return null;
    return String(data.summary);
  } catch {
    return null;
  }
}

// ---------------- AI ingestion (parse-txn Edge Function) ----------------
export interface ParsedTxn {
  amount: number;
  merchant: string | null;
  category: string;
  txn_date: string;
  type: 'expense' | 'income';
  confidence: number;
}

/** Parse free text into a transaction. Returns null when the AI is
 *  unavailable — callers fall back to the on-device heuristic parser. */
export async function parseNL(text: string): Promise<ParsedTxn | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('parse-txn', { body: { kind: 'nl', text } });
    if (error || !data?.ok) return null;
    return data.parsed as ParsedTxn;
  } catch {
    return null;
  }
}

/** Extract a transaction from a receipt photo or UPI screenshot. Null when
 *  vision AI is unavailable — the UI then shows the manual confirm form. */
export async function parseImage(kind: 'receipt' | 'upi', base64: string, mime: string): Promise<ParsedTxn | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('parse-txn', { body: { kind, image: base64, mime } });
    if (error || !data?.ok) return null;
    return data.parsed as ParsedTxn;
  } catch {
    return null;
  }
}

/** Batch-categorize CSV rows. Null → callers keep their heuristic categories. */
export async function categorizeBatch(rows: { merchant: string; note?: string }[]): Promise<{ category: string; confidence: number }[] | null> {
  const supabase = getSupabase();
  if (!supabase || !rows.length) return null;
  try {
    const { data, error } = await supabase.functions.invoke('parse-txn', { body: { kind: 'categorize', rows } });
    if (error || !data?.ok || !Array.isArray(data.results)) return null;
    return data.results;
  } catch {
    return null;
  }
}

export const SUGGESTED_QUESTIONS = [
  'How much did I spend on food this month?',
  'What were my biggest expenses last month?',
  'Compare my spending this month vs last month',
  'How much did I save last month?',
  'How many Swiggy orders did I make?',
];

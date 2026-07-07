/**
 * Ingestion intelligence: turn free text / receipts / UPI screenshots into a
 * structured transaction, and auto-categorize it with a confidence score.
 * Each function tries the LLM, then falls back to deterministic heuristics.
 */
import { extractJSON, hasLLMConfigured, llmChat } from './llm';
import { todayISO } from '@/lib/format';

export interface ParsedTxn {
  amount: number;
  merchant: string | null;
  category: string;
  txnDate: string;
  type: 'expense' | 'income';
  confidence: number;
  needsReview: boolean;
}

// Keyword → category table drives the offline fallback and biases the LLM.
const KEYWORDS: Record<string, string[]> = {
  'Food & Dining': ['swiggy', 'zomato', 'starbucks', 'domino', 'pizza', 'cafe', 'restaurant', 'mcdonald', 'kfc', 'biryani', 'chaayos', 'coffee', 'dinner', 'lunch', 'breakfast', 'food', 'eat'],
  Groceries: ['bigbasket', 'dmart', 'blinkit', 'zepto', 'grofers', 'reliance fresh', 'supermarket', 'grocery', 'groceries', 'vegetables', 'milk'],
  Transport: ['uber', 'ola', 'rapido', 'metro', 'petrol', 'fuel', 'indianoil', 'irctc', 'train', 'bus', 'cab', 'auto', 'ride', 'travel'],
  Shopping: ['amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'croma', 'shopping', 'clothes', 'shoes', 'headphones', 'electronics'],
  'Bills & Utilities': ['airtel', 'jio', 'vodafone', 'bescom', 'electricity', 'water bill', 'gas', 'broadband', 'act fibernet', 'recharge', 'bill', 'wifi', 'internet'],
  Rent: ['rent', 'landlord', 'maintenance'],
  Entertainment: ['netflix', 'spotify', 'hotstar', 'prime video', 'youtube premium', 'bookmyshow', 'pvr', 'inox', 'movie', 'game', 'concert'],
  Health: ['apollo', 'pharmeasy', '1mg', 'practo', 'cult.fit', 'cultfit', 'gym', 'medicine', 'pharmacy', 'doctor', 'hospital'],
  Income: ['salary', 'payroll', 'freelance', 'refund', 'cashback', 'interest', 'received', 'credited', 'income'],
};

const INCOME_HINTS = ['salary', 'payroll', 'received', 'credited', 'refund', 'cashback', 'interest', 'income', 'freelance'];

export function categorizeHeuristic(text: string): { category: string; confidence: number } {
  const t = text.toLowerCase();
  let best = 'Others';
  let hits = 0;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    const c = words.filter((w) => t.includes(w)).length;
    if (c > hits) {
      hits = c;
      best = cat;
    }
  }
  const confidence = hits === 0 ? 0.45 : Math.min(0.95, 0.7 + hits * 0.12);
  return { category: best, confidence };
}

function parseRelativeDate(text: string): string {
  const t = text.toLowerCase();
  const today = new Date();
  const shift = (d: number) => {
    const x = new Date(today);
    x.setDate(x.getDate() - d);
    return x.toISOString().slice(0, 10);
  };
  if (t.includes('yesterday')) return shift(1);
  if (t.includes('day before yesterday')) return shift(2);
  const ago = t.match(/(\d+)\s*days?\s*ago/);
  if (ago) return shift(Number(ago[1]));
  const iso = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return todayISO();
}

export function parseNLHeuristic(text: string): ParsedTxn {
  // amount: first standalone number, allowing ₹, commas, k/rs
  const amtMatch = text.match(/(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  let amount = 0;
  if (amtMatch) {
    amount = parseFloat(amtMatch[1].replace(/,/g, ''));
    if (amtMatch[2]) amount *= 1000;
  }
  // merchant: token(s) after at/from/to (not "on"/"for" — those usually precede
  // a category/verb, e.g. "on groceries", "for dinner").
  let merchant: string | null = null;
  const m = text.match(/\b(?:at|from|to)\s+([A-Za-z][\w'&.\- ]{1,30}?)(?:\s+(?:yesterday|today|on|for|\d)|[.,]|$)/i);
  if (m) merchant = m[1].trim().replace(/\s+/g, ' ');
  const { category, confidence } = categorizeHeuristic(text);
  const type: 'expense' | 'income' = INCOME_HINTS.some((h) => text.toLowerCase().includes(h)) ? 'income' : 'expense';
  return {
    amount,
    merchant,
    category: type === 'income' ? 'Income' : category,
    txnDate: parseRelativeDate(text),
    type,
    confidence: amount === 0 ? 0.3 : confidence,
    needsReview: confidence < 0.75 || amount === 0,
  };
}

/** Natural-language entry → structured transaction. */
export async function parseNaturalLanguage(text: string, categories: string[]): Promise<ParsedTxn> {
  if (!hasLLMConfigured()) return parseNLHeuristic(text);
  try {
    const sys = `You extract a single financial transaction from Indian personal-finance text.
Return ONLY JSON: {"amount": number, "merchant": string|null, "category": string, "txnDate": "YYYY-MM-DD", "type": "expense"|"income", "confidence": number}.
Category must be one of: ${categories.join(', ')}.
Amounts are Indian Rupees. Today is ${todayISO()}. Resolve relative dates like "yesterday".`;
    const raw = await llmChat([
      { role: 'system', content: sys },
      { role: 'user', content: text },
    ], { json: true, temperature: 0 });
    const parsed = extractJSON<Partial<ParsedTxn>>(raw);
    if (!parsed || typeof parsed.amount !== 'number') return parseNLHeuristic(text);
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
    return {
      amount: parsed.amount,
      merchant: parsed.merchant ?? null,
      category: parsed.category && categories.includes(parsed.category) ? parsed.category : categorizeHeuristic(text).category,
      txnDate: parsed.txnDate ?? parseRelativeDate(text),
      type: parsed.type === 'income' ? 'income' : 'expense',
      confidence,
      needsReview: confidence < 0.7,
    };
  } catch {
    return parseNLHeuristic(text);
  }
}

/** Auto-categorization for a known merchant/amount (used on every insert). */
export async function autoCategorize(merchant: string, note: string, categories: string[]): Promise<{ category: string; confidence: number }> {
  const text = `${merchant} ${note}`.trim();
  if (!hasLLMConfigured()) return categorizeHeuristic(text);
  try {
    const raw = await llmChat([
      { role: 'system', content: `Classify the transaction into exactly one category from: ${categories.join(', ')}. Return ONLY JSON {"category": string, "confidence": number}.` },
      { role: 'user', content: text },
    ], { json: true, temperature: 0 });
    const parsed = extractJSON<{ category: string; confidence: number }>(raw);
    if (parsed && categories.includes(parsed.category)) return parsed;
    return categorizeHeuristic(text);
  } catch {
    return categorizeHeuristic(text);
  }
}

/** Vision: receipt / UPI screenshot → transaction. base64 image (no data: prefix). */
export async function parseImage(base64: string, mime: string, kind: 'receipt' | 'upi', categories: string[]): Promise<ParsedTxn | null> {
  if (!hasLLMConfigured()) return null; // caller shows manual-confirm form in demo mode
  try {
    const { parseImageWithVision } = await import('./vision');
    return await parseImageWithVision(base64, mime, kind, categories);
  } catch {
    return null;
  }
}

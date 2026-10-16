/**
 * On-device ingestion heuristics: turn free text into a structured transaction
 * and categorize it with a confidence score, using nothing but a keyword table.
 *
 * These are the deterministic fallbacks. The LLM paths live server-side in the
 * `parse-txn` Edge Function and are reached through `@/data/ai` — callers try
 * that first and fall back to these when the AI is unavailable.
 */
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

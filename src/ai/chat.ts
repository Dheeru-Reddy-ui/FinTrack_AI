/**
 * "Chat with your money" — a lightweight RAG + tools agent.
 *
 * Retrieval: keyword/category/time filtering over the local ledger (stands in
 * for pgvector similarity in demo mode; the real build embeds each txn).
 * Tools: deterministic sum/group-by aggregations so quantitative answers are
 * exact rather than hallucinated. The LLM (when configured) only phrases the
 * answer over retrieved rows + computed aggregates.
 */
import type { Budget, Goal, Transaction } from '@/data/types';
import { inLastDays, inMonth, inThisWeek, spendByCategory, totalExpense, totalIncome } from '@/data/analytics';
import { hasLLMConfigured, llmChat } from './llm';
import { formatINR, currentMonthKey, localISO, monthLabel } from '@/lib/format';

export interface ChatContext {
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
}

export interface ChatAnswer {
  text: string;
  citations: string[];
}

const CATEGORY_ALIASES: Record<string, string> = {
  food: 'Food & Dining', dining: 'Food & Dining', eat: 'Food & Dining', restaurant: 'Food & Dining',
  grocery: 'Groceries', groceries: 'Groceries',
  transport: 'Transport', travel: 'Transport', uber: 'Transport', ola: 'Transport', fuel: 'Transport', petrol: 'Transport',
  shopping: 'Shopping', amazon: 'Shopping', clothes: 'Shopping',
  bills: 'Bills & Utilities', utilities: 'Bills & Utilities', electricity: 'Bills & Utilities', recharge: 'Bills & Utilities',
  rent: 'Rent',
  entertainment: 'Entertainment', netflix: 'Entertainment', movie: 'Entertainment', subscription: 'Entertainment',
  health: 'Health', gym: 'Health', medicine: 'Health',
  income: 'Income', salary: 'Income',
};

function detectCategories(q: string): string[] {
  const t = q.toLowerCase();
  const found = new Set<string>();
  for (const [alias, cat] of Object.entries(CATEGORY_ALIASES)) {
    if (t.includes(alias)) found.add(cat);
  }
  return [...found];
}

type Range = { label: string; txns: (all: Transaction[]) => Transaction[]; explicit: boolean };

function detectRange(q: string): Range {
  const t = q.toLowerCase();
  const cur = currentMonthKey();
  const prevKey = (() => {
    const [y, m] = cur.split('-').map(Number);
    return new Date(y, m - 2, 1).toISOString().slice(0, 7);
  })();
  if (t.includes('last month') || t.includes('previous month'))
    return { label: monthLabel(prevKey), txns: (a) => inMonth(a, prevKey), explicit: true };
  if (t.includes('this month')) return { label: monthLabel(cur), txns: (a) => inMonth(a, cur), explicit: true };
  if (t.includes('this week') || t.includes('week')) return { label: 'this week', txns: (a) => inThisWeek(a), explicit: true };
  if (t.includes('today')) return { label: 'today', txns: (a) => a.filter((x) => x.txnDate === localISO()), explicit: true };
  if (t.includes('year')) return { label: 'the last year', txns: (a) => inLastDays(a, 365), explicit: true };
  if (t.includes('last 30') || t.includes('30 days')) return { label: 'the last 30 days', txns: (a) => inLastDays(a, 30), explicit: true };
  // Default: rolling last 30 days (more useful than a near-empty calendar month early on).
  return { label: 'the last 30 days', txns: (a) => inLastDays(a, 30), explicit: false };
}

/** Build the deterministic answer + the retrieved rows used as citations. */
function computeAnswer(question: string, ctx: ChatContext): { text: string; rows: Transaction[] } {
  const q = question.toLowerCase();
  const cats = detectCategories(question);
  const range = detectRange(question);
  const scoped = range.txns(ctx.transactions);
  const expenses = scoped.filter((t) => t.type === 'expense');

  // "compare X vs last month" style
  if (q.includes('compare') || q.includes(' vs ') || q.includes('versus')) {
    const cur = currentMonthKey();
    const [y, m] = cur.split('-').map(Number);
    const prevKey = new Date(y, m - 2, 1).toISOString().slice(0, 7);
    const cat = cats[0];
    const filt = (arr: Transaction[]) => (cat ? arr.filter((t) => t.category === cat) : arr).filter((t) => t.type === 'expense');
    const a = totalExpense(filt(inMonth(ctx.transactions, cur)));
    const b = totalExpense(filt(inMonth(ctx.transactions, prevKey)));
    const diff = a - b;
    const label = cat ?? 'overall';
    const dir = diff > 0 ? 'more' : 'less';
    const rows = filt(inMonth(ctx.transactions, cur)).slice(0, 5);
    return {
      text: `Your ${label} spending is ${formatINR(a)} this month vs ${formatINR(b)} last month — ${formatINR(Math.abs(diff))} ${dir} (${b ? Math.round((diff / b) * 100) : 0}%).`,
      rows,
    };
  }

  // "biggest / top expenses"
  if (q.includes('biggest') || q.includes('top') || q.includes('largest') || q.includes('most expensive')) {
    const top = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5);
    if (!top.length) return { text: `No expenses found for ${range.label}.`, rows: [] };
    const lines = top.map((t, i) => `${i + 1}. ${formatINR(t.amount)} — ${t.merchant ?? t.category} (${t.category})`);
    return { text: `Your biggest expenses ${labelPhrase(range.label)}:\n${lines.join('\n')}`, rows: top };
  }

  // "how many / count"
  if (q.includes('how many') || q.includes('number of') || q.includes('count')) {
    const filt = cats.length ? expenses.filter((t) => cats.includes(t.category ?? '')) : expenses;
    return { text: `You made ${filt.length} transactions ${labelPhrase(range.label)}${cats.length ? ` on ${cats.join(', ')}` : ''}, totalling ${formatINR(totalExpense(filt))}.`, rows: filt.slice(0, 5) };
  }

  // "average"
  if (q.includes('average') || q.includes('avg')) {
    const filt = cats.length ? expenses.filter((t) => cats.includes(t.category ?? '')) : expenses;
    const avg = filt.length ? totalExpense(filt) / filt.length : 0;
    return { text: `Your average ${cats[0] ?? ''} transaction ${labelPhrase(range.label)} is ${formatINR(avg)} across ${filt.length} transactions.`, rows: filt.slice(0, 5) };
  }

  // "income / earn / salary"
  if (q.includes('income') || q.includes('earn') || q.includes('salary') || q.includes('save') || q.includes('saving')) {
    const inc = totalIncome(scoped);
    const exp = totalExpense(scoped);
    if (q.includes('save') || q.includes('saving'))
      return { text: `${cap(labelPhrase(range.label))} you earned ${formatINR(inc)} and spent ${formatINR(exp)}, saving ${formatINR(inc - exp)}.`, rows: scoped.filter((t) => t.type === 'income').slice(0, 3) };
    return { text: `Your income ${labelPhrase(range.label)} is ${formatINR(inc)}.`, rows: scoped.filter((t) => t.type === 'income').slice(0, 3) };
  }

  // category-specific "how much did I spend on X"
  if (cats.length) {
    const filt = expenses.filter((t) => cats.includes(t.category ?? ''));
    const total = totalExpense(filt);
    const budget = ctx.budgets.find((b) => cats.includes(b.category));
    let extra = '';
    if (budget) {
      const pct = Math.round((total / budget.limitAmount) * 100);
      extra = ` That's ${pct}% of your ${formatINR(budget.limitAmount)} ${budget.category} budget.`;
    }
    return { text: `You spent ${formatINR(total)} on ${cats.join(' & ')} ${labelPhrase(range.label)} across ${filt.length} transactions.${extra}`, rows: filt.slice(0, 5) };
  }

  // default: overall spend + top categories
  const total = totalExpense(expenses);
  const byCat = spendByCategory(expenses).slice(0, 3);
  const breakdown = byCat.map((s) => `${s.category} ${formatINR(s.amount)}`).join(', ');
  return {
    text: `You spent ${formatINR(total)} ${labelPhrase(range.label)}. Top categories: ${breakdown || 'none yet'}.`,
    rows: [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

const labelPhrase = (label: string) => (/^\w+ \d{4}$/.test(label) ? `in ${label}` : label);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function answerQuestion(question: string, ctx: ChatContext): Promise<ChatAnswer> {
  const { text, rows } = computeAnswer(question, ctx);
  const citations = rows.map((r) => r.id);

  if (!hasLLMConfigured()) {
    return { text, citations };
  }

  // LLM phrasing over retrieved rows + the exact computed figure (grounded).
  try {
    const context = rows
      .map((r) => `- ${r.txnDate} | ${r.merchant ?? '—'} | ${r.category} | ${formatINR(r.amount)} | ${r.type}`)
      .join('\n');
    const sys = `You are FinTrack AI's finance assistant for an Indian user (currency ₹).
Answer conversationally and briefly using ONLY the pre-computed answer and retrieved transactions below.
Never invent numbers. Amounts are already exact — restate them. Be encouraging, not prescriptive (no investment advice).`;
    const user = `Question: ${question}\n\nPre-computed answer: ${text}\n\nRetrieved transactions:\n${context || '(none)'}`;
    const out = await llmChat([
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { temperature: 0.3, maxTokens: 300 });
    return { text: out.trim() || text, citations };
  } catch {
    return { text, citations };
  }
}

/** Starter prompts surfaced in the chat UI. */
export const SUGGESTED_QUESTIONS = [
  'How much did I spend on food this month?',
  'What are my biggest expenses?',
  'Compare my spending vs last month',
  'How much did I save this month?',
  'How many Swiggy orders did I make?',
];

import type { Budget, Category, Insight, Transaction } from './types';
import { colorForCategory } from '@/theme';
import { currentMonthKey, dayOfMonth, daysInMonth, localISO, monthKey } from '@/lib/format';
import { groupBy, sum, uid } from '@/lib/id';

/** Group label for rollups: subcategories report under their top-level parent. */
const groupOf = (t: Transaction) => t.categoryGroup ?? t.category ?? 'Uncategorized';

/** A budget's category ids expanded with all their subcategory ids. */
export function expandBudgetCategories(budget: Budget, categories: Category[]): Set<string> {
  const ids = new Set(budget.categoryIds);
  for (const c of categories) if (c.parentId && ids.has(c.parentId)) ids.add(c.id);
  return ids;
}

/** Current window for a budget period (IST-local dates). */
export function budgetWindow(period: Budget['period'], now = new Date()): { start: string; end: string; elapsed: number; total: number; label: string } {
  const today = localISO(now);
  if (period === 'weekly') {
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    const s = new Date(now); s.setDate(now.getDate() - dow);
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return { start: localISO(s), end: localISO(e), elapsed: dow + 1, total: 7, label: 'this week' };
  }
  if (period === 'yearly') {
    const s = new Date(now.getFullYear(), 0, 1);
    const e = new Date(now.getFullYear(), 11, 31);
    const elapsed = Math.round((now.getTime() - s.getTime()) / 86400000) + 1;
    return { start: localISO(s), end: localISO(e), elapsed, total: 365, label: 'this year' };
  }
  const key = today.slice(0, 7);
  const total = daysInMonth(key);
  return { start: `${key}-01`, end: `${key}-${String(total).padStart(2, '0')}`, elapsed: Number(today.slice(8, 10)), total, label: 'this month' };
}

export const isExpense = (t: Transaction) => t.type === 'expense';
export const isIncome = (t: Transaction) => t.type === 'income';

export function inMonth(txns: Transaction[], key: string): Transaction[] {
  return txns.filter((t) => monthKey(t.txnDate) === key);
}

export function inLastDays(txns: Transaction[], days: number): Transaction[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const c = localISO(cutoff);
  return txns.filter((t) => t.txnDate >= c);
}

/** Transactions in the window [daysAgoEnd, daysAgoStart) — for period comparisons. */
export function inDayWindow(txns: Transaction[], startDaysAgo: number, endDaysAgo: number): Transaction[] {
  const s = new Date();
  s.setDate(s.getDate() - startDaysAgo);
  const e = new Date();
  e.setDate(e.getDate() - endDaysAgo);
  const from = localISO(s);
  const to = localISO(e);
  return txns.filter((t) => t.txnDate >= from && t.txnDate < to);
}

export function inThisWeek(txns: Transaction[]): Transaction[] {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Monday=0
  const start = new Date(now);
  start.setDate(now.getDate() - dow);
  const c = localISO(start);
  return txns.filter((t) => t.txnDate >= c);
}

export function totalExpense(txns: Transaction[]): number {
  return sum(txns.filter(isExpense).map((t) => t.amount));
}
export function totalIncome(txns: Transaction[]): number {
  return sum(txns.filter(isIncome).map((t) => t.amount));
}

export interface CategorySlice {
  category: string;
  amount: number;
  pct: number;
  color: string;
}

export function spendByCategory(txns: Transaction[]): CategorySlice[] {
  const expenses = txns.filter(isExpense);
  const total = sum(expenses.map((t) => t.amount));
  const groups = groupBy(expenses, groupOf);
  const slices = Object.entries(groups)
    .map(([category, items]) => {
      const amount = sum(items.map((t) => t.amount));
      return { category, amount, pct: total ? (amount / total) * 100 : 0, color: colorForCategory(category) };
    })
    .sort((a, b) => b.amount - a.amount);
  return slices;
}

/** Headline period: current month, but fall back to trailing 30 days if the
 *  month has just started (keeps the dashboard from looking empty on the 1st). */
export function primaryPeriod(txns: Transaction[]): { label: string; txns: Transaction[]; isMonth: boolean } {
  const key = currentMonthKey();
  const month = inMonth(txns, key);
  if (month.length >= 8) return { label: 'This month', txns: month, isMonth: true };
  return { label: 'Last 30 days', txns: inLastDays(txns, 30), isMonth: false };
}

export interface StatDelta {
  value: number;
  prev: number;
  deltaPct: number; // vs previous comparable period
}

function prevMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.toISOString().slice(0, 7);
}

export function monthlyStats(txns: Transaction[]): {
  income: StatDelta;
  expense: StatDelta;
  savings: StatDelta;
} {
  const key = currentMonthKey();
  const prev = prevMonthKey(key);
  const cur = inMonth(txns, key);
  const pre = inMonth(txns, prev);
  const mk = (v: number, p: number): StatDelta => ({ value: v, prev: p, deltaPct: p ? ((v - p) / p) * 100 : 0 });
  const inc = mk(totalIncome(cur), totalIncome(pre));
  const exp = mk(totalExpense(cur), totalExpense(pre));
  const sav = mk(inc.value - exp.value, inc.prev - exp.prev);
  return { income: inc, expense: exp, savings: sav };
}

/** Rolling last-30-days vs the prior 30 days. Robust even at the start of a
 *  calendar month (when "this month" would otherwise look empty). */
export function rollingStats(txns: Transaction[]): { income: StatDelta; expense: StatDelta; savings: StatDelta } {
  const cur = inLastDays(txns, 30);
  const prev = inDayWindow(txns, 60, 30);
  const mk = (v: number, p: number): StatDelta => ({ value: v, prev: p, deltaPct: p ? ((v - p) / p) * 100 : 0 });
  const inc = mk(totalIncome(cur), totalIncome(prev));
  const exp = mk(totalExpense(cur), totalExpense(prev));
  const sav = mk(inc.value - exp.value, inc.prev - exp.prev);
  return { income: inc, expense: exp, savings: sav };
}

export interface BudgetProgress {
  budget: Budget;
  spent: number;
  pct: number;
  color: string;
  overBudget: boolean;
  periodLabel: string;
}

export function budgetProgress(txns: Transaction[], budgets: Budget[], categories: Category[]): BudgetProgress[] {
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));
  return budgets.map((b) => {
    const win = budgetWindow(b.period);
    const ids = expandBudgetCategories(b, categories);
    const spent = sum(
      txns
        .filter(isExpense)
        .filter((t) => t.txnDate >= win.start && t.txnDate <= win.end && t.categoryId && ids.has(t.categoryId))
        .map((t) => t.amount)
    );
    const pct = b.limitAmount ? (spent / b.limitAmount) * 100 : 0;
    const colorKey = catNameById.get(b.categoryIds[0] ?? '') ?? b.name;
    return { budget: b, spent, pct, color: colorForCategory(colorKey), overBudget: spent > b.limitAmount, periodLabel: win.label };
  });
}

// --- Forecasting (deterministic) ---
export interface Forecast {
  category: string;
  spentSoFar: number;
  projected: number;
  limit?: number;
  willOverspend: boolean;
  overBy: number;
}

/** Month-end projection per MONTHLY budget (weekly/yearly budgets are paced by
 *  nudges instead). Blends the current month's pace with the 3-month history
 *  of the budget's categories, trusting pace more as days accumulate. */
export function forecastMonth(txns: Transaction[], budgets: Budget[], categories: Category[]): Forecast[] {
  const key = currentMonthKey();
  const day = Math.max(dayOfMonth(localISO()), 1);
  const total = daysInMonth(key);
  const remaining = total - day;
  const w = Math.min(1, day / 8);
  const now = new Date();

  return budgets
    .filter((b) => b.period === 'monthly' && b.limitAmount > 0 && b.categoryIds.length > 0)
    .map((b) => {
      const ids = expandBudgetCategories(b, categories);
      const inSet = (t: Transaction) => isExpense(t) && !!t.categoryId && ids.has(t.categoryId);
      const spentSoFar = sum(inMonth(txns, key).filter(inSet).map((t) => t.amount));

      // 3-month history for this budget's categories
      let hist = 0;
      let counted = 0;
      for (let m = 1; m <= 3; m++) {
        const mk = localISO(new Date(now.getFullYear(), now.getMonth() - m, 1)).slice(0, 7);
        const v = sum(inMonth(txns, mk).filter(inSet).map((t) => t.amount));
        if (v > 0) { hist += v; counted++; }
      }
      const histTotal = counted ? hist / counted : spentSoFar * (total / day);

      const dailyRate = w * (spentSoFar / day) + (1 - w) * (histTotal / total);
      const projected = Math.round(spentSoFar + dailyRate * remaining);
      const willOverspend = projected > b.limitAmount;
      return {
        category: b.name, // display label (kept as `category` for existing call sites)
        spentSoFar,
        projected,
        limit: b.limitAmount,
        willOverspend,
        overBy: Math.max(0, projected - b.limitAmount),
      };
    })
    .sort((a, b) => b.overBy - a.overBy || b.projected - a.projected);
}

// --- Subscription detection ---
export interface Subscription {
  merchant: string;
  amount: number;
  category: string;
  occurrences: number;
  lastDate: string;
  likelyForgotten: boolean;
}

export function detectSubscriptions(txns: Transaction[]): Subscription[] {
  const expenses = txns.filter(isExpense);
  const byMerchant = groupBy(expenses, (t) => (t.merchant ?? 'Unknown').trim());
  const subs: Subscription[] = [];
  for (const [merchant, items] of Object.entries(byMerchant)) {
    if (merchant === 'Unknown') continue;
    // group by rounded amount; a recurring charge repeats the same amount monthly
    const byAmt = groupBy(items, (t) => String(Math.round(t.amount)));
    for (const [amtStr, group] of Object.entries(byAmt)) {
      if (group.length < 2) continue;
      // Rent recurs monthly too, but it isn't a "subscription" worth flagging.
      if (group[0].category === 'Rent') continue;
      const dates = group.map((g) => g.txnDate).sort();
      const monthsSpanned = new Set(dates.map((d) => d.slice(0, 7))).size;
      if (monthsSpanned < 2) continue;
      const lastDate = dates[dates.length - 1];
      const daysSince = Math.round((Date.now() - new Date(lastDate).getTime()) / 86400000);
      subs.push({
        merchant,
        amount: Number(amtStr),
        category: group[0].category ?? 'Others',
        occurrences: group.length,
        lastDate,
        likelyForgotten: daysSince > 40, // hasn't recurred as expected
      });
    }
  }
  return subs.sort((a, b) => b.amount - a.amount);
}

// --- Anomaly detection (statistical outliers per category) ---
export interface Anomaly {
  txn: Transaction;
  category: string;
  amount: number;
  median: number;
  ratio: number;
}

export function detectAnomalies(txns: Transaction[], lookbackDays = 45): Anomaly[] {
  const recent = inLastDays(txns.filter(isExpense), lookbackDays);
  const byCat = groupBy(recent, (t) => t.category ?? 'Uncategorized');
  const out: Anomaly[] = [];
  for (const [category, items] of Object.entries(byCat)) {
    if (items.length < 4) continue;
    const amounts = items.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (median <= 0) continue;
    for (const t of items) {
      const ratio = t.amount / median;
      if (ratio >= 3 && t.amount > 1500) {
        out.push({ txn: t, category, amount: t.amount, median, ratio });
      }
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 6);
}

// --- Proactive nudges / insights (Layer 3, deterministic generator) ---
export function generateInsights(txns: Transaction[], budgets: Budget[], categories: Category[] = []): Insight[] {
  const insights: Insight[] = [];
  const now = new Date().toISOString();

  // Budget pacing
  for (const bp of budgetProgress(txns, budgets, categories)) {
    if (bp.pct >= 100) {
      insights.push({ id: uid('ins'), kind: 'budget', severity: 'alert', title: `${bp.budget.category} budget exceeded`, body: `You've spent ₹${Math.round(bp.spent).toLocaleString('en-IN')} of your ₹${bp.budget.limitAmount.toLocaleString('en-IN')} ${bp.budget.category} budget — ${Math.round(bp.pct)}% used.`, amount: bp.spent, category: bp.budget.category, createdAt: now });
    } else if (bp.pct >= 80) {
      insights.push({ id: uid('ins'), kind: 'budget', severity: 'warn', title: `${Math.round(bp.pct)}% through ${bp.budget.category} budget`, body: `Heads up — you're ₹${Math.round(bp.budget.limitAmount - bp.spent).toLocaleString('en-IN')} away from your ${bp.budget.category} limit this month.`, amount: bp.spent, category: bp.budget.category, createdAt: now });
    }
  }

  // Forecast overspend
  for (const f of forecastMonth(txns, budgets, categories)) {
    if (f.willOverspend && f.overBy > 300) {
      insights.push({ id: uid('ins'), kind: 'trend', severity: 'warn', title: `On pace to overshoot ${f.category}`, body: `At this rate you'll spend about ₹${f.projected.toLocaleString('en-IN')} on ${f.category} — ₹${f.overBy.toLocaleString('en-IN')} over budget.`, amount: f.projected, category: f.category, createdAt: now });
    }
  }

  // Subscriptions likely forgotten
  for (const s of detectSubscriptions(txns)) {
    if (s.likelyForgotten) {
      insights.push({ id: uid('ins'), kind: 'subscription', severity: 'info', title: `Unused ${s.merchant} subscription?`, body: `${s.merchant} charged ₹${s.amount.toLocaleString('en-IN')} for ${s.occurrences} months but hasn't recurred recently. Cancel if unused.`, amount: s.amount, category: s.category, createdAt: now });
    }
  }

  // Anomalies
  for (const a of detectAnomalies(txns)) {
    insights.push({ id: uid('ins'), kind: 'anomaly', severity: 'alert', title: `Unusual ${a.category} charge`, body: `₹${Math.round(a.amount).toLocaleString('en-IN')} at ${a.txn.merchant ?? 'unknown'} is ${a.ratio.toFixed(1)}× your typical ${a.category} spend.`, amount: a.amount, category: a.category, createdAt: now });
  }

  // Month-over-month trend
  const stats = monthlyStats(txns);
  if (stats.expense.deltaPct >= 20 && stats.expense.prev > 0) {
    insights.push({ id: uid('ins'), kind: 'trend', severity: 'warn', title: 'Spending up vs last month', body: `Your spending is up ${Math.round(stats.expense.deltaPct)}% compared to last month.`, amount: stats.expense.value, createdAt: now });
  }
  if (stats.savings.value > 0) {
    insights.push({ id: uid('ins'), kind: 'tip', severity: 'info', title: 'Nice — you saved this month', body: `You've saved ₹${Math.round(stats.savings.value).toLocaleString('en-IN')} so far. Consider moving it toward a goal.`, amount: stats.savings.value, createdAt: now });
  }

  return insights;
}

export function accountsBalance(txns: Transaction[], opening = 248500): number {
  const net = sum(txns.map((t) => (t.type === 'income' ? t.amount : -t.amount)));
  return opening + net;
}

// ============================== Trends (W / M / Y) ==============================
export type TrendMode = 'week' | 'month' | 'year';

export interface TrendPoint { label: string; value: number }
export interface TrendSeries {
  points: TrendPoint[];
  total: number;      // current window
  prevTotal: number;  // previous comparable window (for vs-past-period %)
  deltaPct: number;
}

const net = (t: Transaction) => (t.type === 'income' ? t.amount : -t.amount);
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shiftDays(n: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return localISO(d);
}

/** Cumulative balance over time (daily for week/month, monthly for year). */
export function balanceTrend(txns: Transaction[], mode: TrendMode): { points: TrendPoint[]; today: number; startOfWindow: number; deltaPct: number } {
  const sorted = [...txns].sort((a, b) => (a.txnDate < b.txnDate ? -1 : 1));
  const balanceUpTo = (iso: string) => sum(sorted.filter((t) => t.txnDate <= iso).map(net));

  const points: TrendPoint[] = [];
  if (mode === 'year') {
    const now = new Date();
    for (let m = 11; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m + 1, 0); // month end
      const iso = m === 0 ? localISO(now) : localISO(d);
      points.push({ label: MONTH_LABELS[d.getMonth()], value: balanceUpTo(iso) });
    }
  } else {
    const days = mode === 'week' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const iso = shiftDays(i);
      points.push({ label: iso.slice(8, 10), value: balanceUpTo(iso) });
    }
  }
  const today = points[points.length - 1]?.value ?? 0;
  const startOfWindow = points[0]?.value ?? 0;
  const deltaPct = startOfWindow !== 0 ? ((today - startOfWindow) / Math.abs(startOfWindow)) * 100 : 0;
  return { points, today, startOfWindow, deltaPct };
}

/** Expense totals bucketed per day (week/month) or per month (year), plus the
 *  previous comparable window for a vs-past-period comparison. */
export function spendingTrend(txns: Transaction[], mode: TrendMode): TrendSeries {
  const expenses = txns.filter(isExpense);
  const points: TrendPoint[] = [];
  let total = 0;
  let prevTotal = 0;

  if (mode === 'year') {
    const now = new Date();
    for (let m = 11; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = localISO(d).slice(0, 7);
      const v = sum(expenses.filter((t) => t.txnDate.startsWith(key)).map((t) => t.amount));
      points.push({ label: MONTH_LABELS[d.getMonth()], value: v });
      total += v;
    }
    for (let m = 23; m >= 12; m--) {
      const d = new Date(new Date().getFullYear(), new Date().getMonth() - m, 1);
      const key = localISO(d).slice(0, 7);
      prevTotal += sum(expenses.filter((t) => t.txnDate.startsWith(key)).map((t) => t.amount));
    }
  } else {
    const days = mode === 'week' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const iso = shiftDays(i);
      const v = sum(expenses.filter((t) => t.txnDate === iso).map((t) => t.amount));
      points.push({ label: iso.slice(8, 10), value: v });
      total += v;
    }
    const from = shiftDays(days * 2 - 1);
    const to = shiftDays(days);
    prevTotal = sum(expenses.filter((t) => t.txnDate >= from && t.txnDate <= to).map((t) => t.amount));
  }

  const deltaPct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
  return { points, total, prevTotal, deltaPct };
}

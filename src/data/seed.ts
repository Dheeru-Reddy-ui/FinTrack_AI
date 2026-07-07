import type { Account, Budget, Goal, Profile, Transaction } from './types';
import { makeDefaultCategories } from './categories';
import { uid } from '@/lib/id';
import { localISO } from '@/lib/format';

/** Deterministic RNG so the demo looks the same across reloads. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260701);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));

const MERCHANTS: Record<string, string[]> = {
  'Food & Dining': ['Swiggy', 'Zomato', 'Starbucks', "Domino's Pizza", 'Chaayos', "McDonald's", 'Behrouz Biryani', 'Third Wave Coffee'],
  Groceries: ['BigBasket', 'DMart', 'Blinkit', 'Zepto', 'Reliance Fresh', 'More Supermarket'],
  Transport: ['Uber', 'Ola', 'Rapido', 'IndianOil', 'Namma Metro', 'IRCTC'],
  Shopping: ['Amazon', 'Flipkart', 'Myntra', 'Ajio', 'Nykaa', 'Croma'],
  'Bills & Utilities': ['Airtel Postpaid', 'Jio Recharge', 'BESCOM Electricity', 'Gas Bill'],
  Health: ['Apollo Pharmacy', 'PharmEasy', '1mg', 'Practo'],
};

const RANGES: Record<string, [number, number]> = {
  'Food & Dining': [120, 680],
  Groceries: [280, 2600],
  Transport: [45, 480],
  Shopping: [499, 4200],
  'Bills & Utilities': [280, 1600],
  Health: [150, 2200],
};

const SOURCES = ['upi', 'nl', 'manual', 'receipt', 'csv'] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localISO(d);
}

function monthStartISO(monthsAgo: number, day: number): string | null {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day);
  if (d > now) return null; // don't seed the future
  return localISO(d);
}

export interface SeedData {
  profile: Profile;
  accounts: Account[];
  categories: ReturnType<typeof makeDefaultCategories>;
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
}

export function buildSeed(): SeedData {
  const categories = makeDefaultCategories();
  const catId = (name: string) => categories.find((c) => c.name === name)?.id ?? null;

  const accounts: Account[] = [
    { id: uid('acc'), name: 'HDFC Bank', type: 'bank' },
    { id: uid('acc'), name: 'Cash', type: 'cash' },
    { id: uid('acc'), name: 'Paytm Wallet', type: 'wallet' },
    { id: uid('acc'), name: 'HDFC Credit Card', type: 'credit_card' },
  ];
  const bank = accounts[0].id;
  const wallet = accounts[2].id;

  const txns: Transaction[] = [];
  const add = (t: Omit<Transaction, 'id' | 'createdAt'>) =>
    txns.push({ ...t, id: uid('txn'), createdAt: new Date().toISOString() });

  // --- Recurring: salary, rent, subscriptions across the last 3 months ---
  for (let m = 2; m >= 0; m--) {
    const salary = monthStartISO(m, 1);
    if (salary)
      add({ accountId: bank, categoryId: catId('Income'), category: 'Income', amount: 98000, type: 'income', merchant: 'Acme Corp Payroll', txnDate: salary, source: 'csv', confidence: 1, needsReview: false });

    const rent = monthStartISO(m, 3);
    if (rent)
      add({ accountId: bank, categoryId: catId('Rent'), category: 'Rent', amount: 18000, type: 'expense', merchant: 'Rent — Landlord', txnDate: rent, source: 'manual', confidence: 1, needsReview: false });

    // Subscriptions (same amount every month → subscription detection)
    const subs: [string, number, number, string][] = [
      ['Netflix', 649, 5, 'Entertainment'],
      ['Spotify', 119, 8, 'Entertainment'],
      ['YouTube Premium', 129, 12, 'Entertainment'],
      ['Cult.fit', 1499, 6, 'Health'],
      ['ACT Fibernet', 1180, 4, 'Bills & Utilities'],
    ];
    for (const [name, amt, day, cat] of subs) {
      const dt = monthStartISO(m, day);
      if (dt) add({ accountId: bank, categoryId: catId(cat), category: cat, amount: amt, type: 'expense', merchant: name, txnDate: dt, source: 'upi', confidence: 0.98, needsReview: false });
    }
  }

  // --- Discretionary daily spending for the last 72 days ---
  const cats = Object.keys(MERCHANTS);
  const weights = [0.32, 0.16, 0.22, 0.1, 0.08, 0.12]; // Food, Groceries, Transport, Shopping, Bills, Health
  for (let day = 72; day >= 0; day--) {
    const nTxn = rand() < 0.18 ? 0 : between(1, 3);
    for (let i = 0; i < nTxn; i++) {
      let r = rand();
      let ci = 0;
      for (let w = 0; w < weights.length; w++) {
        r -= weights[w];
        if (r <= 0) { ci = w; break; }
      }
      const cat = cats[ci];
      const [lo, hi] = RANGES[cat];
      const amount = between(lo, hi);
      const merchant = pick(MERCHANTS[cat]);
      const source = pick(SOURCES.slice());
      const confidence = source === 'manual' ? 1 : Math.round((0.72 + rand() * 0.27) * 100) / 100;
      add({
        accountId: rand() < 0.75 ? bank : wallet,
        categoryId: catId(cat),
        category: cat,
        amount,
        type: 'expense',
        merchant,
        txnDate: isoDaysAgo(day),
        source,
        rawText: source === 'nl' ? `spent ${amount} at ${merchant}` : null,
        confidence,
        needsReview: confidence < 0.75,
      });
    }
  }

  // A couple of deliberately-flagged low-confidence + anomalous items for the demo
  add({ accountId: bank, categoryId: null, category: 'Uncategorized', amount: 2499, type: 'expense', merchant: 'RZPAY*TECHNOSOFT', txnDate: isoDaysAgo(2), source: 'csv', confidence: 0.41, needsReview: true, rawText: 'UPI/RZPAY*TECHNOSOFT/2499.00' });
  add({ accountId: bank, categoryId: catId('Shopping'), category: 'Shopping', amount: 18990, type: 'expense', merchant: 'Croma', txnDate: isoDaysAgo(4), source: 'receipt', confidence: 0.95, needsReview: false, note: 'Boat headphones + accessories' });

  txns.sort((a, b) => (a.txnDate < b.txnDate ? 1 : -1));

  const mkBudget = (category: string, limitAmount: number): Budget => ({
    id: uid('bud'),
    name: category,
    category,
    categoryIds: [catId(category)!],
    limitAmount,
    period: 'monthly',
    notifyTrending: true,
    notifyOver: true,
  });
  const budgets: Budget[] = [
    mkBudget('Food & Dining', 8000),
    mkBudget('Groceries', 6000),
    mkBudget('Transport', 4000),
    mkBudget('Shopping', 5000),
    mkBudget('Entertainment', 2500),
    mkBudget('Bills & Utilities', 3500),
  ];

  const goals: Goal[] = [
    { id: uid('goal'), name: 'Emergency Fund', targetAmount: 100000, currentAmount: 42000, deadline: monthStartISO(-5, 1) ?? '2026-12-01', createdAt: new Date().toISOString() },
    { id: uid('goal'), name: 'Goa Trip', targetAmount: 40000, currentAmount: 15500, deadline: monthStartISO(-4, 15) ?? '2026-11-15', createdAt: new Date().toISOString() },
    { id: uid('goal'), name: 'New Laptop', targetAmount: 95000, currentAmount: 31000, deadline: monthStartISO(-6, 1) ?? '2027-01-01', createdAt: new Date().toISOString() },
  ];

  const profile: Profile = {
    id: 'demo-user',
    name: 'Div1ne',
    email: 'you@fintrack.ai',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
  };

  return { profile, accounts, categories, transactions: txns, budgets, goals };
}

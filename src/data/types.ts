/** Domain types — mirror the Supabase schema in /supabase/schema.sql. */

export type AccountType = 'bank' | 'cash' | 'wallet' | 'credit_card';
export type TxnSource = 'manual' | 'nl' | 'receipt' | 'upi' | 'csv';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
}

export interface Category {
  id: string;
  name: string;
  isDefault: boolean;
  icon?: string;
  parentId?: string | null; // null = top-level; set = subcategory
}

export interface Transaction {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  category?: string; // denormalized category name (may be a subcategory)
  categoryGroup?: string; // top-level parent name (== category when top-level)
  amount: number; // positive = expense, negative = income (see `type`)
  type: 'expense' | 'income';
  merchant: string | null;
  txnDate: string; // YYYY-MM-DD
  source: TxnSource;
  rawText?: string | null;
  confidence?: number | null; // 0..1 categorization confidence
  needsReview?: boolean;
  note?: string | null;
  createdAt: string;
}

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

export interface Budget {
  id: string;
  name: string;            // display label ("Food", "Essentials", …)
  categoryIds: string[];   // top-level category ids this budget covers (subcats roll up)
  category: string;        // legacy alias = name (kept for existing call sites)
  limitAmount: number;
  period: BudgetPeriod;
  notifyTrending: boolean; // nudge when forecasted to exceed
  notifyOver: boolean;     // nudge when exceeded
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string | null;
  createdAt: string;
  plan?: GoalPlanStep[];
}

export interface GoalPlanStep {
  month: string; // YYYY-MM
  contribution: number;
  note?: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  currency: string;
  timezone: string;
}

export interface Insight {
  id: string;
  kind: 'budget' | 'anomaly' | 'subscription' | 'trend' | 'tip';
  title: string;
  body: string;
  severity: 'info' | 'warn' | 'alert';
  amount?: number;
  category?: string;
  createdAt: string;
  read?: boolean;
}

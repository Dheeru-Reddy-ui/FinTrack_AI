/**
 * Supabase data layer — React Query hooks + mutations + a Realtime sync hook.
 * All reads are RLS-scoped to the signed-in user. Mutations invalidate the
 * relevant caches; Realtime also invalidates so changes from any device/tab
 * reflect live without a manual refresh.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from './supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Account, Budget, Category, Goal, Insight, Transaction, TxnSource } from './types';

function sb() {
  const s = getSupabase();
  if (!s) throw new Error('Supabase is not configured.');
  return s;
}

const TXN_SELECT = 'id, account_id, category_id, amount, type, merchant, txn_date, source, raw_text, receipt_path, confidence, needs_review, note, created_at, categories(name, parent:parent_id(name))';

function mapTxn(r: any): Transaction {
  return {
    id: r.id,
    accountId: r.account_id ?? null,
    categoryId: r.category_id ?? null,
    category: r.categories?.name ?? null,
    categoryGroup: r.categories?.parent?.name ?? r.categories?.name ?? null,
    amount: Number(r.amount),
    type: r.type,
    merchant: r.merchant ?? null,
    txnDate: r.txn_date,
    source: r.source,
    rawText: r.raw_text ?? null,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    needsReview: !!r.needs_review,
    note: r.note ?? null,
    createdAt: r.created_at,
  };
}

// ---------------- Queries ----------------
export function useCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['categories', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await sb().from('categories').select('id, name, is_default, parent_id').order('name');
      if (error) throw error;
      return (data ?? []).map((c: any) => ({ id: c.id, name: c.name, isDefault: c.is_default, parentId: c.parent_id ?? null }));
    },
  });
}

export function useAccounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['accounts', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await sb().from('accounts').select('id, name, type').order('created_at');
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ id: a.id, name: a.name, type: a.type }));
    },
  });
}

export function useTransactions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['transactions', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await sb()
        .from('transactions')
        .select(TXN_SELECT)
        .order('txn_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map(mapTxn);
    },
  });
}

export function useBudgets() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['budgets', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Budget[]> => {
      const { data, error } = await sb()
        .from('budgets')
        .select('id, name, category_ids, limit_amount, period, notify_trending, notify_over')
        .order('name');
      if (error) throw error;
      return (data ?? []).map((b: any) => ({
        id: b.id,
        name: b.name ?? 'Budget',
        categoryIds: b.category_ids ?? [],
        category: b.name ?? 'Budget',
        limitAmount: Number(b.limit_amount),
        period: b.period,
        notifyTrending: b.notify_trending ?? true,
        notifyOver: b.notify_over ?? true,
      }));
    },
  });
}

export interface BudgetInput {
  name: string;
  categoryIds: string[];
  limitAmount: number;
  period: 'weekly' | 'monthly' | 'yearly';
  notifyTrending: boolean;
  notifyOver: boolean;
}

export function useAddBudget() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (b: BudgetInput) => {
      const { error } = await sb().from('budgets').insert({
        user_id: user!.id,
        name: b.name,
        category_ids: b.categoryIds,
        limit_amount: b.limitAmount,
        period: b.period,
        notify_trending: b.notifyTrending,
        notify_over: b.notifyOver,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BudgetInput> }) => {
      const { error } = await sb().from('budgets').update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.categoryIds !== undefined ? { category_ids: patch.categoryIds } : {}),
        ...(patch.limitAmount !== undefined ? { limit_amount: patch.limitAmount } : {}),
        ...(patch.period !== undefined ? { period: patch.period } : {}),
        ...(patch.notifyTrending !== undefined ? { notify_trending: patch.notifyTrending } : {}),
        ...(patch.notifyOver !== undefined ? { notify_over: patch.notifyOver } : {}),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from('budgets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useBalance() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['balance', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      const { data, error } = await sb().from('v_balances').select('balance').maybeSingle();
      if (error) throw error;
      return data ? Number((data as any).balance) : 0;
    },
  });
}

// ---------------- Mutations ----------------
export interface NewTxn {
  amount: number;
  type: 'expense' | 'income';
  categoryId: string | null;
  accountId?: string | null;
  merchant?: string | null;
  txnDate: string;
  source: TxnSource;
  rawText?: string | null;
  confidence?: number | null;
  needsReview?: boolean;
  note?: string | null;
}

export function useAddTransaction() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (t: NewTxn) => {
      const { data, error } = await sb().from('transactions').insert({
        user_id: user!.id,
        amount: Math.abs(t.amount),
        type: t.type,
        category_id: t.categoryId,
        account_id: t.accountId ?? null,
        merchant: t.merchant ?? null,
        txn_date: t.txnDate,
        source: t.source,
        raw_text: t.rawText ?? null,
        confidence: t.confidence ?? null,
        needs_review: t.needsReview ?? false,
        note: t.note ?? null,
      }).select(TXN_SELECT).single();
      if (error) throw error;
      return mapTxn(data);
    },
    onSuccess: () => invalidateTxns(qc),
  });
}

export function useAddTransactionsBulk() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (rows: NewTxn[]) => {
      const payload = rows.map((t) => ({
        user_id: user!.id,
        amount: Math.abs(t.amount),
        type: t.type,
        category_id: t.categoryId,
        account_id: t.accountId ?? null,
        merchant: t.merchant ?? null,
        txn_date: t.txnDate,
        source: t.source,
        confidence: t.confidence ?? null,
        needs_review: t.needsReview ?? false,
      }));
      const { error, count } = await sb().from('transactions').insert(payload, { count: 'exact' });
      if (error) throw error;
      return count ?? rows.length;
    },
    onSuccess: () => invalidateTxns(qc),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Record<string, any>> }) => {
      const { error } = await sb().from('transactions').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateTxns(qc),
  });
}

export function useSetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, categoryId }: { id: string; categoryId: string }) => {
      const { error } = await sb().from('transactions').update({ category_id: categoryId, needs_review: false, confidence: 1 }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateTxns(qc),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from('transactions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateTxns(qc),
  });
}

function invalidateTxns(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['transactions'] });
  qc.invalidateQueries({ queryKey: ['balance'] });
}

// ---------------- Goals (Phase 3: planner) ----------------
export function useGoals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['goals', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await sb().from('goals').select('id, name, target_amount, current_amount, deadline, created_at').order('created_at');
      if (error) throw error;
      return (data ?? []).map((g: any) => ({
        id: g.id,
        name: g.name,
        targetAmount: Number(g.target_amount),
        currentAmount: Number(g.current_amount),
        deadline: g.deadline,
        createdAt: g.created_at,
      }));
    },
  });
}

export function useAddGoal() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (g: { name: string; targetAmount: number; deadline: string | null; currentAmount?: number }): Promise<string> => {
      const { data, error } = await sb().from('goals').insert({
        user_id: user!.id,
        name: g.name,
        target_amount: g.targetAmount,
        current_amount: Math.max(0, g.currentAmount ?? 0),
        deadline: g.deadline,
      }).select('id').single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { name?: string; targetAmount?: number; deadline?: string | null; currentAmount?: number } }) => {
      const { error } = await sb().from('goals').update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.targetAmount !== undefined ? { target_amount: patch.targetAmount } : {}),
        ...(patch.deadline !== undefined ? { deadline: patch.deadline } : {}),
        ...(patch.currentAmount !== undefined ? { current_amount: Math.max(0, patch.currentAmount) } : {}),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

export function useContributeGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ goal, amount }: { goal: Goal; amount: number }) => {
      const { error } = await sb().from('goals')
        .update({ current_amount: Math.max(0, goal.currentAmount + amount) })
        .eq('id', goal.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from('goals').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

// ---------------- Notifications (Phase 3: proactive nudges) ----------------
export interface AppNotification {
  id: string;
  kind: Insight['kind'];
  severity: Insight['severity'];
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await sb()
        .from('notifications')
        .select('id, kind, severity, title, body, read, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((n: any) => ({
        id: n.id, kind: n.kind, severity: n.severity, title: n.title, body: n.body, read: n.read, createdAt: n.created_at,
      }));
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { error } = await sb().from('notifications').update({ read: true }).eq('user_id', user!.id).eq('read', false);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/** Ask the DB to (re)generate nudges for me — runs the same deterministic SQL
 *  the daily pg_cron job uses; dedupe keys make it idempotent. */
export function useRefreshNudges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await sb().rpc('refresh_my_nudges');
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ---------------- Realtime ----------------
/** Subscribe to this user's row changes and keep React Query in sync live. */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const { user } = useAuth();
  useEffect(() => {
    const s = getSupabase();
    if (!s || !user) return;
    const channel = s
      .channel(`rt-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ['transactions'] });
        qc.invalidateQueries({ queryKey: ['balance'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ['budgets'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ['goals'] });
      })
      .subscribe();
    return () => {
      s.removeChannel(channel);
    };
  }, [user?.id, qc]);
}

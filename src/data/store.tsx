/**
 * Central app store (React context). Demo mode persists the whole dataset to
 * AsyncStorage; a real build would swap these actions for Supabase queries with
 * RLS (the shapes already match /supabase/schema.sql).
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Account, Budget, ChatMessage, Category, Goal, Profile, Transaction, TxnSource } from './types';
import { buildSeed } from './seed';
import { generateInsights } from './analytics';
import { answerQuestion } from '@/ai/chat';
import { uid } from '@/lib/id';
import { todayISO } from '@/lib/format';

const STORAGE_KEY = 'fintrack.v1.data';
const AUTH_KEY = 'fintrack.v1.authed';

interface Dataset {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  chat: ChatMessage[];
}

export interface AddTxnInput {
  amount: number;
  type: 'expense' | 'income';
  category: string;
  merchant?: string | null;
  txnDate?: string;
  accountId?: string | null;
  source: TxnSource;
  rawText?: string | null;
  confidence?: number | null;
  needsReview?: boolean;
  note?: string | null;
}

interface AppContextValue extends Dataset {
  ready: boolean;
  isAuthed: boolean;
  categoryNames: string[];
  insights: ReturnType<typeof generateInsights>;
  signIn: (name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  addTransaction: (input: AddTxnInput) => Transaction;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  setTransactionCategory: (id: string, category: string) => void;
  addBudget: (b: Omit<Budget, 'id'>) => void;
  updateBudget: (id: string, patch: Partial<Budget>) => void;
  addGoal: (g: Omit<Goal, 'id' | 'createdAt' | 'currentAmount'> & { currentAmount?: number }) => Goal;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  contributeToGoal: (id: string, amount: number) => void;
  sendChat: (question: string) => Promise<void>;
  clearChat: () => void;
  resetDemo: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bootstrap from storage (or seed)
  useEffect(() => {
    (async () => {
      try {
        const [rawData, rawAuth] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(AUTH_KEY),
        ]);
        if (rawData) {
          const parsed = JSON.parse(rawData) as Dataset;
          if (!parsed.chat) parsed.chat = [];
          setData(parsed);
        } else {
          const seed = buildSeed();
          setData({ ...seed, chat: [] });
        }
        setIsAuthed(rawAuth === 'true');
      } catch {
        const seed = buildSeed();
        setData({ ...seed, chat: [] });
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Persist (debounced)
  useEffect(() => {
    if (!data) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
    }, 250);
  }, [data]);

  const patch = (fn: (d: Dataset) => Dataset) => setData((prev) => (prev ? fn(prev) : prev));

  const value: AppContextValue = useMemo(() => {
    const d = data ?? emptyDataset();
    const categoryNames = d.categories.map((c) => c.name);
    const catId = (name: string) => d.categories.find((c) => c.name === name)?.id ?? null;

    const addTransaction: AppContextValue['addTransaction'] = (input) => {
      const txn: Transaction = {
        id: uid('txn'),
        accountId: input.accountId ?? d.accounts[0]?.id ?? null,
        categoryId: catId(input.category),
        category: input.category,
        amount: Math.abs(input.amount),
        type: input.type,
        merchant: input.merchant ?? null,
        txnDate: input.txnDate ?? todayISO(),
        source: input.source,
        rawText: input.rawText ?? null,
        confidence: input.confidence ?? null,
        needsReview: input.needsReview ?? false,
        note: input.note ?? null,
        createdAt: new Date().toISOString(),
      };
      patch((prev) => ({ ...prev, transactions: [txn, ...prev.transactions] }));
      return txn;
    };

    return {
      ...d,
      ready,
      isAuthed,
      categoryNames,
      insights: generateInsights(d.transactions, d.budgets),
      signIn: async (name?: string) => {
        await AsyncStorage.setItem(AUTH_KEY, 'true');
        if (name) patch((prev) => ({ ...prev, profile: { ...prev.profile, name } }));
        setIsAuthed(true);
      },
      signOut: async () => {
        await AsyncStorage.setItem(AUTH_KEY, 'false');
        setIsAuthed(false);
      },
      addTransaction,
      updateTransaction: (id, p) =>
        patch((prev) => ({ ...prev, transactions: prev.transactions.map((t) => (t.id === id ? { ...t, ...p } : t)) })),
      deleteTransaction: (id) =>
        patch((prev) => ({ ...prev, transactions: prev.transactions.filter((t) => t.id !== id) })),
      setTransactionCategory: (id, category) =>
        patch((prev) => ({
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === id ? { ...t, category, categoryId: catId(category), needsReview: false, confidence: 1 } : t
          ),
        })),
      addBudget: (b) => patch((prev) => ({ ...prev, budgets: [...prev.budgets, { ...b, id: uid('bud') }] })),
      updateBudget: (id, p) =>
        patch((prev) => ({ ...prev, budgets: prev.budgets.map((b) => (b.id === id ? { ...b, ...p } : b)) })),
      addGoal: (g) => {
        const goal: Goal = { ...g, id: uid('goal'), currentAmount: g.currentAmount ?? 0, createdAt: new Date().toISOString() };
        patch((prev) => ({ ...prev, goals: [...prev.goals, goal] }));
        return goal;
      },
      updateGoal: (id, p) =>
        patch((prev) => ({ ...prev, goals: prev.goals.map((g) => (g.id === id ? { ...g, ...p } : g)) })),
      contributeToGoal: (id, amount) =>
        patch((prev) => ({
          ...prev,
          goals: prev.goals.map((g) => (g.id === id ? { ...g, currentAmount: g.currentAmount + amount } : g)),
        })),
      sendChat: async (question: string) => {
        const userMsg: ChatMessage = { id: uid('msg'), role: 'user', text: question, createdAt: new Date().toISOString() };
        const pendingId = uid('msg');
        patch((prev) => ({
          ...prev,
          chat: [...prev.chat, userMsg, { id: pendingId, role: 'assistant', text: '', pending: true, createdAt: new Date().toISOString() }],
        }));
        try {
          const ans = await answerQuestion(question, { transactions: d.transactions, budgets: d.budgets, goals: d.goals });
          patch((prev) => ({
            ...prev,
            chat: prev.chat.map((m) => (m.id === pendingId ? { ...m, text: ans.text, citations: ans.citations, pending: false } : m)),
          }));
        } catch {
          patch((prev) => ({
            ...prev,
            chat: prev.chat.map((m) => (m.id === pendingId ? { ...m, text: 'Sorry, I could not compute that just now.', pending: false } : m)),
          }));
        }
      },
      clearChat: () => patch((prev) => ({ ...prev, chat: [] })),
      resetDemo: async () => {
        const seed = buildSeed();
        const fresh = { ...seed, chat: [] };
        setData(fresh);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      },
    };
  }, [data, ready, isAuthed]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

function emptyDataset(): Dataset {
  return { profile: { id: '', name: '', email: '', currency: 'INR', timezone: 'Asia/Kolkata' }, accounts: [], categories: [], transactions: [], budgets: [], goals: [], chat: [] };
}

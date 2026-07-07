/**
 * Real authentication backed by Supabase Auth. Session is persisted (AsyncStorage
 * via the supabase client) and restored on launch. No demo bypass — if the backend
 * isn't configured yet, `configured` is false and the UI shows a setup notice
 * instead of faking a login.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from '@/data/supabase';
import { hasSupabase } from '@/data/config';

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsConfirmation?: boolean;
}

interface AuthContextValue {
  configured: boolean;
  initializing: boolean;
  session: Session | null;
  user: User | null;
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('rate limit')) return 'Too many signups too fast. This happens when "Confirm email" is on in Supabase — turn it off (no emails needed), then retry.';
  if (m.includes('invalid login')) return 'Wrong email or password.';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already')) return 'That email already has an account. Try logging in instead.';
  if (m.includes('password should be') || m.includes('weak password')) return 'Password must be at least 6 characters.';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Please enter a valid email address.';
  if (m.includes('network') || m.includes('failed to fetch') || m.includes('load failed')) return 'Network error — check your connection and try again.';
  if (m.includes('email not confirmed')) return 'Please confirm your email first, then log in.';
  return message;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setInitializing(false);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitializing(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (mounted) setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthContextValue>(() => ({
    configured: hasSupabase,
    initializing,
    session,
    user: session?.user ?? null,
    signUp: async (email, password, name) => {
      if (!supabase) return { ok: false, error: 'Backend not configured yet.' };
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim() } },
      });
      if (error) return { ok: false, error: friendlyError(error.message) };
      // If email confirmation is on, there's no session until the user confirms.
      return { ok: true, needsConfirmation: !data.session };
    },
    signIn: async (email, password) => {
      if (!supabase) return { ok: false, error: 'Backend not configured yet.' };
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { ok: false, error: friendlyError(error.message) };
      return { ok: true };
    },
    signOut: async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
      setSession(null);
    },
  }), [supabase, session, initializing]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

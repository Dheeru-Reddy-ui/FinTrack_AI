/**
 * Local goal metadata + app preferences overlay.
 *
 * The Supabase `goals` table only stores the financial fields (name, target,
 * current, deadline) — it's the synced source of truth and stays RLS-scoped.
 * The *presentation & lifecycle* fields a rich goals UI needs (colour, icon,
 * note, archived / completed state, per-goal auto-archive) live here, persisted
 * to AsyncStorage. This keeps the whole feature working with the existing DB
 * schema (no migration required) while still surviving reloads. Merge the two
 * with `enrichGoal()` at every read site.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Ionicons } from '@expo/vector-icons';
import type { Goal } from './types';

const META_KEY = 'fintrack.goalMeta.v1';
const SETTINGS_KEY = 'fintrack.settings.v1';

type IconName = keyof typeof Ionicons.glyphMap;

export interface GoalMeta {
  color?: string;
  icon?: IconName;
  note?: string;
  archived?: boolean;
  completedAt?: string | null; // ISO timestamp the goal first reached 100%
  autoArchive?: boolean;       // per-goal override of the global default
}

export interface AppSettings {
  autoArchiveCompleted: boolean; // default applied to new goals + drives archiving
  goalCelebration: boolean;      // show the "reached 🎉" banner
}

const DEFAULT_SETTINGS: AppSettings = { autoArchiveCompleted: true, goalCelebration: true };

/** Cheerful, distinct swatches for goals. */
export const GOAL_COLORS = [
  '#22C1D6', '#F5A623', '#4CD137', '#2E86DE',
  '#9B59B6', '#E5484D', '#F6B93B', '#E84393',
  '#1FA95C', '#0EA5E9', '#EC4899', '#14B8A6',
] as const;

export const GOAL_ICONS: IconName[] = [
  'flag', 'car', 'home', 'airplane', 'school', 'shield-checkmark',
  'medkit', 'wine', 'happy', 'gift', 'cash', 'phone-portrait',
  'laptop', 'heart', 'paw', 'barbell', 'bicycle', 'briefcase',
  'camera', 'game-controller', 'book', 'business',
];

/** Quick-start templates shown as a grid on the create screen. */
export const GOAL_PRESETS: { name: string; icon: IconName; color: string }[] = [
  { name: 'New vehicle', icon: 'car', color: '#22C1D6' },
  { name: 'New home', icon: 'home', color: '#F5A623' },
  { name: 'Holiday trip', icon: 'airplane', color: '#4CD137' },
  { name: 'Education', icon: 'school', color: '#2E86DE' },
  { name: 'Emergency fund', icon: 'shield-checkmark', color: '#9B59B6' },
  { name: 'Health care', icon: 'medkit', color: '#E5484D' },
  { name: 'Party', icon: 'wine', color: '#F6B93B' },
  { name: 'Kids', icon: 'happy', color: '#E84393' },
];

export interface EnrichedGoal extends Goal {
  color: string;
  icon: IconName;
  note: string;
  archived: boolean;
  completed: boolean;      // currentAmount >= targetAmount (target > 0)
  completedAt: string | null;
  autoArchive: boolean;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Merge a DB goal with its local metadata, filling sensible defaults. */
export function enrichGoal(goal: Goal, meta: GoalMeta | undefined, defaultAutoArchive: boolean): EnrichedGoal {
  const m = meta ?? {};
  const completed = goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount;
  return {
    ...goal,
    color: m.color ?? GOAL_COLORS[hash(goal.id) % GOAL_COLORS.length],
    icon: m.icon ?? 'flag',
    note: m.note ?? '',
    archived: !!m.archived,
    completed,
    completedAt: m.completedAt ?? null,
    autoArchive: m.autoArchive ?? defaultAutoArchive,
  };
}

interface GoalMetaValue {
  ready: boolean;
  metaMap: Record<string, GoalMeta>;
  settings: AppSettings;
  metaFor: (id: string) => GoalMeta;
  setMeta: (id: string, patch: GoalMeta) => void;
  removeMeta: (id: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  /** Stamp completion + auto-archive against the latest DB goals. Idempotent. */
  reconcile: (goals: Goal[]) => void;
}

const Ctx = createContext<GoalMetaValue | null>(null);

export function GoalMetaProvider({ children }: { children: React.ReactNode }) {
  const [metaMap, setMetaMap] = useState<Record<string, GoalMeta>>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bootstrap
  useEffect(() => {
    (async () => {
      try {
        const [rawMeta, rawSettings] = await Promise.all([
          AsyncStorage.getItem(META_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (rawMeta) setMetaMap(JSON.parse(rawMeta));
        if (rawSettings) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) });
      } catch {
        // fall back to defaults
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Persist (debounced)
  useEffect(() => {
    if (!ready) return;
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => {
      AsyncStorage.setItem(META_KEY, JSON.stringify(metaMap)).catch(() => {});
    }, 200);
  }, [metaMap, ready]);

  useEffect(() => {
    if (!ready) return;
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => {
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
    }, 200);
  }, [settings, ready]);

  const value = useMemo<GoalMetaValue>(() => ({
    ready,
    metaMap,
    settings,
    metaFor: (id) => metaMap[id] ?? {},
    setMeta: (id, patch) =>
      setMetaMap((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } })),
    removeMeta: (id) =>
      setMetaMap((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }),
    updateSettings: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    reconcile: (goals) =>
      setMetaMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const g of goals) {
          const m = next[g.id] ?? {};
          const complete = g.targetAmount > 0 && g.currentAmount >= g.targetAmount;
          const autoArchive = m.autoArchive ?? settings.autoArchiveCompleted;
          let nm = m;
          if (complete && !nm.completedAt) nm = { ...nm, completedAt: new Date().toISOString() };
          if (!complete && nm.completedAt) nm = { ...nm, completedAt: null }; // target was raised again
          if (complete && autoArchive && !nm.archived) nm = { ...nm, archived: true };
          if (nm !== m) {
            next[g.id] = nm;
            changed = true;
          }
        }
        return changed ? next : prev;
      }),
  }), [ready, metaMap, settings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGoalMeta(): GoalMetaValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGoalMeta must be used within GoalMetaProvider');
  return ctx;
}

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthProvider';
import { useBalance, useBudgets, useCategories, useGoals, useNotifications, useRefreshNudges, useTransactions } from '@/data/api';
import { enrichGoal, useGoalMeta } from '@/data/goalMeta';
import { goalProgressPct } from '@/ai/goals';
import { Screen, useResponsive } from '@/components/Screen';
import { AppText, Avatar, Button, Card, Dot, IconCircle, Pill, ProgressBar, SectionHeader } from '@/components/ui';
import { DonutChart } from '@/components/DonutChart';
import { AreaChart, BarsChart, PeriodToggle } from '@/components/charts';
import { TransactionRow } from '@/components/TransactionRow';
import {
  balanceTrend,
  budgetProgress,
  detectSubscriptions,
  forecastMonth,
  inLastDays,
  rollingStats,
  spendByCategory,
  spendingTrend,
  totalExpense,
  type TrendMode,
} from '@/data/analytics';
import { colors, radius, spacing } from '@/theme';
import { currentMonthKey, formatINR, formatPercent, localISO, monthLabel } from '@/lib/format';

export default function Dashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const { isWide } = useResponsive();
  const txnsQ = useTransactions();
  const balanceQ = useBalance();
  const budgetsQ = useBudgets();
  const categoriesQ = useCategories();
  const goalsQ = useGoals();
  const { metaFor, settings } = useGoalMeta();
  const notifsQ = useNotifications();
  const refreshNudges = useRefreshNudges();
  const [hidden, setHidden] = useState(false);
  const [balMode, setBalMode] = useState<TrendMode>('month');
  const [spendMode, setSpendMode] = useState<TrendMode>('month');

  useEffect(() => {
    refreshNudges.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const txns = txnsQ.data ?? [];
  const budgets = budgetsQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const goals = goalsQ.data ?? [];
  const name = (user?.user_metadata as any)?.name || user?.email?.split('@')[0] || 'there';
  const balance = balanceQ.data ?? 0;

  const stats = useMemo(() => rollingStats(txns), [txns]);
  const last30 = useMemo(() => inLastDays(txns, 30), [txns]);
  const slices = useMemo(() => spendByCategory(last30), [last30]);
  const monthSpent = totalExpense(last30);
  const progress = useMemo(() => budgetProgress(txns, budgets, categories), [txns, budgets, categories]);
  const forecast = useMemo(() => forecastMonth(txns, budgets, categories), [txns, budgets, categories]);
  const projectedSpend = useMemo(() => forecast.reduce((a, f) => a + f.projected, 0), [forecast]);
  const atRisk = useMemo(() => forecast.filter((f) => f.willOverspend).length, [forecast]);
  const balTrend = useMemo(() => balanceTrend(txns, balMode), [txns, balMode]);
  const spendTrend = useMemo(() => spendingTrend(txns, spendMode), [txns, spendMode]);
  const unreadCount = useMemo(() => (notifsQ.data ?? []).filter((n) => !n.read).length, [notifsQ.data]);
  const topGoal = useMemo(() => {
    const activeGoals = goals
      .map((g) => enrichGoal(g, metaFor(g.id), settings.autoArchiveCompleted))
      .filter((g) => !g.archived);
    if (!activeGoals.length) return null;
    // Prefer an in-progress goal closest to done; a reached-but-not-archived goal ranks last.
    return [...activeGoals].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return goalProgressPct(b) - goalProgressPct(a);
    })[0];
  }, [goals, metaFor, settings.autoArchiveCompleted]);

  // Upcoming planned payments — detected recurring charges, next expected ~1 month after last
  const planned = useMemo(() => {
    const today = localISO();
    return detectSubscriptions(txns)
      .map((s) => {
        const d = new Date(s.lastDate + 'T00:00:00');
        d.setMonth(d.getMonth() + 1);
        const due = localISO(d);
        const days = Math.round((new Date(due + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
        return { ...s, due, days };
      })
      .filter((p) => p.days >= -7 && p.days <= 21)
      .sort((a, b) => a.days - b.days)
      .slice(0, 3);
  }, [txns]);

  const recent = txns.slice(0, 5);
  const freshAccount = !txnsQ.isLoading && !budgetsQ.isLoading && txns.length === 0 && budgets.length === 0;

  const refreshing = txnsQ.isRefetching || balanceQ.isRefetching;
  const onRefresh = () => { txnsQ.refetch(); balanceQ.refetch(); budgetsQ.refetch(); notifsQ.refetch(); };

  if (txnsQ.isLoading || categoriesQ.isLoading) {
    return <Screen><View style={{ paddingTop: 120, alignItems: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View></Screen>;
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.md, marginBottom: spacing.xl }}>
        <Avatar name={name} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <AppText size="lg" weight="bold">Hi, {name} 👋</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.positive }} />
            <AppText size="sm" color={colors.textMuted}>Live · {monthLabel(currentMonthKey())}</AppText>
          </View>
        </View>
        <Pressable onPress={() => router.push('/notifications')} style={styles.bellBtn} hitSlop={6}>
          <Ionicons name="notifications-outline" size={19} color={colors.text} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <AppText size="xs" weight="bold" color="#fff" style={{ fontSize: 9 }}>{unreadCount > 9 ? '9+' : unreadCount}</AppText>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => router.push('/chat')} style={styles.askBtn}>
          <Ionicons name="sparkles" size={15} color="#fff" />
          <AppText size="sm" weight="bold" color="#fff">Ask AI</AppText>
        </Pressable>
      </View>

      {/* ---- First-run onboarding: budget planning comes first ---- */}
      {freshAccount ? (
        <View style={{ gap: spacing.lg }}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <IconCircle name="pie-chart" bg={colors.brandSoft} color={colors.brand} size={54} iconSize={26} />
              <View style={{ flex: 1 }}>
                <AppText size="lg" weight="bold">Let's plan your budget!</AppText>
                <AppText size="sm" color={colors.textMuted}>Create your first budget and stay on track with your money.</AppText>
              </View>
            </View>
            <Button label="Create budget" icon="add" onPress={() => router.push('/budget-new')} style={{ marginTop: spacing.lg }} />
          </Card>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <IconCircle name="flag" bg="#E0F2FE" color={colors.info} size={54} iconSize={26} />
              <View style={{ flex: 1 }}>
                <AppText size="lg" weight="bold">Set a goal</AppText>
                <AppText size="sm" color={colors.textMuted}>Set your first goal and get a savings plan built from your surplus.</AppText>
              </View>
            </View>
            <Button label="Create goal" variant="ghost" icon="flag-outline" onPress={() => router.push('/goals')} style={{ marginTop: spacing.lg }} />
          </Card>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <IconCircle name="add-circle" bg={colors.warningSoft} color={colors.warning} size={54} iconSize={26} />
              <View style={{ flex: 1 }}>
                <AppText size="lg" weight="bold">Add your first record</AppText>
                <AppText size="sm" color={colors.textMuted}>Type it, snap a UPI screenshot, or import a bank CSV.</AppText>
              </View>
            </View>
            <Button label="Add record" variant="dark" icon="add" onPress={() => router.push('/add')} style={{ marginTop: spacing.lg }} />
          </Card>
        </View>
      ) : (
        <>
          {/* Balance hero */}
          <View style={[styles.hero, { marginBottom: spacing.lg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppText color="rgba(255,255,255,0.85)" size="sm" weight="medium">Total Balance</AppText>
              <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
                <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={16} color="rgba(255,255,255,0.85)" />
              </Pressable>
            </View>
            <AppText color="#fff" weight="heavy" style={{ fontSize: 38, marginTop: spacing.sm }}>
              {hidden ? '₹ • • • • •' : formatINR(balance)}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md }}>
              <View style={styles.heroPill}>
                <Ionicons name={stats.savings.value >= 0 ? 'trending-up' : 'trending-down'} size={13} color="#fff" />
                <AppText size="xs" weight="bold" color="#fff">{formatINR(Math.abs(stats.savings.value), { compact: true })}</AppText>
              </View>
              <AppText size="xs" color="rgba(255,255,255,0.8)">{stats.savings.value >= 0 ? 'saved' : 'overspent'} · last 30 days</AppText>
            </View>
          </View>

          {/* Stat cards */}
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg }}>
            <StatCard label="Income" value={stats.income.value} color={colors.positive} icon="arrow-down-circle" />
            <StatCard label="Expenses" value={stats.expense.value} color={colors.negative} icon="arrow-up-circle" />
            <StatCard label="Savings" value={stats.savings.value} color={colors.brand} icon="wallet" />
          </View>

          {/* Balance Trend */}
          <Card style={{ marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <AppText size="lg" weight="bold">Balance Trend</AppText>
              <PeriodToggle value={balMode} onChange={setBalMode} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md }}>
              <View>
                <AppText size="xs" color={colors.textMuted} weight="medium">TODAY</AppText>
                <AppText size="xl" weight="heavy">{hidden ? '₹ • • • • •' : formatINR(balTrend.today)}</AppText>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText size="xs" color={colors.textMuted}>vs past period</AppText>
                <AppText size="md" weight="bold" color={balTrend.deltaPct >= 0 ? colors.positive : colors.negative}>
                  {formatPercent(balTrend.deltaPct)}
                </AppText>
              </View>
            </View>
            <AreaChart points={balTrend.points} />
          </Card>

          {/* Spending trend */}
          <Card style={{ marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <AppText size="lg" weight="bold">Spending</AppText>
              <PeriodToggle value={spendMode} onChange={setSpendMode} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md }}>
              <View>
                <AppText size="xs" color={colors.textMuted} weight="medium">
                  {spendMode === 'week' ? 'THIS WEEK' : spendMode === 'month' ? 'LAST 30 DAYS' : 'LAST 12 MONTHS'}
                </AppText>
                <AppText size="xl" weight="heavy">{formatINR(spendTrend.total)}</AppText>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText size="xs" color={colors.textMuted}>vs past period</AppText>
                <AppText size="md" weight="bold" color={spendTrend.deltaPct <= 0 ? colors.positive : colors.negative}>
                  {formatPercent(spendTrend.deltaPct)}
                </AppText>
              </View>
            </View>
            <BarsChart points={spendTrend.points} color={colors.negative} />
          </Card>

          {/* Budgets & Goals */}
          <SectionHeader title="Budgets & Goals" action="New budget" onAction={() => router.push('/budget-new')} />
          <View style={{ flexDirection: isWide ? 'row' : 'column', gap: spacing.lg, marginBottom: spacing.lg }}>
            <Card style={{ flex: isWide ? 1.4 : undefined }}>
              {progress.length === 0 ? (
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <IconCircle name="pie-chart" bg={colors.brandSoft} color={colors.brand} size={46} />
                    <View style={{ flex: 1 }}>
                      <AppText size="md" weight="bold">Let's plan your budget!</AppText>
                      <AppText size="xs" color={colors.textMuted}>Create your first budget and stay on track.</AppText>
                    </View>
                  </View>
                  <Button label="Create budget" icon="add" onPress={() => router.push('/budget-new')} style={{ marginTop: spacing.md, height: 44 }} />
                </View>
              ) : (
                progress.slice(0, 6).map((bp, i) => (
                  <Pressable key={bp.budget.id} onPress={() => router.push({ pathname: '/budget-new', params: { id: bp.budget.id } })}>
                    <View style={{ marginBottom: i < Math.min(progress.length, 6) - 1 ? spacing.md : 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                        <Dot color={bp.color} />
                        <AppText size="sm" weight="medium" style={{ flex: 1, marginLeft: 8 }} numberOfLines={1}>{bp.budget.name}</AppText>
                        <Pill label={bp.periodLabel.replace('this ', '')} tone="neutral" />
                        <AppText size="xs" weight="semibold" color={bp.overBudget ? colors.negative : colors.textMuted} style={{ marginLeft: 8 }}>
                          {formatINR(bp.spent, { compact: true })} / {formatINR(bp.budget.limitAmount, { compact: true })}
                        </AppText>
                      </View>
                      <ProgressBar pct={bp.pct} color={bp.overBudget ? colors.negative : bp.color} />
                    </View>
                  </Pressable>
                ))
              )}
            </Card>

            <Pressable onPress={() => router.push('/goals')} style={{ flex: isWide ? 1 : undefined }}>
              <Card padded style={{ padding: spacing.lg }}>
                {topGoal ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <IconCircle name={topGoal.icon} bg={topGoal.color + '22'} color={topGoal.color} size={34} iconSize={16} />
                      <AppText size="sm" weight="bold" style={{ flex: 1, marginLeft: spacing.sm }} numberOfLines={1}>{topGoal.name}</AppText>
                      <AppText size="xs" color={colors.textMuted}>{Math.round(goalProgressPct(topGoal))}%</AppText>
                    </View>
                    <ProgressBar pct={goalProgressPct(topGoal)} color={topGoal.color} />
                    <AppText size="xs" color={colors.textMuted} style={{ marginTop: 6 }}>
                      {formatINR(topGoal.currentAmount, { compact: true })} of {formatINR(topGoal.targetAmount, { compact: true })} · tap to manage
                    </AppText>
                  </>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <IconCircle name="flag-outline" bg="#E0F2FE" color={colors.info} size={40} />
                    <View style={{ flex: 1 }}>
                      <AppText size="sm" weight="bold">Set your first goal</AppText>
                      <AppText size="xs" color={colors.textMuted}>Track progress toward what matters.</AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  </View>
                )}
              </Card>
            </Pressable>
          </View>

          {/* Upcoming planned payments */}
          {planned.length > 0 && (
            <>
              <SectionHeader title="Upcoming planned payments" />
              <Card style={{ marginBottom: spacing.lg }}>
                {planned.map((p, i) => (
                  <View key={p.merchant + p.amount} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                    <IconCircle name="calendar" bg={p.days <= 3 ? colors.warningSoft : colors.cardMuted} color={p.days <= 3 ? colors.warning : colors.textMuted} size={38} iconSize={17} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <AppText size="sm" weight="semibold">{p.merchant}</AppText>
                      <AppText size="xs" color={p.days < 0 ? colors.negative : colors.textMuted}>
                        {p.days < 0 ? `expected ${-p.days}d ago` : p.days === 0 ? 'expected today' : `in ${p.days} day${p.days > 1 ? 's' : ''}`}
                      </AppText>
                    </View>
                    <AppText size="md" weight="bold">{formatINR(p.amount)}</AppText>
                  </View>
                ))}
              </Card>
            </>
          )}

          {/* Spending overview donut */}
          <Card style={{ marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText size="lg" weight="bold">Spending Overview</AppText>
              <AppText size="xs" color={colors.textMuted}>Last 30 days</AppText>
            </View>
            <AppText size="sm" color={colors.textMuted} style={{ marginTop: spacing.md }}>Total spent</AppText>
            <AppText size="xxl" weight="heavy">{formatINR(monthSpent)}</AppText>
            {slices.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.xl, flexWrap: 'wrap' }}>
                <DonutChart slices={slices.map((s) => ({ amount: s.amount, color: s.color }))} centerSubtitle="Top" centerTitle={slices[0]?.category ?? '—'} />
                <View style={{ flex: 1, minWidth: 180, gap: spacing.md }}>
                  {slices.slice(0, 6).map((s) => (
                    <View key={s.category} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Dot color={s.color} />
                      <AppText size="sm" weight="medium" style={{ marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>{s.category}</AppText>
                      <AppText size="sm" weight="semibold" style={{ marginRight: spacing.md }}>{formatINR(s.amount)}</AppText>
                      <AppText size="sm" color={colors.textMuted} style={{ width: 38, textAlign: 'right' }}>{Math.round(s.pct)}%</AppText>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <AppText size="sm" color={colors.textMuted} style={{ marginTop: spacing.lg }}>No spending yet.</AppText>
            )}
          </Card>

          {/* Month-end forecast */}
          {forecast.length > 0 && (
            <Pressable onPress={() => router.push('/insights')}>
              <Card padded style={{ padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
                <IconCircle name="trending-up" bg={atRisk ? colors.warningSoft : colors.brandSoft} color={atRisk ? colors.warning : colors.brand} size={42} />
                <View style={{ flex: 1 }}>
                  <AppText size="sm" weight="bold">Projected month-end: {formatINR(projectedSpend, { compact: true })}</AppText>
                  <AppText size="xs" color={atRisk ? colors.warning : colors.textMuted}>
                    {atRisk ? `${atRisk} budget${atRisk > 1 ? 's' : ''} on pace to overshoot` : 'All budgets on track'} · tap for details
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Card>
            </Pressable>
          )}

          {/* Last records overview */}
          {recent.length > 0 && (
            <View>
              <SectionHeader title="Last records overview" action="View all" onAction={() => router.push('/ledger')} />
              <Card padded style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.xl }}>
                <AppText size="xs" weight="bold" color={colors.textFaint} style={{ marginTop: spacing.md }}>LAST 30 DAYS</AppText>
                {recent.map((t, i) => (
                  <View key={t.id}>
                    <TransactionRow txn={t} onPress={() => router.push('/ledger')} />
                    {i < recent.length - 1 && <View style={{ height: 1, backgroundColor: colors.hairline }} />}
                  </View>
                ))}
                <Pressable onPress={() => router.push('/add')} style={{ paddingVertical: spacing.md }}>
                  <AppText size="sm" weight="bold" color={colors.brand}>Add record</AppText>
                </Pressable>
              </Card>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: any }) {
  return (
    <Card padded style={{ padding: spacing.lg, flex: 1 }}>
      <IconCircle name={icon} bg={color + '18'} color={color} size={34} iconSize={18} />
      <AppText size="xs" color={colors.textMuted} weight="medium" style={{ marginTop: 10 }} numberOfLines={1}>{label}</AppText>
      <AppText size="lg" weight="heavy" style={{ marginTop: 2 }}>{formatINR(value, { compact: true })}</AppText>
    </Card>
  );
}

const styles = {
  hero: {
    backgroundColor: colors.brand,
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: colors.brand,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  } as const,
  heroPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  askBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: spacing.sm,
  },
  badge: {
    position: 'absolute' as const,
    top: 2,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.negative,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 3,
  },
};

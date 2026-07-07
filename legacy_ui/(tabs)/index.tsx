import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { Screen, useResponsive } from '@/components/Screen';
import { AppText, Avatar, Button, Card, Dot, IconCircle, Pill, SectionHeader } from '@/components/ui';
import { DonutChart } from '@/components/DonutChart';
import { TransactionRow } from '@/components/TransactionRow';
import {
  accountsBalance,
  inThisWeek,
  inLastDays,
  inMonth,
  rollingStats,
  spendByCategory,
  totalExpense,
} from '@/data/analytics';
import { colors, fontWeight, radius, spacing } from '@/theme';
import { currentMonthKey, formatINR, formatPercent } from '@/lib/format';

type Period = 'month' | 'week' | '30';

export default function Dashboard() {
  const app = useApp();
  const router = useRouter();
  const { isWide } = useResponsive();
  const [hidden, setHidden] = useState(false);
  const [period, setPeriod] = useState<Period>('30');

  const balance = useMemo(() => accountsBalance(app.transactions), [app.transactions]);
  const stats = useMemo(() => rollingStats(app.transactions), [app.transactions]);

  const periodTxns = useMemo(() => {
    if (period === 'week') return inThisWeek(app.transactions);
    if (period === '30') return inLastDays(app.transactions, 30);
    return inMonth(app.transactions, currentMonthKey());
  }, [app.transactions, period]);

  const slices = useMemo(() => spendByCategory(periodTxns), [periodTxns]);
  const totalSpent = totalExpense(periodTxns);
  const topInsight = useMemo(
    () => [...app.insights].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0],
    [app.insights]
  );
  const recent = app.transactions.slice(0, 6);
  const unread = app.insights.length;

  const balanceDelta = stats.savings.value;
  const balancePct = balance ? (balanceDelta / balance) * 100 : 0;

  return (
    <Screen>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.md, marginBottom: spacing.xl }}>
        <Avatar name={app.profile.name || 'You'} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <AppText size="lg" weight="bold">Welcome, {app.profile.name || 'there'} 👋</AppText>
          <AppText size="sm" color={colors.textMuted}>Here's your financial overview for today</AppText>
        </View>
        <Pressable onPress={() => router.push('/chat')} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="search" size={19} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => router.push('/insights')} hitSlop={8} style={[styles.headerBtn, { marginLeft: spacing.sm }]}>
          <Ionicons name="notifications-outline" size={19} color={colors.text} />
          {unread > 0 && <View style={styles.badge} />}
        </Pressable>
      </View>

      {/* Balance + stats */}
      <View style={{ flexDirection: isWide ? 'row' : 'column', gap: spacing.lg }}>
        {/* Total balance hero */}
        <Card dark style={{ flex: isWide ? 1 : undefined, justifyContent: 'space-between', minHeight: 168 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText color={colors.textOnDarkMuted} size="sm" weight="medium">Total Balance</AppText>
            <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
              <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={16} color={colors.textOnDarkMuted} />
            </Pressable>
          </View>
          <AppText color="#fff" weight="heavy" style={{ fontSize: 40, marginTop: spacing.sm }}>
            {hidden ? '₹ • • • • •' : formatINR(balance)}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md }}>
            <View style={{ backgroundColor: colors.lime, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name={balancePct >= 0 ? 'trending-up' : 'trending-down'} size={13} color={colors.limeInk} />
              <AppText size="xs" weight="bold" color={colors.limeInk}>{formatPercent(balancePct)}</AppText>
            </View>
            <AppText size="xs" color={colors.textOnDarkMuted}>net change this month</AppText>
          </View>
        </Card>

        {/* Stat cards */}
        <View style={{ flex: isWide ? 1.5 : undefined, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <StatCard label="Monthly Income" value={stats.income.value} delta={stats.income.deltaPct} prev={stats.income.prev} color={colors.positive} positiveGood />
          <StatCard label="Monthly Expenses" value={stats.expense.value} delta={stats.expense.deltaPct} prev={stats.expense.prev} color={colors.negative} positiveGood={false} />
          <StatCard label="Monthly Savings" value={stats.savings.value} delta={stats.savings.deltaPct} prev={stats.savings.prev} color={colors.brand} positiveGood />
        </View>
      </View>

      {/* Spending overview + AI insight */}
      <View style={{ flexDirection: isWide ? 'row' : 'column', gap: spacing.lg, marginTop: spacing.lg }}>
        <Card style={{ flex: isWide ? 1.6 : undefined }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText size="lg" weight="bold">Spending Overview</AppText>
            <PeriodToggle value={period} onChange={setPeriod} />
          </View>
          <AppText size="sm" color={colors.textMuted} style={{ marginTop: spacing.lg }}>Total spent</AppText>
          <AppText size="xxl" weight="heavy">{formatINR(totalSpent)}</AppText>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.xl, flexWrap: 'wrap' }}>
            <DonutChart
              slices={slices.map((s) => ({ amount: s.amount, color: s.color }))}
              centerSubtitle="Top category"
              centerTitle={slices[0]?.category ?? '—'}
            />
            <View style={{ flex: 1, minWidth: 200, gap: spacing.md }}>
              {slices.slice(0, 6).map((s) => (
                <View key={s.category} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Dot color={s.color} />
                  <AppText size="sm" weight="medium" style={{ marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>{s.category}</AppText>
                  <AppText size="sm" weight="semibold" style={{ marginRight: spacing.md }}>{formatINR(s.amount)}</AppText>
                  <AppText size="sm" color={colors.textMuted} style={{ width: 40, textAlign: 'right' }}>{Math.round(s.pct)}%</AppText>
                </View>
              ))}
              {!slices.length && <AppText color={colors.textMuted} size="sm">No spending in this period yet.</AppText>}
            </View>
          </View>
        </Card>

        {/* AI insight + quick actions column */}
        <View style={{ flex: isWide ? 1 : undefined, gap: spacing.lg }}>
          <Card dark>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md }}>
              <Ionicons name="sparkles" size={15} color={colors.lime} />
              <AppText color={colors.lime} size="sm" weight="bold">AI Smart Insight</AppText>
            </View>
            <AppText color="#fff" size="lg" weight="semibold" style={{ lineHeight: 24 }}>
              {topInsight ? topInsight.title : "You're on track this month 🎉"}
            </AppText>
            <AppText color={colors.textOnDarkMuted} size="sm" style={{ marginTop: 6 }} numberOfLines={3}>
              {topInsight ? topInsight.body : 'Keep it up — your spending is within your budgets.'}
            </AppText>
            <Button label="View Suggestions" variant="lime" icon="bulb-outline" style={{ marginTop: spacing.lg }} onPress={() => router.push('/insights')} />
          </Card>

          <Card>
            <AppText size="md" weight="bold" style={{ marginBottom: spacing.md }}>Quick Actions</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
              <QuickAction icon="add-circle" label="Add" color={colors.brand} onPress={() => router.push('/add')} />
              <QuickAction icon="scan" label="Scan" color={colors.info} onPress={() => router.push({ pathname: '/add', params: { mode: 'upi' } })} />
              <QuickAction icon="chatbubbles" label="Ask AI" color="#A855F7" onPress={() => router.push('/chat')} />
              <QuickAction icon="flag" label="Goals" color={colors.warning} onPress={() => router.push('/goals')} />
            </View>
          </Card>
        </View>
      </View>

      {/* Recommendations */}
      {app.insights.length > 0 && (
        <View style={{ marginTop: spacing.lg }}>
          <SectionHeader title="AI Recommendations" action="View All" onAction={() => router.push('/insights')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.xl }}>
            {app.insights.slice(0, 5).map((ins) => (
              <Pressable key={ins.id} onPress={() => router.push('/insights')} style={{ width: 220 }}>
                <Card padded style={{ padding: spacing.lg }}>
                  <IconCircle name={insightIcon(ins.kind)} bg={colors.brandSoft} color={colors.brand} size={38} />
                  <AppText weight="bold" size="sm" style={{ marginTop: spacing.md }} numberOfLines={2}>{ins.title}</AppText>
                  <AppText size="xs" color={colors.textMuted} style={{ marginTop: 4 }} numberOfLines={2}>{ins.body}</AppText>
                </Card>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Recent transactions */}
      <View style={{ marginTop: spacing.lg }}>
        <SectionHeader title="Recent Transactions" action="View All" onAction={() => router.push('/transactions')} />
        <Card padded style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.xl }}>
          {recent.map((t, i) => (
            <View key={t.id}>
              <TransactionRow txn={t} onPress={() => router.push('/transactions')} />
              {i < recent.length - 1 && <View style={{ height: 1, backgroundColor: colors.hairline }} />}
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

function StatCard({ label, value, delta, prev, color, positiveGood }: { label: string; value: number; delta: number; prev: number; color: string; positiveGood: boolean }) {
  const up = value >= prev;
  const improved = positiveGood ? up : !up;
  // % change is only meaningful with a positive baseline; otherwise show direction only.
  const showPct = prev > 0 && Math.abs(delta) <= 300;
  const tone = improved ? colors.positive : colors.negative;
  return (
    <Card padded style={{ padding: spacing.lg, flexGrow: 1, flexBasis: 150, minWidth: 140 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <AppText size="xs" color={colors.textMuted} weight="medium" numberOfLines={1}>{label}</AppText>
      </View>
      <AppText size="xl" weight="heavy" style={{ marginTop: 8 }}>{formatINR(value, { compact: true })}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 }}>
        <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={12} color={tone} />
        {showPct && <AppText size="xs" weight="bold" color={tone}>{formatPercent(delta, false)}</AppText>}
        <AppText size="xs" color={colors.textFaint}>vs last month</AppText>
      </View>
    </Card>
  );
}

function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const opts: { key: Period; label: string }[] = [
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: '30', label: '30d' },
  ];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.cardMuted, borderRadius: radius.pill, padding: 3 }}>
      {opts.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: value === o.key ? colors.card : 'transparent' }}>
          <AppText size="xs" weight="semibold" color={value === o.key ? colors.text : colors.textMuted}>{o.label}</AppText>
        </Pressable>
      ))}
    </View>
  );
}

function QuickAction({ icon, label, color, onPress }: { icon: any; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: 60 }}>
      <IconCircle name={icon} bg={color + '18'} color={color} size={48} />
      <AppText size="xs" weight="medium">{label}</AppText>
    </Pressable>
  );
}

function severityRank(s: string) {
  return s === 'alert' ? 3 : s === 'warn' ? 2 : 1;
}
function insightIcon(kind: string): any {
  return { budget: 'pie-chart', anomaly: 'warning', subscription: 'repeat', trend: 'trending-up', tip: 'bulb' }[kind] ?? 'sparkles';
}

const styles = {
  headerBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
  badge: { position: 'absolute' as const, top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.negative },
};

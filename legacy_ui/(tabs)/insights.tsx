import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, IconCircle, ProgressBar, SectionHeader } from '@/components/ui';
import { budgetProgress, detectSubscriptions, forecastMonth } from '@/data/analytics';
import type { Insight } from '@/data/types';
import { colors, colorForCategory, radius, spacing } from '@/theme';
import { formatINR } from '@/lib/format';

export default function Insights() {
  const app = useApp();
  const router = useRouter();

  const forecast = useMemo(() => forecastMonth(app.transactions, app.budgets).slice(0, 5), [app.transactions, app.budgets]);
  const budgets = useMemo(() => budgetProgress(app.transactions, app.budgets), [app.transactions, app.budgets]);
  const subs = useMemo(() => detectSubscriptions(app.transactions).slice(0, 6), [app.transactions]);
  const insights = app.insights;

  return (
    <Screen>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <AppText size="xxl" weight="heavy">Smart Insights</AppText>
        <AppText size="sm" color={colors.textMuted}>Forecasts, alerts and nudges from your spending.</AppText>
      </View>

      {/* Chat CTA */}
      <Card dark style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconCircle name="chatbubbles" bg={colors.inkSoft} color={colors.lime} size={48} />
          <View style={{ flex: 1 }}>
            <AppText color="#fff" weight="bold" size="md">Chat with your money</AppText>
            <AppText color={colors.textOnDarkMuted} size="sm">Ask "how much did I spend on food?"</AppText>
          </View>
          <Button label="Ask" variant="lime" icon="arrow-forward" onPress={() => router.push('/chat')} style={{ height: 42, paddingHorizontal: 18 }} />
        </View>
      </Card>

      {/* Forecast */}
      <SectionHeader title="This month's forecast" />
      <Card style={{ marginBottom: spacing.lg }}>
        {forecast.length === 0 ? (
          <AppText size="sm" color={colors.textMuted}>Not enough data yet this month.</AppText>
        ) : (
          forecast.map((f, i) => (
            <View key={f.category} style={{ marginBottom: i < forecast.length - 1 ? spacing.lg : 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorForCategory(f.category) }} />
                <AppText size="sm" weight="semibold" style={{ flex: 1, marginLeft: 8 }}>{f.category}</AppText>
                <AppText size="sm" weight="bold" color={f.willOverspend ? colors.negative : colors.text}>{formatINR(f.projected, { compact: true })}</AppText>
                {f.limit != null && <AppText size="xs" color={colors.textFaint}> / {formatINR(f.limit, { compact: true })}</AppText>}
              </View>
              {f.limit != null && <ProgressBar pct={(f.projected / f.limit) * 100} color={f.willOverspend ? colors.negative : colorForCategory(f.category)} />}
              <AppText size="xs" color={colors.textMuted} style={{ marginTop: 4 }}>
                {formatINR(f.spentSoFar, { compact: true })} spent so far · projected month-end {f.willOverspend ? `⚠︎ ${formatINR(f.overBy, { compact: true })} over` : 'on track'}
              </AppText>
            </View>
          ))
        )}
      </Card>

      {/* Insights feed */}
      <SectionHeader title={`Alerts & nudges${insights.length ? ` (${insights.length})` : ''}`} />
      {insights.length === 0 ? (
        <Card style={{ marginBottom: spacing.lg }}><EmptyState icon="checkmark-done-circle-outline" title="All clear" subtitle="No alerts right now. Great job staying on budget!" /></Card>
      ) : (
        <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
          {insights.map((ins) => <InsightCard key={ins.id} ins={ins} />)}
        </View>
      )}

      {/* Subscriptions */}
      {subs.length > 0 && (
        <>
          <SectionHeader title="Detected subscriptions" />
          <Card>
            {subs.map((s, i) => (
              <View key={s.merchant + s.amount} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                <IconCircle name="repeat" bg={colors.brandSoft} color={colors.brand} size={38} iconSize={18} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <AppText size="sm" weight="semibold">{s.merchant}</AppText>
                  <AppText size="xs" color={s.likelyForgotten ? colors.warning : colors.textMuted}>
                    {s.occurrences}× · {s.likelyForgotten ? 'may be unused — review' : 'active monthly'}
                  </AppText>
                </View>
                <AppText size="md" weight="bold">{formatINR(s.amount)}<AppText size="xs" color={colors.textFaint}>/mo</AppText></AppText>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function InsightCard({ ins }: { ins: Insight }) {
  const tone = { info: colors.info, warn: colors.warning, alert: colors.negative }[ins.severity];
  const icon = { budget: 'pie-chart', anomaly: 'warning', subscription: 'repeat', trend: 'trending-up', tip: 'bulb' }[ins.kind] as any;
  return (
    <Card padded style={{ padding: spacing.lg, borderLeftWidth: 4, borderLeftColor: tone }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <IconCircle name={icon} bg={tone + '18'} color={tone} size={40} />
        <View style={{ flex: 1 }}>
          <AppText size="md" weight="bold">{ins.title}</AppText>
          <AppText size="sm" color={colors.textMuted} style={{ marginTop: 3, lineHeight: 20 }}>{ins.body}</AppText>
        </View>
      </View>
    </Card>
  );
}

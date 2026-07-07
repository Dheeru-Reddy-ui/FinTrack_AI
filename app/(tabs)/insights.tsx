import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudgets, useCategories, useTransactions } from '@/data/api';
import { explainInsights } from '@/data/ai';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, IconCircle, ProgressBar, SectionHeader } from '@/components/ui';
import { detectSubscriptions, forecastMonth, generateInsights } from '@/data/analytics';
import type { Insight } from '@/data/types';
import { colors, colorForCategory, spacing } from '@/theme';
import { formatINR, monthLabel, currentMonthKey } from '@/lib/format';

export default function Insights() {
  const router = useRouter();
  const txnsQ = useTransactions();
  const budgetsQ = useBudgets();
  const categoriesQ = useCategories();
  const txns = txnsQ.data ?? [];
  const budgets = budgetsQ.data ?? [];
  const categories = categoriesQ.data ?? [];

  const forecast = useMemo(() => forecastMonth(txns, budgets, categories).slice(0, 6), [txns, budgets, categories]);
  const subs = useMemo(() => detectSubscriptions(txns).slice(0, 8), [txns]);
  const insights = useMemo(() => generateInsights(txns, budgets, categories), [txns, budgets, categories]);

  // Deterministic digest of the findings — both the AI prompt and the fallback copy.
  const digest = useMemo(() => {
    if (!txns.length) return '';
    const parts: string[] = [];
    const over = forecast.filter((f) => f.willOverspend);
    if (over.length) parts.push(`Overspend risk: ${over.map((f) => `${f.category} projected ₹${f.projected.toLocaleString('en-IN')} vs budget ₹${(f.limit ?? 0).toLocaleString('en-IN')}`).join('; ')}.`);
    const totalProjected = forecast.reduce((a, f) => a + f.projected, 0);
    parts.push(`Projected month-end spend (${monthLabel(currentMonthKey())}): ₹${totalProjected.toLocaleString('en-IN')} across tracked categories.`);
    for (const i of insights.slice(0, 4)) parts.push(`${i.title} — ${i.body}`);
    const forgotten = subs.filter((s) => s.likelyForgotten);
    if (forgotten.length) parts.push(`Possibly unused subscriptions: ${forgotten.map((s) => `${s.merchant} ₹${s.amount}`).join(', ')}.`);
    return parts.join('\n');
  }, [txns.length, forecast, insights, subs]);

  // LLM summary (server-side phrasing) with deterministic fallback.
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const lastDigest = useRef<string>('');
  useEffect(() => {
    if (!digest || digest === lastDigest.current) return;
    lastDigest.current = digest;
    setSummarizing(true);
    explainInsights(digest)
      .then((s) => setSummary(s))
      .finally(() => setSummarizing(false));
  }, [digest]);

  if (txnsQ.isLoading) {
    return <Screen><View style={{ paddingTop: 120, alignItems: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View></Screen>;
  }

  return (
    <Screen refreshing={txnsQ.isRefetching} onRefresh={() => { txnsQ.refetch(); budgetsQ.refetch(); }}>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <AppText size="xxl" weight="heavy">Smart Insights</AppText>
        <AppText size="sm" color={colors.textMuted}>Forecasts, alerts and nudges — computed from your ledger.</AppText>
      </View>

      {txns.length === 0 ? (
        <Card><EmptyState icon="sparkles" title="No insights yet" subtitle="Add a few transactions and forecasts, alerts and subscription detection appear here." /></Card>
      ) : (
        <>
          {/* AI summary */}
          <Card style={{ marginBottom: spacing.lg, backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: '#CBEBD8' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
              <Ionicons name="sparkles" size={15} color={colors.brandDark} />
              <AppText size="sm" weight="bold" color={colors.brandDark}>This month at a glance</AppText>
            </View>
            {summarizing && !summary ? (
              <AppText size="sm" color={colors.textMuted}>Summarizing your month…</AppText>
            ) : (
              <AppText size="md" style={{ lineHeight: 22 }}>{summary ?? digest.split('\n').slice(0, 3).join(' ')}</AppText>
            )}
          </Card>

          {/* Forecast / budget pacing */}
          <SectionHeader title={`Forecast — ${monthLabel(currentMonthKey())}`} />
          <Card style={{ marginBottom: spacing.lg }}>
            {forecast.length === 0 ? (
              <AppText size="sm" color={colors.textMuted}>Set budgets in Settings to unlock pacing forecasts.</AppText>
            ) : (
              forecast.map((f, i) => (
                <View key={f.category} style={{ marginBottom: i < forecast.length - 1 ? spacing.lg : 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorForCategory(f.category) }} />
                    <AppText size="sm" weight="semibold" style={{ flex: 1, marginLeft: 8 }}>{f.category}</AppText>
                    <AppText size="sm" weight="bold" color={f.willOverspend ? colors.negative : colors.text}>
                      {formatINR(f.projected, { compact: true })}
                    </AppText>
                    {f.limit != null && <AppText size="xs" color={colors.textFaint}> / {formatINR(f.limit, { compact: true })}</AppText>}
                  </View>
                  {f.limit != null && <ProgressBar pct={(f.projected / f.limit) * 100} color={f.willOverspend ? colors.negative : colorForCategory(f.category)} />}
                  <AppText size="xs" color={colors.textMuted} style={{ marginTop: 4 }}>
                    {formatINR(f.spentSoFar, { compact: true })} so far · month-end {f.willOverspend ? `⚠ ${formatINR(f.overBy, { compact: true })} over budget` : 'on track'}
                  </AppText>
                </View>
              ))
            )}
          </Card>

          {/* Alerts & nudges */}
          <SectionHeader title={`Alerts & nudges${insights.length ? ` (${insights.length})` : ''}`} />
          {insights.length === 0 ? (
            <Card style={{ marginBottom: spacing.lg }}>
              <EmptyState icon="checkmark-done-circle-outline" title="All clear" subtitle="No alerts right now — you're within budget." />
            </Card>
          ) : (
            <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
              {insights.map((ins) => <InsightCard key={ins.id} ins={ins} />)}
            </View>
          )}

          {/* Subscriptions */}
          {subs.length > 0 && (
            <>
              <SectionHeader title="Detected subscriptions" />
              <Card style={{ marginBottom: spacing.lg }}>
                {subs.map((s, i) => (
                  <View key={s.merchant + s.amount} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                    <IconCircle name="repeat" bg={colors.brandSoft} color={colors.brand} size={38} iconSize={18} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <AppText size="sm" weight="semibold">{s.merchant}</AppText>
                      <AppText size="xs" color={s.likelyForgotten ? colors.warning : colors.textMuted}>
                        {s.occurrences}× monthly · {s.likelyForgotten ? 'may be unused — review' : 'active'}
                      </AppText>
                    </View>
                    <AppText size="md" weight="bold">{formatINR(s.amount)}<AppText size="xs" color={colors.textFaint}>/mo</AppText></AppText>
                  </View>
                ))}
              </Card>
            </>
          )}

          <Button label="Ask about your spending" variant="dark" icon="chatbubbles-outline" onPress={() => router.push('/chat')} />
        </>
      )}
    </Screen>
  );
}

function InsightCard({ ins }: { ins: Insight }) {
  const tone = { info: colors.info, warn: colors.warning, alert: colors.negative }[ins.severity];
  const icon = ({ budget: 'pie-chart', anomaly: 'warning', subscription: 'repeat', trend: 'trending-up', tip: 'bulb' } as const)[ins.kind] ?? 'sparkles';
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

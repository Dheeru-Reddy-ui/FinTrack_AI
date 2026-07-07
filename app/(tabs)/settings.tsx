import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthProvider';
import { useAccounts, useBudgets, useGoals, useNotifications, useTransactions } from '@/data/api';
import { enrichGoal, useGoalMeta } from '@/data/goalMeta';
import { Screen } from '@/components/Screen';
import { AppText, Avatar, Button, Card, IconCircle, Pill, SectionHeader, SettingRow, Toggle } from '@/components/ui';
import { colors, colorForCategory, spacing } from '@/theme';
import { formatINR } from '@/lib/format';

const accountIcon: Record<string, any> = { bank: 'business', cash: 'cash', wallet: 'wallet', credit_card: 'card' };

const SUPPORT_EMAIL = 'support@fintrack.ai';
const PRIVACY_URL = 'https://fintrack.ai/privacy';
const RATE_URL = Platform.select({
  ios: 'https://apps.apple.com/app/id0000000000',
  android: 'https://play.google.com/store/apps/details?id=ai.fintrack',
  default: 'https://fintrack.ai',
})!;

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function Settings() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const budgetsQ = useBudgets();
  const accountsQ = useAccounts();
  const goalsQ = useGoals();
  const txnsQ = useTransactions();
  const notifsQ = useNotifications();
  const { metaFor, settings, updateSettings } = useGoalMeta();
  const [exporting, setExporting] = useState(false);

  const name = (user?.user_metadata as any)?.name || user?.email?.split('@')[0] || 'You';
  const budgets = budgetsQ.data ?? [];
  const goals = (goalsQ.data ?? []).map((g) => enrichGoal(g, metaFor(g.id), settings.autoArchiveCompleted));
  const activeGoals = goals.filter((g) => !g.archived).length;
  const archivedGoals = goals.filter((g) => g.archived).length;
  const unread = (notifsQ.data ?? []).filter((n) => !n.read).length;

  const exportCSV = async () => {
    const txns = txnsQ.data ?? [];
    if (!txns.length || exporting) return;
    setExporting(true);
    try {
      const header = 'Date,Type,Category,Merchant,Amount,Note';
      const rows = txns.map((t) =>
        [t.txnDate, t.type, t.category ?? '', t.merchant ?? '', String(t.amount), t.note ?? ''].map((c) => csvEscape(String(c))).join(','),
      );
      const csv = [header, ...rows].join('\n');
      const filename = `fintrack-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: filename, message: csv });
      }
    } catch {
      // best-effort; nothing to surface
    } finally {
      setExporting(false);
    }
  };

  const openURL = (url: string) => Linking.openURL(url).catch(() => {});

  return (
    <Screen>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <AppText size="xxl" weight="heavy">Settings</AppText>
      </View>

      {/* Profile */}
      <Card style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={name} size={54} />
          <View style={{ flex: 1 }}>
            <AppText size="lg" weight="bold">{name}</AppText>
            <AppText size="sm" color={colors.textMuted}>{user?.email}</AppText>
          </View>
          <Pill label="INR · Kolkata" tone="neutral" />
        </View>
      </Card>

      {/* Quick links */}
      <Card style={{ marginBottom: spacing.lg }}>
        <SettingRow
          first
          icon="flag"
          iconBg={colors.brandSoft}
          iconColor={colors.brand}
          label="Goals"
          subtitle={activeGoals ? `${activeGoals} active${archivedGoals ? ` · ${archivedGoals} archived` : ''}` : 'Set your first savings goal'}
          onPress={() => router.push('/goals')}
        />
        <SettingRow
          icon="notifications"
          iconBg="#E0F2FE"
          iconColor={colors.info}
          label="Alerts"
          subtitle={unread ? `${unread} unread` : 'Proactive nudges & reminders'}
          right={unread ? <Pill label={String(unread)} tone="down" /> : undefined}
          onPress={() => router.push('/notifications')}
        />
      </Card>

      {/* Preferences */}
      <SectionHeader title="Preferences" />
      <Card style={{ marginBottom: spacing.lg }}>
        <SettingRow
          first
          icon="archive-outline"
          label="Auto-archive completed goals"
          subtitle="Move goals to Archived once they hit their target"
          right={<Toggle value={settings.autoArchiveCompleted} onValueChange={(v) => updateSettings({ autoArchiveCompleted: v })} />}
        />
        <SettingRow
          icon="trophy-outline"
          label="Celebrate completed goals"
          subtitle="Show a banner when you reach a goal"
          right={<Toggle value={settings.goalCelebration} onValueChange={(v) => updateSettings({ goalCelebration: v })} />}
        />
      </Card>

      {/* Budgets */}
      <SectionHeader title="Budgets" action="New" onAction={() => router.push('/budget-new')} />
      <Card style={{ marginBottom: spacing.lg }}>
        {budgetsQ.isLoading ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
        ) : budgets.length === 0 ? (
          <AppText size="sm" color={colors.textMuted}>No budgets yet — create one to unlock pacing forecasts and nudges.</AppText>
        ) : (
          budgets.map((b, i) => (
            <Pressable key={b.id} onPress={() => router.push({ pathname: '/budget-new', params: { id: b.id } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colorForCategory(b.name) }} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <AppText size="sm" weight="semibold">{b.name}</AppText>
                  <AppText size="xs" color={colors.textMuted}>{b.categoryIds.length} categor{b.categoryIds.length === 1 ? 'y' : 'ies'} · {b.period}</AppText>
                </View>
                <AppText size="sm" weight="bold" style={{ marginRight: spacing.sm }}>{formatINR(b.limitAmount, { compact: true })}</AppText>
                <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
              </View>
            </Pressable>
          ))
        )}
      </Card>

      {/* Accounts */}
      <SectionHeader title="Accounts" />
      <Card style={{ marginBottom: spacing.lg }}>
        {(accountsQ.data ?? []).map((a, i) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
            <IconCircle name={accountIcon[a.type] ?? 'wallet'} bg={colors.cardMuted} color={colors.text} size={38} iconSize={18} />
            <AppText size="sm" weight="semibold" style={{ flex: 1, marginLeft: spacing.md }}>{a.name}</AppText>
            <AppText size="xs" color={colors.textMuted} style={{ textTransform: 'capitalize' }}>{a.type.replace('_', ' ')}</AppText>
          </View>
        ))}
        {(accountsQ.data ?? []).length === 0 && <AppText size="sm" color={colors.textMuted}>No accounts.</AppText>}
      </Card>

      {/* Data & support */}
      <SectionHeader title="Data & support" />
      <Card style={{ marginBottom: spacing.lg }}>
        <SettingRow
          first
          icon="download-outline"
          label="Export transactions"
          subtitle={`Download ${(txnsQ.data ?? []).length} transactions as CSV`}
          right={exporting ? <ActivityIndicator color={colors.brand} /> : undefined}
          onPress={exportCSV}
        />
        <SettingRow icon="help-circle-outline" label="Help & feedback" subtitle="Email our team" onPress={() => openURL(`mailto:${SUPPORT_EMAIL}?subject=FinTrack%20AI%20feedback`)} />
        <SettingRow icon="star-outline" label="Rate FinTrack AI" subtitle="Enjoying the app? Leave a review" onPress={() => openURL(RATE_URL)} />
        <SettingRow icon="shield-checkmark-outline" label="Privacy policy" onPress={() => openURL(PRIVACY_URL)} />
      </Card>

      {/* System */}
      <Card style={{ marginBottom: spacing.lg }}>
        <StatusRow icon="server-outline" label="Backend" value="Supabase · live" ok />
        <StatusRow icon="lock-closed-outline" label="Data privacy" value="Row-level security" ok />
        <AppText size="xs" color={colors.textMuted} style={{ marginTop: spacing.md, lineHeight: 18 }}>
          FinTrack AI v1.0 · Insights are descriptive, not financial advice.
        </AppText>
      </Card>

      <Button label="Sign out" variant="dark" icon="log-out-outline" onPress={async () => { await signOut(); router.replace('/login'); }} />
    </Screen>
  );
}

function StatusRow({ icon, label, value, ok }: { icon: any; label: string; value: string; ok?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
      <IconCircle name={icon} bg={colors.cardMuted} color={colors.text} size={34} iconSize={16} />
      <AppText size="sm" weight="medium" style={{ flex: 1, marginLeft: spacing.md }}>{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ok ? colors.positive : colors.textFaint }} />
        <AppText size="sm" color={colors.textMuted}>{value}</AppText>
      </View>
    </View>
  );
}

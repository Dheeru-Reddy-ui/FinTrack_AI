import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { Screen } from '@/components/Screen';
import { AppText, Avatar, Button, Card, IconCircle, Pill, SectionHeader } from '@/components/ui';
import { colors, colorForCategory, radius, spacing } from '@/theme';
import { formatINR } from '@/lib/format';
import { config, DEMO_MODE, hasLLM } from '@/data/config';

export default function Settings() {
  const app = useApp();
  const router = useRouter();

  const accountIcon: Record<string, any> = { bank: 'business', cash: 'cash', wallet: 'wallet', credit_card: 'card' };

  return (
    <Screen>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <AppText size="xxl" weight="heavy">Settings</AppText>
      </View>

      {/* Profile */}
      <Card style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={app.profile.name || 'You'} size={54} />
          <View style={{ flex: 1 }}>
            <AppText size="lg" weight="bold">{app.profile.name || 'You'}</AppText>
            <AppText size="sm" color={colors.textMuted}>{app.profile.email}</AppText>
          </View>
          <Pill label={`${app.profile.currency} · ${app.profile.timezone.split('/')[1] ?? app.profile.timezone}`} tone="neutral" />
        </View>
      </Card>

      {/* Budgets */}
      <SectionHeader title="Monthly budgets" />
      <Card style={{ marginBottom: spacing.lg }}>
        {app.budgets.map((b, i) => (
          <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colorForCategory(b.category) }} />
            <AppText size="sm" weight="semibold" style={{ flex: 1, marginLeft: spacing.md }}>{b.category}</AppText>
            <Pressable onPress={() => app.updateBudget(b.id, { limitAmount: Math.max(0, b.limitAmount - 500) })} style={styles.stepper}><Ionicons name="remove" size={16} color={colors.textMuted} /></Pressable>
            <AppText size="sm" weight="bold" style={{ width: 78, textAlign: 'center' }}>{formatINR(b.limitAmount, { compact: true })}</AppText>
            <Pressable onPress={() => app.updateBudget(b.id, { limitAmount: b.limitAmount + 500 })} style={styles.stepper}><Ionicons name="add" size={16} color={colors.textMuted} /></Pressable>
          </View>
        ))}
      </Card>

      {/* Accounts */}
      <SectionHeader title="Accounts" />
      <Card style={{ marginBottom: spacing.lg }}>
        {app.accounts.map((a, i) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
            <IconCircle name={accountIcon[a.type] ?? 'wallet'} bg={colors.cardMuted} color={colors.text} size={38} iconSize={18} />
            <AppText size="sm" weight="semibold" style={{ flex: 1, marginLeft: spacing.md }}>{a.name}</AppText>
            <AppText size="xs" color={colors.textMuted} style={{ textTransform: 'capitalize' }}>{a.type.replace('_', ' ')}</AppText>
          </View>
        ))}
      </Card>

      {/* System status */}
      <SectionHeader title="Data & AI" />
      <Card style={{ marginBottom: spacing.lg }}>
        <StatusRow icon="server-outline" label="Backend" value={DEMO_MODE ? 'Demo (local)' : 'Supabase'} ok={!DEMO_MODE} />
        <StatusRow icon="sparkles-outline" label="AI provider" value={hasLLM ? config.aiProvider : 'On-device fallback'} ok={hasLLM} />
        <StatusRow icon="lock-closed-outline" label="Data privacy" value="Stored on this device" ok />
        <Button label="Reset demo data" variant="ghost" icon="refresh" onPress={() => app.resetDemo()} style={{ marginTop: spacing.md }} />
      </Card>

      {/* About */}
      <Card style={{ marginBottom: spacing.lg }}>
        <AppText size="sm" weight="semibold">FinTrack AI</AppText>
        <AppText size="xs" color={colors.textMuted} style={{ marginTop: 4, lineHeight: 18 }}>
          v1.0.0 · An AI finance tracker for India. Insights are descriptive, not financial advice — figures are projections from your own data.
        </AppText>
      </Card>

      <Button label="Sign out" variant="dark" icon="log-out-outline" onPress={async () => { await app.signOut(); router.replace('/login'); }} />
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
        <AppText size="sm" color={colors.textMuted} style={{ textTransform: 'capitalize' }}>{value}</AppText>
      </View>
    </View>
  );
}

const styles = {
  stepper: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardMuted, alignItems: 'center' as const, justifyContent: 'center' as const },
};

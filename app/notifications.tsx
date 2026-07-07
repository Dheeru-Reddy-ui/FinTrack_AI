import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMarkAllRead, useNotifications, useRefreshNudges } from '@/data/api';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, IconCircle } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { relativeDay } from '@/lib/format';
import { goBack } from '@/lib/nav';

const KIND_ICON = { budget: 'pie-chart', forecast: 'trending-up', anomaly: 'warning', subscription: 'repeat', trend: 'analytics', tip: 'bulb' } as const;

export default function Notifications() {
  const router = useRouter();
  const notifsQ = useNotifications();
  const markAll = useMarkAllRead();
  const refresh = useRefreshNudges();

  // Re-scan for fresh nudges when the center opens (idempotent server-side).
  useEffect(() => {
    refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifs = notifsQ.data ?? [];
  const unread = notifs.filter((n) => !n.read).length;

  return (
    <Screen refreshing={notifsQ.isRefetching} onRefresh={() => { refresh.mutate(); notifsQ.refetch(); }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText size="xxl" weight="heavy">Nudges</AppText>
          <AppText size="sm" color={colors.textMuted}>
            {refresh.isPending ? 'Scanning your spending…' : `${notifs.length} total${unread ? ` · ${unread} new` : ''}`}
          </AppText>
        </View>
        {unread > 0 && (
          <Button label="Mark all read" variant="ghost" onPress={() => markAll.mutate()} loading={markAll.isPending} style={{ height: 40, paddingHorizontal: 14 }} />
        )}
      </View>

      {notifsQ.isLoading ? (
        <View style={{ paddingTop: 80, alignItems: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : notifs.length === 0 ? (
        <Card><EmptyState icon="notifications-outline" title="No nudges yet" subtitle="When budgets run hot, charges look unusual, or subscriptions go stale, you'll hear about it here — checked daily, automatically." /></Card>
      ) : (
        <View style={{ gap: spacing.md }}>
          {notifs.map((n) => {
            const tone = { info: colors.info, warn: colors.warning, alert: colors.negative }[n.severity];
            return (
              <Card key={n.id} padded style={{ padding: spacing.lg, borderLeftWidth: 4, borderLeftColor: tone, opacity: n.read ? 0.75 : 1 }}>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <IconCircle name={KIND_ICON[n.kind] ?? 'sparkles'} bg={tone + '18'} color={tone} size={40} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <AppText size="md" weight="bold" style={{ flex: 1 }}>{n.title}</AppText>
                      {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />}
                    </View>
                    <AppText size="sm" color={colors.textMuted} style={{ marginTop: 3, lineHeight: 20 }}>{n.body}</AppText>
                    <AppText size="xs" color={colors.textFaint} style={{ marginTop: 6 }}>{relativeDay(n.createdAt.slice(0, 10))}</AppText>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

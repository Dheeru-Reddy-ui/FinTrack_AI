import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, IconCircle, Pill, TextField } from '@/components/ui';
import { TransactionRow } from '@/components/TransactionRow';
import type { Transaction } from '@/data/types';
import { colors, colorForCategory, radius, spacing } from '@/theme';
import { formatDate, relativeDay } from '@/lib/format';
import { groupBy } from '@/lib/id';

export default function Transactions() {
  const app = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('All');
  const [editing, setEditing] = useState<string | null>(null);

  const flagged = app.transactions.filter((t) => t.needsReview);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return app.transactions.filter((t) => {
      if (filter !== 'All' && t.category !== filter) return false;
      if (!q) return true;
      return (t.merchant ?? '').toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q);
    });
  }, [app.transactions, query, filter]);

  const groups = useMemo(() => {
    const byDate = groupBy(filtered, (t) => t.txnDate);
    return Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const categories = ['All', ...app.categoryNames];

  return (
    <Screen>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <AppText size="xxl" weight="heavy">Transactions</AppText>
          <AppText size="sm" color={colors.textMuted}>{app.transactions.length} total · {flagged.length} to review</AppText>
        </View>
      </View>

      {/* Review queue */}
      {flagged.length > 0 && (
        <Card style={{ marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.warningSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
            <IconCircle name="alert-circle" bg={colors.warningSoft} color={colors.warning} size={34} iconSize={18} />
            <AppText size="md" weight="bold" style={{ flex: 1 }}>Needs your review</AppText>
            <Pill label={`${flagged.length}`} tone="down" />
          </View>
          {flagged.slice(0, 4).map((t) => (
            <View key={t.id} style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <AppText size="sm" weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{t.merchant ?? 'Unknown'} · ₹{t.amount}</AppText>
                <AppText size="xs" color={colors.textFaint}>{Math.round((t.confidence ?? 0) * 100)}%</AppText>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {app.categoryNames.slice(0, 6).map((c) => (
                  <Pressable key={c} onPress={() => app.setTransactionCategory(t.id, c)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colorForCategory(c) + '18', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colorForCategory(c) }} />
                    <AppText size="xs" weight="medium">{c}</AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* Search + filters */}
      <TextField value={query} onChangeText={setQuery} placeholder="Search merchant or category" icon="search-outline" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.lg }}>
        {categories.map((c) => {
          const active = filter === c;
          return (
            <Pressable key={c} onPress={() => setFilter(c)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: active ? colors.ink : colors.card, borderWidth: 1, borderColor: active ? colors.ink : colors.hairline }}>
              <AppText size="xs" weight="semibold" color={active ? '#fff' : colors.textMuted}>{c}</AppText>
            </Pressable>
          );
        })}
      </View>

      {/* Grouped list */}
      {groups.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No transactions found" subtitle="Try a different search or add a new expense." />
      ) : (
        groups.map(([date, items]) => (
          <View key={date} style={{ marginBottom: spacing.md }}>
            <AppText size="xs" weight="bold" color={colors.textMuted} style={{ marginBottom: 4, marginLeft: 4 }}>{relativeDay(date)} · {formatDate(date)}</AppText>
            <Card padded style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.xl }}>
              {items.map((t, i) => (
                <View key={t.id}>
                  <TransactionRow txn={t} onPress={() => setEditing(editing === t.id ? null : t.id)} />
                  {editing === t.id && <EditPanel txn={t} onClose={() => setEditing(null)} />}
                  {i < items.length - 1 && <View style={{ height: 1, backgroundColor: colors.hairline }} />}
                </View>
              ))}
            </Card>
          </View>
        ))
      )}
    </Screen>
  );
}

function EditPanel({ txn, onClose }: { txn: Transaction; onClose: () => void }) {
  const app = useApp();
  return (
    <View style={{ paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.hairline, gap: spacing.sm }}>
      <AppText size="xs" weight="semibold" color={colors.textMuted}>Recategorize</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {app.categoryNames.map((c) => {
          const active = txn.category === c;
          return (
            <Pressable key={c} onPress={() => app.setTransactionCategory(txn.id, c)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: active ? colorForCategory(c) : colorForCategory(c) + '18' }}>
              <AppText size="xs" weight={active ? 'bold' : 'medium'} color={active ? '#fff' : colors.text}>{c}</AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        <Button label="Delete" variant="ghost" icon="trash-outline" onPress={() => { app.deleteTransaction(txn.id); onClose(); }} style={{ flex: 1, height: 42 }} />
        <Button label="Done" onPress={onClose} style={{ flex: 1, height: 42 }} />
      </View>
    </View>
  );
}

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCategories, useDeleteTransaction, useSetCategory, useTransactions } from '@/data/api';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, IconCircle, Pill, TextField } from '@/components/ui';
import { TransactionRow } from '@/components/TransactionRow';
import type { Category, Transaction } from '@/data/types';
import { colors, colorForCategory, radius, spacing } from '@/theme';
import { formatDate, relativeDay } from '@/lib/format';
import { groupBy } from '@/lib/id';

export default function Ledger() {
  const txnsQ = useTransactions();
  const catsQ = useCategories();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [editing, setEditing] = useState<string | null>(null);

  const txns = txnsQ.data ?? [];
  const categories = catsQ.data ?? [];
  const flagged = txns.filter((t) => t.needsReview);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns.filter((t) => {
      if (filter !== 'All' && t.category !== filter) return false;
      if (!q) return true;
      return (t.merchant ?? '').toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q);
    });
  }, [txns, query, filter]);

  const groups = useMemo(() => {
    const byDate = groupBy(filtered, (t) => t.txnDate);
    return Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const filterOptions = ['All', ...categories.map((c) => c.name)];

  if (txnsQ.isLoading) {
    return <Screen><View style={{ paddingTop: 120, alignItems: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View></Screen>;
  }

  return (
    <Screen refreshing={txnsQ.isRefetching} onRefresh={() => txnsQ.refetch()}>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <AppText size="xxl" weight="heavy">Transactions</AppText>
        <AppText size="sm" color={colors.textMuted}>{txns.length} total{flagged.length ? ` · ${flagged.length} to review` : ''}</AppText>
      </View>

      {txns.length === 0 ? (
        <Card><EmptyState icon="receipt-outline" title="No transactions yet" subtitle="Add your first expense from the Add tab." /></Card>
      ) : (
        <>
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
                  <AppText size="sm" weight="semibold" numberOfLines={1}>{t.merchant ?? 'Unknown'} · ₹{t.amount}</AppText>
                  <CategoryChips categories={categories} activeName={t.category} txnId={t.id} />
                </View>
              ))}
            </Card>
          )}

          {/* Search + filters */}
          <TextField value={query} onChangeText={setQuery} placeholder="Search merchant or category" icon="search-outline" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.lg }}>
            {filterOptions.map((c) => {
              const active = filter === c;
              return (
                <Pressable key={c} onPress={() => setFilter(c)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: active ? colors.brand : colors.card, borderWidth: 1, borderColor: active ? colors.brand : colors.hairline }}>
                  <AppText size="xs" weight="semibold" color={active ? '#fff' : colors.textMuted}>{c}</AppText>
                </Pressable>
              );
            })}
          </View>

          {/* Grouped list */}
          {groups.length === 0 ? (
            <EmptyState icon="search-outline" title="No matches" subtitle="Try a different search or filter." />
          ) : (
            groups.map(([date, items]) => (
              <View key={date} style={{ marginBottom: spacing.md }}>
                <AppText size="xs" weight="bold" color={colors.textMuted} style={{ marginBottom: 4, marginLeft: 4 }}>{relativeDay(date)} · {formatDate(date)}</AppText>
                <Card padded style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.xl }}>
                  {items.map((t, i) => (
                    <View key={t.id}>
                      <TransactionRow txn={t} onPress={() => setEditing(editing === t.id ? null : t.id)} />
                      {editing === t.id && <EditPanel txn={t} categories={categories} onClose={() => setEditing(null)} />}
                      {i < items.length - 1 && <View style={{ height: 1, backgroundColor: colors.hairline }} />}
                    </View>
                  ))}
                </Card>
              </View>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

function CategoryChips({ categories, activeName, txnId }: { categories: Category[]; activeName?: string | null; txnId: string }) {
  const setCat = useSetCategory();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {categories.map((c) => {
        const active = activeName === c.name;
        return (
          <Pressable key={c.id} onPress={() => setCat.mutate({ id: txnId, categoryId: c.id })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: active ? colorForCategory(c.name) : colorForCategory(c.name) + '18', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {!active && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colorForCategory(c.name) }} />}
            <AppText size="xs" weight={active ? 'bold' : 'medium'} color={active ? '#fff' : colors.text}>{c.name}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function EditPanel({ txn, categories, onClose }: { txn: Transaction; categories: Category[]; onClose: () => void }) {
  const del = useDeleteTransaction();
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={{ paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.hairline, gap: spacing.sm }}>
      <AppText size="xs" weight="semibold" color={colors.textMuted}>Recategorize</AppText>
      <CategoryChips categories={categories} activeName={txn.category} txnId={txn.id} />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        {confirming ? (
          <>
            <Button label="Confirm delete" variant="ghost" icon="trash" onPress={() => { del.mutate(txn.id); onClose(); }} style={{ flex: 1.4, height: 42 }} loading={del.isPending} />
            <Button label="Keep" onPress={() => setConfirming(false)} style={{ flex: 1, height: 42 }} />
          </>
        ) : (
          <>
            <Button label="Delete" variant="ghost" icon="trash-outline" onPress={() => setConfirming(true)} style={{ flex: 1, height: 42 }} />
            <Button label="Done" onPress={onClose} style={{ flex: 1, height: 42 }} />
          </>
        )}
      </View>
    </View>
  );
}

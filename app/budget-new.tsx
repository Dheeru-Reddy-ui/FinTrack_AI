import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAddBudget, useBudgets, useCategories, useDeleteBudget, useUpdateBudget } from '@/data/api';
import { goBack } from '@/lib/nav';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, TextField } from '@/components/ui';
import type { BudgetPeriod } from '@/data/types';
import { colors, colorForCategory, radius, spacing } from '@/theme';

export default function BudgetNew() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const categoriesQ = useCategories();
  const budgetsQ = useBudgets();
  const addBudget = useAddBudget();
  const updateBudget = useUpdateBudget();
  const deleteBudget = useDeleteBudget();

  const editing = budgetsQ.data?.find((b) => b.id === id) ?? null;

  const [name, setName] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [amount, setAmount] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notifyTrending, setNotifyTrending] = useState(true);
  const [notifyOver, setNotifyOver] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // hydrate edit mode once data arrives
  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setPeriod(editing.period);
      setAmount(String(editing.limitAmount));
      setSelected(new Set(editing.categoryIds));
      setNotifyTrending(editing.notifyTrending);
      setNotifyOver(editing.notifyOver);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const categories = categoriesQ.data ?? [];
  const tops = useMemo(() => categories.filter((c) => !c.parentId && c.name !== 'Income'), [categories]);
  const subsOf = (pid: string) => categories.filter((c) => c.parentId === pid);

  const toggle = (catId: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(catId)) n.delete(catId);
      else n.add(catId);
      return n;
    });
  };
  const toggleExpand = (pid: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  };

  const save = async () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return setError('Set a budget amount greater than 0.');
    if (selected.size === 0) return setError('Pick at least one category.');
    const catNameById = new Map(categories.map((c) => [c.id, c.name]));
    const finalName = name.trim() || catNameById.get([...selected][0]) || 'Budget';
    const input = {
      name: finalName,
      categoryIds: [...selected],
      limitAmount: amt,
      period,
      notifyTrending,
      notifyOver,
    };
    try {
      if (editing) await updateBudget.mutateAsync({ id: editing.id, patch: input });
      else await addBudget.mutateAsync(input);
      goBack('/');
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the budget.');
    }
  };

  if (categoriesQ.isLoading || (id && budgetsQ.isLoading)) {
    return <Screen><View style={{ paddingTop: 120, alignItems: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View></Screen>;
  }

  return (
    <Screen>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText size="xxl" weight="heavy">{editing ? 'Edit budget' : 'New budget'}</AppText>
          <AppText size="sm" color={colors.textMuted}>Cap your spending — we'll track pace and nudge you.</AppText>
        </View>
      </View>

      <Card style={{ marginBottom: spacing.lg }}>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Food, Essentials, Fun money" icon="pricetag-outline" />

        <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: 6 }}>Period</AppText>
        <View style={{ flexDirection: 'row', backgroundColor: colors.cardMuted, borderRadius: radius.md, padding: 3, marginBottom: spacing.md }}>
          {(['weekly', 'monthly', 'yearly'] as const).map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: period === p ? colors.card : 'transparent', alignItems: 'center' }}>
              <AppText size="sm" weight="semibold" color={period === p ? colors.text : colors.textMuted} style={{ textTransform: 'capitalize' }}>{p}</AppText>
            </Pressable>
          ))}
        </View>

        <TextField label={`Amount (per ${period.replace('ly', '')})`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" prefix="₹" placeholder="8000" />
      </Card>

      {/* Categories with subcategories */}
      <Card style={{ marginBottom: spacing.lg }}>
        <AppText size="md" weight="bold" style={{ marginBottom: 4 }}>Categories</AppText>
        <AppText size="xs" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
          Selecting a category includes all of its subcategories.
        </AppText>
        {tops.map((top) => {
          const subs = subsOf(top.id);
          const parentSelected = selected.has(top.id);
          const isOpen = expanded.has(top.id);
          const color = colorForCategory(top.name);
          return (
            <View key={top.id} style={{ borderTopWidth: 1, borderTopColor: colors.hairline, paddingVertical: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
                </View>
                <Pressable onPress={() => subs.length && toggleExpand(top.id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: spacing.md }} hitSlop={6}>
                  <AppText size="md" weight="semibold">{top.name}</AppText>
                  {subs.length > 0 && <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textFaint} />}
                </Pressable>
                <Pressable onPress={() => toggle(top.id)} hitSlop={10} style={[styles.checkbox, parentSelected && styles.checkboxOn]}>
                  {parentSelected && <Ionicons name="checkmark" size={15} color="#fff" />}
                </Pressable>
              </View>
              {isOpen && subs.map((sub) => {
                const subSelected = selected.has(sub.id) || parentSelected;
                return (
                  <View key={sub.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingLeft: 44 }}>
                    <AppText size="sm" color={colors.textMuted} style={{ flex: 1 }}>{sub.name}</AppText>
                    <Pressable
                      onPress={() => !parentSelected && toggle(sub.id)}
                      hitSlop={10}
                      style={[styles.checkbox, subSelected && styles.checkboxOn, parentSelected && { opacity: 0.45 }]}
                    >
                      {subSelected && <Ionicons name="checkmark" size={15} color="#fff" />}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          );
        })}
      </Card>

      {/* Notifications */}
      <Card style={{ marginBottom: spacing.lg }}>
        <AppText size="md" weight="bold" style={{ marginBottom: spacing.sm }}>Notifications</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <AppText size="sm" weight="semibold">Trending over</AppText>
            <AppText size="xs" color={colors.textMuted}>Nudge me when forecasted spend exceeds the budget</AppText>
          </View>
          <Switch value={notifyTrending} onValueChange={setNotifyTrending} trackColor={{ true: colors.brand, false: colors.hairlineStrong }} thumbColor="#fff" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.hairline }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <AppText size="sm" weight="semibold">Over budget</AppText>
            <AppText size="xs" color={colors.textMuted}>Nudge me when spending has exceeded the budget</AppText>
          </View>
          <Switch value={notifyOver} onValueChange={setNotifyOver} trackColor={{ true: colors.brand, false: colors.hairlineStrong }} thumbColor="#fff" />
        </View>
      </Card>

      {error && (
        <Card padded style={{ padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.negativeSoft, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="alert-circle" size={16} color={colors.negative} />
          <AppText size="sm" color={colors.negative} style={{ flex: 1 }}>{error}</AppText>
        </Card>
      )}

      <Button
        label={editing ? 'Save changes' : 'Create budget'}
        icon="checkmark"
        onPress={save}
        loading={addBudget.isPending || updateBudget.isPending}
      />

      {editing && (
        confirmingDelete ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Confirm delete" variant="ghost" icon="trash" onPress={async () => { await deleteBudget.mutateAsync(editing.id); goBack('/'); }} loading={deleteBudget.isPending} style={{ flex: 1.4 }} />
            <Button label="Keep" onPress={() => setConfirmingDelete(false)} style={{ flex: 1 }} />
          </View>
        ) : (
          <Pressable onPress={() => setConfirmingDelete(true)} style={{ marginTop: spacing.lg, alignSelf: 'center' }} hitSlop={8}>
            <AppText size="sm" color={colors.negative}>Delete this budget</AppText>
          </Pressable>
        )
      )}
    </Screen>
  );
}

const styles = {
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.hairlineStrong,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.card,
  },
  checkboxOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
};

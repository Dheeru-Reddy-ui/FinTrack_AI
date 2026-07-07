import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContributeGoal, useDeleteGoal, useGoals, useTransactions } from '@/data/api';
import { explainInsights } from '@/data/ai';
import { enrichGoal, useGoalMeta, type EnrichedGoal } from '@/data/goalMeta';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, IconCircle, Pill, ProgressBar, TextField } from '@/components/ui';
import { buildGoalPlan, goalProgressPct } from '@/ai/goals';
import { colors, radius, spacing } from '@/theme';
import { formatINR, formatDate } from '@/lib/format';
import { goBack } from '@/lib/nav';

const QUICK_ADDS = [500, 1000, 5000];

export default function Goals() {
  const router = useRouter();
  const goalsQ = useGoals();
  const txnsQ = useTransactions();
  const contribute = useContributeGoal();
  const deleteGoal = useDeleteGoal();
  const { metaFor, setMeta, removeMeta, reconcile, settings } = useGoalMeta();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customAmt, setCustomAmt] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const rawGoals = goalsQ.data ?? [];
  const txns = txnsQ.data ?? [];

  // Stamp completion + auto-archive whenever the DB goals change.
  useEffect(() => {
    if (rawGoals.length) reconcile(rawGoals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsQ.data, settings.autoArchiveCompleted]);

  const enriched = useMemo(
    () => rawGoals.map((g) => enrichGoal(g, metaFor(g.id), settings.autoArchiveCompleted)),
    [rawGoals, metaFor, settings.autoArchiveCompleted],
  );
  const active = enriched.filter((g) => !g.archived);
  const archived = enriched.filter((g) => g.archived);

  const addAmount = (g: EnrichedGoal, amount: number) => {
    contribute.mutate({ goal: g, amount });
  };

  const submitCustom = (g: EnrichedGoal) => {
    const n = parseFloat(customAmt);
    if (!n || n <= 0) return;
    addAmount(g, n);
    setCustomAmt('');
    setCustomFor(null);
  };

  const archive = (id: string) => { setMeta(id, { archived: true }); setExpanded(null); };
  const restore = (id: string) => setMeta(id, { archived: false, autoArchive: false });
  const removeForever = (id: string) => { deleteGoal.mutate(id); removeMeta(id); setConfirmingDelete(null); setExpanded(null); };

  const expand = async (g: EnrichedGoal) => {
    const open = expanded === g.id;
    setExpanded(open ? null : g.id);
    if (!open && !aiSummaries[g.id] && txns.length) {
      const plan = buildGoalPlan(g, txns);
      const digest = `Savings goal "${g.name}": target ₹${g.targetAmount}, saved ₹${g.currentAmount}, deadline ${g.deadline ?? 'none'}.
Plan: set aside ₹${plan.monthlyTarget}/month for ${plan.monthsLeft} months. Recent monthly surplus ≈ ₹${plan.surplus}. Feasible: ${plan.feasible ? 'yes' : 'no — tight'}.`;
      const ai = await explainInsights(digest);
      if (ai) setAiSummaries((s) => ({ ...s, [g.id]: ai }));
    }
  };

  if (goalsQ.isLoading || txnsQ.isLoading) {
    return <Screen><View style={{ paddingTop: 120, alignItems: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View></Screen>;
  }

  return (
    <Screen refreshing={goalsQ.isRefetching} onRefresh={() => goalsQ.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText size="xxl" weight="heavy">Goals</AppText>
          <AppText size="sm" color={colors.textMuted}>Savings plans grounded in your real surplus.</AppText>
        </View>
        <Pressable onPress={() => router.push('/goal-edit')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.md, height: 38, borderRadius: radius.pill }}>
          <Ionicons name="add" size={18} color="#fff" />
          <AppText size="sm" weight="bold" color="#fff">New</AppText>
        </Pressable>
      </View>

      <View style={{ gap: spacing.lg }}>
        {active.length === 0 && archived.length === 0 && (
          <Card><EmptyState icon="flag-outline" title="No goals yet" subtitle="Set a target — we'll build a monthly plan from your actual income and spending." /></Card>
        )}

        {active.map((g) => {
          const pct = goalProgressPct(g);
          const plan = buildGoalPlan(g, txns);
          const open = expanded === g.id;
          return (
            <Card key={g.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <IconCircle name={g.icon} bg={g.color + '22'} color={g.color} size={44} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <AppText size="md" weight="bold">{g.name}</AppText>
                  {g.deadline ? <AppText size="xs" color={colors.textMuted}>by {formatDate(g.deadline)}</AppText> : <AppText size="xs" color={colors.textFaint}>no deadline</AppText>}
                </View>
                {g.completed ? <Pill label="Reached 🎉" tone="lime" /> : <Pill label={plan.feasible ? 'On track' : 'Tight'} tone={plan.feasible ? 'up' : 'down'} />}
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: spacing.lg, marginBottom: 8 }}>
                <AppText size="xl" weight="heavy">{formatINR(g.currentAmount)}</AppText>
                <AppText size="sm" color={colors.textMuted}>of {formatINR(g.targetAmount)} · {Math.round(pct)}%</AppText>
              </View>
              <ProgressBar pct={pct} height={10} color={g.color} />

              {g.note ? <AppText size="xs" color={colors.textMuted} style={{ marginTop: spacing.sm, fontStyle: 'italic' }}>“{g.note}”</AppText> : null}

              {g.completed ? (
                <View style={{ marginTop: spacing.lg }}>
                  {settings.goalCelebration && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.positiveSoft, marginBottom: spacing.md }}>
                      <Ionicons name="trophy" size={18} color={colors.positive} />
                      <AppText size="sm" color={colors.positive} style={{ flex: 1 }}>You reached this goal — nicely done! Archive it to keep a record.</AppText>
                    </View>
                  )}
                  {confirmingDelete === g.id ? (
                    <DeleteConfirm onConfirm={() => removeForever(g.id)} onCancel={() => setConfirmingDelete(null)} />
                  ) : (
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button label="Archive & save" icon="archive-outline" onPress={() => archive(g.id)} style={{ flex: 1.6, height: 44 }} />
                      <Button label="Delete" variant="ghost" icon="trash-outline" onPress={() => setConfirmingDelete(g.id)} style={{ flex: 1, height: 44 }} />
                    </View>
                  )}
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    {QUICK_ADDS.map((amt) => (
                      <Button key={amt} label={`+${formatINR(amt, { compact: true })}`} variant="ghost" onPress={() => addAmount(g, amt)} loading={contribute.isPending && contribute.variables?.goal.id === g.id} style={{ flex: 1, height: 42 }} />
                    ))}
                    <Pressable onPress={() => { setCustomFor(customFor === g.id ? null : g.id); setCustomAmt(''); }} style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: customFor === g.id ? colors.brand : colors.cardMuted, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="create-outline" size={18} color={customFor === g.id ? '#fff' : colors.text} />
                    </Pressable>
                  </View>

                  {customFor === g.id && (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <TextField label="" value={customAmt} onChangeText={(v) => setCustomAmt(v.replace(/[^0-9.]/g, ''))} placeholder="Custom amount" prefix="₹" keyboardType="decimal-pad" autoFocus onSubmitEditing={() => submitCustom(g)} />
                      </View>
                      <Button label="Add" icon="add" onPress={() => submitCustom(g)} style={{ height: 50, paddingHorizontal: spacing.lg }} />
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button label="Edit" variant="ghost" icon="pencil" onPress={() => router.push({ pathname: '/goal-edit', params: { id: g.id } })} style={{ flex: 1, height: 42 }} />
                    <Button label={open ? 'Hide plan' : 'View AI plan'} icon={open ? 'chevron-up' : 'sparkles'} onPress={() => expand(g)} style={{ flex: 1.4, height: 42 }} />
                  </View>
                </>
              )}

              {open && !g.completed && (
                <View style={{ marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.hairline }}>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                    <Ionicons name="sparkles" size={15} color={colors.brand} />
                    <AppText size="sm" color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>
                      {aiSummaries[g.id] ?? plan.summary}
                    </AppText>
                  </View>
                  <View style={{ backgroundColor: colors.cardMuted, borderRadius: radius.md, padding: spacing.md }}>
                    {plan.steps.slice(0, 6).map((s, i) => (
                      <View key={s.month} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: g.color, alignItems: 'center', justifyContent: 'center' }}>
                          <AppText size="xs" weight="bold" color="#fff">{i + 1}</AppText>
                        </View>
                        <AppText size="sm" style={{ flex: 1, marginLeft: spacing.md }}>{s.note}</AppText>
                        <AppText size="sm" weight="bold">{formatINR(s.contribution)}</AppText>
                      </View>
                    ))}
                    {plan.steps.length > 6 && <AppText size="xs" color={colors.textFaint} style={{ marginTop: 6 }}>+{plan.steps.length - 6} more months…</AppText>}
                  </View>
                  {confirmingDelete === g.id ? (
                    <View style={{ marginTop: spacing.md }}><DeleteConfirm onConfirm={() => removeForever(g.id)} onCancel={() => setConfirmingDelete(null)} /></View>
                  ) : (
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, marginTop: spacing.md }}>
                      <Pressable onPress={() => archive(g.id)} hitSlop={8}><AppText size="xs" color={colors.textMuted}>Archive</AppText></Pressable>
                      <Pressable onPress={() => setConfirmingDelete(g.id)} hitSlop={8}><AppText size="xs" color={colors.negative}>Delete goal</AppText></Pressable>
                    </View>
                  )}
                </View>
              )}
            </Card>
          );
        })}

        {/* Archived */}
        {archived.length > 0 && (
          <View>
            <Pressable onPress={() => setShowArchived((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm }}>
              <Ionicons name={showArchived ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
              <AppText size="sm" weight="semibold" color={colors.textMuted}>Archived ({archived.length})</AppText>
            </Pressable>
            {showArchived && (
              <View style={{ gap: spacing.md }}>
                {archived.map((g) => (
                  <Card key={g.id} style={{ opacity: 0.92 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <IconCircle name={g.icon} bg={g.color + '22'} color={g.color} size={38} iconSize={18} />
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <AppText size="sm" weight="bold">{g.name}</AppText>
                        <AppText size="xs" color={colors.textMuted}>{g.completed ? 'Completed' : 'Archived'} · {formatINR(g.currentAmount, { compact: true })} of {formatINR(g.targetAmount, { compact: true })}</AppText>
                      </View>
                      {g.completed ? <Ionicons name="checkmark-circle" size={20} color={colors.positive} /> : null}
                    </View>
                    {confirmingDelete === g.id ? (
                      <View style={{ marginTop: spacing.md }}><DeleteConfirm onConfirm={() => removeForever(g.id)} onCancel={() => setConfirmingDelete(null)} /></View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                        <Button label="Restore" variant="ghost" icon="arrow-undo-outline" onPress={() => restore(g.id)} style={{ flex: 1, height: 40 }} />
                        <Button label="Delete" variant="ghost" icon="trash-outline" onPress={() => setConfirmingDelete(g.id)} style={{ flex: 1, height: 40 }} />
                      </View>
                    )}
                  </Card>
                ))}
              </View>
            )}
          </View>
        )}

        <Button label="Add a goal" variant="dark" icon="add" onPress={() => router.push('/goal-edit')} />
      </View>
    </Screen>
  );
}

function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <View>
      <AppText size="xs" color={colors.textMuted} style={{ textAlign: 'center', marginBottom: spacing.sm }}>Delete this goal permanently? This can't be undone.</AppText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Delete forever" variant="ghost" icon="trash" onPress={onConfirm} style={{ flex: 1.4, height: 42 }} />
        <Button label="Keep" onPress={onCancel} style={{ flex: 1, height: 42 }} />
      </View>
    </View>
  );
}

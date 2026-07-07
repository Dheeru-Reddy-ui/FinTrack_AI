import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, IconCircle, Pill, ProgressBar, TextField } from '@/components/ui';
import type { Goal } from '@/data/types';
import { buildGoalPlan, goalProgressPct } from '@/ai/goals';
import { colors, radius, spacing } from '@/theme';
import { formatINR, formatDate } from '@/lib/format';

export default function Goals() {
  const app = useApp();
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');

  const addGoal = () => {
    const t = parseFloat(target);
    if (!name.trim() || !t) return;
    const g = app.addGoal({ name: name.trim(), targetAmount: t, deadline: deadline || null });
    setAdding(false); setName(''); setTarget(''); setDeadline('');
    setExpanded(g.id);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText size="xxl" weight="heavy">Goals</AppText>
          <AppText size="sm" color={colors.textMuted}>AI savings plans grounded in your spending.</AppText>
        </View>
      </View>

      <View style={{ gap: spacing.lg }}>
        {app.goals.map((g) => {
          const pct = goalProgressPct(g);
          const plan = buildGoalPlan(g, app.transactions);
          const open = expanded === g.id;
          return (
            <Card key={g.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <IconCircle name="flag" bg={colors.brandSoft} color={colors.brand} size={44} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <AppText size="md" weight="bold">{g.name}</AppText>
                  {g.deadline ? <AppText size="xs" color={colors.textMuted}>by {formatDate(g.deadline)}</AppText> : null}
                </View>
                <Pill label={plan.feasible ? 'On track' : 'Tight'} tone={plan.feasible ? 'up' : 'down'} />
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: spacing.lg, marginBottom: 8 }}>
                <AppText size="xl" weight="heavy">{formatINR(g.currentAmount)}</AppText>
                <AppText size="sm" color={colors.textMuted}>of {formatINR(g.targetAmount)} · {Math.round(pct)}%</AppText>
              </View>
              <ProgressBar pct={pct} height={10} />

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <Button label="+ ₹1,000" variant="ghost" onPress={() => app.contributeToGoal(g.id, 1000)} style={{ flex: 1, height: 44 }} />
                <Button label={open ? 'Hide plan' : 'View AI plan'} icon={open ? 'chevron-up' : 'sparkles'} onPress={() => setExpanded(open ? null : g.id)} style={{ flex: 1.4, height: 44 }} />
              </View>

              {open && (
                <View style={{ marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.hairline }}>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                    <Ionicons name="sparkles" size={15} color={colors.brand} />
                    <AppText size="sm" color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>{plan.summary}</AppText>
                  </View>
                  <View style={{ backgroundColor: colors.cardMuted, borderRadius: radius.md, padding: spacing.md }}>
                    {plan.steps.slice(0, 6).map((s, i) => (
                      <View key={s.month} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                          <AppText size="xs" weight="bold" color="#fff">{i + 1}</AppText>
                        </View>
                        <AppText size="sm" style={{ flex: 1, marginLeft: spacing.md }}>{s.note}</AppText>
                        <AppText size="sm" weight="bold">{formatINR(s.contribution)}</AppText>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </Card>
          );
        })}

        {/* Add goal */}
        {adding ? (
          <Card>
            <AppText size="md" weight="bold" style={{ marginBottom: spacing.md }}>New goal</AppText>
            <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Japan Trip" icon="flag-outline" />
            <TextField label="Target amount" value={target} onChangeText={(v) => setTarget(v.replace(/[^0-9.]/g, ''))} placeholder="50000" prefix="₹" keyboardType="decimal-pad" />
            <TextField label="Deadline (optional)" value={deadline} onChangeText={setDeadline} placeholder="2026-12-31" icon="calendar-outline" />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Cancel" variant="ghost" onPress={() => setAdding(false)} style={{ flex: 1 }} />
              <Button label="Create goal" icon="checkmark" onPress={addGoal} style={{ flex: 2 }} disabled={!name.trim() || !parseFloat(target)} />
            </View>
          </Card>
        ) : (
          <Button label="Add a goal" variant="dark" icon="add" onPress={() => setAdding(true)} />
        )}
      </View>
    </Screen>
  );
}

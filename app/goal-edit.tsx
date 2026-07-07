import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAddGoal, useGoals, useUpdateGoal } from '@/data/api';
import { GOAL_COLORS, GOAL_ICONS, GOAL_PRESETS, enrichGoal, useGoalMeta, type EnrichedGoal } from '@/data/goalMeta';
import { AppText, Button, TextField, Toggle } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { formatDate, localISO } from '@/lib/format';
import { goBack } from '@/lib/nav';

type IconName = typeof GOAL_ICONS[number];
const onlyNum = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

function addMonths(months: number): string {
  const d = new Date();
  return localISO(new Date(d.getFullYear(), d.getMonth() + months, d.getDate()));
}

/** Resolves edit data (or create defaults) before mounting the stateful form,
 *  so `useState` initializers always see the right values — even on a cold cache. */
export default function GoalEdit() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = typeof params.id === 'string' ? params.id : undefined;
  const goalsQ = useGoals();
  const { metaFor, settings } = useGoalMeta();

  const existing = useMemo<EnrichedGoal | null>(() => {
    if (!editId) return null;
    const g = (goalsQ.data ?? []).find((x) => x.id === editId);
    return g ? enrichGoal(g, metaFor(g.id), settings.autoArchiveCompleted) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, goalsQ.data]);

  if (editId && !existing) {
    // Either still loading, or the goal was deleted elsewhere.
    return (
      <View style={{ flex: 1, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
        {goalsQ.isLoading ? (
          <ActivityIndicator color={colors.brand} size="large" />
        ) : (
          <View style={{ alignItems: 'center', padding: spacing.xl }}>
            <AppText size="md" weight="bold">Goal not found</AppText>
            <Button label="Back to goals" onPress={() => goBack('/goals')} style={{ marginTop: spacing.md }} />
          </View>
        )}
      </View>
    );
  }

  return <GoalForm editId={editId} existing={existing} defaultAutoArchive={settings.autoArchiveCompleted} />;
}

function GoalForm({ editId, existing, defaultAutoArchive }: { editId?: string; existing: EnrichedGoal | null; defaultAutoArchive: boolean }) {
  const addGoal = useAddGoal();
  const updateGoal = useUpdateGoal();
  const { setMeta } = useGoalMeta();

  const [name, setName] = useState(existing?.name ?? '');
  const [target, setTarget] = useState(existing ? String(existing.targetAmount) : '');
  const [saved, setSaved] = useState(existing && existing.currentAmount ? String(existing.currentAmount) : '');
  const [deadline, setDeadline] = useState<string | null>(existing?.deadline ?? null);
  const [color, setColor] = useState<string>(existing?.color ?? GOAL_COLORS[0]);
  const [icon, setIcon] = useState<IconName>(existing?.icon ?? 'flag');
  const [note, setNote] = useState(existing?.note ?? '');
  const [autoArchive, setAutoArchive] = useState<boolean>(existing?.autoArchive ?? defaultAutoArchive);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false); // synchronous double-submit guard

  const showPresets = !editId && !name.trim();

  const applyPreset = (p: typeof GOAL_PRESETS[number]) => {
    setName(p.name);
    setIcon(p.icon);
    setColor(p.color);
    setError(null);
  };

  const save = async () => {
    if (savingRef.current) return;
    setError(null);
    const t = parseFloat(target);
    const s = saved ? parseFloat(saved) : 0;
    if (!name.trim()) return setError('Give your goal a name.');
    if (!t || t <= 0) return setError('Enter a target amount greater than 0.');
    if (s < 0) return setError("Saved amount can't be negative.");
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return setError('Desired date must be a valid date.');

    savingRef.current = true;
    try {
      let id = editId;
      if (editId) {
        await updateGoal.mutateAsync({ id: editId, patch: { name: name.trim(), targetAmount: t, currentAmount: s, deadline } });
      } else {
        id = await addGoal.mutateAsync({ name: name.trim(), targetAmount: t, currentAmount: s, deadline });
      }
      if (id) setMeta(id, { color, icon, note: note.trim(), autoArchive });
      goBack('/goals');
    } catch (e: any) {
      savingRef.current = false;
      setError(e?.message ?? 'Could not save the goal.');
    }
  };

  const busy = addGoal.isPending || updateGoal.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: colors.card }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.brand }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, height: 56 }}>
          <Pressable onPress={() => goBack('/goals')} hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <AppText size="xl" weight="bold" color="#fff" style={{ flex: 1, marginLeft: spacing.md }}>
            {editId ? 'Edit goal' : 'New goal'}
          </AppText>
          <Pressable onPress={save} hitSlop={12} style={{ padding: 4 }} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={26} color="#fff" />}
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }} keyboardShouldPersistTaps="handled">
        <AppText size="xl" weight="heavy" style={{ marginBottom: spacing.lg }}>What are you saving for?</AppText>

        <TextField label="Name" value={name} onChangeText={setName} placeholder="Your goal's name" autoFocus={!editId} />

        {showPresets ? (
          <View style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
            <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: spacing.md }}>Some things people save for</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {GOAL_PRESETS.map((p) => (
                <Pressable key={p.name} onPress={() => applyPreset(p)} style={{ width: '48%', flexDirection: 'row', alignItems: 'center', padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.cardMuted }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.color, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={p.icon} size={20} color="#fff" />
                  </View>
                  <AppText size="sm" weight="semibold" style={{ flex: 1, marginLeft: spacing.sm }} numberOfLines={1}>{p.name}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <>
            <TextField label="Target amount" value={target} onChangeText={(v) => setTarget(onlyNum(v))} placeholder="50000" prefix="₹" keyboardType="decimal-pad" />
            <TextField label="Saved already" value={saved} onChangeText={(v) => setSaved(onlyNum(v))} placeholder="0" prefix="₹" keyboardType="decimal-pad" />

            <DateField value={deadline} onChange={setDeadline} />

            <ColorPicker value={color} onChange={setColor} />
            <IconPicker value={icon} color={color} onChange={setIcon} />

            <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Why this matters…" multiline icon="document-text-outline" />

            <Pressable onPress={() => setAutoArchive((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs }}>
              <View style={{ flex: 1, marginRight: spacing.md }}>
                <AppText size="sm" weight="semibold">Auto-archive when complete</AppText>
                <AppText size="xs" color={colors.textMuted} style={{ marginTop: 1 }}>Move it to Archived automatically once you hit the target.</AppText>
              </View>
              <Toggle value={autoArchive} onValueChange={setAutoArchive} />
            </Pressable>
          </>
        )}

        {error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.negativeSoft }}>
            <Ionicons name="alert-circle" size={16} color={colors.negative} />
            <AppText size="sm" color={colors.negative} style={{ flex: 1 }}>{error}</AppText>
          </View>
        ) : null}

        {!showPresets ? (
          <Button label={editId ? 'Save changes' : 'Create goal'} icon="checkmark" onPress={save} loading={busy} style={{ marginTop: spacing.lg }} />
        ) : (
          <AppText size="xs" color={colors.textFaint} style={{ textAlign: 'center', marginTop: spacing.md }}>
            Pick one above, or type a name to set your own target.
          </AppText>
        )}
      </ScrollView>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: 8 }}>{children}</AppText>;
}

function DateField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const presets: { label: string; months: number }[] = [
    { label: '3 months', months: 3 },
    { label: '6 months', months: 6 },
    { label: '1 year', months: 12 },
    { label: '2 years', months: 24 },
  ];
  return (
    <View style={{ marginBottom: spacing.md }}>
      <FieldLabel>Desired date</FieldLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, minHeight: 50, borderWidth: 1, borderColor: colors.hairline }}>
        <Ionicons name="calendar-outline" size={18} color={colors.textFaint} style={{ marginRight: 8 }} />
        <AppText size="md" color={value ? colors.text : colors.textFaint} style={{ flex: 1 }}>
          {value ? formatDate(value) : 'No date set'}
        </AppText>
        {value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textFaint} /></Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
        {presets.map((p) => {
          const iso = addMonths(p.months);
          const active = value === iso;
          return (
            <Pressable key={p.label} onPress={() => onChange(iso)} style={{ paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: active ? colors.brand : colors.cardMuted, borderWidth: 1, borderColor: active ? colors.brand : colors.hairline }}>
              <AppText size="xs" weight="semibold" color={active ? '#fff' : colors.textMuted}>{p.label}</AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <FieldLabel>Goal color</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {GOAL_COLORS.map((c) => {
          const active = value === c;
          return (
            <Pressable key={c} onPress={() => onChange(c)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, alignItems: 'center', justifyContent: 'center', borderWidth: active ? 3 : 0, borderColor: '#fff', ...(active ? { transform: [{ scale: 1.12 }] } : null) }}>
              {active ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (i: IconName) => void }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <FieldLabel>Icon</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {GOAL_ICONS.map((i) => {
          const active = value === i;
          return (
            <Pressable key={i} onPress={() => onChange(i)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? color : colors.cardMuted, borderWidth: 1, borderColor: active ? color : colors.hairline }}>
              <Ionicons name={i} size={20} color={active ? '#fff' : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, IconCircle, Pill, TextField } from '@/components/ui';
import { colors, colorForCategory, radius, spacing } from '@/theme';
import { todayISO, relativeDay } from '@/lib/format';
import { parseNaturalLanguage, parseImage } from '@/ai/parse';
import { parseCSV } from '@/lib/csv';
import { DEMO_MODE } from '@/data/config';
import { hasLLMConfigured } from '@/ai/llm';

type Mode = 'nl' | 'manual' | 'scan' | 'csv';

interface Form {
  amount: string;
  type: 'expense' | 'income';
  category: string;
  merchant: string;
  txnDate: string;
  source: 'manual' | 'nl' | 'receipt' | 'upi' | 'csv';
  confidence: number | null;
  needsReview: boolean;
}

const emptyForm = (source: Form['source']): Form => ({
  amount: '', type: 'expense', category: 'Food & Dining', merchant: '', txnDate: todayISO(), source, confidence: null, needsReview: false,
});

export default function AddScreen() {
  const app = useApp();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>((params.mode as Mode) || 'nl');
  const [nlText, setNlText] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const [csvText, setCsvText] = useState('');
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseCSV>>([]);

  const modes: { key: Mode; label: string; icon: any }[] = [
    { key: 'nl', label: 'Type it', icon: 'chatbubble-ellipses' },
    { key: 'manual', label: 'Manual', icon: 'create' },
    { key: 'scan', label: 'Scan', icon: 'scan' },
    { key: 'csv', label: 'Import', icon: 'document-text' },
  ];

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const runNL = async () => {
    if (!nlText.trim()) return;
    setBusy(true);
    try {
      const parsed = await parseNaturalLanguage(nlText.trim(), app.categoryNames);
      setForm({
        amount: parsed.amount ? String(parsed.amount) : '',
        type: parsed.type,
        category: parsed.category,
        merchant: parsed.merchant ?? '',
        txnDate: parsed.txnDate,
        source: 'nl',
        confidence: parsed.confidence,
        needsReview: parsed.needsReview,
      });
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async (kind: 'upi' | 'receipt') => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.6 });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    setImageUri(asset.uri);
    setBusy(true);
    try {
      let parsed = null;
      if (asset.base64) parsed = await parseImage(asset.base64, asset.mimeType ?? 'image/jpeg', kind, app.categoryNames);
      if (parsed) {
        setForm({ amount: String(parsed.amount), type: parsed.type, category: parsed.category, merchant: parsed.merchant ?? '', txnDate: parsed.txnDate, source: kind, confidence: parsed.confidence, needsReview: parsed.needsReview });
      } else {
        // Demo mode / no vision key: prefill a confirm form for manual entry
        setForm({ ...emptyForm(kind), needsReview: true });
      }
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!form) return;
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return;
    app.addTransaction({
      amount,
      type: form.type,
      category: form.category,
      merchant: form.merchant || null,
      txnDate: form.txnDate,
      source: form.source,
      rawText: mode === 'nl' ? nlText : null,
      confidence: form.confidence,
      needsReview: form.needsReview,
    });
    setSaved((s) => s + 1);
    setForm(null);
    setNlText('');
    setImageUri(null);
  };

  const importCSV = () => {
    const rows = csvText.trim() ? parseCSV(csvText) : [];
    setCsvRows(rows);
  };
  const confirmImport = () => {
    let n = 0;
    for (const r of csvRows) {
      app.addTransaction({ amount: r.amount, type: r.type, category: r.category, merchant: r.merchant, txnDate: r.txnDate, source: 'csv', confidence: r.confidence, needsReview: r.confidence < 0.75 });
      n++;
    }
    setSaved((s) => s + n);
    setCsvRows([]);
    setCsvText('');
  };

  return (
    <Screen>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <AppText size="xxl" weight="heavy">Add spending</AppText>
        <AppText size="sm" color={colors.textMuted}>Type it, snap a UPI screenshot, or import a statement — we do the rest.</AppText>
      </View>

      {/* Mode selector */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        {modes.map((m) => {
          const active = mode === m.key;
          return (
            <Pressable key={m.key} onPress={() => { setMode(m.key); setForm(m.key === 'manual' ? emptyForm('manual') : null); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: active ? colors.ink : colors.card, borderWidth: 1, borderColor: active ? colors.ink : colors.hairline }}>
              <Ionicons name={m.icon} size={15} color={active ? '#fff' : colors.textMuted} />
              <AppText size="sm" weight="semibold" color={active ? '#fff' : colors.text}>{m.label}</AppText>
            </Pressable>
          );
        })}
      </View>

      {saved > 0 && (
        <Pressable onPress={() => router.push('/transactions')}>
          <Card padded style={{ padding: spacing.md, backgroundColor: colors.positiveSoft, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.lg }}>
            <Ionicons name="checkmark-circle" size={20} color={colors.positive} />
            <AppText size="sm" weight="semibold" color={colors.positive} style={{ flex: 1 }}>Added {saved} transaction{saved > 1 ? 's' : ''}. Tap to view ledger.</AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.positive} />
          </Card>
        </Pressable>
      )}

      {/* Natural language */}
      {mode === 'nl' && (
        <Card>
          <AppText size="md" weight="bold" style={{ marginBottom: spacing.sm }}>Describe your expense</AppText>
          <TextField value={nlText} onChangeText={setNlText} placeholder='e.g. "spent 300 on groceries at DMart yesterday"' multiline icon="chatbubble-ellipses-outline" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
            {['coffee at Starbucks 240', 'Uber ride 180 today', 'got salary 85000'].map((ex) => (
              <Pressable key={ex} onPress={() => setNlText(ex)} style={styles.exChip}>
                <AppText size="xs" color={colors.textMuted}>{ex}</AppText>
              </Pressable>
            ))}
          </View>
          <Button label={hasLLMConfigured() ? 'Parse with AI' : 'Parse'} icon="sparkles" onPress={runNL} loading={busy} disabled={!nlText.trim()} />
          {!hasLLMConfigured() && <AppText size="xs" color={colors.textFaint} style={{ marginTop: spacing.sm, textAlign: 'center' }}>Using on-device parsing. Add a Groq/Gemini key for full accuracy.</AppText>}
        </Card>
      )}

      {/* Scan */}
      {mode === 'scan' && (
        <Card>
          <AppText size="md" weight="bold">Scan a payment or receipt</AppText>
          <AppText size="sm" color={colors.textMuted} style={{ marginTop: 4, marginBottom: spacing.lg }}>Upload a PhonePe / Paytm / GPay screenshot or a shop receipt.</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <ScanTile icon="phone-portrait" label="UPI screenshot" onPress={() => pickImage('upi')} color={colors.info} />
            <ScanTile icon="receipt" label="Receipt photo" onPress={() => pickImage('receipt')} color={colors.brand} />
          </View>
          {imageUri && <Image source={{ uri: imageUri }} style={{ width: '100%', height: 180, borderRadius: radius.md, marginTop: spacing.lg, resizeMode: 'contain', backgroundColor: colors.cardMuted }} />}
          {busy && <AppText size="sm" color={colors.textMuted} style={{ marginTop: spacing.md, textAlign: 'center' }}>Reading image…</AppText>}
          {DEMO_MODE && !hasLLMConfigured() && <AppText size="xs" color={colors.textFaint} style={{ marginTop: spacing.md, textAlign: 'center' }}>Demo mode: image is attached; confirm the details below. Add a vision API key to auto-extract.</AppText>}
        </Card>
      )}

      {/* CSV import */}
      {mode === 'csv' && (
        <Card>
          <AppText size="md" weight="bold">Import bank statement (CSV)</AppText>
          <AppText size="sm" color={colors.textMuted} style={{ marginTop: 4, marginBottom: spacing.md }}>Paste rows with Date, Description, Amount columns (debits negative or a Debit column).</AppText>
          <TextField value={csvText} onChangeText={setCsvText} placeholder={'Date,Description,Amount\n2026-06-28,Swiggy,-420\n2026-06-27,Salary,85000'} multiline />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Load sample" variant="ghost" onPress={() => setCsvText(SAMPLE_CSV)} style={{ flex: 1 }} />
            <Button label="Preview" icon="eye-outline" onPress={importCSV} style={{ flex: 1 }} disabled={!csvText.trim()} />
          </View>
          {csvRows.length > 0 && (
            <View style={{ marginTop: spacing.lg }}>
              <AppText size="sm" weight="semibold" style={{ marginBottom: spacing.sm }}>{csvRows.length} rows detected</AppText>
              {csvRows.slice(0, 6).map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                  <AppText size="xs" color={colors.textMuted} style={{ width: 90 }}>{relativeDay(r.txnDate)}</AppText>
                  <AppText size="sm" style={{ flex: 1 }} numberOfLines={1}>{r.merchant}</AppText>
                  <Pill label={r.category} tone="neutral" />
                  <AppText size="sm" weight="semibold" color={r.type === 'income' ? colors.positive : colors.text} style={{ marginLeft: spacing.md }}>{r.type === 'income' ? '+' : '-'}₹{r.amount}</AppText>
                </View>
              ))}
              {csvRows.length > 6 && <AppText size="xs" color={colors.textFaint} style={{ marginTop: 4 }}>+{csvRows.length - 6} more…</AppText>}
              <Button label={`Import ${csvRows.length} transactions`} icon="cloud-upload-outline" onPress={confirmImport} style={{ marginTop: spacing.md }} />
            </View>
          )}
        </Card>
      )}

      {/* Review & save form (manual, or after nl/scan parse) */}
      {form && (
        <Card style={{ marginTop: mode === 'manual' ? 0 : spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }}>
            <AppText size="md" weight="bold">{mode === 'manual' ? 'New transaction' : 'Review & save'}</AppText>
            {form.needsReview && <Pill label="Low confidence — check" tone="down" icon="alert-circle" />}
            {form.confidence != null && !form.needsReview && <Pill label={`${Math.round(form.confidence * 100)}% confident`} tone="up" icon="checkmark-circle" />}
          </View>

          {/* Type toggle */}
          <View style={{ flexDirection: 'row', backgroundColor: colors.cardMuted, borderRadius: radius.md, padding: 3, marginBottom: spacing.md }}>
            {(['expense', 'income'] as const).map((t) => (
              <Pressable key={t} onPress={() => set({ type: t, category: t === 'income' ? 'Income' : form.category })} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: form.type === t ? colors.card : 'transparent', alignItems: 'center' }}>
                <AppText size="sm" weight="semibold" color={form.type === t ? (t === 'income' ? colors.positive : colors.negative) : colors.textMuted}>{t === 'expense' ? 'Expense' : 'Income'}</AppText>
              </Pressable>
            ))}
          </View>

          <TextField label="Amount" value={form.amount} onChangeText={(v) => set({ amount: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" prefix="₹" placeholder="0" autoFocus={mode === 'manual'} />
          <TextField label="Merchant" value={form.merchant} onChangeText={(v) => set({ merchant: v })} placeholder="e.g. Swiggy" icon="storefront-outline" />

          <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: 6 }}>Category</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
            {app.categoryNames.map((c) => {
              const active = form.category === c;
              return (
                <Pressable key={c} onPress={() => set({ category: c })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? colorForCategory(c) + '1A' : colors.cardMuted, borderWidth: 1, borderColor: active ? colorForCategory(c) : 'transparent' }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colorForCategory(c) }} />
                  <AppText size="xs" weight={active ? 'bold' : 'medium'} color={active ? colors.text : colors.textMuted}>{c}</AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: 6 }}>Date</AppText>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
            {[{ l: 'Today', v: todayISO() }, { l: 'Yesterday', v: dayShift(1) }, { l: '2 days ago', v: dayShift(2) }].map((d) => (
              <Pressable key={d.l} onPress={() => set({ txnDate: d.v })} style={[styles.exChip, form.txnDate === d.v && { backgroundColor: colors.ink }]}>
                <AppText size="xs" color={form.txnDate === d.v ? '#fff' : colors.textMuted}>{d.l}</AppText>
              </Pressable>
            ))}
          </View>
          <TextField value={form.txnDate} onChangeText={(v) => set({ txnDate: v })} placeholder="YYYY-MM-DD" icon="calendar-outline" />

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Cancel" variant="ghost" onPress={() => setForm(null)} style={{ flex: 1 }} />
            <Button label="Save" icon="checkmark" onPress={save} style={{ flex: 2 }} disabled={!parseFloat(form.amount)} />
          </View>
        </Card>
      )}
    </Screen>
  );
}

function ScanTile({ icon, label, onPress, color }: { icon: any; label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 10, paddingVertical: spacing.xl, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.hairlineStrong, borderStyle: 'dashed', backgroundColor: colors.cardMuted }}>
      <IconCircle name={icon} bg={color + '18'} color={color} size={48} />
      <AppText size="sm" weight="semibold">{label}</AppText>
    </Pressable>
  );
}

function dayShift(d: number): string {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x.toISOString().slice(0, 10);
}

const SAMPLE_CSV = `Date,Description,Amount
2026-06-29,Swiggy Order,-486
2026-06-28,BigBasket Groceries,-1240
2026-06-27,Uber Ride,-210
2026-06-25,Amazon Shopping,-2399
2026-06-24,Salary Credit,85000
2026-06-22,Airtel Postpaid,-799`;

const styles = {
  exChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.cardMuted },
};

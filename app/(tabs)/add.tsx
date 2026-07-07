import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useAccounts, useAddTransaction, useAddTransactionsBulk, useCategories } from '@/data/api';
import { categorizeBatch, parseImage, parseNL } from '@/data/ai';
import { getSupabase } from '@/data/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, IconCircle, Pill, TextField } from '@/components/ui';
import { colors, colorForCategory, radius, spacing } from '@/theme';
import { todayISO, localISO, relativeDay, formatINR } from '@/lib/format';
import { parseNLHeuristic, categorizeHeuristic } from '@/ai/parse';
import { parseCSV, type CSVRow } from '@/lib/csv';
import type { TxnSource } from '@/data/types';

type Mode = 'nl' | 'manual' | 'scan' | 'csv';

interface Form {
  amount: string;
  type: 'expense' | 'income';
  category: string;
  merchant: string;
  txnDate: string;
  source: TxnSource;
  confidence: number | null;
  needsReview: boolean;
  aiParsed: boolean;
}

const emptyForm = (source: TxnSource): Form => ({
  amount: '', type: 'expense', category: 'Food & Dining', merchant: '', txnDate: todayISO(),
  source, confidence: null, needsReview: false, aiParsed: false,
});

export default function AddScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const categoriesQ = useCategories();
  const accountsQ = useAccounts();
  const addTxn = useAddTransaction();
  const addBulk = useAddTransactionsBulk();

  const [mode, setMode] = useState<Mode>('manual');
  const [form, setForm] = useState<Form | null>(emptyForm('manual'));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  // NL state
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  // Scan state
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // CSV state
  const [csvText, setCsvText] = useState('');
  const [csvRows, setCsvRows] = useState<CSVRow[]>([]);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvAI, setCsvAI] = useState(false);

  const categories = categoriesQ.data ?? [];
  const catNames = categories.map((c) => c.name);
  const topCats = categories.filter((c) => !c.parentId);
  const catId = (name: string) => categories.find((c) => c.name === name)?.id ?? null;
  const byName = (name?: string | null) => categories.find((c) => c.name === name);
  /** Top-level name for any category name (itself when already top-level). */
  const topOf = (name: string): string => {
    const c = byName(name);
    if (!c?.parentId) return name;
    return categories.find((p) => p.id === c.parentId)?.name ?? name;
  };
  const subsOf = (topName: string) => {
    const top = byName(topName);
    return top ? categories.filter((c) => c.parentId === top.id) : [];
  };
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  useEffect(() => {
    // keep the default form category valid once categories load
    if (form && !catNames.includes(form.category) && catNames.length) set({ category: catNames.includes('Food & Dining') ? 'Food & Dining' : catNames[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setForm(m === 'manual' ? emptyForm('manual') : null);
    setImageUri(null); setImageB64(null); setScanNote(null); setUsedFallback(false);
  };

  // ---- NL ----
  const runNL = async () => {
    if (!nlText.trim()) return;
    setNlBusy(true); setError(null); setUsedFallback(false);
    try {
      const ai = await parseNL(nlText.trim());
      const p = ai ?? (() => {
        const h = parseNLHeuristic(nlText.trim());
        return { amount: h.amount, merchant: h.merchant, category: h.category, txn_date: h.txnDate, type: h.type, confidence: h.confidence };
      })();
      if (!ai) setUsedFallback(true);
      setForm({
        amount: p.amount ? String(p.amount) : '',
        type: p.type,
        category: catNames.includes(p.category) ? p.category : 'Others',
        merchant: p.merchant ?? '',
        txnDate: p.txn_date,
        source: 'nl',
        confidence: p.confidence,
        needsReview: p.confidence < 0.7,
        aiParsed: !!ai,
      });
    } finally {
      setNlBusy(false);
    }
  };

  // ---- Scan ----
  const pickImage = async (kind: 'upi' | 'receipt', fromCamera = false) => {
    setError(null); setScanNote(null);
    let res: ImagePicker.ImagePickerResult;
    try {
      if (fromCamera) {
        // Runtime permission with a clear, non-crashing denial path (Android/iOS).
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError('Camera permission was denied. Allow it in your device settings, or upload from your gallery instead.');
          return;
        }
        res = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.6 });
      }
    } catch {
      setError(fromCamera
        ? 'Could not open the camera. Check app permissions and try again.'
        : 'Could not open your photo library. Check app permissions and try again.');
      return;
    }
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    setImageUri(asset.uri);
    setImageB64(asset.base64 ?? null);
    setImageMime(asset.mimeType ?? 'image/jpeg');
    setScanBusy(true);
    try {
      const parsed = asset.base64 ? await parseImage(kind, asset.base64, asset.mimeType ?? 'image/jpeg') : null;
      if (parsed) {
        setForm({
          amount: String(parsed.amount),
          type: parsed.type,
          category: catNames.includes(parsed.category) ? parsed.category : 'Others',
          merchant: parsed.merchant ?? '',
          txnDate: parsed.txn_date,
          source: kind,
          confidence: parsed.confidence,
          needsReview: parsed.confidence < 0.7,
          aiParsed: true,
        });
        setScanNote(null);
      } else {
        setForm({ ...emptyForm(kind), needsReview: true });
        setScanNote('AI could not read this image right now — fill in the details below and save.');
      }
    } finally {
      setScanBusy(false);
    }
  };

  /** Best-effort upload of the scanned image to the private receipts bucket. */
  const uploadReceipt = async (): Promise<string | null> => {
    try {
      const supabase = getSupabase();
      if (!supabase || !imageB64 || !user) return null;
      const bin = atob(imageB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = imageMime.includes('png') ? 'png' : 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('receipts').upload(path, bytes.buffer, { contentType: imageMime });
      return error ? null : path;
    } catch {
      return null;
    }
  };

  // ---- CSV ----
  const previewCSV = () => {
    setError(null);
    const rows = csvText.trim() ? parseCSV(csvText) : [];
    if (!rows.length) setError('No valid rows found. Expect columns like Date, Description, Amount (or Debit/Credit).');
    setCsvRows(rows);
    setCsvAI(false);
  };

  const upgradeCSVCategories = async () => {
    setCsvBusy(true);
    try {
      const ai = await categorizeBatch(csvRows.map((r) => ({ merchant: r.merchant })));
      if (ai) {
        setCsvRows((rows) => rows.map((r, i) => (r.type === 'income' ? r : { ...r, category: ai[i]?.category ?? r.category, confidence: ai[i]?.confidence ?? r.confidence })));
        setCsvAI(true);
      } else {
        setError('AI categorization is busy right now — keeping the on-device categories.');
      }
    } finally {
      setCsvBusy(false);
    }
  };

  const importCSV = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setError(null);
    try {
      const n = await addBulk.mutateAsync(csvRows.map((r) => ({
        amount: r.amount,
        type: r.type,
        categoryId: catId(r.type === 'income' ? 'Income' : r.category) ?? catId('Others'),
        merchant: r.merchant,
        txnDate: r.txnDate,
        source: 'csv' as const,
        confidence: r.confidence,
        needsReview: r.confidence < 0.75,
        accountId: accountsQ.data?.[0]?.id ?? null,
      })));
      setSaved((s) => s + n);
      setCsvRows([]);
      setCsvText('');
    } catch (e: any) {
      setError(e?.message ?? 'Import failed — please try again.');
    } finally {
      savingRef.current = false;
    }
  };

  // ---- shared save ----
  // Synchronous re-entry guard: React state (isPending) updates async, so a
  // rapid double-tap could double-save without this.
  const savingRef = useRef(false);
  const save = async () => {
    if (!form || savingRef.current) return;
    setError(null);
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return setError('Enter an amount greater than 0.');
    const cid = catId(form.type === 'income' ? 'Income' : form.category);
    if (!cid) return setError('Pick a category.');
    savingRef.current = true;
    try {
      if ((form.source === 'receipt' || form.source === 'upi') && imageB64) await uploadReceipt();
      await addTxn.mutateAsync({
        amount: amt,
        type: form.type,
        categoryId: cid,
        merchant: form.merchant.trim() || null,
        txnDate: /^\d{4}-\d{2}-\d{2}$/.test(form.txnDate) ? form.txnDate : todayISO(),
        source: form.source,
        rawText: form.source === 'nl' ? nlText.trim() : null,
        confidence: form.confidence,
        needsReview: form.needsReview,
        accountId: accountsQ.data?.[0]?.id ?? null,
      });
      setSaved((s) => s + 1);
      setForm(mode === 'manual' ? emptyForm('manual') : null);
      setNlText(''); setImageUri(null); setImageB64(null); setUsedFallback(false); setScanNote(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save — please try again.');
    } finally {
      savingRef.current = false;
    }
  };

  if (categoriesQ.isLoading) {
    return <Screen><View style={{ paddingTop: 120, alignItems: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View></Screen>;
  }

  const modes: { key: Mode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'manual', label: 'Manual', icon: 'create' },
    { key: 'nl', label: 'Type it', icon: 'chatbubble-ellipses' },
    { key: 'scan', label: 'Scan', icon: 'scan' },
    { key: 'csv', label: 'Import', icon: 'document-text' },
  ];

  return (
    <Screen>
      <View style={{ paddingTop: spacing.md, marginBottom: spacing.lg }}>
        <AppText size="xxl" weight="heavy">Add spending</AppText>
        <AppText size="sm" color={colors.textMuted}>Type it, snap a UPI screenshot or receipt, or import a bank CSV.</AppText>
      </View>

      {/* Mode selector */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        {modes.map((m) => {
          const active = mode === m.key;
          return (
            <Pressable key={m.key} onPress={() => switchMode(m.key)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: active ? colors.brand : colors.card, borderWidth: 1, borderColor: active ? colors.brand : colors.hairline }}>
              <Ionicons name={m.icon} size={15} color={active ? '#fff' : colors.textMuted} />
              <AppText size="sm" weight="semibold" color={active ? '#fff' : colors.text}>{m.label}</AppText>
            </Pressable>
          );
        })}
      </View>

      {saved > 0 && (
        <Pressable onPress={() => router.push('/ledger')}>
          <Card padded style={{ padding: spacing.md, backgroundColor: colors.positiveSoft, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.lg }}>
            <Ionicons name="checkmark-circle" size={20} color={colors.positive} />
            <AppText size="sm" weight="semibold" color={colors.positive} style={{ flex: 1 }}>Saved {saved} transaction{saved > 1 ? 's' : ''}. Tap to view ledger.</AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.positive} />
          </Card>
        </Pressable>
      )}

      {/* Natural language */}
      {mode === 'nl' && (
        <Card style={{ marginBottom: spacing.lg }}>
          <AppText size="md" weight="bold" style={{ marginBottom: spacing.sm }}>Describe your expense</AppText>
          <TextField value={nlText} onChangeText={setNlText} placeholder='e.g. "spent 300 on groceries at DMart yesterday"' multiline icon="chatbubble-ellipses-outline" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
            {['coffee at Starbucks 240', 'Uber ride 180 today', 'got salary 98000'].map((ex) => (
              <Pressable key={ex} onPress={() => setNlText(ex)} style={styles.exChip}>
                <AppText size="xs" color={colors.textMuted}>{ex}</AppText>
              </Pressable>
            ))}
          </View>
          <Button label="Parse with AI" icon="sparkles" onPress={runNL} loading={nlBusy} disabled={!nlText.trim()} />
          {usedFallback && (
            <AppText size="xs" color={colors.warning} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
              AI is busy — parsed on-device instead. Double-check the details below.
            </AppText>
          )}
        </Card>
      )}

      {/* Scan */}
      {mode === 'scan' && (
        <Card style={{ marginBottom: spacing.lg }}>
          <AppText size="md" weight="bold">Scan a payment or receipt</AppText>
          <AppText size="sm" color={colors.textMuted} style={{ marginTop: 4, marginBottom: spacing.lg }}>Upload a PhonePe / Paytm / GPay screenshot or a shop receipt photo.</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <ScanTile icon="phone-portrait" label="UPI screenshot" color={colors.info} onPress={() => pickImage('upi')} />
            <ScanTile icon="receipt" label="Receipt photo" color={colors.brand} onPress={() => pickImage('receipt')} />
          </View>
          {Platform.OS !== 'web' && (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Snap UPI screen" variant="ghost" icon="camera-outline" onPress={() => pickImage('upi', true)} style={{ flex: 1, height: 44 }} />
              <Button label="Snap receipt" variant="ghost" icon="camera-outline" onPress={() => pickImage('receipt', true)} style={{ flex: 1, height: 44 }} />
            </View>
          )}
          {imageUri && <Image source={{ uri: imageUri }} style={{ width: '100%', height: 180, borderRadius: radius.md, marginTop: spacing.lg, backgroundColor: colors.cardMuted }} resizeMode="contain" />}
          {scanBusy && (
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: spacing.md }}>
              <ActivityIndicator color={colors.brand} size="small" />
              <AppText size="sm" color={colors.textMuted}>Reading image with AI…</AppText>
            </View>
          )}
          {scanNote && <AppText size="xs" color={colors.warning} style={{ marginTop: spacing.md, textAlign: 'center' }}>{scanNote}</AppText>}
        </Card>
      )}

      {/* CSV import */}
      {mode === 'csv' && (
        <Card style={{ marginBottom: spacing.lg }}>
          <AppText size="md" weight="bold">Import bank statement (CSV)</AppText>
          <AppText size="sm" color={colors.textMuted} style={{ marginTop: 4, marginBottom: spacing.md }}>Paste rows with Date, Description, Amount columns (negative = spent, or separate Debit/Credit columns).</AppText>
          <TextField value={csvText} onChangeText={setCsvText} placeholder={'Date,Description,Amount\n2026-07-01,Swiggy,-420\n2026-07-01,Salary,98000'} multiline />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Load sample" variant="ghost" onPress={() => setCsvText(SAMPLE_CSV)} style={{ flex: 1 }} />
            <Button label="Preview" icon="eye-outline" onPress={previewCSV} style={{ flex: 1 }} disabled={!csvText.trim()} />
          </View>
          {csvRows.length > 0 && (
            <View style={{ marginTop: spacing.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <AppText size="sm" weight="semibold" style={{ flex: 1 }}>{csvRows.length} rows detected</AppText>
                {csvAI ? <Pill label="AI categorized" tone="up" icon="sparkles" /> : <Pill label="On-device categories" tone="neutral" />}
              </View>
              {csvRows.slice(0, 6).map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                  <AppText size="xs" color={colors.textMuted} style={{ width: 86 }}>{relativeDay(r.txnDate)}</AppText>
                  <AppText size="sm" style={{ flex: 1 }} numberOfLines={1}>{r.merchant}</AppText>
                  <Pill label={r.type === 'income' ? 'Income' : r.category} tone="neutral" />
                  <AppText size="sm" weight="semibold" color={r.type === 'income' ? colors.positive : colors.text} style={{ marginLeft: spacing.sm }}>
                    {r.type === 'income' ? '+' : '-'}{formatINR(r.amount)}
                  </AppText>
                </View>
              ))}
              {csvRows.length > 6 && <AppText size="xs" color={colors.textFaint} style={{ marginTop: 4 }}>+{csvRows.length - 6} more…</AppText>}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                {!csvAI && <Button label="Improve with AI" variant="ghost" icon="sparkles" onPress={upgradeCSVCategories} loading={csvBusy} style={{ flex: 1 }} />}
                <Button label={`Import ${csvRows.length}`} icon="cloud-upload-outline" onPress={importCSV} loading={addBulk.isPending} style={{ flex: 1.4 }} />
              </View>
            </View>
          )}
        </Card>
      )}

      {/* Review & save form (manual, or after NL/scan parse) */}
      {form && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }}>
            <AppText size="md" weight="bold">{mode === 'manual' ? 'New transaction' : 'Review & save'}</AppText>
            {form.aiParsed && form.confidence != null && (
              form.needsReview
                ? <Pill label={`${Math.round(form.confidence * 100)}% — check`} tone="down" icon="alert-circle" />
                : <Pill label={`${Math.round(form.confidence * 100)}% confident`} tone="up" icon="checkmark-circle" />
            )}
          </View>

          {/* Type toggle */}
          <View style={{ flexDirection: 'row', backgroundColor: colors.cardMuted, borderRadius: radius.md, padding: 3, marginBottom: spacing.md }}>
            {(['expense', 'income'] as const).map((t) => (
              <Pressable key={t} onPress={() => set({ type: t, category: t === 'income' ? 'Income' : form.category === 'Income' ? 'Food & Dining' : form.category })} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: form.type === t ? colors.card : 'transparent', alignItems: 'center' }}>
                <AppText size="sm" weight="semibold" color={form.type === t ? (t === 'income' ? colors.positive : colors.negative) : colors.textMuted}>{t === 'expense' ? 'Expense' : 'Income'}</AppText>
              </Pressable>
            ))}
          </View>

          <TextField label="Amount" value={form.amount} onChangeText={(v) => set({ amount: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" prefix="₹" placeholder="0" autoFocus={mode === 'manual'} />
          <TextField label="Merchant / note" value={form.merchant} onChangeText={(v) => set({ merchant: v })} placeholder="e.g. Swiggy" icon="storefront-outline" />

          <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: 6 }}>Category</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
            {topCats.map((c) => {
              const activeTop = topOf(form.category) === c.name;
              const color = colorForCategory(c.name);
              return (
                <Pressable key={c.id} onPress={() => set({ category: c.name, type: c.name === 'Income' ? 'income' : form.type })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: activeTop ? color + '1A' : colors.cardMuted, borderWidth: 1, borderColor: activeTop ? color : 'transparent' }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
                  <AppText size="xs" weight={activeTop ? 'bold' : 'medium'} color={activeTop ? colors.text : colors.textMuted}>{c.name}</AppText>
                </Pressable>
              );
            })}
          </View>
          {subsOf(topOf(form.category)).length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              <AppText size="xs" color={colors.textFaint} style={{ marginBottom: 5 }}>Refine (optional)</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {subsOf(topOf(form.category)).map((sub) => {
                  const active = form.category === sub.name;
                  const color = colorForCategory(topOf(form.category));
                  return (
                    <Pressable key={sub.id} onPress={() => set({ category: active ? topOf(form.category) : sub.name })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: active ? color : color + '14' }}>
                      <AppText size="xs" weight={active ? 'bold' : 'medium'} color={active ? '#fff' : colors.text}>{sub.name}</AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: 6 }}>Date</AppText>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
            {[{ l: 'Today', v: todayISO() }, { l: 'Yesterday', v: dayShift(1) }, { l: '2 days ago', v: dayShift(2) }].map((d) => (
              <Pressable key={d.l} onPress={() => set({ txnDate: d.v })} style={[styles.exChip, form.txnDate === d.v && { backgroundColor: colors.brand }]}>
                <AppText size="xs" weight="semibold" color={form.txnDate === d.v ? '#fff' : colors.textMuted}>{d.l}</AppText>
              </Pressable>
            ))}
          </View>
          <TextField value={form.txnDate} onChangeText={(v) => set({ txnDate: v })} placeholder="YYYY-MM-DD" icon="calendar-outline" />

          {error && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.negativeSoft }}>
              <Ionicons name="alert-circle" size={16} color={colors.negative} />
              <AppText size="sm" color={colors.negative} style={{ flex: 1 }}>{error}</AppText>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            {mode !== 'manual' && <Button label="Cancel" variant="ghost" onPress={() => setForm(null)} style={{ flex: 1 }} />}
            <Button label="Save transaction" icon="checkmark" onPress={save} loading={addTxn.isPending} style={{ flex: 2 }} disabled={!parseFloat(form.amount)} />
          </View>
        </Card>
      )}

      {/* Non-form errors (CSV/scan) */}
      {!form && error && (
        <Card padded style={{ padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="alert-circle" size={16} color={colors.negative} />
          <AppText size="sm" color={colors.negative} style={{ flex: 1 }}>{error}</AppText>
        </Card>
      )}
    </Screen>
  );
}

function ScanTile({ icon, label, color, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }) {
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
  return localISO(x);
}

const SAMPLE_CSV = `Date,Description,Amount
2026-07-01,Swiggy Order,-486
2026-07-01,BigBasket Groceries,-1240
2026-06-30,Uber Ride,-210
2026-06-29,Amazon Shopping,-2399
2026-06-28,Airtel Postpaid,-799`;

const styles = {
  exChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.cardMuted },
};

import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { askFinance, SUGGESTED_QUESTIONS, type ChatCitation } from '@/data/ai';
import { AppText, IconCircle } from '@/components/ui';
import { MAX_WIDTH } from '@/components/Screen';
import { colors, fontSize, radius, shadow, spacing } from '@/theme';
import { formatINR } from '@/lib/format';
import { uid } from '@/lib/id';
import { goBack } from '@/lib/nav';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: ChatCitation[];
  pending?: boolean;
  error?: boolean;
}

export default function Chat() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async (q?: string) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText('');
    setBusy(true);
    const pendingId = uid('msg');
    setMessages((m) => [
      ...m,
      { id: uid('msg'), role: 'user', text: question },
      { id: pendingId, role: 'assistant', text: '', pending: true },
    ]);
    try {
      const res = await askFinance(question);
      setMessages((m) => m.map((msg) => (msg.id === pendingId
        ? { ...msg, text: res.answer, citations: res.citations, pending: false }
        : msg)));
    } catch (e) {
      setMessages((m) => m.map((msg) => (msg.id === pendingId
        ? { ...msg, text: e instanceof Error ? e.message : 'Something went wrong — please try again.', pending: false, error: true }
        : msg)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-down" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <IconCircle name="sparkles" bg={colors.brand} color="#fff" size={34} iconSize={17} />
            <View>
              <AppText weight="bold" size="md">FinTrack Assistant</AppText>
              <AppText size="xs" color={colors.positive}>● Grounded in your real transactions</AppText>
            </View>
          </View>
          {messages.length > 0 && (
            <Pressable onPress={() => setMessages([])} hitSlop={10} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.xl, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', gap: spacing.md }}
        >
          {messages.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl }}>
              <IconCircle name="chatbubbles" bg={colors.brandSoft} color={colors.brand} size={64} iconSize={30} />
              <AppText weight="bold" size="lg" style={{ marginTop: spacing.md }}>Ask about your money</AppText>
              <AppText size="sm" color={colors.textMuted} style={{ textAlign: 'center', marginTop: 4, maxWidth: 320 }}>
                Answers are computed from your ledger with real SQL — never guessed.
              </AppText>
            </View>
          )}

          {messages.map((m) => (
            <View key={m.id} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <View style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble, m.error && styles.errBubble]}>
                {m.pending ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="sparkles" size={14} color={colors.brand} />
                    <AppText size="md" color={colors.textMuted}>Crunching your numbers…</AppText>
                  </View>
                ) : (
                  <AppText size="md" color={m.role === 'user' ? '#fff' : m.error ? colors.negative : colors.text} style={{ lineHeight: 22 }}>
                    {m.text}
                  </AppText>
                )}
                {!!m.citations?.length && !m.pending && (
                  <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: spacing.sm, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="link" size={11} color={colors.textFaint} />
                      <AppText size="xs" color={colors.textFaint}>Based on {m.citations.length} of your transactions</AppText>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {m.citations.slice(0, 4).map((c) => (
                        <View key={c.id} style={styles.citation}>
                          <AppText size="xs" color={colors.textMuted}>{c.merchant ?? c.category} · {formatINR(c.amount)}</AppText>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Suggested prompts */}
        {messages.length === 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 46 }} contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: 8, alignItems: 'center' }}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <Pressable key={q} onPress={() => send(q)} style={styles.suggestion}>
                <AppText size="xs" color={colors.text}>{q}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Input */}
        <View style={styles.inputBarWrap}>
          <View style={styles.inputBar}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Ask anything about your finances…"
              placeholderTextColor={colors.textFaint}
              style={{ flex: 1, fontSize: fontSize.md, color: colors.text, paddingVertical: 6 }}
              onSubmitEditing={() => send()}
              returnKeyType="send"
              editable={!busy}
            />
            <Pressable onPress={() => send()} disabled={!text.trim() || busy} style={[styles.sendBtn, { opacity: text.trim() && !busy ? 1 : 0.4 }]}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = {
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.hairline, backgroundColor: colors.card },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center' as const, justifyContent: 'center' as const },
  bubble: { maxWidth: '88%' as const, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg },
  userBubble: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 4, ...shadow.soft },
  errBubble: { backgroundColor: colors.negativeSoft },
  citation: { backgroundColor: colors.cardMuted, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  suggestion: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.hairline },
  inputBarWrap: { padding: spacing.md, paddingTop: spacing.sm, maxWidth: MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const },
  inputBar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingLeft: spacing.lg, paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderColor: colors.hairline, ...shadow.soft },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center' as const, justifyContent: 'center' as const },
};

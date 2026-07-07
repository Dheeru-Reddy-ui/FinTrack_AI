import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { AppText, IconCircle } from '@/components/ui';
import { MAX_WIDTH } from '@/components/Screen';
import { SUGGESTED_QUESTIONS } from '@/ai/chat';
import { colors, fontSize, radius, shadow, spacing } from '@/theme';

export default function Chat() {
  const app = useApp();
  const router = useRouter();
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [app.chat.length]);

  const send = (q?: string) => {
    const question = (q ?? text).trim();
    if (!question) return;
    setText('');
    app.sendChat(question);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-down" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <IconCircle name="sparkles" bg={colors.brand} color="#fff" size={34} iconSize={17} />
            <View>
              <AppText weight="bold" size="md">FinTrack Assistant</AppText>
              <AppText size="xs" color={colors.positive}>● Ready · grounded in your ledger</AppText>
            </View>
          </View>
          {app.chat.length > 0 && (
            <Pressable onPress={app.clearChat} hitSlop={10} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.xl, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', gap: spacing.md }}>
          {app.chat.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl }}>
              <IconCircle name="chatbubbles" bg={colors.brandSoft} color={colors.brand} size={64} iconSize={30} />
              <AppText weight="bold" size="lg" style={{ marginTop: spacing.md }}>Ask about your money</AppText>
              <AppText size="sm" color={colors.textMuted} style={{ textAlign: 'center', marginTop: 4 }}>Answers are computed from your real transactions.</AppText>
            </View>
          )}

          {app.chat.map((m) => (
            <View key={m.id} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <View style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                {m.pending ? (
                  <AppText size="md" color={colors.textMuted}>Thinking…</AppText>
                ) : (
                  <AppText size="md" color={m.role === 'user' ? '#fff' : colors.text} style={{ lineHeight: 22 }}>{m.text}</AppText>
                )}
                {!!m.citations?.length && !m.pending && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                    <Ionicons name="link" size={11} color={colors.textFaint} />
                    <AppText size="xs" color={colors.textFaint}>{m.citations.length} transactions referenced</AppText>
                  </View>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Suggested prompts */}
        {app.chat.length === 0 && (
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
            />
            <Pressable onPress={() => send()} disabled={!text.trim()} style={[styles.sendBtn, { opacity: text.trim() ? 1 : 0.4 }]}>
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
  bubble: { maxWidth: '86%' as const, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg },
  userBubble: { backgroundColor: colors.ink, borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 4, ...shadow.soft },
  suggestion: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.hairline },
  inputBarWrap: { padding: spacing.md, paddingTop: spacing.sm, maxWidth: MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const },
  inputBar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingLeft: spacing.lg, paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderColor: colors.hairline, ...shadow.soft },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center' as const, justifyContent: 'center' as const },
};

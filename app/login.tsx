import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthProvider';
import { AppText, Button, Card, IconCircle, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

type Mode = 'login' | 'signup';

export default function Login() {
  const { session, configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (session) return <Redirect href="/" />;

  const validate = (): string | null => {
    if (mode === 'signup' && name.trim().length < 2) return 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    const v = validate();
    if (v) return setError(v);
    setLoading(true);
    try {
      const res = mode === 'signup' ? await signUp(email, password, name) : await signIn(email, password);
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
      } else if (res.needsConfirmation) {
        setNotice('Account created! Check your email to confirm, then log in.');
        setMode('login');
        setPassword('');
      }
      // On success with a session, the <Redirect> above takes over automatically.
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.xl, width: '100%', maxWidth: 460, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
            {/* Brand */}
            <View style={{ alignItems: 'center', marginBottom: spacing.xxl }}>
              <IconCircle name="wallet" bg={colors.brand} color="#fff" size={56} iconSize={28} />
              <AppText size="xxl" weight="heavy" style={{ marginTop: spacing.md }}>
                FinTrack <AppText size="xxl" weight="heavy" color={colors.brand}>AI</AppText>
              </AppText>
              <AppText size="md" color={colors.textMuted} style={{ marginTop: 6, textAlign: 'center' }}>
                Track every rupee, effortlessly.
              </AppText>
            </View>

            <Card style={{ borderRadius: radius.xl }}>
              <AppText size="xl" weight="bold">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</AppText>
              <AppText size="sm" color={colors.textMuted} style={{ marginTop: 4, marginBottom: spacing.lg }}>
                {mode === 'signup' ? 'Start organizing your money in seconds.' : 'Log in to see your finances.'}
              </AppText>

              {/* Mode toggle */}
              <View style={{ flexDirection: 'row', backgroundColor: colors.cardMuted, borderRadius: radius.md, padding: 3, marginBottom: spacing.lg }}>
                {(['login', 'signup'] as Mode[]).map((m) => (
                  <Pressable key={m} onPress={() => { setMode(m); setError(null); setNotice(null); }} style={{ flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: mode === m ? colors.card : 'transparent', alignItems: 'center' }}>
                    <AppText size="sm" weight="semibold" color={mode === m ? colors.text : colors.textMuted}>{m === 'login' ? 'Log in' : 'Sign up'}</AppText>
                  </Pressable>
                ))}
              </View>

              {mode === 'signup' && (
                <TextField label="Name" value={name} onChangeText={setName} placeholder="Your name" icon="person-outline" autoCapitalize="words" />
              )}
              <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@email.com" keyboardType="email-address" icon="mail-outline" />
              <TextField label="Password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" icon="lock-closed-outline" secure onSubmitEditing={submit} />

              {error && (
                <View style={styles.banner('error')}>
                  <Ionicons name="alert-circle" size={16} color={colors.negative} />
                  <AppText size="sm" color={colors.negative} style={{ flex: 1 }}>{error}</AppText>
                </View>
              )}
              {notice && (
                <View style={styles.banner('ok')}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.positive} />
                  <AppText size="sm" color={colors.positive} style={{ flex: 1 }}>{notice}</AppText>
                </View>
              )}

              <Button
                label={mode === 'signup' ? 'Create account' : 'Log in'}
                onPress={submit}
                loading={loading}
                icon="arrow-forward"
                style={{ marginTop: spacing.sm }}
              />

              {!configured && (
                <View style={styles.banner('warn')}>
                  <Ionicons name="server-outline" size={16} color={colors.warning} />
                  <AppText size="xs" color={colors.textMuted} style={{ flex: 1 }}>
                    Backend not connected yet. Add your Supabase URL + anon key to .env to enable sign-in.
                  </AppText>
                </View>
              )}
            </Card>

            <AppText size="xs" color={colors.textFaint} style={{ textAlign: 'center', marginTop: spacing.xl }}>
              🔒 Your data is private and secured with row-level security.
            </AppText>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = {
  banner: (tone: 'error' | 'ok' | 'warn') => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: tone === 'error' ? colors.negativeSoft : tone === 'ok' ? colors.positiveSoft : colors.warningSoft,
  }),
};

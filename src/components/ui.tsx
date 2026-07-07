import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme';

export function TextField({ label, value, onChangeText, placeholder, keyboardType, prefix, autoFocus, multiline, icon, secure, autoCapitalize, onSubmitEditing }: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  prefix?: string;
  autoFocus?: boolean;
  multiline?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onSubmitEditing?: () => void;
}) {
  const [hidden, setHidden] = React.useState(true);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <AppText size="sm" weight="semibold" color={colors.textMuted} style={{ marginBottom: 6 }}>{label}</AppText> : null}
      <View style={styles.field}>
        {icon ? <Ionicons name={icon} size={18} color={colors.textFaint} style={{ marginRight: 8 }} /> : null}
        {prefix ? <Text style={{ color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold, marginRight: 4 }}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          multiline={multiline}
          secureTextEntry={secure && hidden}
          autoCapitalize={autoCapitalize ?? (secure || keyboardType === 'email-address' ? 'none' : 'sentences')}
          autoCorrect={!secure}
          onSubmitEditing={onSubmitEditing}
          style={[{ flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: 0 }, multiline && { height: 72, textAlignVertical: 'top' }]}
        />
        {secure ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8} style={{ paddingLeft: 8 }}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={18} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function Card({ style, children, dark, padded = true }: { style?: StyleProp<ViewStyle>; children: React.ReactNode; dark?: boolean; padded?: boolean }) {
  return (
    <View
      style={[
        styles.card,
        dark && styles.cardDark,
        padded && { padding: spacing.xl },
        shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function AppText({ children, style, weight, size, color, numberOfLines }: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  weight?: keyof typeof fontWeight;
  size?: keyof typeof fontSize;
  color?: string;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: color ?? colors.text, fontSize: size ? fontSize[size] : fontSize.md, fontWeight: weight ? fontWeight[weight] : fontWeight.regular },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <AppText weight="bold" size="lg">{title}</AppText>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <AppText color={colors.brand} weight="semibold" size="sm">{action}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: 'up' | 'down' | 'neutral' | 'lime'; icon?: keyof typeof Ionicons.glyphMap }) {
  const map = {
    up: { bg: colors.positiveSoft, fg: colors.positive },
    down: { bg: colors.negativeSoft, fg: colors.negative },
    neutral: { bg: colors.cardMuted, fg: colors.textMuted },
    lime: { bg: colors.lime, fg: colors.limeInk },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={map.fg} style={{ marginRight: 3 }} /> : null}
      <Text style={{ color: map.fg, fontSize: fontSize.xs, fontWeight: fontWeight.bold }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ pct, color = colors.brand, track = colors.cardMuted, height = 8 }: { pct: number; color?: string; track?: string; height?: number }) {
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height, backgroundColor: track }]}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

export function IconCircle({ name, color = colors.text, bg = colors.cardMuted, size = 40, iconSize }: { name: keyof typeof Ionicons.glyphMap; color?: string; bg?: string; size?: number; iconSize?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={iconSize ?? size * 0.5} color={color} />
    </View>
  );
}

export function Dot({ color, size = 9 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Button({ label, onPress, variant = 'primary', icon, style, loading, disabled }: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'dark' | 'ghost' | 'lime';
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  loading?: boolean;
  disabled?: boolean;
}) {
  const styleMap = {
    primary: { bg: colors.brand, fg: '#fff' },
    dark: { bg: colors.ink, fg: '#fff' },
    ghost: { bg: colors.cardMuted, fg: colors.text },
    lime: { bg: colors.lime, fg: colors.limeInk },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: styleMap.bg, opacity: disabled ? 0.5 : pressed ? 0.88 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={styleMap.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={styleMap.fg} style={{ marginRight: 7 }} /> : null}
          <Text style={{ color: styleMap.fg, fontWeight: fontWeight.bold, fontSize: fontSize.md }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Avatar({ name, size = 44, uri }: { name: string; size?: number; uri?: string }) {
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: fontWeight.bold, fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** A settings row: leading icon, label + optional subtitle, and a trailing
 *  control (Switch, chevron, value text). Tapping the row fires onPress. */
export function SettingRow({ icon, iconBg, iconColor, label, subtitle, right, onPress, first, danger }: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg?: string;
  iconColor?: string;
  label: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  first?: boolean;
  danger?: boolean;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <IconCircle name={icon} bg={iconBg ?? colors.cardMuted} color={iconColor ?? (danger ? colors.negative : colors.text)} size={38} iconSize={18} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <AppText size="sm" weight="semibold" color={danger ? colors.negative : colors.text}>{label}</AppText>
        {subtitle ? <AppText size="xs" color={colors.textMuted} style={{ marginTop: 1 }}>{subtitle}</AppText> : null}
      </View>
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

/** Themed on/off switch. */
export function Toggle({ value, onValueChange, disabled }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.hairlineStrong, true: colors.brand }}
      thumbColor={Platform.OS === 'android' ? (value ? '#fff' : '#f4f4f4') : undefined}
      ios_backgroundColor={colors.hairlineStrong}
      style={{ opacity: disabled ? 0.5 : 1 }}
    />
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <IconCircle name={icon} bg={colors.brandSoft} color={colors.brand} size={56} />
      <AppText weight="semibold" size="md" style={{ marginTop: spacing.md }}>{title}</AppText>
      {subtitle ? <AppText color={colors.textMuted} size="sm" style={{ marginTop: 4, textAlign: 'center' }}>{subtitle}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.xl },
  cardDark: { backgroundColor: colors.ink },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  progressTrack: { width: '100%', overflow: 'hidden' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, minHeight: 50, borderWidth: 1, borderColor: colors.hairline },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginVertical: spacing.md },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl },
});

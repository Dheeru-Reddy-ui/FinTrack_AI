import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Transaction } from '@/data/types';
import { AppText, IconCircle } from './ui';
import { colors, colorForCategory, spacing } from '@/theme';
import { iconForCategory } from '@/data/categories';
import { formatINR, relativeDay } from '@/lib/format';

const SOURCE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  manual: 'create-outline',
  nl: 'chatbubble-ellipses-outline',
  upi: 'phone-portrait-outline',
  receipt: 'receipt-outline',
  csv: 'document-text-outline',
};

export function TransactionRow({ txn, onPress }: { txn: Transaction; onPress?: () => void }) {
  const group = txn.categoryGroup ?? txn.category; // color/icon by top-level parent
  const color = colorForCategory(group);
  const income = txn.type === 'income';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1 }]}>
      <IconCircle name={(iconForCategory(group) as any)} color={color} bg={color + '1A'} size={42} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <AppText weight="semibold" size="md" numberOfLines={1} style={{ flexShrink: 1 }}>
            {txn.merchant || txn.category || 'Transaction'}
          </AppText>
          {txn.needsReview ? <Ionicons name="alert-circle" size={15} color={colors.warning} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <Ionicons name={SOURCE_ICON[txn.source] ?? 'ellipse'} size={11} color={colors.textFaint} />
          <AppText size="xs" color={colors.textMuted}>{txn.category} · {relativeDay(txn.txnDate)}</AppText>
        </View>
      </View>
      <AppText weight="bold" size="md" color={income ? colors.positive : colors.text}>
        {income ? '+' : '-'}{formatINR(txn.amount)}
      </AppText>
    </Pressable>
  );
}

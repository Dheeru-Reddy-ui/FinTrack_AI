import React from 'react';
import { RefreshControl, ScrollView, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

export const MAX_WIDTH = 1100;

export function useResponsive() {
  const { width } = useWindowDimensions();
  return {
    width,
    isWide: width >= 760,
    isCompact: width < 520,
    columns: width >= 1000 ? 3 : width >= 640 ? 2 : 1,
  };
}

export function Screen({
  children,
  edges = ['top'],
  contentStyle,
  refreshing,
  onRefresh,
  scroll = true,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
}) {
  const inner = (
    <View style={[{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }, contentStyle]}>
      {children}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={edges}>
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} /> : undefined}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

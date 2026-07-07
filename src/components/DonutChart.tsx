import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from './ui';
import { colors } from '@/theme';

export interface DonutSlice {
  amount: number;
  color: string;
}

/** Ring donut with a centered label — mirrors the dashboard's Spending Overview. */
export function DonutChart({
  slices,
  size = 180,
  strokeWidth = 26,
  centerTitle,
  centerSubtitle,
}: {
  slices: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  centerTitle?: string;
  centerSubtitle?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((a, s) => a + s.amount, 0) || 1;
  const gap = slices.length > 1 ? 2 : 0; // px gap between segments

  let offset = 0;
  const arcs = slices
    .filter((s) => s.amount > 0)
    .map((s, i) => {
      const frac = s.amount / total;
      const len = Math.max(0, frac * circumference - gap);
      const dash = `${len} ${circumference - len}`;
      const el = (
        <Circle
          key={i}
          cx={cx}
          cy={cy}
          r={radius}
          stroke={s.color}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          strokeDashoffset={-offset}
          strokeLinecap="butt"
          fill="none"
        />
      );
      offset += frac * circumference;
      return el;
    });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Rotate the whole SVG -90° via a CSS/RN style transform so the first
          segment starts at 12 o'clock — avoids react-native-svg's transform-origin. */}
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={cx} cy={cy} r={radius} stroke={colors.cardMuted} strokeWidth={strokeWidth} fill="none" />
        {arcs}
      </Svg>
      {(centerTitle || centerSubtitle) && (
        <View style={{ position: 'absolute', alignItems: 'center', paddingHorizontal: 12 }}>
          {centerSubtitle ? <AppText size="xs" color={colors.textMuted} weight="medium">{centerSubtitle}</AppText> : null}
          {centerTitle ? <AppText size="md" weight="bold" style={{ textAlign: 'center', marginTop: 2 }}>{centerTitle}</AppText> : null}
        </View>
      )}
    </View>
  );
}

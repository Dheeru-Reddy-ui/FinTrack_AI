import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';
import { AppText } from './ui';
import { colors } from '@/theme';
import type { TrendPoint } from '@/data/analytics';

const PAD_X = 4;

function niceRange(values: number[]): { min: number; max: number } {
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 1);
  if (min === max) { max = min + 1; }
  const span = max - min;
  return { min: min - span * 0.06, max: max + span * 0.08 };
}

/** Wallet-style area chart (balance over time) with dashed gridlines. */
export function AreaChart({ points, height = 150, color = colors.brand }: { points: TrendPoint[]; height?: number; color?: string }) {
  const { width: winW } = useWindowDimensions();
  const width = Math.min(winW, 1100) - 2 * 20 - 2 * 20; // screen pad + card pad
  if (points.length < 2) return <AppText size="sm" color={colors.textMuted}>Not enough data yet.</AppText>;

  const { min, max } = niceRange(points.map((p) => p.value));
  const x = (i: number) => PAD_X + (i / (points.length - 1)) * (width - 2 * PAD_X);
  const y = (v: number) => height - ((v - min) / (max - min)) * height;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;

  // ~4 x labels
  const labelIdx = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1];

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.28" />
            <Stop offset="1" stopColor={color} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={colors.hairline} strokeWidth={1} strokeDasharray="4 6" />
        ))}
        <Path d={area} fill="url(#areaFill)" />
        <Path d={line} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {labelIdx.map((i, k) => (
          <AppText key={k} size="xs" color={colors.textFaint}>{points[i]?.label ?? ''}</AppText>
        ))}
      </View>
    </View>
  );
}

/** Simple bar chart (spending per bucket). */
export function BarsChart({ points, height = 130, color = colors.brand }: { points: TrendPoint[]; height?: number; color?: string }) {
  const { width: winW } = useWindowDimensions();
  const width = Math.min(winW, 1100) - 2 * 20 - 2 * 20;
  if (!points.length) return <AppText size="sm" color={colors.textMuted}>No spending in this period.</AppText>;

  const max = Math.max(...points.map((p) => p.value), 1);
  const gap = points.length > 20 ? 2 : 6;
  const barW = Math.max(3, (width - gap * (points.length - 1)) / points.length);
  // label every k-th bucket, ~5 labels
  const every = Math.max(1, Math.ceil(points.length / 5));

  return (
    <View>
      <Svg width={width} height={height}>
        {[0.33, 0.66].map((f) => (
          <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={colors.hairline} strokeWidth={1} strokeDasharray="4 6" />
        ))}
        {points.map((p, i) => {
          const h = Math.max(p.value > 0 ? 3 : 0, (p.value / max) * (height - 8));
          return (
            <Rect
              key={i}
              x={i * (barW + gap)}
              y={height - h}
              width={barW}
              height={h}
              rx={Math.min(3, barW / 2)}
              fill={p.value > 0 ? color : colors.hairline}
              opacity={p.value > 0 ? 0.9 : 0.6}
            />
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {points.map((p, i) => (
          <View key={i} style={{ width: barW + gap, alignItems: 'flex-start' }}>
            {i % every === 0 ? <AppText size="xs" color={colors.textFaint}>{p.label}</AppText> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Small W / M / Y segmented toggle used by the trend cards. */
export function PeriodToggle({ value, onChange }: { value: 'week' | 'month' | 'year'; onChange: (m: 'week' | 'month' | 'year') => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.cardMuted, borderRadius: 999, padding: 3 }}>
      {(['week', 'month', 'year'] as const).map((m) => (
        <Pressable
          key={m}
          onPress={() => onChange(m)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: value === m ? colors.card : 'transparent',
          }}
        >
          <AppText size="xs" weight="semibold" color={value === m ? colors.text : colors.textMuted}>
            {m === 'week' ? 'W' : m === 'month' ? 'M' : 'Y'}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

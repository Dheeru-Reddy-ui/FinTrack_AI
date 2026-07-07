/**
 * FinTrack AI — design system.
 *
 * Palette is derived from the product's reference dashboard: a warm off-white
 * canvas, floating white cards, near-black "ink" hero cards, and a fresh green
 * brand accent with a lime highlight chip.
 */

export const colors = {
  // Surfaces
  bg: '#EEF0EA', // app canvas (warm gray-green)
  bgElevated: '#F6F7F3',
  card: '#FFFFFF',
  cardMuted: '#F5F6F1',

  // "Ink" — the dark hero cards (Total Balance / AI Insight)
  ink: '#141711',
  inkSoft: '#20261C',
  inkLine: 'rgba(255,255,255,0.08)',

  // Brand
  brand: '#1FA95C', // primary green
  brandDark: '#0E7A40',
  brandSoft: '#E4F6EB', // tinted green background
  lime: '#C9F26D', // bright highlight chip
  limeInk: '#22331A', // text on lime

  // Semantic
  positive: '#16A34A',
  positiveSoft: '#E7F6EC',
  negative: '#E5484D',
  negativeSoft: '#FDECEC',
  warning: '#F59E0B',
  warningSoft: '#FEF3E2',
  info: '#3B82F6',

  // Text
  text: '#14171C',
  textMuted: '#7B818B',
  textFaint: '#A6ABB2',
  textOnDark: '#FFFFFF',
  textOnDarkMuted: 'rgba(255,255,255,0.62)',

  // Lines
  hairline: '#E7E8E2',
  hairlineStrong: '#DDDFD8',
} as const;

/** Consistent, cheerful colors for spending categories. */
export const categoryColors: Record<string, string> = {
  Food: '#1FA95C',
  'Food & Dining': '#1FA95C',
  Transport: '#3B82F6',
  Shopping: '#A855F7',
  'Bills & Utilities': '#F59E0B',
  Bills: '#F59E0B',
  Rent: '#0EA5E9',
  Entertainment: '#EC4899',
  Groceries: '#14B8A6',
  Health: '#EF4444',
  Income: '#16A34A',
  Others: '#94A3B8',
  Uncategorized: '#B0B5BD',
};

export function colorForCategory(name?: string | null): string {
  if (!name) return categoryColors.Uncategorized;
  return categoryColors[name] ?? fallbackPalette[hashString(name) % fallbackPalette.length];
}

const fallbackPalette = ['#1FA95C', '#3B82F6', '#A855F7', '#F59E0B', '#EC4899', '#14B8A6', '#EF4444', '#0EA5E9'];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  display: 34,
  displayLg: 42,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const shadow = {
  card: {
    shadowColor: '#1B2A1E',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  soft: {
    shadowColor: '#1B2A1E',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#0B1F12',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;

export const theme = { colors, spacing, radius, fontSize, fontWeight, shadow };
export type Theme = typeof theme;

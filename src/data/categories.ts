import type { Category } from './types';
import { uid } from '@/lib/id';

/** Default categories seeded on first login. */
export const DEFAULT_CATEGORY_NAMES: { name: string; icon: string }[] = [
  { name: 'Food & Dining', icon: 'restaurant' },
  { name: 'Groceries', icon: 'basket' },
  { name: 'Transport', icon: 'car' },
  { name: 'Shopping', icon: 'bag-handle' },
  { name: 'Bills & Utilities', icon: 'flash' },
  { name: 'Rent', icon: 'home' },
  { name: 'Entertainment', icon: 'game-controller' },
  { name: 'Health', icon: 'medkit' },
  { name: 'Income', icon: 'trending-up' },
  { name: 'Others', icon: 'ellipsis-horizontal' },
];

export function makeDefaultCategories(): Category[] {
  return DEFAULT_CATEGORY_NAMES.map((c) => ({
    id: uid('cat'),
    name: c.name,
    icon: c.icon,
    isDefault: true,
  }));
}

export function iconForCategory(name?: string | null): string {
  const found = DEFAULT_CATEGORY_NAMES.find((c) => c.name === name);
  return found?.icon ?? 'pricetag';
}

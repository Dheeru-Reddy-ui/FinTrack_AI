/** Currency, number and date formatting — India-first (₹, Asia/Kolkata). */

export function formatINR(amount: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const { compact = false, sign = false } = opts;
  const abs = Math.abs(amount);
  let body: string;
  if (compact && abs >= 100000) {
    // Indian shorthand: L (lakh), Cr (crore)
    if (abs >= 10000000) body = `${trim(abs / 10000000)}Cr`;
    else body = `${trim(abs / 100000)}L`;
    body = `₹${body}`;
  } else if (compact && abs >= 1000) {
    body = `₹${trim(abs / 1000)}K`;
  } else {
    body = `₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  if (sign) return `${amount < 0 ? '-' : '+'}${body}`;
  return amount < 0 ? `-${body}` : body;
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '');
}

export function formatPercent(n: number, withSign = true): string {
  const v = Math.round(n * 10) / 10;
  const s = withSign ? (v >= 0 ? '+' : '') : '';
  return `${s}${v}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function relativeDay(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return formatShortDate(iso);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local (not UTC) YYYY-MM-DD — avoids off-by-one from toISOString in +5:30. */
export function localISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return localISO();
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

export function currentMonthKey(): string {
  return localISO().slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

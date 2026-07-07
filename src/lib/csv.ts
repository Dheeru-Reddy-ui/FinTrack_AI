/** Tolerant bank-statement CSV parser → normalized transaction rows. */
import { categorizeHeuristic } from '@/ai/parse';
import { todayISO } from '@/lib/format';

export interface CSVRow {
  amount: number;
  type: 'expense' | 'income';
  category: string;
  merchant: string;
  txnDate: string;
  confidence: number;
}

function splitLine(line: string): string[] {
  // handles simple quoted fields
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const find = (headers: string[], names: string[]) =>
  headers.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));

function normalizeDate(s: string): string {
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return todayISO();
}

const num = (s: string) => parseFloat((s || '').replace(/[^0-9.\-]/g, '')) || 0;

export function parseCSV(text: string): CSVRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitLine(lines[0]);
  const hasHeader = /date|desc|amount|debit|credit|narration|particular/i.test(lines[0]);
  const body = hasHeader ? lines.slice(1) : lines;

  const dateI = hasHeader ? find(headers, ['date']) : 0;
  const descI = hasHeader ? find(headers, ['desc', 'narration', 'particular', 'merchant', 'detail']) : 1;
  const amtI = hasHeader ? find(headers, ['amount']) : 2;
  const debitI = hasHeader ? find(headers, ['debit', 'withdrawal']) : -1;
  const creditI = hasHeader ? find(headers, ['credit', 'deposit']) : -1;

  const rows: CSVRow[] = [];
  for (const line of body) {
    const cols = splitLine(line);
    if (cols.length < 2) continue;
    const merchant = (cols[descI >= 0 ? descI : 1] || 'Transaction').replace(/\s+/g, ' ').trim();

    let signed = 0;
    if (debitI >= 0 || creditI >= 0) {
      const debit = debitI >= 0 ? num(cols[debitI]) : 0;
      const credit = creditI >= 0 ? num(cols[creditI]) : 0;
      signed = credit - debit;
    } else {
      signed = num(cols[amtI >= 0 ? amtI : 2]);
    }
    if (signed === 0) continue;
    const type: 'expense' | 'income' = signed >= 0 ? 'income' : 'expense';
    const { category, confidence } = categorizeHeuristic(merchant);
    rows.push({
      amount: Math.abs(signed),
      type,
      category: type === 'income' ? 'Income' : category,
      merchant,
      txnDate: normalizeDate(cols[dateI >= 0 ? dateI : 0]),
      confidence,
    });
  }
  return rows;
}

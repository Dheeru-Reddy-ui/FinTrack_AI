/**
 * Vision extraction for receipts and UPI/PhonePe/Paytm screenshots.
 * Uses Gemini vision (multimodal) or a Groq vision model. Only invoked when a
 * key is configured; demo mode falls back to the manual-confirm form.
 */
import { config } from '@/data/config';
import { extractJSON } from './llm';
import type { ParsedTxn } from './parse';
import { todayISO } from '@/lib/format';

const promptFor = (kind: 'receipt' | 'upi', categories: string[]) => `You read an Indian ${
  kind === 'upi' ? 'UPI / PhonePe / Paytm / GPay payment screenshot' : 'shop receipt'
} and extract the transaction.
Return ONLY JSON: {"amount": number, "merchant": string, "category": string, "txnDate": "YYYY-MM-DD", "type": "expense"|"income", "confidence": number}.
- amount is the total paid in INR (a plain number, no symbols).
- merchant is the payee/store name.
- category must be one of: ${categories.join(', ')}.
- Today is ${todayISO()}; if no date is visible use today.
- confidence is 0..1 for how sure you are.`;

export async function parseImageWithVision(
  base64: string,
  mime: string,
  kind: 'receipt' | 'upi',
  categories: string[]
): Promise<ParsedTxn | null> {
  const raw = config.aiProvider === 'gemini'
    ? await geminiVision(base64, mime, promptFor(kind, categories))
    : await groqVision(base64, mime, promptFor(kind, categories));
  const parsed = extractJSON<Partial<ParsedTxn>>(raw);
  if (!parsed || typeof parsed.amount !== 'number') return null;
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.75;
  return {
    amount: parsed.amount,
    merchant: parsed.merchant ?? null,
    category: parsed.category && categories.includes(parsed.category) ? parsed.category : 'Others',
    txnDate: parsed.txnDate ?? todayISO(),
    type: parsed.type === 'income' ? 'income' : 'expense',
    confidence,
    needsReview: confidence < 0.7,
  };
}

async function geminiVision(base64: string, mime: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: base64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini vision ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
}

async function groqVision(base64: string, mime: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groqApiKey}` },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq vision ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

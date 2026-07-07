/**
 * LLM abstraction. Supports Groq and Gemini (OpenAI-style chat) via their REST
 * APIs, plus a `mock` provider used when no key is configured. Callers should
 * always provide a deterministic fallback so the app works offline / keyless.
 */
import { config, hasLLM } from '@/data/config';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export function hasLLMConfigured(): boolean {
  return hasLLM;
}

export async function llmChat(messages: ChatTurn[], opts: LLMOptions = {}): Promise<string> {
  if (!hasLLM) throw new LLMUnavailable();
  if (config.aiProvider === 'groq') return groqChat(messages, opts);
  if (config.aiProvider === 'gemini') return geminiChat(messages, opts);
  throw new LLMUnavailable();
}

export class LLMUnavailable extends Error {
  constructor() {
    super('No LLM provider configured');
    this.name = 'LLMUnavailable';
  }
}

async function groqChat(messages: ChatTurn[], opts: LLMOptions): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: config.groqModel,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 800,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function geminiChat(messages: ChatTurn[], opts: LLMOptions): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 800,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
}

/** Extract the first JSON object/array from a model response. */
export function extractJSON<T = any>(text: string): T | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const openCh = cleaned[start];
  const closeCh = openCh === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === openCh) depth++;
    else if (cleaned[i] === closeCh) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

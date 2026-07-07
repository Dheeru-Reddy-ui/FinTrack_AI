/**
 * Runtime configuration.
 *
 * IMPORTANT: every read MUST be a direct static `process.env.EXPO_PUBLIC_*`
 * member expression. Expo inlines these at bundle time; aliasing process.env
 * to a variable defeats the transform and the values become undefined in
 * release (APK) builds — even though they work on the Metro dev server.
 */

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',

  // Legacy demo-mode knobs (unused in production paths; kept for the on-device
  // heuristic modules that still import them).
  aiProvider: (process.env.EXPO_PUBLIC_AI_PROVIDER ?? 'mock') as 'groq' | 'gemini' | 'mock',
  groqApiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '',
  groqModel: process.env.EXPO_PUBLIC_GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  geminiModel: process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-2.0-flash',
};

export const hasSupabase = Boolean(config.supabaseUrl && config.supabaseAnonKey);
export const hasLLM =
  (config.aiProvider === 'groq' && !!config.groqApiKey) ||
  (config.aiProvider === 'gemini' && !!config.geminiApiKey);

export const DEMO_MODE = !hasSupabase;

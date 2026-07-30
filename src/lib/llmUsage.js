import { supabase } from './supabase'

// Rough, approximate $ per 1M tokens — for the "Est. Cost" KPI only, not
// billing-accurate. Ollama is local/free. Update if pricing changes.
export const PRICING = {
  'deepseek-chat':    { input: 0.27,  output: 1.10 },
  'gemini-2.5-pro':   { input: 1.25,  output: 10.00 },
  'claude-opus-5':    { input: 5.00,  output: 25.00 },
}

export function estimateCost(model, promptTokens, completionTokens) {
  const rate = PRICING[model]
  if (!rate) return 0
  return ((promptTokens || 0) / 1e6) * rate.input + ((completionTokens || 0) / 1e6) * rate.output
}

// Never throw — a logging failure must not break the actual chat feature.
export async function logLLMUsage({ userId, source, provider, model, question, usage, latencyMs, success, errorMessage }) {
  try {
    const { error } = await supabase.from('llm_usage_logs').insert({
      user_id: userId || null,
      source,
      provider,
      model,
      question: question ? String(question).slice(0, 500) : null,
      prompt_tokens: usage?.promptTokens ?? null,
      completion_tokens: usage?.completionTokens ?? null,
      total_tokens: usage?.totalTokens ?? (usage ? (usage.promptTokens || 0) + (usage.completionTokens || 0) : null),
      latency_ms: latencyMs ?? null,
      success: success !== false,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
    })
    if (error) throw error
  } catch (err) {
    console.error('[llmUsage:log]', err)
  }
}

export async function getUsageLogs({ since, limit = 2000 } = {}) {
  let q = supabase.from('llm_usage_logs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (since) q = q.gte('created_at', since)
  const { data, error } = await q
  if (error) { console.error('[llmUsage:get]', error); return [] }
  return data || []
}

/**
 * Unified LLM service for Neo Task AI
 * Supports: DeepSeek V3, Gemini 2.5 Pro, Ollama (local)
 */
import { supabase } from './supabase'
import { getLLMSettings } from './llmSettings'
import { logLLMUsage } from './llmUsage'

const PROVIDER_BY_MODEL_ID = { 'deepseek-v3': 'deepseek', 'gemini-2.5-pro': 'gemini', 'ollama-local': 'ollama', 'claude-opus-5': 'claude' }

// UI-saved keys (Settings → AI / LLM Keys) take precedence over .env — lets
// admins rotate/set keys from the app without a redeploy. Falls back to the
// build-time VITE_ vars when no DB override is saved.
async function resolveApiKey(envVarName, dbField) {
  const settings = await getLLMSettings()
  const fromDb = settings?.[dbField]
  if (fromDb) return fromDb
  return import.meta.env[envVarName]
}

async function resolveOllamaUrl() {
  const settings = await getLLMSettings()
  return (settings?.ollama_url || import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
}

// ── Model registry ───────────────────────────────────────────
export const LLM_MODELS = [
  {
    id:          'deepseek-v3',
    label:       'DeepSeek V3',
    provider:    'DeepSeek',
    model:       'deepseek-chat',
    color:       '#6366f1',
    bg:          '#6366f118',
    description: 'Fast, efficient and cost-effective. Great for structured output.',
    context:     '64K tokens',
    speed:       'Fast',
    badge:       'Recommended',
    envKey:      'VITE_DEEPSEEK_API_KEY',
  },
  {
    id:          'gemini-2.5-pro',
    label:       'Gemini 2.5 Pro',
    provider:    'Google',
    model:       'gemini-2.5-pro',
    color:       '#0284c7',
    bg:          '#0284c718',
    description: 'Most capable model with 1M token context. Best for large, complex documents.',
    context:     '1M tokens',
    speed:       'Moderate',
    badge:       'Most Capable',
    envKey:      'VITE_GEMINI_API_KEY',
  },
  {
    id:          'ollama-local',
    label:       'Ollama (Local)',
    provider:    'Ollama',
    model:       'qwen2.5-coder:7b',
    color:       '#10b981',
    bg:          '#10b98118',
    description: 'Run AI locally on your machine. Private, no API key, no data sent to cloud.',
    context:     'Model-dependent',
    speed:       'Local',
    badge:       'Private',
    envKey:      null,
  },
  {
    id:          'claude-opus-5',
    label:       'Claude Opus 5',
    provider:    'Anthropic',
    model:       'claude-opus-5',
    color:       '#d97757',
    bg:          '#d9775718',
    description: 'Anthropic’s flagship model. Strongest reasoning, best for complex analysis.',
    context:     '1M tokens',
    speed:       'Moderate',
    badge:       'Most Capable',
    envKey:      'VITE_CLAUDE_API_KEY',
  },
]

export function getModel(id) {
  return LLM_MODELS.find(m => m.id === id) || LLM_MODELS[0]
}

const DB_FIELD_BY_ENV_KEY = { VITE_DEEPSEEK_API_KEY: 'deepseek_api_key', VITE_GEMINI_API_KEY: 'gemini_api_key', VITE_CLAUDE_API_KEY: 'claude_api_key' }

// Async, DB-aware replacement for the old synchronous `!import.meta.env[m.envKey]`
// check pages used for greying out a model card — a key saved via Settings →
// AI / LLM Keys wouldn't show up in import.meta.env, so that check alone would
// wrongly still say "missing" even once a DB key is configured.
export async function isModelUsable(modelDef) {
  if (!modelDef.envKey) return true // e.g. Ollama — no key required
  const apiKey = await resolveApiKey(modelDef.envKey, DB_FIELD_BY_ENV_KEY[modelDef.envKey])
  return Boolean(apiKey && !apiKey.startsWith('your-'))
}

// ── Main entry point ─────────────────────────────────────────
export async function analyzeRequirements(sessionId, modelId = 'deepseek-v3', ollamaModel = '', onProgress = null, userId = null) {
  const modelDef = getModel(modelId)

  const { data: session, error } = await supabase
    .from('ai_analysis_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()
  if (error || !session) throw new Error('Session not found')

  await supabase.from('ai_analysis_sessions')
    .update({ status: 'analyzing', llm_model: modelDef.id, updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  const isLocal = modelDef.id === 'ollama-local'
  const prompt = buildPrompt(session.document_text || '', session.document_name || 'document', isLocal)
  const provider = PROVIDER_BY_MODEL_ID[modelDef.id] || modelDef.id
  const actualModel = isLocal ? (ollamaModel || modelDef.model) : modelDef.model
  const start = Date.now()

  let result
  try {
    if (modelDef.id === 'gemini-2.5-pro') {
      result = await callGemini(prompt, modelDef)
    } else if (modelDef.id === 'ollama-local') {
      result = await callOllama(prompt, ollamaModel || modelDef.model, onProgress)
    } else {
      result = await callDeepSeek(prompt, modelDef)
    }
    await logLLMUsage({ userId, source: 'neo_task_ai', provider, model: actualModel, question: session.document_name, usage: result.usage, latencyMs: Date.now() - start, success: true })
  } catch (err) {
    await logLLMUsage({ userId, source: 'neo_task_ai', provider, model: actualModel, question: session.document_name, latencyMs: Date.now() - start, success: false, errorMessage: err?.message })
    throw err
  }

  const rawText = result.text
  if (!rawText) throw new Error('LLM returned empty response')

  const parsed = parseJSON(rawText)
  return await persistArtifacts(sessionId, session.project_id, parsed)
}

// ── DeepSeek API call ────────────────────────────────────────
async function callDeepSeek(prompt, modelDef) {
  const apiKey = await resolveApiKey('VITE_DEEPSEEK_API_KEY', 'deepseek_api_key')
  if (!apiKey || apiKey === 'your-deepseek-api-key-here') throw new Error('DeepSeek API key not set — add it in Settings → AI / LLM Keys, or VITE_DEEPSEEK_API_KEY in .env')

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelDef.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`DeepSeek API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, totalTokens: data.usage?.total_tokens },
  }
}

// ── Gemini 2.5 Pro API call ──────────────────────────────────
async function callGemini(prompt, modelDef) {
  const apiKey = await resolveApiKey('VITE_GEMINI_API_KEY', 'gemini_api_key')
  if (!apiKey || apiKey === 'your-gemini-api-key-here') throw new Error('Gemini API key not set — add it in Settings → AI / LLM Keys, or VITE_GEMINI_API_KEY in .env')

  // Use Google's OpenAI-compatible endpoint for consistency
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelDef.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, totalTokens: data.usage?.total_tokens },
  }
}

// ── Ollama local API call (native /api/chat endpoint) ────────
async function callOllama(prompt, model, onProgress) {
  const baseUrl = await resolveOllamaUrl()

  let res
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: true,
        // num_ctx: Ollama silently defaults unset context to 2048 tokens
        // regardless of what the model actually supports, truncating large
        // uploaded documents without any error — raise it explicitly.
        options: { temperature: 0.3, num_predict: 6000, num_ctx: 8192 },
      }),
    })
  } catch {
    throw new Error('Cannot reach Ollama. Make sure it is running: ollama serve')
  }

  if (!res.ok) {
    const err = await res.text()
    let msg
    try { msg = JSON.parse(err).error || err } catch { msg = err }
    throw new Error(`Ollama: ${msg}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''
  let tokenCount = 0
  let buf = ''
  let usage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() // keep any incomplete trailing line

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const chunk = JSON.parse(line)
        const token = chunk.message?.content
        if (token) {
          fullContent += token
          tokenCount++
          if (onProgress) onProgress({ tokens: tokenCount, preview: fullContent.slice(-100) })
        }
        if (chunk.done) {
          usage = { promptTokens: chunk.prompt_eval_count, completionTokens: chunk.eval_count }
          break
        }
      } catch {}
    }
  }

  if (!fullContent) throw new Error('Ollama returned empty response. Try a different model.')
  return { text: fullContent, usage }
}

// ── Data Assistant: plain prose chat, grounded on a precomputed data index ──
// Unlike callDeepSeek/callGemini/callOllama above (hardcoded requirements-analysis
// SYSTEM_PROMPT, forced JSON response_format), these take an arbitrary system
// prompt and return free text — for answering typed questions against a data
// snapshot rather than analyzing an uploaded document. Each accepts an optional
// onToken(deltaText) callback: when passed, the request streams and onToken
// fires per chunk as it arrives (Claude.ai-style live typing in the chat UI);
// when omitted, falls back to a single non-streaming request/response.

// Reads a fetch Response body as a byte stream, decodes it, and calls
// onLine(line) for each complete line as it arrives — the shared low-level
// mechanism behind every provider's streaming parser below (each provider
// wraps its lines differently: OpenAI-style `data: {...}` SSE, Claude's
// `event:`/`data:` SSE pairs, or Ollama's raw NDJSON — this helper only
// handles the byte-stream-to-lines part).
async function readLines(res, onLine) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) onLine(line)
  }
  if (buf) onLine(buf)
}

async function callDeepSeekChat(systemPrompt, userPrompt, modelDef, onToken, maxTokens = 700) {
  const apiKey = await resolveApiKey('VITE_DEEPSEEK_API_KEY', 'deepseek_api_key')
  if (!apiKey || apiKey === 'your-deepseek-api-key-here') throw new Error('DeepSeek API key not set — add it in Settings → AI / LLM Keys, or VITE_DEEPSEEK_API_KEY in .env')

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelDef.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(onToken ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`DeepSeek API error ${res.status}: ${err}`)
  }

  if (!onToken) {
    const data = await res.json()
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, totalTokens: data.usage?.total_tokens },
    }
  }

  let fullText = ''
  let usage = null
  await readLines(res, line => {
    if (!line.startsWith('data: ')) return
    const payload = line.slice(6)
    if (payload === '[DONE]') return
    try {
      const chunk = JSON.parse(payload)
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) { fullText += delta; onToken(delta) }
      if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens }
    } catch {}
  })
  return { text: fullText, usage }
}

async function callGeminiChat(systemPrompt, userPrompt, modelDef, onToken, maxTokens = 700) {
  const apiKey = await resolveApiKey('VITE_GEMINI_API_KEY', 'gemini_api_key')
  if (!apiKey || apiKey === 'your-gemini-api-key-here') throw new Error('Gemini API key not set — add it in Settings → AI / LLM Keys, or VITE_GEMINI_API_KEY in .env')

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelDef.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(onToken ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }

  if (!onToken) {
    const data = await res.json()
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, totalTokens: data.usage?.total_tokens },
    }
  }

  let fullText = ''
  let usage = null
  await readLines(res, line => {
    if (!line.startsWith('data: ')) return
    const payload = line.slice(6)
    if (payload === '[DONE]') return
    try {
      const chunk = JSON.parse(payload)
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) { fullText += delta; onToken(delta) }
      if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens }
    } catch {}
  })
  return { text: fullText, usage }
}

async function callOllamaChat(systemPrompt, userPrompt, model, onToken, maxTokens = 700) {
  const baseUrl = await resolveOllamaUrl()

  let res
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: !!onToken,
        // Same num_ctx fix as callOllama above — without it Ollama's 2048-token
        // default silently truncates the data snapshot before the model ever
        // sees most of it, which is why local models were "missing data".
        options: { temperature: 0.2, num_predict: maxTokens, num_ctx: 8192 },
      }),
    })
  } catch {
    throw new Error('Cannot reach Ollama. Make sure it is running: ollama serve')
  }

  if (!res.ok) {
    const err = await res.text()
    let msg
    try { msg = JSON.parse(err).error || err } catch { msg = err }
    throw new Error(`Ollama: ${msg}`)
  }

  if (!onToken) {
    const data = await res.json()
    return {
      text: data.message?.content || '',
      usage: { promptTokens: data.prompt_eval_count, completionTokens: data.eval_count },
    }
  }

  let fullText = ''
  let usage = null
  await readLines(res, line => {
    if (!line.trim()) return
    try {
      const chunk = JSON.parse(line)
      const delta = chunk.message?.content
      if (delta) { fullText += delta; onToken(delta) }
      if (chunk.done) usage = { promptTokens: chunk.prompt_eval_count, completionTokens: chunk.eval_count }
    } catch {}
  })
  return { text: fullText, usage }
}

// Anthropic's native Messages API — a different shape from the OpenAI-compatible
// endpoints above: auth is x-api-key + anthropic-version (not Authorization:
// Bearer), system prompt is a top-level field (not a messages[] entry), and
// temperature/top_p/top_k are rejected outright on claude-opus-5 (steer via
// prompting instead). Thinking is on by default on this model; effort:"low"
// keeps it fast/cheap for a quick data-assistant answer without disabling
// thinking outright (disabling it can leak stray <thinking> tags into output).
// anthropic-dangerous-direct-browser-access is required to call this API from
// browser JS at all — without it the request is blocked before CORS headers
// are even considered, since the API isn't intended to be called client-side.
async function callClaudeChat(systemPrompt, userPrompt, modelDef, onToken, maxTokens = 1024) {
  const apiKey = await resolveApiKey('VITE_CLAUDE_API_KEY', 'claude_api_key')
  if (!apiKey || apiKey === 'your-claude-api-key-here') throw new Error('Claude API key not set — add it in Settings → AI / LLM Keys, or VITE_CLAUDE_API_KEY in .env')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modelDef.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: userPrompt }],
      ...(onToken ? { stream: true } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  if (!onToken) {
    const data = await res.json()
    if (data.stop_reason === 'refusal') throw new Error('Claude declined to answer this question.')
    const textBlock = (data.content || []).find(b => b.type === 'text')
    return {
      text: textBlock?.text || '',
      usage: { promptTokens: data.usage?.input_tokens, completionTokens: data.usage?.output_tokens },
    }
  }

  // Anthropic's streaming events carry their own `type` in the data payload,
  // so we don't need to separately track the paired `event:` line — only
  // `data:` lines matter here.
  let fullText = ''
  let promptTokens, completionTokens, stopReason
  await readLines(res, line => {
    if (!line.startsWith('data: ')) return
    try {
      const chunk = JSON.parse(line.slice(6))
      if (chunk.type === 'message_start') {
        promptTokens = chunk.message?.usage?.input_tokens
      } else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        fullText += chunk.delta.text
        onToken(chunk.delta.text)
      } else if (chunk.type === 'message_delta') {
        completionTokens = chunk.usage?.output_tokens
        stopReason = chunk.delta?.stop_reason
      }
    } catch {}
  })
  if (stopReason === 'refusal') throw new Error('Claude declined to answer this question.')
  return { text: fullText, usage: { promptTokens, completionTokens } }
}

const ASSISTANT_SYSTEM_PROMPT = `You are a data assistant embedded in an ERP application called ThingsAlive NeoX.
You answer questions about the company's operational data using ONLY the JSON data snapshot provided below.

Rules:
- Answer only from the JSON snapshot. Never invent numbers, names, or facts not present in it.
- If the answer isn't in the snapshot, say so honestly (e.g. "I don't have that in the current data") instead of guessing.
- Be concise: 2-4 sentences unless the question asks for a list, in which case use short bullet points.
- Currency values in the snapshot are already formatted (e.g. "₹1,20,000") — reuse them as-is, don't reformat.
- Don't mention the word "JSON", "snapshot", or "index" in your answer — just answer naturally, like a knowledgeable colleague.`

// modelId: 'deepseek-v3' | 'gemini-2.5-pro' | 'ollama-local' | 'claude-opus-5'. Single-turn — no
// conversation memory, each question is answered fresh against the current index.
// onToken(deltaText), if passed, streams the answer live (Claude.ai-style typing)
// instead of returning it all at once — see the call*Chat functions above.
export async function askDataAssistant(question, dataIndex, modelId = 'deepseek-v3', ollamaModel = '', userId = null, onToken = null) {
  const modelDef = getModel(modelId)
  const userPrompt = `Data snapshot (as of ${dataIndex.generatedAt}):\n${JSON.stringify(dataIndex)}\n\nQuestion: ${question}`
  const provider = PROVIDER_BY_MODEL_ID[modelDef.id] || modelDef.id
  const actualModel = modelDef.id === 'ollama-local' ? (ollamaModel || modelDef.model) : modelDef.model
  const start = Date.now()

  try {
    let result
    if (modelDef.id === 'ollama-local') {
      result = await callOllamaChat(ASSISTANT_SYSTEM_PROMPT, userPrompt, ollamaModel || modelDef.model, onToken)
    } else if (modelDef.id === 'gemini-2.5-pro') {
      result = await callGeminiChat(ASSISTANT_SYSTEM_PROMPT, userPrompt, modelDef, onToken)
    } else if (modelDef.id === 'claude-opus-5') {
      result = await callClaudeChat(ASSISTANT_SYSTEM_PROMPT, userPrompt, modelDef, onToken)
    } else {
      result = await callDeepSeekChat(ASSISTANT_SYSTEM_PROMPT, userPrompt, modelDef, onToken)
    }
    await logLLMUsage({ userId, source: 'data_assistant', provider, model: actualModel, question, usage: result.usage, latencyMs: Date.now() - start, success: true })
    return result.text.trim()
  } catch (err) {
    await logLLMUsage({ userId, source: 'data_assistant', provider, model: actualModel, question, latencyMs: Date.now() - start, success: false, errorMessage: err?.message })
    throw err
  }
}

// ── Generic structured-JSON generation — the shared engine behind BOM AI,
// Product AI, and prompt-based task actions. Unlike analyzeRequirements()
// (hardcoded Neo Task AI SYSTEM_PROMPT, forced json_object response mode),
// this takes an arbitrary system prompt and relies on parseJSON()'s
// 3-strategy fallback instead of provider-level JSON mode, since
// callClaudeChat (Claude has no OpenAI-style response_format option) needs
// to go through the same path as the others. Always non-streaming — every
// caller needs the complete object before it can render anything, not a
// token stream. ──
export async function generateStructured(systemPrompt, userPrompt, modelId = 'deepseek-v3', ollamaModel = '', userId = null, source = 'ai_generate', maxTokens = 2000) {
  const modelDef = getModel(modelId)
  const provider = PROVIDER_BY_MODEL_ID[modelDef.id] || modelDef.id
  const actualModel = modelDef.id === 'ollama-local' ? (ollamaModel || modelDef.model) : modelDef.model
  const start = Date.now()

  try {
    let result
    if (modelDef.id === 'ollama-local') {
      result = await callOllamaChat(systemPrompt, userPrompt, ollamaModel || modelDef.model, null, maxTokens)
    } else if (modelDef.id === 'gemini-2.5-pro') {
      result = await callGeminiChat(systemPrompt, userPrompt, modelDef, null, maxTokens)
    } else if (modelDef.id === 'claude-opus-5') {
      result = await callClaudeChat(systemPrompt, userPrompt, modelDef, null, maxTokens)
    } else {
      result = await callDeepSeekChat(systemPrompt, userPrompt, modelDef, null, maxTokens)
    }
    await logLLMUsage({ userId, source, provider, model: actualModel, question: userPrompt.slice(0, 200), usage: result.usage, latencyMs: Date.now() - start, success: true })
    if (!result.text) throw new Error('AI returned an empty response')
    return parseJSON(result.text)
  } catch (err) {
    await logLLMUsage({ userId, source, provider, model: actualModel, question: userPrompt.slice(0, 200), latencyMs: Date.now() - start, success: false, errorMessage: err?.message })
    throw err
  }
}

// ── JSON parser (robust) ─────────────────────────────────────
function parseJSON(text) {
  try { return JSON.parse(text) } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) {
    try { return JSON.parse(match[1]) } catch {}
  }
  // Try to find first { ... } block
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  throw new Error('Could not parse AI response as JSON. Try again.')
}

// ── Persist all artifacts to Supabase ───────────────────────
async function persistArtifacts(sessionId, projectId, parsed) {
  const stories   = Array.isArray(parsed.stories)    ? parsed.stories    : []
  const backlog   = Array.isArray(parsed.backlog)     ? parsed.backlog    : []
  const tasks     = Array.isArray(parsed.tasks)       ? parsed.tasks      : []
  const testCases = Array.isArray(parsed.test_cases)  ? parsed.test_cases : []
  const apis      = Array.isArray(parsed.apis)        ? parsed.apis       : []

  // Stories
  let storyIds = []
  if (stories.length > 0) {
    const { data } = await supabase.from('ai_generated_stories').insert(
      stories.map((s, i) => ({
        session_id:           sessionId,
        project_id:           projectId || null,
        module_name:          s.module_name       || null,
        feature_name:         s.feature_name      || null,
        role:                 s.role              || 'User',
        capability:           s.capability        || '',
        business_benefit:     s.business_benefit  || null,
        ac_given:             s.acceptance_criteria?.given || null,
        ac_when:              s.acceptance_criteria?.when  || null,
        ac_then:              s.acceptance_criteria?.then  || null,
        extra_acs: Array.isArray(s.acceptance_criteria?.extra) ? s.acceptance_criteria.extra : [],
        priority:      validPriority(s.priority),
        story_points:  Number(s.story_points) || 3,
        sprint_recommendation: Number(s.sprint) || 1,
        sort_order: i,
      }))
    ).select('id')
    storyIds = (data || []).map(r => r.id)
  }

  // Backlog
  let backlogIds = []
  if (backlog.length > 0) {
    const { data } = await supabase.from('ai_generated_backlog').insert(
      backlog.map((b, i) => ({
        session_id:     sessionId,
        story_id:       storyIds[Number(b.story_index) || 0] || storyIds[0] || null,
        title:          b.title        || `Backlog item ${i + 1}`,
        description:    b.description  || null,
        priority:       validPriority(b.priority),
        business_value: b.business_value || null,
        story_points:   Number(b.story_points) || 2,
        sort_order: i,
      }))
    ).select('id')
    backlogIds = (data || []).map(r => r.id)
  }

  // Tasks
  const validTaskTypes = ['FE','BE','DB','API','INT','FW','QA','DEVOPS']
  if (tasks.length > 0) {
    await supabase.from('ai_generated_tasks').insert(
      tasks.map((t, i) => ({
        session_id:           sessionId,
        backlog_id:           backlogIds[Number(t.backlog_index) || 0] || backlogIds[0] || null,
        story_id:             storyIds[Number(t.story_index) || 0]    || storyIds[0]   || null,
        task_type:            validTaskTypes.includes(t.task_type) ? t.task_type : 'BE',
        title:                t.title           || `Task ${i + 1}`,
        description:          t.description     || null,
        validation_notes:     t.validation      || null,
        error_handling_notes: t.error_handling  || null,
        security_notes:       t.security        || null,
        audit_notes:          t.audit           || null,
        performance_notes:    t.performance     || null,
        estimated_hours:      t.estimated_hours ? Number(t.estimated_hours) : null,
        story_points:         Number(t.story_points) || 1,
        sprint_recommendation: Number(t.sprint) || 1,
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        sort_order: i,
      }))
    )
  }

  // Test cases
  const validTcTypes = ['positive','negative','edge','security','performance']
  if (testCases.length > 0) {
    await supabase.from('ai_generated_test_cases').insert(
      testCases.map((tc, i) => ({
        session_id:  sessionId,
        story_id:    storyIds[Number(tc.story_index) || 0] || storyIds[0] || null,
        title:       tc.title || `Test case ${i + 1}`,
        given_cond:  tc.given || null,
        when_action: tc.when  || null,
        then_result: tc.then  || null,
        test_type:   validTcTypes.includes(tc.type) ? tc.type : 'positive',
        priority:    validPriority(tc.priority),
        sort_order: i,
      }))
    )
  }

  // APIs
  const validMethods = ['GET','POST','PUT','PATCH','DELETE']
  if (apis.length > 0) {
    await supabase.from('ai_generated_apis').insert(
      apis.map(a => ({
        session_id:         sessionId,
        api_name:           a.name     || '',
        method:             validMethods.includes(a.method) ? a.method : 'GET',
        endpoint:           a.endpoint || '',
        request_structure:  a.request    || {},
        response_structure: a.response   || {},
        validation_rules:   Array.isArray(a.validation) ? a.validation : [],
        error_responses:    Array.isArray(a.errors)     ? a.errors     : [],
      }))
    )
  }

  // Mark completed
  await supabase.from('ai_analysis_sessions').update({
    status:           'completed',
    total_stories:    storyIds.length,
    total_tasks:      tasks.length,
    total_test_cases: testCases.length,
    updated_at:       new Date().toISOString(),
  }).eq('id', sessionId)

  return {
    ok: true,
    counts: {
      stories:    storyIds.length,
      backlog:    backlogIds.length,
      tasks:      tasks.length,
      test_cases: testCases.length,
      apis:       apis.length,
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────
function validPriority(p) {
  return ['low','medium','high','critical'].includes(p) ? p : 'medium'
}

const SYSTEM_PROMPT = `You are Neo Task AI — an expert Solution Architect, Product Owner, and Technical Lead. You convert requirement documents into complete, implementation-ready project artifacts. Always return valid JSON only. Never include any text outside the JSON object.`

function buildPrompt(docText, docName, isLocal = false) {
  // Local 7B models have limited context — keep input tight
  const maxChars = isLocal ? 6000 : 14000
  return `Analyze this requirement document and generate a complete project execution plan.

Document: "${docName}"
---
${docText.slice(0, maxChars)}
---

Return a JSON object with this exact structure. Be specific and implementation-ready, never generic.

{
  "stories": [
    {
      "module_name": "Module name",
      "feature_name": "Feature name",
      "role": "Role (e.g. Project Manager, Developer, Admin)",
      "capability": "what they want to do",
      "business_benefit": "the business outcome",
      "priority": "critical|high|medium|low",
      "story_points": 3,
      "sprint": 1,
      "acceptance_criteria": {
        "given": "Given precondition",
        "when": "When action is performed",
        "then": "Then expected outcome",
        "extra": [
          { "type": "negative", "given": "...", "when": "...", "then": "..." },
          { "type": "edge",     "given": "...", "when": "...", "then": "..." },
          { "type": "security", "given": "...", "when": "...", "then": "..." }
        ]
      }
    }
  ],
  "backlog": [
    {
      "story_index": 0,
      "title": "Backlog item title",
      "description": "What needs to be built",
      "priority": "high|medium|low|critical",
      "business_value": "Why this matters",
      "story_points": 2
    }
  ],
  "tasks": [
    {
      "story_index": 0,
      "backlog_index": 0,
      "task_type": "FE|BE|DB|API|INT|FW|QA|DEVOPS",
      "title": "Specific actionable task title",
      "description": "Exactly what to implement",
      "validation": "Input validation rules",
      "error_handling": "Error scenarios and handling",
      "security": "Auth, permissions, sanitization",
      "audit": "What to log",
      "performance": "Indexes, caching, pagination",
      "estimated_hours": 4,
      "story_points": 1,
      "sprint": 1,
      "dependencies": ["Dependent task title"]
    }
  ],
  "test_cases": [
    {
      "story_index": 0,
      "title": "Test case title",
      "given": "Precondition",
      "when": "Action",
      "then": "Expected result",
      "type": "positive|negative|edge|security|performance",
      "priority": "high|medium|low"
    }
  ],
  "apis": [
    {
      "name": "API name",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "endpoint": "/api/resource",
      "request":  { "body": {}, "params": {}, "headers": {} },
      "response": { "success": {}, "error": {} },
      "validation": ["rule 1"],
      "errors": [{ "code": 400, "message": "Bad request" }]
    }
  ]
}

Rules:
- Sprint 1 = DB/backend foundations, Sprint 2 = frontend/features, Sprint 3 = QA/polish/DevOps
- Generate tasks for ALL types: FE, BE, DB, API, QA
- Minimum 2 positive + 1 negative + 1 edge + 1 security test case per story
- story_index and backlog_index are 0-based positions in their arrays`
}

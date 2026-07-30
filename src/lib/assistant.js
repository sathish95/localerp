import { buildDataIndex } from './dataIndex'
import { askDataAssistant } from './llm'

// Session-scoped cache of already-answered free-text questions, keyed by
// normalized text + model. Typed questions always go straight to the AI now
// (fuzzy keyword matching against the canned list used to silently misroute
// things — e.g. "pr" matched inside "project" — which was worse than just
// asking the AI every time). This cache is what makes a *repeated* question
// instant again without reintroducing that fragile matching.
const answerCache = new Map()
function cacheKey(text, modelId) { return `${modelId}::${text.trim().toLowerCase().replace(/\s+/g, ' ')}` }

// Shared model preference — set from either surface (bubble or full page),
// read by both, so picking a model in one place doesn't get silently
// ignored by the other (the bubble used to always hardcode 'deepseek-v3').
const MODEL_KEY = 'nx_assistant_model'

export function getPreferredModel() {
  try { return localStorage.getItem(MODEL_KEY) || 'deepseek-v3' } catch { return 'deepseek-v3' }
}

export function setPreferredModel(id) {
  try { localStorage.setItem(MODEL_KEY, id) } catch {}
}

// Shared "ask anything" flow used by both AskBubble (corner widget) and
// DataAssistantPage (full page). The fixed QUESTIONS chips still answer
// instantly by calling their own .run() directly (see AskBubble/DataAssistantPage's
// ask()) — this function is only for free-typed text, which always goes to
// the AI, with an exact-repeat cache so asking the same thing twice is instant.
// onToken(deltaText), if passed, streams the answer live as it's generated
// (Claude.ai-style typing) — a cache hit still delivers through onToken, just
// as one single chunk rather than a fake replay.
export async function answerQuestion(text, profile, { modelId = 'deepseek-v3', ollamaModel = '', onToken = null } = {}) {
  const key = cacheKey(text, modelId)
  if (answerCache.has(key)) {
    const cached = answerCache.get(key)
    if (onToken) onToken(cached)
    return cached
  }

  try {
    const index = await buildDataIndex()
    const answer = await askDataAssistant(text, index, modelId, ollamaModel, profile?.id, onToken)
    answerCache.set(key, answer)
    return answer
  } catch (err) {
    console.error('[assistant:answerQuestion]', err)
    const message = `Sorry, I couldn't work that out (${err?.message || 'unknown error'}).`
    if (onToken) onToken(message)
    return message
  }
}

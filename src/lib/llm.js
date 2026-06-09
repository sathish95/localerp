/**
 * Unified LLM service for Neo Task AI
 * Supports: DeepSeek V3, Gemini 2.5 Pro
 */
import { supabase } from './supabase'

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
]

export function getModel(id) {
  return LLM_MODELS.find(m => m.id === id) || LLM_MODELS[0]
}

// ── Main entry point ─────────────────────────────────────────
export async function analyzeRequirements(sessionId, modelId = 'deepseek-v3') {
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

  const prompt = buildPrompt(session.document_text || '', session.document_name || 'document')

  let rawText
  if (modelDef.id === 'gemini-2.5-pro') {
    rawText = await callGemini(prompt, modelDef)
  } else {
    rawText = await callDeepSeek(prompt, modelDef)
  }

  if (!rawText) throw new Error('LLM returned empty response')

  const parsed = parseJSON(rawText)
  return await persistArtifacts(sessionId, session.project_id, parsed)
}

// ── DeepSeek API call ────────────────────────────────────────
async function callDeepSeek(prompt, modelDef) {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
  if (!apiKey || apiKey === 'your-deepseek-api-key-here') throw new Error('VITE_DEEPSEEK_API_KEY not set in .env')

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
  return data.choices?.[0]?.message?.content || ''
}

// ── Gemini 2.5 Pro API call ──────────────────────────────────
async function callGemini(prompt, modelDef) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey || apiKey === 'your-gemini-api-key-here') throw new Error('VITE_GEMINI_API_KEY not set in .env')

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
  return data.choices?.[0]?.message?.content || ''
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

function buildPrompt(docText, docName) {
  return `Analyze this requirement document and generate a complete project execution plan.

Document: "${docName}"
---
${docText.slice(0, 14000)}
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

import { supabase } from './supabase'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY

/**
 * Analyze a requirement document and save all artifacts to Supabase.
 * Returns { ok, counts } or throws on error.
 */
export async function analyzeRequirements(sessionId) {
  // Load the session text from Supabase
  const { data: session, error } = await supabase
    .from('ai_analysis_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()
  if (error || !session) throw new Error('Session not found')

  // Mark analyzing
  await supabase.from('ai_analysis_sessions')
    .update({ status: 'analyzing', updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  // Call DeepSeek V3
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: 'You are Neo Task AI — an expert Solution Architect, Product Owner, and Technical Lead. You convert requirement documents into complete, implementation-ready project artifacts. Always return valid JSON only.',
        },
        {
          role: 'user',
          content: buildPrompt(session.document_text || '', session.document_name || 'document'),
        },
      ],
      max_tokens: 8000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`DeepSeek API error ${res.status}: ${errText}`)
  }

  const aiData = await res.json()
  const rawText = aiData.choices?.[0]?.message?.content || ''
  if (!rawText) throw new Error('DeepSeek returned empty response')

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (!match) throw new Error('Could not parse AI response as JSON')
    parsed = JSON.parse(match[1])
  }

  const stories    = Array.isArray(parsed.stories)    ? parsed.stories    : []
  const backlog    = Array.isArray(parsed.backlog)     ? parsed.backlog    : []
  const tasks      = Array.isArray(parsed.tasks)       ? parsed.tasks      : []
  const testCases  = Array.isArray(parsed.test_cases)  ? parsed.test_cases : []
  const apis       = Array.isArray(parsed.apis)        ? parsed.apis       : []

  // ── Insert stories ──────────────────────────────────────────
  const storyInserts = stories.map((s, i) => ({
    session_id: sessionId,
    project_id: session.project_id || null,
    module_name: s.module_name || null,
    feature_name: s.feature_name || null,
    role: s.role || 'User',
    capability: s.capability || '',
    business_benefit: s.business_benefit || null,
    ac_given: s.acceptance_criteria?.given || null,
    ac_when:  s.acceptance_criteria?.when  || null,
    ac_then:  s.acceptance_criteria?.then  || null,
    extra_acs: Array.isArray(s.acceptance_criteria?.extra) ? s.acceptance_criteria.extra : [],
    priority: ['low','medium','high','critical'].includes(s.priority) ? s.priority : 'medium',
    story_points: Number(s.story_points) || 3,
    sprint_recommendation: Number(s.sprint) || 1,
    sort_order: i,
  }))

  let storyIds = []
  if (storyInserts.length > 0) {
    const { data } = await supabase.from('ai_generated_stories').insert(storyInserts).select('id')
    storyIds = (data || []).map(r => r.id)
  }

  // ── Insert backlog ──────────────────────────────────────────
  const backlogInserts = backlog.map((b, i) => ({
    session_id: sessionId,
    story_id: storyIds[Number(b.story_index) || 0] || storyIds[0] || null,
    title: b.title || `Backlog item ${i + 1}`,
    description: b.description || null,
    priority: ['low','medium','high','critical'].includes(b.priority) ? b.priority : 'medium',
    business_value: b.business_value || null,
    story_points: Number(b.story_points) || 2,
    sort_order: i,
  }))

  let backlogIds = []
  if (backlogInserts.length > 0) {
    const { data } = await supabase.from('ai_generated_backlog').insert(backlogInserts).select('id')
    backlogIds = (data || []).map(r => r.id)
  }

  // ── Insert tasks ────────────────────────────────────────────
  const validTypes = ['FE','BE','DB','API','INT','FW','QA','DEVOPS']
  const taskInserts = tasks.map((t, i) => ({
    session_id: sessionId,
    backlog_id: backlogIds[Number(t.backlog_index) || 0] || backlogIds[0] || null,
    story_id:   storyIds[Number(t.story_index) || 0]    || storyIds[0]   || null,
    task_type: validTypes.includes(t.task_type) ? t.task_type : 'BE',
    title: t.title || `Task ${i + 1}`,
    description:          t.description    || null,
    validation_notes:     t.validation     || null,
    error_handling_notes: t.error_handling || null,
    security_notes:       t.security       || null,
    audit_notes:          t.audit          || null,
    performance_notes:    t.performance    || null,
    estimated_hours: t.estimated_hours ? Number(t.estimated_hours) : null,
    story_points: Number(t.story_points) || 1,
    sprint_recommendation: Number(t.sprint) || 1,
    dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
    sort_order: i,
  }))

  if (taskInserts.length > 0) {
    await supabase.from('ai_generated_tasks').insert(taskInserts)
  }

  // ── Insert test cases ───────────────────────────────────────
  const validTcTypes = ['positive','negative','edge','security','performance']
  const tcInserts = testCases.map((tc, i) => ({
    session_id: sessionId,
    story_id: storyIds[Number(tc.story_index) || 0] || storyIds[0] || null,
    title:       tc.title || `Test case ${i + 1}`,
    given_cond:  tc.given || null,
    when_action: tc.when  || null,
    then_result: tc.then  || null,
    test_type: validTcTypes.includes(tc.type) ? tc.type : 'positive',
    priority: ['low','medium','high','critical'].includes(tc.priority) ? tc.priority : 'medium',
    sort_order: i,
  }))

  if (tcInserts.length > 0) {
    await supabase.from('ai_generated_test_cases').insert(tcInserts)
  }

  // ── Insert APIs ─────────────────────────────────────────────
  const validMethods = ['GET','POST','PUT','PATCH','DELETE']
  const apiInserts = apis.map(a => ({
    session_id: sessionId,
    api_name: a.name || '',
    method: validMethods.includes(a.method) ? a.method : 'GET',
    endpoint: a.endpoint || '',
    request_structure:  a.request    || {},
    response_structure: a.response   || {},
    validation_rules:   Array.isArray(a.validation) ? a.validation : [],
    error_responses:    Array.isArray(a.errors)     ? a.errors     : [],
  }))

  if (apiInserts.length > 0) {
    await supabase.from('ai_generated_apis').insert(apiInserts)
  }

  // ── Mark completed ──────────────────────────────────────────
  await supabase.from('ai_analysis_sessions').update({
    status: 'completed',
    total_stories:    storyIds.length,
    total_tasks:      taskInserts.length,
    total_test_cases: tcInserts.length,
    updated_at: new Date().toISOString(),
  }).eq('id', sessionId)

  return {
    ok: true,
    counts: {
      stories:    storyIds.length,
      backlog:    backlogIds.length,
      tasks:      taskInserts.length,
      test_cases: tcInserts.length,
      apis:       apiInserts.length,
    },
  }
}

function buildPrompt(docText, docName) {
  return `Analyze this requirement document and generate a complete project execution plan.

Document: "${docName}"
---
${docText.slice(0, 14000)}
---

Return a JSON object with this exact structure. Be specific, never generic. Every task must include implementation details.

{
  "stories": [
    {
      "module_name": "Module name",
      "feature_name": "Feature name",
      "role": "Role (e.g. Project Manager, Developer, Admin, User)",
      "capability": "what they want to do (the I want to... part)",
      "business_benefit": "the business outcome (the So that... part)",
      "priority": "critical|high|medium|low",
      "story_points": 3,
      "sprint": 1,
      "acceptance_criteria": {
        "given": "Given precondition",
        "when": "When action is performed",
        "then": "Then expected outcome",
        "extra": [
          { "type": "negative", "given": "...", "when": "...", "then": "..." },
          { "type": "edge", "given": "...", "when": "...", "then": "..." },
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
      "validation": "Input validation rules to enforce",
      "error_handling": "Error scenarios and how to handle them",
      "security": "Auth, RLS, permissions, sanitization requirements",
      "audit": "What to log for audit trail",
      "performance": "Indexes, caching, pagination considerations",
      "estimated_hours": 4,
      "story_points": 1,
      "sprint": 1,
      "dependencies": ["Title of task this depends on"]
    }
  ],
  "test_cases": [
    {
      "story_index": 0,
      "title": "Test case title",
      "given": "Given precondition",
      "when": "When action",
      "then": "Then expected result",
      "type": "positive|negative|edge|security|performance",
      "priority": "high|medium|low"
    }
  ],
  "apis": [
    {
      "name": "API name",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "endpoint": "/api/resource",
      "request": { "body": {}, "params": {}, "headers": {} },
      "response": { "success": {}, "error": {} },
      "validation": ["validation rule 1"],
      "errors": [{ "code": 400, "message": "Bad request" }]
    }
  ]
}

Sprint guidelines: Sprint 1 = DB/backend foundations, Sprint 2 = frontend/features, Sprint 3 = QA/polish/DevOps.
Generate tasks for ALL types (FE, BE, DB, API, QA). Minimum 2 positive + 1 negative + 1 edge test case per story.
story_index and backlog_index are 0-based positions in their respective arrays.`
}

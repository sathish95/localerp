// Supabase Edge Function: analyze-requirements
// Uses DeepSeek V3 (deepseek-chat) to parse requirement documents into project artifacts
//
// Deploy:
//   supabase functions deploy analyze-requirements
//   supabase secrets set DEEPSEEK_API_KEY=sk-your-deepseek-key
//
// Get your key at: https://platform.deepseek.com/api_keys

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { session_id } = await req.json()
    if (!session_id) return errorRes('session_id required')

    // Load session
    const { data: session, error: sErr } = await supabase
      .from('ai_analysis_sessions')
      .select('*')
      .eq('id', session_id)
      .single()
    if (sErr || !session) return errorRes('Session not found')

    // Mark as analyzing
    await supabase.from('ai_analysis_sessions')
      .update({ status: 'analyzing', updated_at: new Date().toISOString() })
      .eq('id', session_id)

    // ── Call DeepSeek V3 ─────────────────────────────────────────
    const apiKey = Deno.env.get('DEEPSEEK_API_KEY')
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY secret not set. Run: supabase secrets set DEEPSEEK_API_KEY=sk-...')

    const prompt = buildPrompt(session.document_text || '', session.document_name || 'document')

    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',   // DeepSeek V3
        messages: [
          {
            role: 'system',
            content: 'You are Neo Task AI — an expert Solution Architect, Product Owner, and Technical Lead. You convert requirement documents into complete, implementation-ready project artifacts. You ALWAYS return valid JSON. Never return anything outside the JSON code block.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 8000,
        temperature: 0.3,   // Lower temp = more structured, consistent JSON output
        response_format: { type: 'json_object' },  // DeepSeek supports JSON mode
      }),
    })

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text()
      throw new Error(`DeepSeek API error ${deepseekRes.status}: ${errText}`)
    }

    const aiData = await deepseekRes.json()
    const rawText = aiData.choices?.[0]?.message?.content || ''

    if (!rawText) throw new Error('DeepSeek returned empty response')

    // Parse JSON — DeepSeek JSON mode returns clean JSON directly
    let parsed: any
    try {
      parsed = JSON.parse(rawText)
    } catch {
      // Fallback: try to extract from markdown code block
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (!match) throw new Error('Could not parse AI response as JSON')
      parsed = JSON.parse(match[1])
    }

    // ── Persist artifacts ────────────────────────────────────────
    const stories    = Array.isArray(parsed.stories)    ? parsed.stories    : []
    const backlogItems = Array.isArray(parsed.backlog)  ? parsed.backlog    : []
    const tasks      = Array.isArray(parsed.tasks)      ? parsed.tasks      : []
    const testCases  = Array.isArray(parsed.test_cases) ? parsed.test_cases : []
    const apis       = Array.isArray(parsed.apis)       ? parsed.apis       : []

    // Stories
    const storyInserts = stories.map((s: any, i: number) => ({
      session_id,
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

    let storyIds: string[] = []
    if (storyInserts.length > 0) {
      const { data: ins } = await supabase.from('ai_generated_stories').insert(storyInserts).select('id')
      storyIds = (ins || []).map((r: any) => r.id)
    }

    // Backlog
    const backlogInserts = backlogItems.map((b: any, i: number) => ({
      session_id,
      story_id: storyIds[Number(b.story_index) || 0] || storyIds[0] || null,
      title: b.title || `Backlog item ${i + 1}`,
      description: b.description || null,
      priority: ['low','medium','high','critical'].includes(b.priority) ? b.priority : 'medium',
      business_value: b.business_value || null,
      story_points: Number(b.story_points) || 2,
      sort_order: i,
    }))

    let backlogIds: string[] = []
    if (backlogInserts.length > 0) {
      const { data: ins } = await supabase.from('ai_generated_backlog').insert(backlogInserts).select('id')
      backlogIds = (ins || []).map((r: any) => r.id)
    }

    // Tasks
    const validTaskTypes = ['FE','BE','DB','API','INT','FW','QA','DEVOPS']
    const taskInserts = tasks.map((t: any, i: number) => ({
      session_id,
      backlog_id: backlogIds[Number(t.backlog_index) || 0] || backlogIds[0] || null,
      story_id:   storyIds[Number(t.story_index) || 0]   || storyIds[0]   || null,
      task_type:  validTaskTypes.includes(t.task_type) ? t.task_type : 'BE',
      title: t.title || `Task ${i + 1}`,
      description:          t.description   || null,
      validation_notes:     t.validation    || null,
      error_handling_notes: t.error_handling || null,
      security_notes:       t.security      || null,
      audit_notes:          t.audit         || null,
      performance_notes:    t.performance   || null,
      estimated_hours: t.estimated_hours ? Number(t.estimated_hours) : null,
      story_points: Number(t.story_points) || 1,
      sprint_recommendation: Number(t.sprint) || 1,
      dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
      sort_order: i,
    }))

    if (taskInserts.length > 0) {
      await supabase.from('ai_generated_tasks').insert(taskInserts)
    }

    // Test cases
    const validTestTypes = ['positive','negative','edge','security','performance']
    const tcInserts = testCases.map((tc: any, i: number) => ({
      session_id,
      story_id: storyIds[Number(tc.story_index) || 0] || storyIds[0] || null,
      title:       tc.title  || `Test case ${i + 1}`,
      given_cond:  tc.given  || null,
      when_action: tc.when   || null,
      then_result: tc.then   || null,
      test_type: validTestTypes.includes(tc.type) ? tc.type : 'positive',
      priority: ['low','medium','high','critical'].includes(tc.priority) ? tc.priority : 'medium',
      sort_order: i,
    }))

    if (tcInserts.length > 0) {
      await supabase.from('ai_generated_test_cases').insert(tcInserts)
    }

    // APIs
    const validMethods = ['GET','POST','PUT','PATCH','DELETE']
    const apiInserts = apis.map((a: any) => ({
      session_id,
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

    // Mark session completed
    await supabase.from('ai_analysis_sessions').update({
      status: 'completed',
      total_stories:    storyIds.length,
      total_tasks:      taskInserts.length,
      total_test_cases: tcInserts.length,
      updated_at: new Date().toISOString(),
    }).eq('id', session_id)

    return new Response(JSON.stringify({
      ok: true,
      session_id,
      counts: {
        stories:    storyIds.length,
        backlog:    backlogIds.length,
        tasks:      taskInserts.length,
        test_cases: tcInserts.length,
        apis:       apiInserts.length,
      },
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('analyze-requirements error:', err)

    // Mark session as failed if session_id is available
    try {
      const body = await (err as any)?.request?.json?.()
      if (body?.session_id) {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
        await supabase.from('ai_analysis_sessions').update({
          status: 'failed',
          error_message: err.message,
        }).eq('id', body.session_id)
      }
    } catch {}

    return errorRes(err.message || 'Internal error', 500)
  }
})

function errorRes(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function buildPrompt(docText: string, docName: string): string {
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
      "capability": "what they want to do (the 'I want to...' part)",
      "business_benefit": "the business outcome (the 'So that...' part)",
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

Sprint guidelines:
- Sprint 1: DB schema, core backend, foundational APIs
- Sprint 2: Frontend, main features, integrations
- Sprint 3: QA, polish, edge cases, DevOps

Generate tasks for ALL types (FE, BE, DB, API, QA). Minimum 2 positive + 1 negative + 1 edge test case per story. story_index and backlog_index are 0-based positions in their arrays.`
}

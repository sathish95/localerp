import { generateStructured } from './llm'

// Prompt-based task actions — intentionally the narrowest of the three new
// AI features. This is the one surface where "AI writes to the database"
// is even on the table, so the scope is deliberately small: exactly two
// intents (create a task, change an existing task's status), both inside
// project_tasks only — never procurement/finance/approval-chain-guarded
// tables. The model NEVER writes directly: it only returns a parsed
// intent; TasksPage.jsx resolves the target record itself (fuzzy-matched
// against the real in-memory task/member lists, not trusted from the
// model), shows a human a confirm card with the resolved record, and only
// on explicit confirm does it call the exact same
// supabase.from('project_tasks').insert/update(...) path the existing
// New Task button / drag-and-drop already use — so it's gated by the same
// myPerm.can_create / can_change_status checks as any other write on that
// page, not a new permission surface.
export const TASK_STATUSES = ['backlog','todo','in_progress','delayed','qa','ready_for_demo','closed']

const SYSTEM_PROMPT = `You parse a single natural-language instruction into a task action for a project-management tool.

Recognize exactly one of two intents:
- "create_task": the user wants to create a new task.
- "update_status": the user wants to change an existing task's status.
If neither is clearly intended, use intent "unclear" and explain why in "reason".

Valid status values: ${TASK_STATUSES.join(', ')} (backlog=not started, todo=queued, in_progress=being worked,
delayed=blocked/late, qa=in testing, ready_for_demo=done pending demo, closed=fully done).

Return ONLY a JSON object, no other text, matching this exact shape:
{
  "intent": "create_task | update_status | unclear",
  "reason": "only if intent is unclear, explain briefly",
  "task_name": "for create_task: a short task title",
  "description": "for create_task: longer description, or empty string",
  "assignee_name": "for create_task: a person's name mentioned, or empty string if none",
  "priority": "for create_task: low|medium|high|critical, default medium",
  "due_date": "for create_task: an ISO date YYYY-MM-DD if a date/day was mentioned (resolve relative terms like 'Friday' or 'next week' using the given today's date), else empty string",
  "task_match": "for update_status: text identifying which existing task, e.g. its title or a distinctive substring",
  "new_status": "for update_status: one of the valid status values"
}`

export async function parseTaskCommand({ prompt, modelId, ollamaModel, userId }) {
  const today = new Date().toISOString().slice(0, 10)
  const userPrompt = `Today's date is ${today}. Instruction: ${prompt}`
  const result = await generateStructured(SYSTEM_PROMPT, userPrompt, modelId, ollamaModel, userId, 'workflow_ai', 600)
  return {
    intent: ['create_task', 'update_status', 'unclear'].includes(result.intent) ? result.intent : 'unclear',
    reason: result.reason || '',
    task_name: (result.task_name || '').toString().trim(),
    description: (result.description || '').toString().trim(),
    assignee_name: (result.assignee_name || '').toString().trim(),
    priority: ['low','medium','high','critical'].includes(result.priority) ? result.priority : 'medium',
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(result.due_date) ? result.due_date : '',
    task_match: (result.task_match || '').toString().trim(),
    new_status: TASK_STATUSES.includes(result.new_status) ? result.new_status : '',
  }
}

// Simple case-insensitive substring/token overlap scorer — good enough to
// rank a small in-memory task list client-side; not meant to be a real
// fuzzy-search library. Returns candidates sorted best-first.
export function matchTasks(query, tasks) {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const qTokens = q.split(/\s+/).filter(Boolean)
  return tasks
    .map(t => {
      const name = (t.task_name || '').toLowerCase()
      let score = 0
      if (name === q) score = 100
      else if (name.includes(q)) score = 60
      else score = qTokens.filter(tok => name.includes(tok)).length * 10
      return { task: t, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.task)
}

export function matchMember(name, members) {
  if (!name) return null
  const q = name.toLowerCase().trim()
  return members.find(m => (m.full_name || '').toLowerCase() === q)
    || members.find(m => (m.full_name || '').toLowerCase().includes(q))
    || null
}

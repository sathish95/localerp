import { supabase } from './supabase'

// Fields tracked for the task history/audit trail (STEP197) — a curated
// set of structured, verifiable fields. `description` is deliberately
// excluded: it's rich-text HTML now (RichTextEditor), and Daily Updates
// (task_comments) already carries the narrative "what changed and why".
export const TRACKED_TASK_FIELDS = [
  'task_name', 'task_type', 'status', 'priority', 'assigned_to', 'department_id',
  'module_name', 'planned_start_date', 'planned_end_date', 'estimated_hours',
  'actual_hours', 'sprint_id', 'user_story_id',
]

function normalize(v) {
  return v === undefined || v === null || v === '' ? null : String(v)
}

// Diffs only the tracked fields present in `next` against `prev` (a full
// task row) — returns [{field_name, old_value, new_value}, ...] for
// whatever actually changed.
export function diffTaskFields(prev, next) {
  const out = []
  for (const f of TRACKED_TASK_FIELDS) {
    if (!(f in next)) continue
    const before = normalize(prev?.[f])
    const after = normalize(next[f])
    if (before !== after) out.push({ field_name: f, old_value: before, new_value: after })
  }
  return out
}

// Fire-and-forget — a logging failure should never block the task save
// itself. Skips entirely if nothing changed.
export async function logTaskChanges(taskId, userId, changes) {
  if (!changes?.length) return
  try {
    await supabase.from('task_change_log').insert(
      changes.map(c => ({ task_id: taskId, changed_by: userId, ...c }))
    )
  } catch (e) { console.error('logTaskChanges failed', e) }
}

export async function listTaskHistory(taskId) {
  const { data, error } = await supabase.from('task_change_log')
    .select('*').eq('task_id', taskId).order('created_at', { ascending: false })
  if (error) { console.error(error); return [] }
  return data || []
}

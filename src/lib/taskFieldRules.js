import { supabase } from './supabase'

// STEP226 — org-wide required/optional toggles for the Task create/edit
// form (TasksPage.jsx's TaskForm + saveTask()), configured from Settings
// → Task Field Rules. Two independent flags per field since a field can
// reasonably be optional on quick-create but mandatory by the time
// someone edits/refines the task (or vice versa).
export const TASK_FIELD_CATALOG = [
  { key: 'task_name',          label: 'Task Name' },
  { key: 'description',        label: 'Description' },
  { key: 'task_type',          label: 'Type' },
  { key: 'module_name',        label: 'Module' },
  { key: 'priority',           label: 'Priority' },
  { key: 'assigned_to',        label: 'Assigned To' },
  { key: 'department_id',      label: 'Department' },
  { key: 'project_id',         label: 'Project' },
  { key: 'planned_start_date', label: 'Planned Start' },
  { key: 'planned_end_date',   label: 'Planned End' },
  { key: 'estimated_hours',    label: 'Estimated Hours' },
  { key: 'user_story_id',      label: 'User Story' },
  { key: 'sprint_id',          label: 'Sprint' },
]

export async function listTaskFieldRules() {
  const { data, error } = await supabase.from('task_field_rules').select('*')
  if (error) throw error
  return data || []
}

// rows -> { [field_key]: { required_on_create, required_on_edit } }
export function fieldRulesToMap(rows) {
  const map = {}
  for (const r of rows || []) map[r.field_key] = { required_on_create: r.required_on_create, required_on_edit: r.required_on_edit }
  return map
}

// rules: [{ field_key, required_on_create, required_on_edit }]
export async function saveTaskFieldRules(rules, organizationId) {
  const rows = rules.map(r => ({
    organization_id: organizationId,
    field_key: r.field_key,
    required_on_create: !!r.required_on_create,
    required_on_edit: !!r.required_on_edit,
  }))
  const { error } = await supabase.from('task_field_rules').upsert(rows, { onConflict: 'organization_id,field_key' })
  if (error) throw error
}

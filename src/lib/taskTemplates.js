import { supabase } from './supabase'

// Industry-Adaptive Platform — Phase 8. Admin CRUD for `task_templates`
// (STEP182, created inert in Phase 4 — that phase explicitly deferred
// building this UI: "no admin UI anywhere to create one yet"). Checklist
// items use the exact same shape project_tasks.checklist / MyWorkPage.jsx's
// completion flow already use: { id, label, type, required, value }.

// The universal set of checklist item types available everywhere a
// checklist is edited — Settings → Task Templates' default_checklist AND
// a single task's own project_tasks.checklist (TasksPage.jsx Task Detail).
// One shared list so the two editors can never drift apart.
export const CHECKLIST_TYPES = ['checkbox', 'text', 'number', 'date', 'dropdown', 'photo', 'file', 'signature', 'measurement', 'pass_fail']

export async function listTaskTemplates() {
  const { data, error } = await supabase.from('task_templates').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function createTaskTemplate(payload, userId) {
  const { error } = await supabase.from('task_templates').insert({
    name: payload.name,
    task_type: payload.taskType || null,
    estimated_hours: payload.estimatedHours ? parseFloat(payload.estimatedHours) : null,
    requires_approval: !!payload.requiresApproval,
    default_checklist: payload.checklist || [],
    created_by: userId,
  })
  if (error) throw error
}

export async function updateTaskTemplate(id, payload) {
  const { error } = await supabase.from('task_templates').update({
    name: payload.name,
    task_type: payload.taskType || null,
    estimated_hours: payload.estimatedHours ? parseFloat(payload.estimatedHours) : null,
    requires_approval: !!payload.requiresApproval,
    default_checklist: payload.checklist || [],
  }).eq('id', id)
  if (error) throw error
}

export async function deleteTaskTemplate(id) {
  const { error } = await supabase.from('task_templates').delete().eq('id', id)
  if (error) throw error
}

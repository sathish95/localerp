import { supabase } from './supabase'

// Task queue — "my open tasks today," distinct from the Activity history
// log. "Overdue" is computed here (not stored) so it's never stale: a row
// is overdue when due_date has passed and status isn't Completed.

export function isOverdue(task) {
  if (task.status === 'Completed') return false
  return task.due_date < new Date().toISOString().slice(0, 10)
}

export async function getMyQueue(profileId) {
  const { data, error } = await supabase.from('sales_tasks')
    .select('*, creator:profiles!created_by(full_name)')
    .eq('assigned_to', profileId).neq('status', 'Completed')
    .order('due_date')
  if (error) throw error
  return data || []
}

// Team-wide queue for managers (Regional/Sales Head) — optionally scoped
// to a set of rep ids (their region's reps).
export async function getTeamQueue(repIds) {
  let q = supabase.from('sales_tasks')
    .select('*, assignee:profiles!assigned_to(full_name)')
    .order('due_date')
  if (repIds?.length) q = q.in('assigned_to', repIds)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function listTasks(relatedToType, relatedToId) {
  const { data, error } = await supabase.from('sales_tasks')
    .select('*, assignee:profiles!assigned_to(full_name)')
    .eq('related_to_type', relatedToType).eq('related_to_id', relatedToId)
    .order('due_date')
  if (error) throw error
  return data || []
}

export async function createTask(form, userId) {
  const { data, error } = await supabase.from('sales_tasks').insert({
    related_to_type: form.related_to_type, related_to_id: form.related_to_id,
    task_type: form.task_type, assigned_to: form.assigned_to, due_date: form.due_date,
    priority: form.priority || 'Medium', created_by: userId, linked_activity_id: form.linked_activity_id || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateTaskStatus(id, status) {
  const { error } = await supabase.from('sales_tasks').update({ status }).eq('id', id)
  if (error) throw error
}

export async function reassignTask(id, newAssigneeId, userId) {
  const { data: task } = await supabase.from('sales_tasks').select('assigned_to').eq('id', id).single()
  const { error } = await supabase.from('sales_tasks').update({ assigned_to: newAssigneeId }).eq('id', id)
  if (error) throw error
  await supabase.from('sales_task_reassignment_log').insert({
    task_id: id, from_employee: task?.assigned_to || null, to_employee: newAssigneeId, changed_by: userId,
  })
}

export async function deleteTask(id) {
  const { error } = await supabase.from('sales_tasks').delete().eq('id', id)
  if (error) throw error
}

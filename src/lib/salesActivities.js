import { supabase } from './supabase'

// Activity = "what happened" (the call/email/meeting log). Distinct from
// sales_tasks, which is "what needs to happen" — see createFollowUpTask
// below for how the two connect.

export async function listActivities(relatedToType, relatedToId) {
  const { data, error } = await supabase.from('sales_activities')
    .select('*, performer:profiles!performed_by(full_name)')
    .eq('related_to_type', relatedToType).eq('related_to_id', relatedToId)
    .order('activity_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createActivity(form, userId) {
  const payload = {
    related_to_type: form.related_to_type, related_to_id: form.related_to_id,
    activity_type: form.activity_type, direction: form.direction, performed_by: userId,
    activity_date: form.activity_date || new Date().toISOString(),
    duration_minutes: form.duration_minutes || null, notes: form.notes || null,
    outcome: form.outcome || null, next_follow_up_date: form.next_follow_up_date || null,
  }
  const { data: activity, error } = await supabase.from('sales_activities').insert(payload).select().single()
  if (error) throw error

  // "next action" on an activity auto-creates the follow-up task instead
  // of relying on the rep to remember to add one separately.
  if (form.next_follow_up_date) {
    await supabase.from('sales_tasks').insert({
      related_to_type: form.related_to_type, related_to_id: form.related_to_id,
      task_type: 'Follow-up Call', assigned_to: userId, due_date: form.next_follow_up_date,
      priority: 'Medium', created_by: userId, linked_activity_id: activity.id,
    })
  }
  return activity
}

export async function deleteActivity(id) {
  const { error } = await supabase.from('sales_activities').delete().eq('id', id)
  if (error) throw error
}

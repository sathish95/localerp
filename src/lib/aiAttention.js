import { supabase } from './supabase'

// Industry-Adaptive Platform Phase 10 — "AI Attention Center." Despite
// the name (master prompt's own term), this is pure deterministic
// aggregation of already-queryable signals, not an LLM call — consistent
// with the rest of Phase 10's "deterministic first" bias. Read-only, no
// writes, no side effects.
//
// Permission-awareness is enforced by SCOPE, not by a check inside this
// module: getPersonalAttention(personId) only ever reads rows filtered to
// that one person's id, so it structurally cannot leak another person's
// data regardless of who calls it. getTeamAttention() is org-wide by
// design (it mirrors TeamWorkPage.jsx's existing manager-branch query,
// which is itself only reachable via a route gated `isManager` at the
// App.jsx level) — this module doesn't re-check the caller's role because
// TeamWorkPage.jsx already established that "org-wide, but only a manager
// can even load this page" is this app's existing permission model for
// that page, and duplicating a second role-check here wouldn't be safer,
// only redundant.

export async function getPersonalAttention(personId) {
  if (!personId) return []
  const today = new Date().toISOString().split('T')[0]
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  const [overdueRes, certRes, tsRes] = await Promise.all([
    supabase.from('project_tasks').select('id,task_name,planned_end_date')
      .eq('assigned_to', personId).neq('status', 'closed')
      .not('planned_end_date', 'is', null).lt('planned_end_date', today),
    supabase.from('employee_skills').select('id,certification_name,certification_expiry,skills(skill_name)')
      .eq('employee_id', personId).not('certification_expiry', 'is', null)
      .lte('certification_expiry', in30).gte('certification_expiry', today),
    supabase.from('timesheet_approvals').select('id,status,period_month,period_year')
      .eq('employee_id', personId).in('status', ['', 'draft', 'rejected'])
      .order('period_year', { ascending: false }).order('period_month', { ascending: false }).limit(1),
  ])

  const items = []
  for (const t of overdueRes.data || []) {
    items.push({ type: 'overdue_task', severity: 'high', text: `"${t.task_name}" is overdue`, link: '/my-work' })
  }
  for (const s of certRes.data || []) {
    const label = s.skills?.skill_name || 'Certification'
    items.push({ type: 'cert_expiry', severity: 'medium', text: `${label}${s.certification_name ? ` (${s.certification_name})` : ''} expires ${s.certification_expiry}`, link: '/skill-matrix' })
  }
  if ((tsRes.data || []).length) {
    items.push({ type: 'timesheet_pending', severity: 'low', text: "Your latest timesheet hasn't been submitted yet", link: '/timesheet' })
  }
  return items
}

export async function getTeamAttention() {
  const today = new Date().toISOString().split('T')[0]
  const staleCutoffIso = new Date(Date.now() - 3 * 86400000).toISOString()

  const [overdueRes, staleWorkItemsRes, approvalsRes] = await Promise.all([
    supabase.from('project_tasks').select('id,task_name,assignee:profiles!assigned_to(full_name)')
      .neq('status', 'closed').not('planned_end_date', 'is', null).lt('planned_end_date', today),
    supabase.from('work_items').select('id,title,created_at').eq('status', 'open').lt('created_at', staleCutoffIso),
    supabase.from('timesheet_approvals').select('id').eq('status', 'pending_manager'),
  ])

  let staleZeroTask = []
  const staleWorkItems = staleWorkItemsRes.data || []
  if (staleWorkItems.length) {
    const ids = staleWorkItems.map(w => w.id)
    const { data: taskLinks } = await supabase.from('project_tasks').select('work_item_id').in('work_item_id', ids)
    const withTasks = new Set((taskLinks || []).map(t => t.work_item_id))
    staleZeroTask = staleWorkItems.filter(w => !withTasks.has(w.id))
  }

  const items = []
  for (const t of overdueRes.data || []) {
    items.push({ type: 'overdue_task', severity: 'high', text: `"${t.task_name}" (${t.assignee?.full_name || 'unassigned'}) is overdue`, link: '/team-work' })
  }
  for (const w of staleZeroTask) {
    items.push({ type: 'stale_work_item', severity: 'medium', text: `"${w.title}" has had no tasks assigned for 3+ days`, link: '/work-items' })
  }
  const pendingCount = (approvalsRes.data || []).length
  if (pendingCount) {
    items.push({ type: 'timesheet_approvals', severity: 'low', text: `${pendingCount} timesheet${pendingCount === 1 ? '' : 's'} awaiting manager approval`, link: '/timesheet-approvals' })
  }
  return items
}

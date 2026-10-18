import { supabase } from './supabase'
import { listFlows } from './departmentStatusFlows'
import { makeIsTaskDone } from './dailyStatus'
import { computeWorkPlanCore, PLAN_STATUS } from '../../supabase/functions/_shared/planningCore.js'

// Resource Management → Work Planning. Answers "who has nothing scheduled
// for <day>?" so managers can line up work before the day starts. The rule
// itself lives in supabase/functions/_shared/planningCore.js, shared with
// the Manager team report email.

export { PLAN_STATUS }

const toDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function nextWorkingDay(from = new Date()) {
  const d = new Date(from); d.setHours(0, 0, 0, 0)
  do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6)
  return toDateStr(d)
}

export function computeWorkPlan({ day, employees, tasks, leaves, flows = [], targetHours = 8, underPlannedPct = 50 }) {
  return computeWorkPlanCore({ day, employees, tasks, leaves, isTaskDone: makeIsTaskDone(flows), targetHours, underPlannedPct })
}

export async function getWorkPlan({ organizationId, day, employees, targetHours, underPlannedPct }) {
  const [flows, tasksRes, leavesRes] = await Promise.all([
    listFlows(organizationId).catch(() => []),
    // Everything assigned that could land on or before the day — completion
    // is filtered client-side (flow-aware), since "closed" varies per department.
    supabase.from('project_tasks')
      .select('id, task_id, task_name, status, department_id, assigned_to, planned_start_date, planned_end_date, estimated_hours, priority, project:projects(name)')
      .not('assigned_to', 'is', null),
    supabase.from('leave_requests').select('employee_id, leave_type, from_date, to_date')
      .eq('status', 'approved').lte('from_date', day)
      .or(`to_date.gte.${day},and(to_date.is.null,from_date.eq.${day})`),
  ])
  for (const r of [tasksRes, leavesRes]) if (r.error) throw r.error
  return computeWorkPlan({ day, employees, tasks: tasksRes.data || [], leaves: leavesRes.data || [], flows, targetHours, underPlannedPct })
}

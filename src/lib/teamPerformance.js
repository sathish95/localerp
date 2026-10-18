import { supabase } from './supabase'
import { listFlows } from './departmentStatusFlows'
import { makeIsTaskDone, periodRange } from './dailyStatus'
import { computeTeamPerformanceCore, FLAG_META, weekdaysBetween } from '../../supabase/functions/_shared/teamPerformanceCore.js'

// Daily Status → Team Performance. The calculation itself lives in
// supabase/functions/_shared/teamPerformanceCore.js so the scheduled report
// email (send-email Edge Function) uses exactly the same maths; this file
// only fetches the rows and supplies browser-local dates + the flow-aware
// isTaskDone.

export { FLAG_META, weekdaysBetween }

const localDate = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

export function computeTeamPerformance(raw, period, refDate = new Date(), { targetHours = 8 } = {}) {
  const { start, end } = periodRange(period, refDate)
  return computeTeamPerformanceCore(raw, {
    from: localDate(start), to: localDate(end), today: localDate(new Date()),
    isTaskDone: makeIsTaskDone(raw.flows || []), targetHours,
  })
}

export async function getTeamPerformance(organizationId, period = 'daily', refDate = new Date(), opts) {
  const { start, end } = periodRange(period, refDate)
  const startIso = start.toISOString(), endIso = end.toISOString()
  const from = localDate(start), to = localDate(end)
  const [flows, profilesRes, timeLogsRes, workLogsRes, tasksRes, changeLogRes, leavesRes, itRes, supRes, deptRes] = await Promise.all([
    listFlows(organizationId).catch(() => []),
    supabase.from('profiles').select('id, full_name, role, department_id, is_active').order('full_name'),
    supabase.from('time_logs').select('employee_id, work_date, hours_worked, check_in, check_out').gte('work_date', from).lte('work_date', to),
    supabase.from('work_logs').select('employee_id, task_id, started_at, ended_at, duration_minutes').gte('started_at', startIso).lte('started_at', endIso),
    supabase.from('project_tasks').select('id, task_id, task_name, status, department_id, assigned_to, planned_end_date, estimated_hours, actual_hours'),
    supabase.from('task_change_log').select('task_id, new_value, created_at').eq('field_name', 'status').gte('created_at', startIso).lte('created_at', endIso),
    supabase.from('leave_requests').select('employee_id, leave_type, from_date, to_date').eq('status', 'approved').lte('from_date', to)
      .or(`to_date.gte.${from},and(to_date.is.null,from_date.gte.${from})`),
    supabase.from('it_helpdesk_tickets').select('assigned_to, resolved_at, closed_at').or(`resolved_at.gte.${startIso},closed_at.gte.${startIso}`),
    supabase.from('support_tickets').select('assigned_agent_id, resolved_at, closed_at').or(`resolved_at.gte.${startIso},closed_at.gte.${startIso}`),
    supabase.from('departments').select('id, name').order('name'),
  ])
  for (const r of [profilesRes, timeLogsRes, workLogsRes, tasksRes, changeLogRes]) if (r.error) throw r.error
  const result = computeTeamPerformance({
    flows, profiles: profilesRes.data || [], timeLogs: timeLogsRes.data || [], workLogs: workLogsRes.data || [],
    tasks: tasksRes.data || [], changeLog: changeLogRes.data || [], leaves: leavesRes.data || [],
    // Ticket tables are optional add-ons — a missing table just means no tickets.
    itTickets: itRes.error ? [] : itRes.data || [], supportTickets: supRes.error ? [] : supRes.data || [],
  }, period, refDate, opts)
  return { ...result, departments: deptRes.data || [] }
}

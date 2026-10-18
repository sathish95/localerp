import { supabase } from './supabase'
import { listFlows, makeStatusHelpers } from './departmentStatusFlows'
import { makeIsTaskDone } from './dailyStatus'
import { buildTeamDailyUpdates } from './teamDailyUpdates'

// Pre-STEP198 fallback steps, same as dailyStatus.js — labels for tasks in a
// department with no configured flow.
const LEGACY_STEPS = [
  { status_key: 'backlog', label: 'Backlog' }, { status_key: 'todo', label: 'To Do' }, { status_key: 'in_progress', label: 'In Progress' },
  { status_key: 'delayed', label: 'Delayed' }, { status_key: 'qa', label: 'QA Testing' }, { status_key: 'ready_for_demo', label: 'Ready for Demo' },
  { status_key: 'closed', label: 'Closed', is_closed: true },
]
const TASK_COLS = 'id, task_id, task_name, status, project_id, department_id, assigned_to, planned_end_date, created_by, created_at'

// Optional sources (a table that isn't there yet) degrade to no rows.
const rows = async q => { const { data, error } = await q; if (error) { console.warn('daily updates:', error.message); return [] } return data || [] }

// date: 'YYYY-MM-DD', read as a local (browser) calendar day — same as the
// rest of the Daily Status page.
export async function getTeamDailyUpdates(organizationId, date) {
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start); end.setDate(end.getDate() + 1)
  const s = start.toISOString(), e = end.toISOString()

  const [flows, profiles, departments, projects, changeLog, comments, workLogs, timeLogs, checkinTasks, createdTasks] = await Promise.all([
    listFlows(organizationId).catch(() => []),
    rows(supabase.from('profiles').select('id, full_name, role, department_id, is_active')),
    rows(supabase.from('departments').select('id, name')),
    rows(supabase.from('projects').select('id, name')),
    rows(supabase.from('task_change_log').select('*').gte('created_at', s).lt('created_at', e)),
    rows(supabase.from('task_comments').select('*').gte('created_at', s).lt('created_at', e)),
    rows(supabase.from('work_logs').select('*').gte('started_at', s).lt('started_at', e)),
    rows(supabase.from('time_logs').select('*').eq('work_date', date)),
    rows(supabase.from('checkin_tasks').select('*').eq('work_date', date)),
    rows(supabase.from('project_tasks').select(TASK_COLS).gte('created_at', s).lt('created_at', e)),
  ])
  if (!profiles.length) throw new Error('Could not load the team list')

  // every task touched that day, for names / status / project
  const ids = [...new Set([...changeLog, ...comments, ...workLogs, ...checkinTasks].map(r => r.task_id).filter(Boolean))]
    .filter(id => !createdTasks.some(t => t.id === id))
  const tasks = []
  for (let i = 0; i < ids.length; i += 200) tasks.push(...await rows(supabase.from('project_tasks').select(TASK_COLS).in('id', ids.slice(i, i + 200))))

  const { labelFor } = makeStatusHelpers(flows, LEGACY_STEPS)
  return buildTeamDailyUpdates({
    date, dayStart: start.getTime(), dayEnd: end.getTime(),
    profiles, departments, projects, tasks, changeLog, comments, workLogs, timeLogs, checkinTasks, createdTasks,
    labelFor, isTaskDone: makeIsTaskDone(flows),
  })
}

import { supabase } from './supabase'

// Industry-Adaptive Platform Phase 5 — Work Execution.
//
// Task Start/Pause/Resume/Complete, backed by work_logs (created inert in
// Phase 4's STEP182, activated here). Master prompt §29 is explicit that
// Task Start is NEVER forced to equal Check-In — a person checks in once,
// then moves through multiple tasks independently. This file never reads
// or writes time_logs except through the one read-only helper below
// (getActiveCheckIn), which mirrors CheckInWidget.jsx's own "am I checked
// in" query verbatim so there is exactly one definition of that query's
// shape, not two that could drift.
//
// Run-state (not started / running / paused) is derived, never stored:
// a task is "running" if it has a work_logs row with ended_at IS NULL;
// "paused" if it has at least one work_logs row, none open, and its
// project_tasks.status isn't 'closed'; otherwise "not started". This
// deliberately avoids inventing a new project_tasks.status value like
// 'paused' — TasksPage.jsx's STATUSES/SL/SC maps are a closed set used
// for Kanban rendering everywhere, and status only ever moves to
// 'in_progress' (Start) or 'closed' (Complete) here, both of which
// already exist and render correctly today.

// Today's not-checked-out time_logs row for this employee, if any —
// same query CheckInWidget.jsx's init() uses, read-only.
export async function getActiveCheckIn(employeeId) {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('time_logs')
    .select('id, check_in, project_id')
    .eq('employee_id', employeeId)
    .eq('work_date', today)
    .is('check_out', null)
    .order('check_in', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}

// All work_logs rows for a set of task ids, for one employee — used to
// derive each visible task's run-state and accumulated duration in one
// batched query rather than one query per task row.
export async function listWorkLogsForTasks(taskIds, employeeId) {
  if (!taskIds.length) return []
  const { data, error } = await supabase
    .from('work_logs')
    .select('*')
    .in('task_id', taskIds)
    .eq('employee_id', employeeId)
  if (error) throw error
  return data || []
}

// Derives { state: 'not_started'|'running'|'paused', totalMinutes, openLogId }
// for one task from its already-fetched work_logs rows.
export function deriveTaskRunState(taskLogs) {
  if (!taskLogs.length) return { state: 'not_started', totalMinutes: 0, openLogId: null }
  const open = taskLogs.find(l => !l.ended_at)
  const totalMinutes = taskLogs.reduce((s, l) => {
    if (l.ended_at) return s + (l.duration_minutes ?? Math.round((new Date(l.ended_at) - new Date(l.started_at)) / 60000))
    return s
  }, 0)
  return open
    ? { state: 'running', totalMinutes, openLogId: open.id }
    : { state: 'paused', totalMinutes, openLogId: null }
}

// Start: opens a new work_logs segment, and — only the first time, same
// "never overwrites a value" rule TasksPage.jsx's autoActualDates already
// uses for actual_start_date — moves the task to 'in_progress' if it's
// still in an earlier status (backlog/todo/delayed). Never touches a task
// already 'in_progress'/'qa'/'ready_for_demo'/'closed'.
export async function startTask(task, employeeId) {
  const activeCheckIn = await getActiveCheckIn(employeeId)
  const { error: logErr } = await supabase.from('work_logs').insert({
    employee_id: employeeId,
    task_id: task.id,
    project_id: task.project_id || null,
    work_item_id: task.work_item_id || null,
    checkin_log_id: activeCheckIn?.id || null,
    started_at: new Date().toISOString(),
  })
  if (logErr) throw logErr

  if (!task.actual_start_date && ['backlog', 'todo', 'delayed'].includes(task.status)) {
    const patch = { status: 'in_progress' }
    patch.actual_start_date = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('project_tasks').update(patch).eq('id', task.id)
    if (error) throw error
  } else if (!task.actual_start_date) {
    await supabase.from('project_tasks').update({ actual_start_date: new Date().toISOString().split('T')[0] }).eq('id', task.id)
  }
}

// Pause: closes the currently-open segment. Does NOT change task.status —
// "in_progress" remains accurate at the Kanban-column granularity; the
// running/paused distinction lives only in work_logs, read back via
// deriveTaskRunState().
export async function pauseTask(openLogId) {
  const { data: log, error: fetchErr } = await supabase.from('work_logs').select('started_at').eq('id', openLogId).single()
  if (fetchErr) throw fetchErr
  const endedAt = new Date()
  const durationMinutes = Math.max(0, Math.round((endedAt - new Date(log.started_at)) / 60000))
  const { error } = await supabase.from('work_logs')
    .update({ ended_at: endedAt.toISOString(), duration_minutes: durationMinutes })
    .eq('id', openLogId)
  if (error) throw error
}

// Resume: a brand new open segment — never reopens a closed one, so the
// closed segment's duration is never retroactively altered.
export async function resumeTask(task, employeeId) {
  return startTask(task, employeeId)
}

// Complete: closes any open segment first, sums every closed segment's
// duration into actual_hours (only if actual_hours isn't already
// manually set — never clobbers a value a manager already entered, same
// "never overwrites" posture as the rest of this file), stamps
// actual_end_date (only if unset), and sets status: 'closed'.
// `checklistValues` is the task's checklist array with `value` filled in
// by the caller — validation that required items are filled happens in
// the UI before this is called; this function itself does not re-validate,
// per the directive's "client-side gate is acceptable this pass" note.
export async function completeTask(task, employeeId, checklistValues) {
  const { data: openLogs, error: openErr } = await supabase
    .from('work_logs')
    .select('id, started_at')
    .eq('task_id', task.id)
    .eq('employee_id', employeeId)
    .is('ended_at', null)
  if (openErr) throw openErr
  const endedAt = new Date()
  for (const log of openLogs || []) {
    const durationMinutes = Math.max(0, Math.round((endedAt - new Date(log.started_at)) / 60000))
    await supabase.from('work_logs').update({ ended_at: endedAt.toISOString(), duration_minutes: durationMinutes }).eq('id', log.id)
  }

  const { data: allLogs, error: allErr } = await supabase
    .from('work_logs')
    .select('duration_minutes')
    .eq('task_id', task.id)
    .not('duration_minutes', 'is', null)
  if (allErr) throw allErr
  const totalMinutes = (allLogs || []).reduce((s, l) => s + (l.duration_minutes || 0), 0)

  const patch = { status: 'closed', checklist: checklistValues ?? task.checklist ?? [] }
  if (!task.actual_end_date) patch.actual_end_date = new Date().toISOString().split('T')[0]
  if (task.actual_hours == null || task.actual_hours === 0) patch.actual_hours = Math.round((totalMinutes / 60) * 100) / 100

  const { error } = await supabase.from('project_tasks').update(patch).eq('id', task.id)
  if (error) throw error
  return patch
}

// Save checklist item values without completing the task (e.g. filling
// in evidence ahead of time). Replaces the whole array — checklist is
// always read/written as one unit, per STEP182's own design note.
export async function saveChecklistValues(taskId, checklist) {
  const { error } = await supabase.from('project_tasks').update({ checklist }).eq('id', taskId)
  if (error) throw error
}

// Upload one evidence file for a checklist item, reusing the exact same
// bucket/path/getPublicUrl pattern ExpensesPage.jsx already uses for
// receipt uploads — not a new storage convention.
export async function uploadTaskEvidence(taskId, file) {
  const path = `task-evidence/${taskId}/${Date.now()}-${file.name}`
  const { error: upErr } = await supabase.storage.from('invoices').upload(path, file, { upsert: true })
  if (upErr) throw upErr
  const { data } = supabase.storage.from('invoices').getPublicUrl(path)
  return data.publicUrl
}

// Read-only breakdown for TimesheetPage.jsx: Task Hours logged against a
// specific time_logs row (i.e. a specific check-in session), via
// work_logs.checkin_log_id — additive display only, never touches
// time_logs/timesheet_approvals.
export async function getTaskHoursByCheckinLog(checkinLogIds) {
  if (!checkinLogIds.length) return {}
  const { data, error } = await supabase
    .from('work_logs')
    .select('checkin_log_id, duration_minutes')
    .in('checkin_log_id', checkinLogIds)
    .not('duration_minutes', 'is', null)
  if (error) throw error
  const byLog = {}
  for (const row of data || []) {
    if (!row.checkin_log_id) continue
    byLog[row.checkin_log_id] = (byLog[row.checkin_log_id] || 0) + (row.duration_minutes || 0)
  }
  return byLog // { [checkin_log_id]: totalMinutes }
}

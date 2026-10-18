import { supabase } from './supabase'

// A project's fund flow can only close once every task is done AND every
// department involved has signed off. Deliberately a separate module from
// fundFlow.js (read-only aggregation, no table) and approvalFlow.js
// (sequential single-status chain) — this is a parallel, order-independent
// "N departments each confirm" gate, which neither of those fit.

export async function listProjectDepartments(projectId) {
  // Plain select + manual join, not a PostgREST embed — project_departments
  // .department_id is a soft reference (plain UUID, no REFERENCES
  // constraint, matching this app's convention for tables that may not
  // exist yet), so PostgREST has no relationship to auto-embed and
  // `select=*,department:departments(...)` 400s with "Could not find a
  // relationship". Same `row.department = {id,name,code}` shape callers
  // already expect, just resolved by hand.
  const { data, error } = await supabase
    .from('project_departments')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw error
  const rows = data || []
  const deptIds = [...new Set(rows.map(r => r.department_id).filter(Boolean))]
  if (deptIds.length === 0) return rows
  const { data: depts } = await supabase.from('departments').select('id,name,code').in('id', deptIds)
  const byId = Object.fromEntries((depts || []).map(d => [d.id, d]))
  return rows.map(r => ({ ...r, department: byId[r.department_id] || null }))
}

export async function addProjectDepartment(projectId, departmentId) {
  const { error } = await supabase.from('project_departments').insert({ project_id: projectId, department_id: departmentId })
  if (error) throw error
}

export async function removeProjectDepartment(id) {
  const { error } = await supabase.from('project_departments').delete().eq('id', id)
  if (error) throw error
}

export async function signOffDepartment(id, profileId) {
  const { error } = await supabase.from('project_departments')
    .update({ status: 'signed_off', signed_off_by: profileId, signed_off_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function undoSignOffDepartment(id) {
  const { error } = await supabase.from('project_departments')
    .update({ status: 'pending', signed_off_by: null, signed_off_at: null })
    .eq('id', id)
  if (error) throw error
}

export async function getTaskCompletion(projectId) {
  const { data, error } = await supabase.from('project_tasks').select('status').eq('project_id', projectId)
  if (error) throw error
  const total = (data || []).length
  const closed = (data || []).filter(t => t.status === 'closed').length
  return { total, closed, allDone: total > 0 && closed === total }
}

export async function getClosureReadiness(projectId) {
  const [tasks, departments] = await Promise.all([
    getTaskCompletion(projectId),
    listProjectDepartments(projectId),
  ])
  const allSignedOff = departments.length > 0 && departments.every(d => d.status === 'signed_off')
  return { tasks, departments, allSignedOff, canClose: tasks.allDone && allSignedOff }
}

export async function closeFundFlow(projectId, profileId) {
  const readiness = await getClosureReadiness(projectId)
  if (!readiness.canClose) throw new Error('Cannot close: all tasks must be closed and every department must sign off first.')
  const { error } = await supabase.from('projects')
    .update({ fund_flow_status: 'closed', fund_flow_closed_at: new Date().toISOString(), fund_flow_closed_by: profileId })
    .eq('id', projectId)
  if (error) throw error
}

export async function reopenFundFlow(projectId) {
  const { error } = await supabase.from('projects')
    .update({ fund_flow_status: 'open', fund_flow_closed_at: null, fund_flow_closed_by: null })
    .eq('id', projectId)
  if (error) throw error
}

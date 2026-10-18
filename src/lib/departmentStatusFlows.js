import { supabase } from './supabase'

// Per-department task status pipelines (STEP198) — replaces the single
// global status list with one independently-configurable ordered flow
// PER DEPARTMENT (plus one "Unassigned" flow for department_id = null,
// itself just as editable as a real department's).

// Shared per-task status-step resolution built from listFlows()'s output —
// for any screen that renders task status badges/dropdowns OUTSIDE
// TasksPage.jsx's own manager-view fetch (e.g. CheckInWidget, MyWorkPage).
// Without this they fall back to the pre-STEP198 hardcoded global status
// list regardless of the task's actual department, which is exactly the
// "status doesn't match department, shows the default" confusion this
// whole feature was built to fix — see TasksPage.jsx's flowByDept/
// stepsForDept for the original (inline, not shared) version of this.
export function makeStatusHelpers(flows, legacySteps) {
  const byDept = {}
  ;(flows || []).forEach(f => { byDept[f.department_id || '__none'] = f.steps })
  const stepsForDept = deptId => byDept[deptId || '__none'] || legacySteps
  const stepsForTask = task => stepsForDept(task?.department_id)
  const stepFor = (task, key) => stepsForTask(task).find(s => s.status_key === (key ?? task?.status))
  const isTaskDone = task => !!stepFor(task)?.is_closed
  const labelFor = (task, key) => stepFor(task, key)?.label || key || task?.status || '—'
  const colorFor = (task, key) => stepFor(task, key)?.color || '#64748b'
  return { stepsForTask, isTaskDone, labelFor, colorFor }
}

export async function listFlows(organizationId) {
  const { data, error } = await supabase.from('department_status_flows')
    .select('*, steps:department_status_steps(*)').eq('organization_id', organizationId)
  if (error) throw error
  return (data || []).map(f => ({ ...f, steps: (f.steps || []).sort((a, b) => a.sort_order - b.sort_order) }))
}

// Returns the flow id for a department (or the null/"Unassigned" bucket),
// creating an empty one on the fly if this department has none yet (e.g.
// a department created after this feature shipped).
export async function ensureFlow(organizationId, departmentId) {
  let q = supabase.from('department_status_flows').select('id').eq('organization_id', organizationId)
  q = departmentId ? q.eq('department_id', departmentId) : q.is('department_id', null)
  const { data } = await q.maybeSingle()
  if (data) return data.id
  const { data: created, error } = await supabase.from('department_status_flows')
    .insert({ organization_id: organizationId, department_id: departmentId || null }).select('id').single()
  if (error) throw error
  return created.id
}

// Full replace of a flow's steps — simplest robust way to handle
// add/remove/reorder/rename in one save. `steps`: [{status_key,label,color,is_closed,progress_pct}]
// in the desired final order.
export async function saveFlowSteps(flowId, organizationId, steps) {
  const { error: delErr } = await supabase.from('department_status_steps').delete().eq('flow_id', flowId)
  if (delErr) throw delErr
  if (steps.length) {
    const rows = steps.map((s, i) => ({
      organization_id: organizationId, flow_id: flowId, status_key: s.status_key,
      label: s.label, color: s.color || '#6366f1', sort_order: i, is_closed: !!s.is_closed,
      progress_pct: s.progress_pct==null||s.progress_pct===''?null:Math.max(0,Math.min(100,parseInt(s.progress_pct)||0)),
    }))
    const { error } = await supabase.from('department_status_steps').insert(rows)
    if (error) throw error
  }
  await supabase.from('department_status_flows').update({ updated_at: new Date().toISOString() }).eq('id', flowId)
}

// Which status values this department's tasks are ACTUALLY using right
// now — the settings panel needs this to warn about (and remap) any
// value that would become orphaned by a flow edit.
export async function distinctStatusesInUse(organizationId, departmentId) {
  let q = supabase.from('project_tasks').select('status').eq('organization_id', organizationId)
  q = departmentId ? q.eq('department_id', departmentId) : q.is('department_id', null)
  const { data, error } = await q
  if (error) throw error
  return [...new Set((data || []).map(r => r.status).filter(Boolean))]
}

// Bulk-remaps every task currently on an orphaned status to whatever new
// step the admin chose for it, and logs each move into task_change_log
// (STEP197) so it shows up in that task's own history too.
export async function remapTaskStatuses(organizationId, departmentId, mapping, userId) {
  for (const [oldKey, newKey] of Object.entries(mapping)) {
    if (!newKey || oldKey === newKey) continue
    let q = supabase.from('project_tasks').select('id').eq('organization_id', organizationId).eq('status', oldKey)
    q = departmentId ? q.eq('department_id', departmentId) : q.is('department_id', null)
    const { data: rows } = await q
    if (!rows?.length) continue
    const ids = rows.map(r => r.id)
    await supabase.from('project_tasks').update({ status: newKey }).in('id', ids)
    await supabase.from('task_change_log').insert(
      ids.map(id => ({ task_id: id, changed_by: userId, field_name: 'status', old_value: oldKey, new_value: newKey }))
    )
  }
}

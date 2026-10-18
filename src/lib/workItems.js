import { supabase } from './supabase'

// Industry-Adaptive Platform — Phase 7 (Work Order). Data layer for
// `work_items` (STEP182) — the generic non-Project parent a Task may
// optionally belong to (Work Order, Service Request, Production Order,
// ...). `client_id`/`location_id`/`work_type_key` are all soft refs (no
// DB-level FK, per this repo's convention for "might not exist yet"
// relationships), so PostgREST can't embed them via `.select('*, x(y)')`
// — every lookup here is a separate flat query merged client-side by id,
// matching how TasksPage.jsx already fetches work_items itself.

export async function listWorkTypeConfigs() {
  const { data, error } = await supabase.from('work_type_configs').select('key,name,icon').eq('active', true).order('name')
  if (error) throw error
  return data || []
}

// ── Phase 8 (Enterprise Configuration) — admin CRUD over work_type_configs.
// listWorkTypeConfigs() above stays active-only (it's the picker source
// for WorkItemsPage.jsx); this one is for the Settings admin list, which
// needs to show inactive rows too so they can be reactivated.
export async function listAllWorkTypeConfigs() {
  const { data, error } = await supabase.from('work_type_configs').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function createWorkTypeConfig(key, name, icon) {
  const { error } = await supabase.from('work_type_configs').insert({ key, name, icon: icon || null })
  if (error) throw error
}

export async function updateWorkTypeConfig(id, patch) {
  const { error } = await supabase.from('work_type_configs').update(patch).eq('id', id)
  if (error) throw error
}

export async function listWorkItems({ workType, status, clientId, search } = {}) {
  let q = supabase.from('work_items').select('*').order('created_at', { ascending: false })
  if (workType) q = q.eq('work_type_key', workType)
  if (status) q = q.eq('status', status)
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw error
  let items = data || []
  if (search) {
    const s = search.trim().toLowerCase()
    items = items.filter(w => w.title?.toLowerCase().includes(s))
  }
  if (items.length === 0) return []

  const ids = items.map(w => w.id)
  const clientIds = [...new Set(items.map(w => w.client_id).filter(Boolean))]
  const locationIds = [...new Set(items.map(w => w.location_id).filter(Boolean))]

  const [clientsR, locationsR, tasksR, logsR] = await Promise.all([
    clientIds.length ? supabase.from('customers').select('id,name').in('id', clientIds) : Promise.resolve({ data: [] }),
    locationIds.length ? supabase.from('locations').select('id,name').in('id', locationIds) : Promise.resolve({ data: [] }),
    supabase.from('project_tasks').select('id,work_item_id,status').in('work_item_id', ids),
    supabase.from('work_logs').select('work_item_id,duration_minutes').in('work_item_id', ids).not('duration_minutes', 'is', null),
  ])
  const clientById = Object.fromEntries((clientsR.data || []).map(c => [c.id, c]))
  const locationById = Object.fromEntries((locationsR.data || []).map(l => [l.id, l]))
  const taskCountByItem = {}
  for (const t of tasksR.data || []) taskCountByItem[t.work_item_id] = (taskCountByItem[t.work_item_id] || 0) + 1
  const minutesByItem = {}
  for (const l of logsR.data || []) minutesByItem[l.work_item_id] = (minutesByItem[l.work_item_id] || 0) + (l.duration_minutes || 0)

  return items.map(w => ({
    ...w,
    client: w.client_id ? clientById[w.client_id] || null : null,
    location: w.location_id ? locationById[w.location_id] || null : null,
    taskCount: taskCountByItem[w.id] || 0,
    totalHours: Math.round(((minutesByItem[w.id] || 0) / 60) * 100) / 100,
  }))
}

export async function getWorkItem(id) {
  const { data, error } = await supabase.from('work_items').select('*').eq('id', id).single()
  if (error) throw error
  let client = null, location = null
  if (data.client_id) { const r = await supabase.from('customers').select('id,name').eq('id', data.client_id).single(); client = r.data || null }
  if (data.location_id) { const r = await supabase.from('locations').select('id,name').eq('id', data.location_id).single(); location = r.data || null }
  return { ...data, client, location }
}

export async function createWorkItem(payload, userId) {
  const { data, error } = await supabase.from('work_items').insert({
    title: payload.title,
    work_type_key: payload.workTypeKey,
    client_id: payload.clientId || null,
    location_id: payload.locationId || null,
    status: payload.status || 'open',
    created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateWorkItem(id, patch) {
  const { error } = await supabase.from('work_items').update({
    title: patch.title, work_type_key: patch.workTypeKey, client_id: patch.clientId || null,
    location_id: patch.locationId || null, status: patch.status,
  }).eq('id', id)
  if (error) throw error
}

// Tasks linked to this work item, plus each task's assignee name (soft
// ref -> profiles, merged client-side like everything else here).
export async function listTasksForWorkItem(workItemId) {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id,task_id,task_name,status,priority,assigned_to,planned_end_date')
    .eq('work_item_id', workItemId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const tasks = data || []
  const assigneeIds = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))]
  if (!assigneeIds.length) return tasks.map(t => ({ ...t, assignee: null }))
  const { data: people } = await supabase.from('profiles').select('id,full_name').in('id', assigneeIds)
  const byId = Object.fromEntries((people || []).map(p => [p.id, p]))
  return tasks.map(t => ({ ...t, assignee: t.assigned_to ? byId[t.assigned_to] || null : null }))
}

// Minimal direct insert — TasksPage.jsx's TaskForm/saveTask are private to
// that file (not exported), so a full New Task modal here would either
// duplicate a lot of that form or require refactoring TasksPage.jsx a
// fourth time this build. This mirrors saveTask()'s exact required-column
// shape for a plain create (no edit path needed here) with sensible
// defaults for everything TasksPage.jsx's fuller form would otherwise ask.
//
// `template` (Phase 8, optional) is a task_templates row — when passed,
// its task_type/estimated_hours/default_checklist seed the new task,
// closing the gap Phase 4 left open ("no admin UI to create one yet").
export async function createTaskForWorkItem(workItemId, { taskName, assignedTo, priority, template }, userId) {
  const { data, error } = await supabase.from('project_tasks').insert({
    task_name: taskName,
    task_type: template?.task_type || 'task',
    priority: priority || 'medium',
    assigned_to: assignedTo || null, status: 'backlog', project_id: null,
    work_item_id: workItemId, created_by: userId,
    estimated_hours: template?.estimated_hours || null,
    checklist: (template?.default_checklist || []).map(i => ({ ...i, value: null })),
  }).select().single()
  if (error) throw error
  return data
}

// One aggregate query (not one-per-task) — work_logs already carries
// work_item_id directly (STEP182), so no join through project_tasks is
// needed at all for the item-level total.
export async function getWorkItemHoursSummary(workItemId) {
  const { data, error } = await supabase
    .from('work_logs')
    .select('task_id,duration_minutes')
    .eq('work_item_id', workItemId)
    .not('duration_minutes', 'is', null)
  if (error) throw error
  const rows = data || []
  const totalMinutes = rows.reduce((s, r) => s + (r.duration_minutes || 0), 0)
  const byTask = {}
  for (const r of rows) byTask[r.task_id] = (byTask[r.task_id] || 0) + (r.duration_minutes || 0)
  return {
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    byTaskHours: Object.fromEntries(Object.entries(byTask).map(([id, m]) => [id, Math.round((m / 60) * 100) / 100])),
  }
}

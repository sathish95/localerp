import { supabase } from '@/lib/supabase';

// Mobile port of the web src/lib/workItems.js (Industry-Adaptive Platform
// Phase 7 — Work Order). `work_items.client_id`/`location_id`/`work_type_key`
// are all soft refs (no DB-level FK, per this repo's convention), so
// PostgREST can't embed them via `.select('*, x(y)')` — every lookup here
// is a separate flat query merged client-side by id, exactly like the web
// version and like this app's own `requests.ts`/`tasks.ts` already do for
// their own soft-ref project/assignee joins.

export type WorkTypeConfig = { key: string; name: string; icon: string | null };

export type WorkItem = {
  id: string;
  title: string;
  work_type_key: string;
  client_id: string | null;
  location_id: string | null;
  status: string;
  created_at: string;
  client?: { id: string; name: string } | null;
  location?: { id: string; name: string } | null;
  taskCount?: number;
  totalHours?: number;
};

export type WorkItemTask = {
  id: string;
  task_name: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  planned_end_date: string | null;
  assignee: { id: string; full_name: string } | null;
};

export async function listWorkTypeConfigs(): Promise<WorkTypeConfig[]> {
  const { data, error } = await supabase.from('work_type_configs').select('key,name,icon').eq('active', true).order('name');
  if (error) throw error;
  return (data ?? []) as WorkTypeConfig[];
}

export type WorkItemFilters = { workType?: string; status?: string; search?: string };

export async function listWorkItems(filters: WorkItemFilters = {}): Promise<WorkItem[]> {
  let q = supabase.from('work_items').select('*').order('created_at', { ascending: false });
  if (filters.workType) q = q.eq('work_type_key', filters.workType);
  if (filters.status) q = q.eq('status', filters.status);
  const { data, error } = await q;
  if (error) throw error;
  let items = (data ?? []) as WorkItem[];
  if (filters.search) {
    const s = filters.search.trim().toLowerCase();
    items = items.filter((w) => w.title?.toLowerCase().includes(s));
  }
  if (items.length === 0) return [];

  const ids = items.map((w) => w.id);
  const clientIds = [...new Set(items.map((w) => w.client_id).filter(Boolean))] as string[];
  const locationIds = [...new Set(items.map((w) => w.location_id).filter(Boolean))] as string[];

  const [clientsR, locationsR, tasksR, logsR] = await Promise.all([
    clientIds.length ? supabase.from('customers').select('id,name').in('id', clientIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    locationIds.length ? supabase.from('locations').select('id,name').in('id', locationIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from('project_tasks').select('id,work_item_id,status').in('work_item_id', ids),
    supabase.from('work_logs').select('work_item_id,duration_minutes').in('work_item_id', ids).not('duration_minutes', 'is', null),
  ]);
  const clientById = Object.fromEntries((clientsR.data ?? []).map((c) => [c.id, c]));
  const locationById = Object.fromEntries((locationsR.data ?? []).map((l) => [l.id, l]));
  const taskCountByItem: Record<string, number> = {};
  for (const t of (tasksR.data ?? []) as { work_item_id: string }[]) taskCountByItem[t.work_item_id] = (taskCountByItem[t.work_item_id] || 0) + 1;
  const minutesByItem: Record<string, number> = {};
  for (const l of (logsR.data ?? []) as { work_item_id: string; duration_minutes: number }[]) minutesByItem[l.work_item_id] = (minutesByItem[l.work_item_id] || 0) + (l.duration_minutes || 0);

  return items.map((w) => ({
    ...w,
    client: w.client_id ? clientById[w.client_id] || null : null,
    location: w.location_id ? locationById[w.location_id] || null : null,
    taskCount: taskCountByItem[w.id] || 0,
    totalHours: Math.round(((minutesByItem[w.id] || 0) / 60) * 100) / 100,
  }));
}

export async function getWorkItem(id: string): Promise<WorkItem> {
  const { data, error } = await supabase.from('work_items').select('*').eq('id', id).single();
  if (error) throw error;
  const w = data as WorkItem;
  let client = null, location = null;
  if (w.client_id) { const r = await supabase.from('customers').select('id,name').eq('id', w.client_id).single(); client = r.data ?? null; }
  if (w.location_id) { const r = await supabase.from('locations').select('id,name').eq('id', w.location_id).single(); location = r.data ?? null; }
  return { ...w, client, location };
}

export async function createWorkItem(
  payload: { title: string; workTypeKey: string; clientId?: string | null; locationId?: string | null; status?: string },
  userId: string
): Promise<WorkItem> {
  const { data, error } = await supabase.from('work_items').insert({
    title: payload.title,
    work_type_key: payload.workTypeKey,
    client_id: payload.clientId || null,
    location_id: payload.locationId || null,
    status: payload.status || 'open',
    created_by: userId,
  }).select().single();
  if (error) throw error;
  return data as WorkItem;
}

// Tasks linked to this work item, plus each task's assignee name (soft
// ref -> profiles, merged client-side like everything else here).
export async function listTasksForWorkItem(workItemId: string): Promise<WorkItemTask[]> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id,task_name,status,priority,assigned_to,planned_end_date')
    .eq('work_item_id', workItemId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const tasks = (data ?? []) as Omit<WorkItemTask, 'assignee'>[];
  const assigneeIds = [...new Set(tasks.map((t) => t.assigned_to).filter(Boolean))] as string[];
  if (!assigneeIds.length) return tasks.map((t) => ({ ...t, assignee: null }));
  const { data: people } = await supabase.from('profiles').select('id,full_name').in('id', assigneeIds);
  const byId = Object.fromEntries((people ?? []).map((p) => [p.id, p]));
  return tasks.map((t) => ({ ...t, assignee: t.assigned_to ? byId[t.assigned_to] || null : null }));
}

// Minimal direct insert — mirrors the web version's exact same call, made
// for the exact same reason: TasksScreen's task-editing UI isn't
// structured for a full "create with project/work-item picker" reuse
// here, so this is a small, self-contained create path scoped to "new
// Direct Task under this work item" only (project_id always null).
export async function createTaskForWorkItem(
  workItemId: string,
  input: { taskName: string; assignedTo?: string | null; priority?: string },
  userId: string
): Promise<WorkItemTask> {
  const { data, error } = await supabase.from('project_tasks').insert({
    task_name: input.taskName,
    task_type: 'task',
    priority: input.priority || 'medium',
    assigned_to: input.assignedTo || null,
    status: 'backlog',
    project_id: null,
    work_item_id: workItemId,
    created_by: userId,
  }).select('id,task_name,status,priority,assigned_to,planned_end_date').single();
  if (error) throw error;
  return { ...(data as Omit<WorkItemTask, 'assignee'>), assignee: null };
}

// One aggregate query (not one-per-task) — work_logs already carries
// work_item_id directly, so no join through project_tasks is needed at
// all for the item-level total.
export async function getWorkItemHoursSummary(workItemId: string): Promise<{ totalHours: number; byTaskHours: Record<string, number> }> {
  const { data, error } = await supabase
    .from('work_logs')
    .select('task_id,duration_minutes')
    .eq('work_item_id', workItemId)
    .not('duration_minutes', 'is', null);
  if (error) throw error;
  const rows = (data ?? []) as { task_id: string; duration_minutes: number }[];
  const totalMinutes = rows.reduce((s, r) => s + (r.duration_minutes || 0), 0);
  const byTask: Record<string, number> = {};
  for (const r of rows) byTask[r.task_id] = (byTask[r.task_id] || 0) + (r.duration_minutes || 0);
  return {
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    byTaskHours: Object.fromEntries(Object.entries(byTask).map(([id, m]) => [id, Math.round((m / 60) * 100) / 100])),
  };
}

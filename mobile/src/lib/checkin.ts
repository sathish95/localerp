import { supabase } from '@/lib/supabase';
import type { TaskStatus } from '@/lib/tasks';

export type ActiveLog = {
  id: string;
  check_in: string;
  check_out: string | null;
  hours_worked: number | null;
  project_id: string | null;
  comment: string | null;
  project?: { id: string; name: string } | null;
};

export type ProjectTask = {
  id: string;
  task_name: string;
  status: TaskStatus;
  estimated_hours: number | null;
};

export type LinkedTask = {
  id: string; // checkin_tasks row id
  task: { id: string; task_name: string; status: TaskStatus; estimated_hours: number | null } | null;
};

export async function getActiveLog(employeeId: string): Promise<ActiveLog | null> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('time_logs')
    .select('*, project:projects(id,name)')
    .eq('employee_id', employeeId)
    .eq('work_date', today)
    .is('check_out', null)
    .order('check_in', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as ActiveLog) ?? null;
}

// Past (completed) sessions, most recent first — the active/in-progress
// session is shown separately at the top of the screen, so this excludes it
// via the check_out-not-null filter rather than an id exclusion.
export async function listRecentLogs(employeeId: string, limit = 10): Promise<ActiveLog[]> {
  const { data, error } = await supabase
    .from('time_logs')
    .select('*, project:projects(id,name)')
    .eq('employee_id', employeeId)
    .not('check_out', 'is', null)
    .order('check_in', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ActiveLog[];
}

// Monday..Sunday boundaries for "this week" — a plain date-range query
// against time_logs directly (not scoped to a single calendar month) so a
// week spanning a month boundary is still counted correctly.
export function getWeekRange(d = new Date()): { start: string; end: string } {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const iso = (x: Date) => x.toISOString().split('T')[0];
  return { start: iso(monday), end: iso(sunday) };
}

// Mon–Sat is the working week (Sunday off) — matches the Saturday
// submit-timesheet nudge assuming Saturday is itself a work day.
export const DAILY_MIN_HOURS = 8;

// Working days from Monday of the week through `today`, inclusive —
// i.e. how many days' worth of the 8h minimum have come due so far.
export function countWorkingDaysElapsed(weekStartDate: string, today = new Date()): number {
  const start = new Date(`${weekStartDate}T00:00:00`);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) count++;
  }
  return count;
}

export async function getWeekLogs(employeeId: string, startDate: string, endDate: string): Promise<{ work_date: string; hours_worked: number | null }[]> {
  const { data, error } = await supabase
    .from('time_logs')
    .select('work_date, hours_worked')
    .eq('employee_id', employeeId)
    .gte('work_date', startDate)
    .lte('work_date', endDate);
  if (error) throw error;
  return data ?? [];
}

export async function myActiveProjects(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from('projects').select('id,name').eq('status', 'active').order('name');
  if (error) throw error;
  return data;
}

// Open (not-closed) tasks for a project, offered as "what are you working on"
// picks when checking in — mirrors CheckInWidget.jsx's task list on web.
export async function listProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id, task_name, status, estimated_hours')
    .eq('project_id', projectId)
    .neq('status', 'closed')
    .order('task_name');
  if (error) throw error;
  return data as unknown as ProjectTask[];
}

// Tasks linked to an in-progress or just-ended check-in session, for the
// checkout status-update step.
export async function getLinkedTasks(checkinLogId: string): Promise<LinkedTask[]> {
  const { data, error } = await supabase
    .from('checkin_tasks')
    .select('id, task:project_tasks(id, task_name, status, estimated_hours)')
    .eq('checkin_log_id', checkinLogId);
  if (error) throw error;
  return data as unknown as LinkedTask[];
}

// notifyManagers ports src/lib/notifications.js's notifyManagers() — same
// table/shape, so check-in alerts land in the same notifications feed
// managers already watch on the web app.
async function notifyManagers(opts: { type: string; title: string; body?: string; link?: string; senderId: string }) {
  const { data } = await supabase.from('profiles').select('id').in('role', ['manager', 'department_head', 'hr', 'admin', 'ceo']);
  const ids = (data ?? []).map((u: { id: string }) => u.id).filter((id: string) => id !== opts.senderId);
  if (ids.length === 0) return;
  await supabase.from('notifications').insert(
    ids.map((id: string) => ({ recipient_id: id, sender_id: opts.senderId, type: opts.type, title: opts.title, body: opts.body ?? null, link: opts.link ?? null }))
  );
}

const ALREADY_ACTIVE_STATUSES = '("in_progress","qa","ready_for_demo","closed")';

export async function checkIn(employeeId: string, fullName: string, projectId: string | null, taskIds: string[], comment: string) {
  const today = new Date().toISOString().split('T')[0];
  const { data: logData, error } = await supabase
    .from('time_logs')
    .insert({ employee_id: employeeId, project_id: projectId, work_date: today, check_in: new Date().toISOString(), comment: comment || null })
    .select()
    .single();
  if (error) throw error;

  if (taskIds.length > 0) {
    await supabase.from('checkin_tasks').insert(
      taskIds.map((taskId) => ({ checkin_log_id: logData.id, task_id: taskId, employee_id: employeeId, work_date: today }))
    );
    await supabase.from('project_tasks').update({ status: 'in_progress' }).in('id', taskIds).not('status', 'in', ALREADY_ACTIVE_STATUSES);
  }

  await notifyManagers({
    type: 'checkin', title: `🟢 ${fullName} checked in`,
    body: comment || (taskIds.length > 0 ? `Working on ${taskIds.length} task${taskIds.length > 1 ? 's' : ''}` : projectId ? 'Project session started' : 'Work session started'),
    link: '/resources', senderId: employeeId,
  });
}

export async function checkOut(
  log: ActiveLog,
  employeeId: string,
  fullName: string,
  taskUpdates: { checkinTaskId: string; taskId: string; currentStatus: TaskStatus; newStatus: TaskStatus }[]
) {
  const now = new Date();
  const hrs = Math.round(((now.getTime() - new Date(log.check_in).getTime()) / 3600000) * 100) / 100;
  const { error } = await supabase.from('time_logs').update({ check_out: now.toISOString(), hours_worked: hrs }).eq('id', log.id);
  if (error) throw error;

  for (const u of taskUpdates) {
    if (u.newStatus !== u.currentStatus) {
      await supabase.from('project_tasks').update({ status: u.newStatus }).eq('id', u.taskId);
      await supabase.from('checkin_tasks').update({ status_update: u.newStatus }).eq('id', u.checkinTaskId);
    }
  }

  await notifyManagers({
    type: 'checkout', title: `🔴 ${fullName} checked out`,
    body: `Logged ${hrs}h`, link: '/resources', senderId: employeeId,
  });
  return hrs;
}

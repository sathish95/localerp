import { supabase } from '@/lib/supabase';

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'delayed', 'qa', 'ready_for_demo', 'closed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', delayed: 'Delayed',
  qa: 'QA Testing', ready_for_demo: 'Ready for Demo', closed: 'Closed',
};
export const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: '#64748b', todo: '#3b82f6', in_progress: '#f59e0b', delayed: '#e11d48',
  qa: '#8b5cf6', ready_for_demo: '#10b981', closed: '#94a3b8',
};

export type MyTask = {
  id: string;
  task_name: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high' | 'critical' | string;
  planned_end_date: string | null;
  progress_pct: number | null;
  project?: { name: string } | null;
};

export async function listMyTasks(userId: string): Promise<MyTask[]> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id, task_name, status, priority, planned_end_date, progress_pct, project:project_id(name)')
    .eq('assigned_to', userId)
    .neq('status', 'closed')
    .order('planned_end_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data as unknown as MyTask[];
}

export async function setTaskStatus(taskId: string, status: TaskStatus) {
  const { error } = await supabase.from('project_tasks').update({ status }).eq('id', taskId);
  if (error) throw error;
}

import { supabase } from '@/lib/supabase';
import {
  buildApprovalUpdate, canActOnSync, statusLabel, warmChains,
} from '@/lib/timesheetApproval';

// time_logs are created by check-in. A timesheet_approvals row rolls up
// one calendar month of a person's logs for the manager → hr → finance
// chain. Mirrors TimesheetApprovalPage.jsx's submit + doAction.

export type TimeLog = {
  id: string;
  work_date: string;
  hours_worked: number | null;
  check_in: string;
  check_out: string | null;
  comment: string | null;
  project: { name: string | null } | null;
};

export type TimesheetApproval = {
  id: string;
  employee_id: string;
  period_month: number;
  period_year: number;
  status: string;
  total_hours: number | null;
  total_days: number | null;
  submitted_at: string | null;
  rejection_reason: string | null;
} | null;

// A month's timesheet can be (re-)submitted while it's in one of these
// states — shared between the Timesheet hub and the Check-in screen's
// "pending" indicator so the two never drift apart on what "pending" means.
export const SUBMITTABLE_STATUSES = ['', 'draft', 'rejected'];

export function monthRange(month: number, year: number) {
  // Build the strings from local parts — never toISOString() a local
  // Date, or a +offset timezone shifts the boundary by a day.
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export async function getMyMonth(userId: string, month: number, year: number): Promise<{ logs: TimeLog[]; approval: TimesheetApproval }> {
  const { start, end } = monthRange(month, year);
  const [logRes, appRes] = await Promise.all([
    supabase
      .from('time_logs')
      .select('id, work_date, hours_worked, check_in, check_out, comment, project:projects(name)')
      .eq('employee_id', userId)
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date', { ascending: false }),
    supabase
      .from('timesheet_approvals')
      .select('*')
      .eq('employee_id', userId)
      .eq('period_month', month)
      .eq('period_year', year)
      .maybeSingle(),
  ]);
  if (logRes.error) throw logRes.error;
  return {
    logs: (logRes.data ?? []) as unknown as TimeLog[],
    approval: (appRes.data ?? null) as TimesheetApproval,
  };
}

export async function submitTimesheet(args: {
  userId: string; month: number; year: number; note: string;
  logs: TimeLog[]; existingId?: string;
}) {
  const totalHours = args.logs.reduce((s, l) => s + (l.hours_worked ?? 0), 0);
  const totalDays = new Set(args.logs.map((l) => l.work_date)).size;
  const payload = {
    employee_id: args.userId,
    period_month: args.month,
    period_year: args.year,
    status: 'pending_manager',
    total_hours: totalHours,
    total_days: totalDays,
    submitted_at: new Date().toISOString(),
    submission_note: args.note || null,
    rejected_by: null, rejected_at: null, rejection_reason: null, rejected_at_level: null,
    manager_id: null, manager_approved_at: null, manager_comment: null,
    hr_id: null, hr_approved_at: null, hr_comment: null,
    finance_id: null, finance_approved_at: null, finance_comment: null,
  };
  if (args.existingId) {
    const { error } = await supabase.from('timesheet_approvals').update(payload).eq('id', args.existingId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('timesheet_approvals').insert(payload);
    if (error) throw error;
  }
}

export type PendingTimesheet = {
  id: string;
  status: string;
  statusLabel: string;
  period_month: number;
  period_year: number;
  total_hours: number | null;
  total_days: number | null;
  submitted_at: string | null;
  employeeName: string;
  canAct: boolean;
};

export async function listPendingTimesheets(approverRole: string): Promise<PendingTimesheet[]> {
  await warmChains();
  const { data, error } = await supabase
    .from('timesheet_approvals')
    .select('id, status, period_month, period_year, total_hours, total_days, submitted_at, employee:profiles!employee_id(full_name)')
    .order('submitted_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  type Row = {
    id: string; status: string; period_month: number; period_year: number;
    total_hours: number | null; total_days: number | null; submitted_at: string | null;
    employee: { full_name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    status: r.status,
    statusLabel: statusLabel(r.status),
    period_month: r.period_month,
    period_year: r.period_year,
    total_hours: r.total_hours,
    total_days: r.total_days,
    submitted_at: r.submitted_at,
    employeeName: r.employee?.full_name ?? 'Unknown',
    canAct: canActOnSync(approverRole, r.status),
  }));
}

export async function actOnTimesheet(args: {
  approvalId: string; status: string; action: 'approve' | 'reject';
  approverId: string; approverRole: string; comment: string;
}) {
  const update = await buildApprovalUpdate(
    args.action, { status: args.status }, args.approverId, args.approverRole, args.comment,
  );
  const { error } = await supabase.from('timesheet_approvals').update(update).eq('id', args.approvalId);
  if (error) throw error;
}

export { statusLabel };

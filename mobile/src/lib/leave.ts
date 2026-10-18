import { supabase } from '@/lib/supabase';

// Employee-side leave: balances, my requests, and raising a request.
// Manager approval stays on the web app — approving there also runs the
// leave_balances decrement + capacity recompute (recomputeForEmployeeRange),
// which isn't ported to mobile.

export const FISCAL_YEAR = new Date().getFullYear();

export type LeaveType = { code: string; name: string; color: string };

// Fallback when leave_types isn't populated (mirrors LeavePage.jsx).
export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { code: 'sick', name: 'Sick', color: '#dc2626' },
  { code: 'casual', name: 'Casual', color: '#1d4ed8' },
  { code: 'personal', name: 'Personal', color: '#6d28d9' },
  { code: 'permission', name: 'Permission (hours)', color: '#0f766e' },
];

export type LeaveRequest = {
  id: string;
  leave_type: string;
  from_date: string | null;
  to_date: string | null;
  permission_date: string | null;
  permission_hours: number | null;
  reason: string | null;
  status: string;
  created_at: string;
};

export type LeaveBalances = {
  sick_used: number | null;
  casual_used: number | null;
  personal_used: number | null;
  permission_hours_used: number | null;
} | null;

export type LeavePolicy = {
  sick_days: number | null;
  casual_days: number | null;
  personal_days: number | null;
  permission_hours: number | null;
} | null;

function localISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function countWorkingDays(from: string, to: string, holidays: Set<string> = new Set()): number {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end = new Date(to); end.setHours(0, 0, 0, 0);
  if (end < start) return 0;
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    if (holidays.has(localISODate(d))) continue;
    count++;
  }
  return count;
}

export type LeaveData = {
  requests: LeaveRequest[];
  balances: LeaveBalances;
  policy: LeavePolicy;
  types: LeaveType[];
  holidays: Set<string>;
};

export async function getLeaveData(userId: string): Promise<LeaveData> {
  const [reqRes, balRes, polRes, typeRes, holRes] = await Promise.all([
    supabase.from('leave_requests').select('*').eq('employee_id', userId).order('created_at', { ascending: false }).limit(100),
    supabase.from('leave_balances').select('*').eq('employee_id', userId).eq('fiscal_year', FISCAL_YEAR).maybeSingle(),
    supabase.from('leave_policies').select('*').eq('employee_id', userId).maybeSingle(),
    supabase.from('leave_types').select('*').eq('is_active', true).order('name'),
    supabase.from('holidays').select('holiday_date'),
  ]);
  if (reqRes.error) throw reqRes.error;

  const dbTypes = (typeRes.data ?? []) as { code: string; name: string; color?: string | null }[];
  const types: LeaveType[] = dbTypes.length
    ? dbTypes.map((x) => ({ code: x.code, name: x.name, color: x.color ?? '#6366f1' }))
    : DEFAULT_LEAVE_TYPES;

  return {
    requests: (reqRes.data ?? []) as LeaveRequest[],
    balances: (balRes.data ?? null) as LeaveBalances,
    policy: (polRes.data ?? null) as LeavePolicy,
    types,
    holidays: new Set(((holRes.data ?? []) as { holiday_date: string }[]).map((h) => h.holiday_date)),
  };
}

export async function createLeaveRequest(userId: string, input: {
  leaveType: string;
  fromDate: string;
  toDate: string;
  reason: string;
  permissionDate?: string;
  permissionHours?: number;
}) {
  const isPermission = input.leaveType === 'permission';
  const { error } = await supabase.from('leave_requests').insert({
    employee_id: userId,
    leave_type: input.leaveType,
    from_date: isPermission ? null : input.fromDate,
    to_date: isPermission ? null : (input.toDate || input.fromDate),
    permission_date: isPermission ? (input.permissionDate || null) : null,
    permission_hours: isPermission ? (input.permissionHours ?? null) : null,
    reason: input.reason,
    status: 'pending',
  });
  if (error) throw error;
}

export function leaveRequestDays(req: LeaveRequest, holidays: Set<string>): number | null {
  if (req.leave_type === 'permission') return null;
  if (!req.from_date) return null;
  return countWorkingDays(req.from_date, req.to_date || req.from_date, holidays);
}

export function leaveStatusColor(status: string): string {
  return { pending: '#b45309', approved: '#15803d', rejected: '#dc2626', cancelled: '#475569' }[status] ?? '#475569';
}

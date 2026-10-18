import { supabase } from '@/lib/supabase';
import {
  buildApprovalUpdate, canActOnSync, statusLabel, warmChains,
  type ApprovalAction, type Workflow,
} from '@/lib/approvalFlow';

// Manager-side approvals inbox for Expense & Travel. Reads all requests
// the viewer's RLS lets them see, then classifies each with the shared
// chain logic. Actions mirror the web ApprovalsPage exactly:
// buildApprovalUpdate → table .update() → approval_logs insert.

export type ApprovalItem = {
  type: Workflow;
  id: string;
  number: string;
  title: string;
  subtitle: string;
  amount: number | null;
  date: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  requesterName: string;
  requesterRole: string;
  department: string | null;
  canAct: boolean;
  decided: boolean;
};

const DECIDED = ['approved', 'rejected', 'closed', 'cancelled'];

export async function listApprovalItems(approverRole: string): Promise<ApprovalItem[]> {
  await Promise.all([warmChains('expense'), warmChains('travel')]);

  const [exp, trv] = await Promise.all([
    supabase
      .from('expense_requests')
      .select('id, expense_number, title, category, total_amount, amount, expense_date, status, created_at, requester:profiles!requested_by(full_name, role, department:departments(name))')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('travel_requests')
      .select('id, request_number, from_location, to_location, travel_mode, estimated_cost, travel_date, status, created_at, requester:profiles!requested_by(full_name, role, department:departments(name))')
      .order('created_at', { ascending: false })
      .limit(300),
  ]);
  if (exp.error) throw exp.error;
  if (trv.error) throw trv.error;

  // PostgREST returns a to-one embed as an object at runtime; the
  // generated types sometimes model it as an array, hence the cast.
  type Requester = { full_name: string | null; role: string | null; department: { name: string | null } | null } | null;
  type ExpRow = {
    id: string; expense_number: string | null; title: string | null; category: string | null;
    total_amount: number | null; amount: number | null; expense_date: string | null;
    status: string; created_at: string; requester: Requester;
  };
  type TrvRow = {
    id: string; request_number: string | null; from_location: string | null; to_location: string | null;
    travel_mode: string | null; estimated_cost: number | null; travel_date: string | null;
    status: string; created_at: string; requester: Requester;
  };

  const reqInfo = (r: Requester) => ({
    name: r?.full_name ?? 'Unknown',
    role: r?.role ?? 'employee',
    dept: r?.department?.name ?? null,
  });

  const expItems: ApprovalItem[] = ((exp.data ?? []) as unknown as ExpRow[]).map((e) => {
    const info = reqInfo(e.requester);
    return {
      type: 'expense' as const,
      id: e.id,
      number: e.expense_number ?? '',
      title: e.title ?? 'Expense',
      subtitle: `${e.category ?? 'Expense'} · ${e.expense_number ?? ''}`,
      amount: e.total_amount ?? e.amount ?? null,
      date: e.expense_date ?? e.created_at,
      createdAt: e.created_at,
      status: e.status,
      statusLabel: statusLabel(e.status),
      requesterName: info.name,
      requesterRole: info.role,
      department: info.dept,
      canAct: canActOnSync(approverRole, e.status, info.role, 'expense'),
      decided: DECIDED.includes(e.status),
    };
  });

  const trvItems: ApprovalItem[] = ((trv.data ?? []) as unknown as TrvRow[]).map((tr) => {
    const info = reqInfo(tr.requester);
    return {
      type: 'travel' as const,
      id: tr.id,
      number: tr.request_number ?? '',
      title: `${tr.from_location ?? ''} → ${tr.to_location ?? ''}`,
      subtitle: `${tr.travel_mode ?? 'Travel'} · ${tr.request_number ?? ''}`,
      amount: tr.estimated_cost ?? null,
      date: tr.travel_date ?? tr.created_at,
      createdAt: tr.created_at,
      status: tr.status,
      statusLabel: statusLabel(tr.status),
      requesterName: info.name,
      requesterRole: info.role,
      department: info.dept,
      canAct: canActOnSync(approverRole, tr.status, info.role, 'travel'),
      decided: DECIDED.includes(tr.status),
    };
  });

  return [...expItems, ...trvItems].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function applyApproval(args: {
  item: ApprovalItem;
  action: ApprovalAction;
  approverRole: string;
  profileId: string;
  note: string;
}) {
  const { item, action, approverRole, profileId, note } = args;
  const table = item.type === 'expense' ? 'expense_requests' : 'travel_requests';
  const update = await buildApprovalUpdate(action, item.status, approverRole, item.requesterRole, profileId, note, item.type);

  const { error } = await supabase.from(table).update(update).eq('id', item.id);
  if (error) throw error;

  // Audit log — best-effort, never fail the decision that already landed.
  await supabase.from('approval_logs').insert({
    entity_type: item.type,
    entity_id: item.id,
    performed_by: profileId,
    action,
    from_status: item.status,
    to_status: update.status,
    comments: note || null,
  }); // ignore result: a missing/locked-down approval_logs table must not surface as a failed approval
}

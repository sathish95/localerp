import { supabase } from '@/lib/supabase';

// TS port of the web src/lib/timesheetApproval.js. Chain is DB-configurable
// (approval_chains workflow 'timesheet', selector 'always'), falling back
// to manager → hr → finance. timesheet_approvals has exactly 3 positional
// approver column sets (manager_*, hr_*, finance_*).

type Step = { role: string; label: string; status: string };

const DEFAULT_CHAIN: Step[] = [
  { role: 'manager', label: 'Manager', status: 'pending_manager' },
  { role: 'hr', label: 'HR', status: 'pending_hr' },
  { role: 'finance', label: 'Finance', status: 'pending_finance' },
];
const COLS = ['manager', 'hr', 'finance'];

let cachedChain: Step[] | null = null;

export async function getChain(): Promise<Step[]> {
  if (cachedChain) return cachedChain;
  try {
    const { data: chain, error: chainErr } = await supabase
      .from('approval_chains')
      .select('id')
      .eq('workflow', 'timesheet')
      .eq('selector_type', 'always')
      .eq('is_active', true)
      .maybeSingle();
    if (chainErr || !chain) return DEFAULT_CHAIN;
    const { data: steps, error: stepsErr } = await supabase
      .from('approval_chain_steps')
      .select('*')
      .eq('chain_id', chain.id)
      .order('step_order');
    if (stepsErr || !steps?.length) return DEFAULT_CHAIN;
    cachedChain = steps.slice(0, COLS.length).map((s: { approver_role: string; label: string; status_value: string }) => ({
      role: s.approver_role,
      label: s.label,
      status: s.status_value,
    }));
    return cachedChain;
  } catch (err) {
    console.error('[timesheetApproval:getChain]', err);
    return DEFAULT_CHAIN;
  }
}

export async function warmChains() {
  await getChain();
}

export function getChainSync(): Step[] {
  return cachedChain ?? DEFAULT_CHAIN;
}

export function canActOnSync(role: string, currentStatus: string): boolean {
  if (['admin', 'ceo'].includes(role)) return true;
  const step = getChainSync().find((s) => s.status === currentStatus);
  return step ? step.role === role : false;
}

export type TsApprovalRow = { status: string };
export type TsUpdate = Record<string, string | null>;

export async function buildApprovalUpdate(
  action: 'approve' | 'reject', approval: TsApprovalRow, approverId: string, approverRole: string, comment: string,
): Promise<TsUpdate> {
  const chain = await getChain();
  const idx = chain.findIndex((s) => s.status === approval.status);
  const now = new Date().toISOString();

  if (action === 'reject') {
    const level = COLS[idx] || 'manager';
    return {
      status: 'rejected', rejected_by: approverId, rejected_at: now,
      rejection_reason: comment || null, rejected_at_level: level,
    };
  }

  // Admin/CEO approving from step 0 auto-approves every remaining step.
  if (['admin', 'ceo'].includes(approverRole) && idx === 0) {
    const update: TsUpdate = { status: 'approved' };
    chain.forEach((_s, i) => {
      const col = COLS[i];
      if (!col) return;
      update[`${col}_id`] = approverId;
      update[`${col}_approved_at`] = now;
      update[`${col}_comment`] = i === 0 ? (comment || null) : 'Auto-approved by admin';
    });
    return update;
  }

  if (idx === -1) {
    throw new Error(`Status "${approval.status}" isn't part of the current approval chain — it may have changed while this timesheet was in flight.`);
  }
  const col = COLS[idx];
  const nextStatus = idx === chain.length - 1 ? 'approved' : chain[idx + 1].status;
  const update: TsUpdate = { status: nextStatus };
  if (col) {
    update[`${col}_id`] = approverId;
    update[`${col}_approved_at`] = now;
    update[`${col}_comment`] = comment || null;
  }
  return update;
}

export function statusLabel(status: string): string {
  return {
    draft: 'Draft', pending_manager: 'Pending Manager', pending_hr: 'Pending HR',
    pending_finance: 'Pending Finance', approved: 'Approved', rejected: 'Rejected',
  }[status] ?? status;
}

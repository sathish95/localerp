import { supabase } from '@/lib/supabase';

// TS port of the web src/lib/approvalFlow.js (Expense & Travel only —
// procurement/invoice flows aren't in the mobile app). DB-configurable
// chains via approval_chains / approval_chain_steps, with a hardcoded
// fallback. Status progression in the DB is fixed:
//   submitted → manager_review → ceo_review → finance_review → approved

export type Workflow = 'expense' | 'travel';
export type ApprovalAction = 'approve' | 'reject' | 'cancel';

export type ChainStep = { label: string; short: string; status: string; role?: string };

const SUBMITTER_LABELS: Record<string, { label: string; short: string }> = {
  employee: { label: 'Employee', short: 'Emp' },
  manager: { label: 'Manager', short: 'Mgr' },
  finance: { label: 'Finance', short: 'Fin' },
  hr: { label: 'HR', short: 'HR' },
  department_head: { label: 'Dept Head', short: 'DH' },
};

const DEFAULT_CHAINS: Record<string, ChainStep[]> = {
  employee: [
    { label: 'Employee', short: 'Emp', status: 'submitted' },
    { label: 'Manager', short: 'Mgr', status: 'manager_review', role: 'manager' },
    { label: 'CEO', short: 'CEO', status: 'ceo_review', role: 'ceo' },
    { label: 'Finance', short: 'Fin', status: 'finance_review', role: 'finance' },
  ],
  manager: [
    { label: 'Manager', short: 'Mgr', status: 'submitted' },
    { label: 'CEO', short: 'CEO', status: 'ceo_review', role: 'ceo' },
    { label: 'Finance', short: 'Fin', status: 'finance_review', role: 'finance' },
  ],
  finance: [
    { label: 'Finance', short: 'Fin', status: 'submitted' },
    { label: 'Manager', short: 'Mgr', status: 'manager_review', role: 'manager' },
    { label: 'CEO', short: 'CEO', status: 'ceo_review', role: 'ceo' },
  ],
  hr: [
    { label: 'HR', short: 'HR', status: 'submitted' },
    { label: 'Manager', short: 'Mgr', status: 'manager_review', role: 'manager' },
    { label: 'CEO', short: 'CEO', status: 'ceo_review', role: 'ceo' },
    { label: 'Finance', short: 'Fin', status: 'finance_review', role: 'finance' },
  ],
  department_head: [
    { label: 'Dept Head', short: 'DH', status: 'submitted' },
    { label: 'CEO', short: 'CEO', status: 'ceo_review', role: 'ceo' },
    { label: 'Finance', short: 'Fin', status: 'finance_review', role: 'finance' },
  ],
};

const cache: Record<string, ChainStep[]> = {};
const ALL_SUBMITTER_ROLES = Object.keys(SUBMITTER_LABELS);

export async function getChain(submitterRole: string, workflow: Workflow = 'expense'): Promise<ChainStep[]> {
  const role = SUBMITTER_LABELS[submitterRole] ? submitterRole : 'employee';
  const cacheKey = `${workflow}:${role}`;
  if (cache[cacheKey]) return cache[cacheKey];

  try {
    const { data: chainRow, error: chainErr } = await supabase
      .from('approval_chains')
      .select('id')
      .eq('workflow', workflow)
      .eq('selector_type', 'submitter_role')
      .eq('selector_value', role)
      .eq('is_active', true)
      .maybeSingle();
    if (chainErr || !chainRow) return DEFAULT_CHAINS[role] ?? DEFAULT_CHAINS.employee;

    const { data: steps, error: stepsErr } = await supabase
      .from('approval_chain_steps')
      .select('*')
      .eq('chain_id', chainRow.id)
      .order('step_order');
    if (stepsErr || !steps?.length) return DEFAULT_CHAINS[role] ?? DEFAULT_CHAINS.employee;

    const submitter = SUBMITTER_LABELS[role] ?? SUBMITTER_LABELS.employee;
    const chain: ChainStep[] = [
      { label: submitter.label, short: submitter.short, status: 'submitted' },
      ...steps.map((s: { label: string; status_value: string; approver_role: string }) => ({
        label: s.label,
        short: s.label.slice(0, 3),
        status: s.status_value,
        role: s.approver_role,
      })),
    ];
    cache[cacheKey] = chain;
    return chain;
  } catch (err) {
    console.error('[approvalFlow:getChain]', err);
    return DEFAULT_CHAINS[role] ?? DEFAULT_CHAINS.employee;
  }
}

export function getChainSync(submitterRole: string, workflow: Workflow = 'expense'): ChainStep[] {
  const role = SUBMITTER_LABELS[submitterRole] ? submitterRole : 'employee';
  return cache[`${workflow}:${role}`] ?? DEFAULT_CHAINS[role] ?? DEFAULT_CHAINS.employee;
}

export async function warmChains(workflow: Workflow = 'expense') {
  await Promise.all(ALL_SUBMITTER_ROLES.map((r) => getChain(r, workflow)));
}

export async function nextApprovalStatus(
  currentStatus: string, _approverRole: string, submitterRole: string, workflow: Workflow = 'expense',
): Promise<string> {
  const chain = await getChain(submitterRole, workflow);
  const idx = chain.findIndex((s) => s.status === currentStatus);
  if (idx === -1) {
    throw new Error(`Status "${currentStatus}" isn't part of the current approval chain — it may have changed while this item was in flight.`);
  }
  if (idx === chain.length - 1) return 'approved';
  return chain[idx + 1].status;
}

function resolveCanActOn(chain: ChainStep[], approverRole: string, currentStatus: string): boolean {
  if (approverRole === 'admin') {
    return ['submitted', 'manager_review', 'ceo_review', 'finance_review'].includes(currentStatus);
  }
  const step = chain.find((s) => s.status === currentStatus);
  if (!step) return false;
  if (step.role) return step.role === approverRole;
  const actorLabel = step.label.toLowerCase();
  if (actorLabel === 'manager' || actorLabel === 'dept head') return ['manager', 'department_head'].includes(approverRole);
  if (actorLabel === 'ceo') return approverRole === 'ceo';
  if (actorLabel === 'finance') return approverRole === 'finance';
  if (actorLabel === 'hr') return approverRole === 'hr';
  return false;
}

export function canActOnSync(approverRole: string, currentStatus: string, submitterRole: string, workflow: Workflow = 'expense'): boolean {
  return resolveCanActOn(getChainSync(submitterRole, workflow), approverRole, currentStatus);
}

export type ApprovalUpdate = {
  status: string;
  rejection_reason?: string | null;
  manager_approved_by?: string;
  manager_approved_at?: string;
  ceo_approved_by?: string;
  ceo_approved_at?: string;
  finance_approved_by?: string;
  finance_approved_at?: string;
};

export async function buildApprovalUpdate(
  action: ApprovalAction, currentStatus: string, approverRole: string, submitterRole: string,
  profileId: string, note: string, workflow: Workflow = 'expense',
): Promise<ApprovalUpdate> {
  if (action === 'reject') return { status: 'rejected', rejection_reason: note || null };
  if (action === 'cancel') return { status: 'closed' };

  const toStatus = await nextApprovalStatus(currentStatus, approverRole, submitterRole, workflow);
  const update: ApprovalUpdate = { status: toStatus };
  const now = new Date().toISOString();

  if (['submitted', 'manager_review'].includes(currentStatus)) {
    update.manager_approved_by = profileId;
    update.manager_approved_at = now;
  } else if (currentStatus === 'ceo_review') {
    update.ceo_approved_by = profileId;
    update.ceo_approved_at = now;
  } else if (currentStatus === 'finance_review') {
    update.finance_approved_by = profileId;
    update.finance_approved_at = now;
  }
  return update;
}

export function statusLabel(status: string): string {
  const MAP: Record<string, string> = {
    submitted: 'Pending Manager',
    manager_review: 'Pending CEO',
    ceo_review: 'Pending Finance',
    finance_review: 'In Finance Review',
    approved: 'Approved',
    rejected: 'Rejected',
    closed: 'Closed',
    cancelled: 'Cancelled',
    draft: 'Draft',
  };
  return MAP[status] ?? status;
}

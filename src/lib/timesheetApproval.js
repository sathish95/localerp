import { supabase } from './supabase'

// TIMESHEET — extracted from the state machine that used to live inline in
// TimesheetApprovalPage.jsx's doAction(), and made DB-configurable to match
// the other three approval engines (approvalFlow.js, procurementApproval.js,
// warrantyApproval.js). Falls back to this hardcoded default if the
// approval_chains table hasn't been seeded yet — same safety net used by
// the other engines during rollout.
const DEFAULT_CHAIN = [
  { role: 'manager', label: 'Manager', status: 'pending_manager' },
  { role: 'hr', label: 'HR', status: 'pending_hr' },
  { role: 'finance', label: 'Finance', status: 'pending_finance' },
]

// timesheet_approvals has exactly 3 dedicated approver column sets
// (manager_id/manager_approved_at/manager_comment, hr_*, finance_*) —
// positional, same constraint approvalFlow.js already has on
// expense_requests/travel_requests. A custom chain can reassign WHICH role
// sits at each position, but is capped at 3 steps to match the schema.
const COLS = ['manager', 'hr', 'finance']

let cachedChain = null

export async function getChain() {
  if (cachedChain) return cachedChain
  try {
    const { data: chain, error: chainErr } = await supabase.from('approval_chains')
      .select('id').eq('workflow', 'timesheet').eq('selector_type', 'always').eq('is_active', true).maybeSingle()
    if (chainErr || !chain) return DEFAULT_CHAIN
    const { data: steps, error: stepsErr } = await supabase.from('approval_chain_steps')
      .select('*').eq('chain_id', chain.id).order('step_order')
    if (stepsErr || !steps?.length) return DEFAULT_CHAIN
    cachedChain = steps.slice(0, COLS.length).map(s => ({ role: s.approver_role, label: s.label, status: s.status_value }))
    return cachedChain
  } catch (err) {
    console.error('[timesheetApproval:getChain]', err)
    return DEFAULT_CHAIN
  }
}

export async function firstReviewStatus() {
  const chain = await getChain()
  return chain[0]?.status || 'pending_manager'
}

// Synchronous, cache-only lookup for render-time use (tab/role gating) —
// returns the hardcoded default until warmChains() has warmed the cache.
export function getChainSync() {
  return cachedChain || DEFAULT_CHAIN
}

/** Warm the cache — call once on page load. */
export async function warmChains() {
  await getChain()
}

export async function canActOn(role, currentStatus) {
  if (['admin', 'ceo'].includes(role)) return true
  const chain = await getChain()
  const step = chain.find(s => s.status === currentStatus)
  return step ? step.role === role : false
}

// action: 'approve' | 'reject'. approverRole is used only to detect the
// admin/ceo one-step full-approve shortcut that already existed in the
// inline version. Returns the partial row update to apply.
export async function buildApprovalUpdate(action, approval, approverId, approverRole, comment) {
  const chain = await getChain()
  const idx = chain.findIndex(s => s.status === approval.status)

  if (action === 'reject') {
    const level = COLS[idx] || 'manager'
    return { status: 'rejected', rejected_by: approverId, rejected_at: new Date().toISOString(), rejection_reason: comment || null, rejected_at_level: level }
  }

  // Admin/CEO approving from the first step skips straight through every
  // remaining step in one action (existing behavior, generalized to N steps).
  if (['admin', 'ceo'].includes(approverRole) && idx === 0) {
    const update = { status: 'approved' }
    chain.forEach((step, i) => {
      const col = COLS[i]
      if (!col) return
      update[`${col}_id`] = approverId
      update[`${col}_approved_at`] = new Date().toISOString()
      update[`${col}_comment`] = i === 0 ? (comment || null) : 'Auto-approved by admin'
    })
    return update
  }

  if (idx === -1) throw new Error(`Status "${approval.status}" isn't part of the current approval chain — it may have been edited while this timesheet was in flight. Contact an admin.`)
  const col = COLS[idx]
  const nextStatus = idx === chain.length - 1 ? 'approved' : chain[idx + 1].status
  const update = { status: nextStatus }
  if (col) {
    update[`${col}_id`] = approverId
    update[`${col}_approved_at`] = new Date().toISOString()
    update[`${col}_comment`] = comment || null
  }
  return update
}

export function statusLabel(status) {
  return {
    draft: 'Draft', pending_manager: 'Pending Manager', pending_hr: 'Pending HR',
    pending_finance: 'Pending Finance', approved: 'Approved', rejected: 'Rejected',
  }[status] || status
}

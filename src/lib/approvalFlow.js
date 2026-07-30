/**
 * PROCUREPRO — Centralised Approval Flow Engine (Expense & Travel)
 *
 * The chain for each submitter role is now DB-configurable (see
 * sql/STEP48_approval_chains.sql, workflow 'expense'/'travel',
 * selector_type 'submitter_role') — admins can reassign which role
 * handles each review step, or define new chains, from Settings →
 * Approval Chain. This file falls back to the hardcoded defaults below
 * if no matching DB chain exists yet (e.g. before the seed has run).
 *
 * Status progression in the DB stays FIXED regardless of configuration
 * (other pages — Dashboard, Reports, ApprovalsPage — hardcode these exact
 * strings): submitted → manager_review → ceo_review → finance_review → approved.
 * Each role can act only on the status that is waiting for them.
 */
import { supabase } from './supabase'

const SUBMITTER_LABELS = {
  employee: { label: 'Employee', short: 'Emp' },
  manager: { label: 'Manager', short: 'Mgr' },
  finance: { label: 'Finance', short: 'Fin' },
  hr: { label: 'HR', short: 'HR' },
  department_head: { label: 'Dept Head', short: 'DH' },
}

// Fallback chain definitions — used only if the DB chain isn't seeded yet.
const DEFAULT_CHAINS = {
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
  // admin/ceo: no chain — they can approve anything
}

const cache = {}
const ALL_SUBMITTER_ROLES = Object.keys(SUBMITTER_LABELS)

/** Get the chain steps for a given submitter role. workflow: 'expense' | 'travel'. */
export async function getChain(submitterRole, workflow = 'expense') {
  const role = SUBMITTER_LABELS[submitterRole] ? submitterRole : 'employee'
  const cacheKey = `${workflow}:${role}`
  if (cache[cacheKey]) return cache[cacheKey]

  try {
    const { data: chainRow, error: chainErr } = await supabase.from('approval_chains')
      .select('id').eq('workflow', workflow).eq('selector_type', 'submitter_role').eq('selector_value', role).eq('is_active', true).maybeSingle()
    if (chainErr || !chainRow) return DEFAULT_CHAINS[role] || DEFAULT_CHAINS.employee

    const { data: steps, error: stepsErr } = await supabase.from('approval_chain_steps')
      .select('*').eq('chain_id', chainRow.id).order('step_order')
    if (stepsErr || !steps?.length) return DEFAULT_CHAINS[role] || DEFAULT_CHAINS.employee

    const submitter = SUBMITTER_LABELS[role] || SUBMITTER_LABELS.employee
    const chain = [
      { label: submitter.label, short: submitter.short, status: 'submitted' },
      ...steps.map(s => ({ label: s.label, short: s.label.slice(0, 3), status: s.status_value, role: s.approver_role })),
    ]
    cache[cacheKey] = chain
    return chain
  } catch (err) {
    console.error('[approvalFlow:getChain]', err)
    return DEFAULT_CHAINS[role] || DEFAULT_CHAINS.employee
  }
}

// Synchronous, cache-only lookup for render-time use (table rows, modals) —
// returns the hardcoded default until getChain() has warmed the cache for
// that role. Call warmChains() once on page load to warm all submitter roles.
export function getChainSync(submitterRole, workflow = 'expense') {
  const role = SUBMITTER_LABELS[submitterRole] ? submitterRole : 'employee'
  return cache[`${workflow}:${role}`] || DEFAULT_CHAINS[role] || DEFAULT_CHAINS.employee
}

/** Warm the cache for every submitter role of a workflow — call once on page load. */
export async function warmChains(workflow = 'expense') {
  await Promise.all(ALL_SUBMITTER_ROLES.map(r => getChain(r, workflow)))
}

/**
 * What DB status comes NEXT after this approver acts (approve action)?
 * currentStatus = what the record currently has
 */
export async function nextApprovalStatus(currentStatus, approverRole, submitterRole, workflow = 'expense') {
  const chain = await getChain(submitterRole, workflow)
  const idx = chain.findIndex(s => s.status === currentStatus)
  if (idx === -1) throw new Error(`Status "${currentStatus}" isn't part of the current approval chain — it may have been edited while this item was in flight. Contact an admin.`)
  if (idx === chain.length - 1) return 'approved'
  return chain[idx + 1].status
}

function resolveCanActOn(chain, approverRole, currentStatus) {
  if (approverRole === 'admin') return ['submitted', 'manager_review', 'ceo_review', 'finance_review'].includes(currentStatus)
  const step = chain.find(s => s.status === currentStatus)
  if (!step) return false
  // DB-sourced reviewer steps carry an explicit approver_role — this is the
  // editable part. The synthetic first "submitted" entry (the submitter's
  // own display node) has no role; preserve its original label-matching
  // behavior so nothing about that specific quirk changes.
  if (step.role) return step.role === approverRole
  const actorLabel = step.label.toLowerCase()
  if (actorLabel === 'manager' || actorLabel === 'dept head') return ['manager', 'department_head'].includes(approverRole)
  if (actorLabel === 'ceo') return approverRole === 'ceo'
  if (actorLabel === 'finance') return approverRole === 'finance'
  if (actorLabel === 'hr') return approverRole === 'hr'
  return false
}

/** Can this role act on this item right now? */
export async function canActOn(approverRole, currentStatus, submitterRole, workflow = 'expense') {
  const chain = await getChain(submitterRole, workflow)
  return resolveCanActOn(chain, approverRole, currentStatus)
}

/** Sync, cache-only version of canActOn for render-time use (see getChainSync). */
export function canActOnSync(approverRole, currentStatus, submitterRole, workflow = 'expense') {
  const chain = getChainSync(submitterRole, workflow)
  return resolveCanActOn(chain, approverRole, currentStatus)
}

/**
 * Build the update payload for an approval action
 * action: 'approve' | 'reject' | 'cancel'
 */
export async function buildApprovalUpdate(action, currentStatus, approverRole, submitterRole, profileId, note, workflow = 'expense') {
  if (action === 'reject') return { status: 'rejected', rejection_reason: note || null }
  if (action === 'cancel') return { status: 'closed' }

  // approve
  const toStatus = await nextApprovalStatus(currentStatus, approverRole, submitterRole, workflow)
  const update = { status: toStatus }
  const now = new Date().toISOString()

  if (['submitted', 'manager_review'].includes(currentStatus)) {
    update.manager_approved_by = profileId
    update.manager_approved_at = now
  } else if (currentStatus === 'ceo_review') {
    update.ceo_approved_by = profileId
    update.ceo_approved_at = now
  } else if (currentStatus === 'finance_review') {
    update.finance_approved_by = profileId
    update.finance_approved_at = now
  }

  return update
}

/** Visual step state for the chain display */
export function stepState(chainStep, currentStatus, isRejected) {
  const ORDER = ['submitted', 'manager_review', 'ceo_review', 'finance_review', 'approved']
  if (isRejected) {
    const cur = ORDER.indexOf(currentStatus)
    const stepCur = ORDER.indexOf(chainStep.status)
    if (stepCur < cur) return 'done'
    if (stepCur === cur) return 'rejected'
    return 'pending'
  }
  if (currentStatus === 'approved') return 'done'
  const cur = ORDER.indexOf(currentStatus)
  const stepCur = ORDER.indexOf(chainStep.status)
  if (stepCur < cur) return 'done'
  if (stepCur === cur) return 'active'
  return 'pending'
}

/** Friendly label for current status */
export function statusLabel(status) {
  const MAP = {
    submitted: 'Pending Manager',
    manager_review: 'Pending CEO',
    ceo_review: 'Pending Finance',
    finance_review: 'In Finance Review',
    approved: 'Approved',
    rejected: 'Rejected',
    closed: 'Closed',
    draft: 'Draft',
  }
  return MAP[status] || status
}

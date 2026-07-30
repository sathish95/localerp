/**
 * WARRANTY CLAIM — approval chain.
 *
 * Field Technician submits a claim -> PM approves -> CEO approves ->
 * Finance approves -> Resolved (Replace/Repair/Remote Fix/Reject).
 *
 * The chain's shape/roles are now DB-configurable (see
 * sql/STEP48_approval_chains.sql, workflow 'warranty', selector_type
 * 'always') — admins can reassign roles or edit steps from Settings →
 * Approval Chain. Falls back to the hardcoded CHAIN below if no matching
 * DB chain exists yet. The only branching left outside this file is
 * whether a claim enters the chain at all: claims estimated below
 * warranty_settings.claim_auto_approve_threshold skip straight to
 * 'Approved' (src/lib/warranty.js's createWarrantyClaim handles that) —
 * that threshold is a numeric gate, not a role assignment, and stays as-is.
 *
 * This is a SEPARATE engine from approvalFlow.js (role-indexed, used by
 * expenses/travel) and procurementApproval.js (cost-threshold branched
 * chain shape) — do not fold this into either of those.
 */
import { supabase } from './supabase'

const DEFAULT_CHAIN = [
  { key: 'pm', label: 'PM', short: 'PM', status: 'PM Review' },
  { key: 'ceo', label: 'CEO', short: 'CEO', status: 'CEO Review' },
  { key: 'finance', label: 'Finance', short: 'Fin', status: 'Finance Review' },
]

let cachedChain = null

/** DB-backed chain lookup, falls back to the hardcoded default. */
export async function getChain() {
  if (cachedChain) return cachedChain
  try {
    const { data: chainRow, error: chainErr } = await supabase.from('approval_chains')
      .select('id').eq('workflow', 'warranty').eq('selector_type', 'always').eq('is_active', true).maybeSingle()
    if (chainErr || !chainRow) return DEFAULT_CHAIN

    const { data: steps, error: stepsErr } = await supabase.from('approval_chain_steps')
      .select('*').eq('chain_id', chainRow.id).order('step_order')
    if (stepsErr || !steps?.length) return DEFAULT_CHAIN

    cachedChain = steps.map(s => ({ key: s.approver_role, label: s.label, short: s.label.slice(0, 3), status: s.status_value }))
    return cachedChain
  } catch (err) {
    console.error('[warrantyApproval:getChain]', err)
    return DEFAULT_CHAIN
  }
}

// Synchronous, cache-only lookup for render-time/module-scope use — returns
// the hardcoded default until the async getChain() above has warmed the
// cache once (call it early, e.g. in the page's load()).
export function getChainSync() {
  return cachedChain || DEFAULT_CHAIN
}

/** First status a claim enters when it needs review (not auto-approved). */
export async function firstReviewStatus() {
  const chain = await getChain()
  return chain[0].status
}

/** What status comes next after this step (approve action)? */
export async function nextApprovalStatus(currentStatus) {
  const chain = await getChain()
  const idx = chain.findIndex(s => s.status === currentStatus)
  if (idx === -1) throw new Error(`Status "${currentStatus}" isn't part of the current approval chain — it may have been edited while this claim was in flight. Contact an admin.`)
  if (idx === chain.length - 1) return 'Approved'
  return chain[idx + 1].status
}

function resolveCanActOn(chain, role, currentStatus) {
  if (role === 'admin') return true
  const step = chain.find(s => s.status === currentStatus)
  if (!step) return false
  return role === step.key
}

/** Can this role act on this claim right now? (admin bypasses, ceo maps to the 'ceo' step) */
export async function canActOn(role, currentStatus) {
  const chain = await getChain()
  return resolveCanActOn(chain, role, currentStatus)
}

/** Sync, cache-only version of canActOn for render-time use (see getChainSync). */
export function canActOnSync(role, currentStatus) {
  const chain = getChainSync()
  return resolveCanActOn(chain, role, currentStatus)
}

/** Column pair to stamp for a given step key */
function approvalColumns(stepKey) {
  const MAP = {
    pm: ['pm_approved_by', 'pm_approved_at'],
    ceo: ['ceo_approved_by', 'ceo_approved_at'],
    finance: ['finance_approved_by', 'finance_approved_at'],
  }
  return MAP[stepKey] || [null, null]
}

/**
 * Build the update payload for an approval action.
 * action: 'approve' | 'reject'
 * Rejection at any step is terminal ('Rejected') — the claim record and
 * rejection reason stay attached for pattern analysis, matching this
 * module's existing spec for out-of-warranty/rejected claims. Unlike
 * procurementApproval.js's reject-to-draft (which supports resubmission),
 * there's no claim-resubmit flow here — a field technician logs a new
 * claim if the issue recurs.
 */
export async function buildApprovalUpdate(action, currentStatus, profileId, note) {
  if (action === 'reject') return { status: 'Rejected', rejection_reason: note || null }

  const chain = await getChain()
  const step = chain.find(s => s.status === currentStatus)
  const toStatus = await nextApprovalStatus(currentStatus)
  const update = { status: toStatus, rejection_reason: null }
  const [byCol, atCol] = approvalColumns(step?.key)
  if (byCol) { update[byCol] = profileId; update[atCol] = new Date().toISOString() }
  return update
}

/** Visual step state for chain display: 'done' | 'active' | 'pending' */
export function stepStateFor(step, currentStatus) {
  if (currentStatus === 'Approved' || currentStatus === 'Resolved') return 'done'
  const chain = getChainSync()
  const order = chain.map(s => s.status)
  const cur = order.indexOf(currentStatus)
  const stepIdx = order.indexOf(step.status)
  if (cur === -1) return 'pending'
  if (stepIdx < cur) return 'done'
  if (stepIdx === cur) return 'active'
  return 'pending'
}

/** Friendly label for current status */
export function statusLabel(status) {
  const MAP = {
    Reported: 'Reported',
    'Under Review': 'Under Review',
    'PM Review': 'Pending PM',
    'CEO Review': 'Pending CEO',
    'Finance Review': 'Pending Finance',
    Approved: 'Approved',
    Resolved: 'Resolved',
    Rejected: 'Rejected',
  }
  return MAP[status] || status
}

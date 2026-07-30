/**
 * PROPOSAL — approval chain.
 *
 * Sales Lead submits a proposal for approval -> Sales Lead peer review ->
 * Finance -> CTO/Leadership. All stages Approved -> proposal can be
 * marked Won. A rejection at any stage sends it to 'Revision Requested'.
 *
 * The chain's shape/roles are DB-configurable (see sql/STEP48_approval_chains.sql,
 * workflow 'proposal', selector_type 'always') — admins can reassign roles or
 * edit steps from Settings → Approval Chain. Falls back to the hardcoded
 * DEFAULT_CHAIN below if no matching DB chain exists yet.
 *
 * Two status columns, not one, because proposals.status is a fixed coarse
 * vocabulary (Draft/In Negotiation/Ready for Approval/Approved/Revision
 * Requested/Won/Lost/Expired) that the rest of the module reasons about —
 * this engine instead walks proposals.approval_status (the chain position:
 * 'sales_lead_review'/'finance_review'/'cto_review'/'approved'), and
 * buildApprovalUpdate() below keeps the two in sync on every action.
 *
 * This is a SEPARATE engine from approvalFlow.js/procurementApproval.js/
 * warrantyApproval.js/timesheetApproval.js — do not fold into any of those.
 */
import { supabase } from './supabase'

const DEFAULT_CHAIN = [
  { key: 'sales_lead', label: 'Sales Lead', short: 'SL', status: 'sales_lead_review' },
  { key: 'finance', label: 'Finance', short: 'Fin', status: 'finance_review' },
  { key: 'cto', label: 'CTO / Leadership', short: 'CTO', status: 'cto_review' },
]

let cachedChain = null

/** DB-backed chain lookup, falls back to the hardcoded default. */
export async function getChain() {
  if (cachedChain) return cachedChain
  try {
    const { data: chainRow, error: chainErr } = await supabase.from('approval_chains')
      .select('id').eq('workflow', 'proposal').eq('selector_type', 'always').eq('is_active', true).maybeSingle()
    if (chainErr || !chainRow) return DEFAULT_CHAIN

    const { data: steps, error: stepsErr } = await supabase.from('approval_chain_steps')
      .select('*').eq('chain_id', chainRow.id).order('step_order')
    if (stepsErr || !steps?.length) return DEFAULT_CHAIN

    cachedChain = steps.map(s => ({ key: s.approver_role, label: s.label, short: s.label.slice(0, 3), status: s.status_value }))
    return cachedChain
  } catch (err) {
    console.error('[proposalApproval:getChain]', err)
    return DEFAULT_CHAIN
  }
}

// Synchronous, cache-only lookup for render-time/module-scope use — returns
// the hardcoded default until the async getChain() above has warmed the
// cache once (call it early, e.g. in the page's load()).
export function getChainSync() {
  return cachedChain || DEFAULT_CHAIN
}

/** Warm the cache — call once on page load. */
export async function warmChains() {
  await getChain()
}

/** First approval_status a submitted proposal enters. */
export async function firstReviewStatus() {
  const chain = await getChain()
  return chain[0].status
}

/** What approval_status comes next after this step (approve action)? */
export async function nextApprovalStatus(currentStatus) {
  const chain = await getChain()
  const idx = chain.findIndex(s => s.status === currentStatus)
  if (idx === -1) throw new Error(`Status "${currentStatus}" isn't part of the current approval chain — it may have been edited while this proposal was in flight. Contact an admin.`)
  if (idx === chain.length - 1) return 'approved'
  return chain[idx + 1].status
}

function resolveCanActOn(chain, role, currentStatus) {
  if (role === 'admin') return true
  const step = chain.find(s => s.status === currentStatus)
  if (!step) return false
  return role === step.key
}

/** Can this role act on this proposal right now? (admin bypasses) */
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
    sales_lead: ['sales_lead_approved_by', 'sales_lead_approved_at'],
    finance: ['finance_approved_by', 'finance_approved_at'],
    cto: ['cto_approved_by', 'cto_approved_at'],
  }
  return MAP[stepKey] || [null, null]
}

/**
 * Build the update payload for an approval action.
 * action: 'approve' | 'reject'
 * Rejection sends the proposal to 'Revision Requested' (the author edits
 * and resubmits — approval_status resets so it re-enters from the top).
 */
export async function buildApprovalUpdate(action, currentApprovalStatus, profileId, note) {
  if (action === 'reject') {
    return { status: 'Revision Requested', approval_status: null, rejection_reason: note || null }
  }

  const chain = await getChain()
  const step = chain.find(s => s.status === currentApprovalStatus)
  const toStatus = await nextApprovalStatus(currentApprovalStatus)
  const update = { approval_status: toStatus, rejection_reason: null }
  if (toStatus === 'approved') update.status = 'Approved'
  const [byCol, atCol] = approvalColumns(step?.key)
  if (byCol) { update[byCol] = profileId; update[atCol] = new Date().toISOString() }
  return update
}

/** Visual step state for chain display: 'done' | 'active' | 'pending' */
export function stepStateFor(chain, step, currentStatus) {
  if (currentStatus === 'approved') return 'done'
  const order = chain.map(s => s.status)
  const cur = order.indexOf(currentStatus)
  const stepIdx = order.indexOf(step.status)
  if (cur === -1) return 'pending'
  if (stepIdx < cur) return 'done'
  if (stepIdx === cur) return 'active'
  return 'pending'
}

/** Friendly label for the approval_status column */
export function statusLabel(status) {
  const MAP = {
    sales_lead_review: 'Pending Sales Lead Review',
    finance_review: 'Pending Finance',
    cto_review: 'Pending CTO / Leadership',
    approved: 'Approved',
  }
  return MAP[status] || status || '—'
}

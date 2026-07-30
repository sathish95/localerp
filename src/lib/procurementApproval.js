/**
 * PROCUREMENT — Condition-Branched Approval Engine
 *
 * Branches by (request_type, estimated_total) instead of submitter role:
 *   FULL chain (Production/Post-Production AND estimated_total >= COST_THRESHOLD):
 *     Procurement Lead → PM → CTO → Finance → CEO
 *   SHORT chain (On-Demand, OR anything below threshold):
 *     Procurement Lead → PM
 *
 * The chain's STEPS (which role handles each stage) are now DB-configurable
 * (see sql/STEP48_approval_chains.sql, workflow 'procurement', selector_type
 * 'chain_type') — admins can reassign roles or edit steps from Settings →
 * Approval Chain. Falls back to the hardcoded chains below if no matching
 * DB chain exists yet. COST_THRESHOLD stays a hardcoded numeric gate — it's
 * a threshold decision, not a role assignment, and out of this project's scope.
 *
 * Status progression stays FIXED: draft → procurement_lead_review → pm_review →
 *   [cto_review → finance_review → ceo_review only on the full chain] → approved
 * Rejection at any stage → status back to 'draft', rejection_reason stamped.
 *
 * This is a SEPARATE engine from approvalFlow.js (which is role-indexed, used by
 * expenses/travel) — do not modify approvalFlow.js for this.
 */
import { supabase } from './supabase'

// TODO(phase2): move to an editable settings value; hardcoded for now.
export const COST_THRESHOLD = 100000

const FULL_CHAIN = [
  { key: 'procurement_lead', label: 'Procurement Lead', short: 'PL', status: 'procurement_lead_review' },
  { key: 'pm', label: 'PM', short: 'PM', status: 'pm_review' },
  { key: 'cto', label: 'CTO', short: 'CTO', status: 'cto_review' },
  { key: 'finance', label: 'Finance', short: 'Fin', status: 'finance_review' },
  { key: 'ceo', label: 'CEO', short: 'CEO', status: 'ceo_review' },
]

const SHORT_CHAIN = [
  { key: 'procurement_lead', label: 'Procurement Lead', short: 'PL', status: 'procurement_lead_review' },
  { key: 'pm', label: 'PM', short: 'PM', status: 'pm_review' },
]

const DEFAULT_CHAINS = { full: FULL_CHAIN, short: SHORT_CHAIN }
const cache = {}

/** Decide chain type from request_type + amount */
export function resolveChainType(requestType, estimatedTotal) {
  const amt = Number(estimatedTotal) || 0
  const isFullEligibleType = requestType === 'production' || requestType === 'post_production'
  return (isFullEligibleType && amt >= COST_THRESHOLD) ? 'full' : 'short'
}

/** DB-backed chain lookup, falls back to the hardcoded default. */
export async function getChain(chainType) {
  const type = chainType === 'full' ? 'full' : 'short'
  if (cache[type]) return cache[type]

  try {
    const { data: chainRow, error: chainErr } = await supabase.from('approval_chains')
      .select('id').eq('workflow', 'procurement').eq('selector_type', 'chain_type').eq('selector_value', type).eq('is_active', true).maybeSingle()
    if (chainErr || !chainRow) return DEFAULT_CHAINS[type]

    const { data: steps, error: stepsErr } = await supabase.from('approval_chain_steps')
      .select('*').eq('chain_id', chainRow.id).order('step_order')
    if (stepsErr || !steps?.length) return DEFAULT_CHAINS[type]

    const chain = steps.map(s => ({ key: s.approver_role, label: s.label, short: s.label.slice(0, 3), status: s.status_value }))
    cache[type] = chain
    return chain
  } catch (err) {
    console.error('[procurementApproval:getChain]', err)
    return DEFAULT_CHAINS[type]
  }
}

// Synchronous, cache-only lookup for render-time use (e.g. a chain-step
// visualization component) — returns the hardcoded default until the async
// getChain() above has warmed the cache once (normally already true by the
// time a detail view renders, since the page's own load() calls getChain()
// first), so it never blocks a render on a network round trip.
export function getChainSync(chainType) {
  const type = chainType === 'full' ? 'full' : 'short'
  return cache[type] || DEFAULT_CHAINS[type]
}

/** Warm the cache for both chain types — call once on page load. */
export async function warmChains() {
  await Promise.all([getChain('full'), getChain('short')])
}

/** First status a freshly-submitted draft moves into */
export async function firstReviewStatus(chainType) {
  const chain = await getChain(chainType)
  return chain[0].status
}

/** What status comes next after this step (approve action)? */
export async function nextApprovalStatus(currentStatus, chainType) {
  const chain = await getChain(chainType)
  const idx = chain.findIndex(s => s.status === currentStatus)
  if (idx === -1) throw new Error(`Status "${currentStatus}" isn't part of the current approval chain — it may have been edited while this request was in flight. Contact an admin.`)
  if (idx === chain.length - 1) return 'approved'
  return chain[idx + 1].status
}

function resolveCanActOn(chain, role, currentStatus) {
  if (role === 'admin') return true
  const step = chain.find(s => s.status === currentStatus)
  if (!step) return false
  if (step.key === 'ceo') return role === 'ceo'
  return role === step.key
}

/** Can this role act on this PR right now? (admin bypasses, ceo maps to the 'ceo' step) */
export async function canActOn(role, currentStatus, chainType) {
  const chain = await getChain(chainType)
  return resolveCanActOn(chain, role, currentStatus)
}

/** Sync, cache-only version of canActOn for render-time use (see getChainSync). */
export function canActOnSync(role, currentStatus, chainType) {
  const chain = getChainSync(chainType)
  return resolveCanActOn(chain, role, currentStatus)
}

/** Column pair to stamp for a given step key */
function approvalColumns(stepKey) {
  const MAP = {
    procurement_lead: ['procurement_lead_approved_by', 'procurement_lead_approved_at'],
    pm: ['pm_approved_by', 'pm_approved_at'],
    cto: ['cto_approved_by', 'cto_approved_at'],
    finance: ['finance_approved_by', 'finance_approved_at'],
    ceo: ['ceo_approved_by', 'ceo_approved_at'],
  }
  return MAP[stepKey] || [null, null]
}

/**
 * Build the update payload for an approval action.
 * action: 'approve' | 'reject' | 'cancel'
 * Finance-overrun validation must be done by the CALLER before invoking this
 * with action='approve' at the finance_review step (see validateFinanceStep).
 */
export async function buildApprovalUpdate(action, currentStatus, chainType, profileId, note) {
  if (action === 'reject') return { status: 'draft', rejection_reason: note || null }
  if (action === 'cancel') return { status: 'cancelled' }

  const chain = await getChain(chainType)
  const step = chain.find(s => s.status === currentStatus)
  const toStatus = await nextApprovalStatus(currentStatus, chainType)
  const update = { status: toStatus, rejection_reason: null }
  const [byCol, atCol] = approvalColumns(step?.key)
  if (byCol) { update[byCol] = profileId; update[atCol] = new Date().toISOString() }
  return update
}

/**
 * Finance-step budget validation. Call before approving at 'finance_review'.
 * Returns { ok, available, shortfall }.
 */
export function validateFinanceStep({ allocated, committedAmount, estimatedTotal, overrideFlag }) {
  const available = (Number(allocated) || 0) - (Number(committedAmount) || 0)
  const shortfall = (Number(estimatedTotal) || 0) - available
  if (shortfall <= 0) return { ok: true, available, shortfall: 0 }
  return { ok: !!overrideFlag, available, shortfall }
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

/** Friendly label for current status */
export function statusLabel(status) {
  const MAP = {
    draft: 'Draft',
    procurement_lead_review: 'Pending Procurement Lead',
    pm_review: 'Pending PM',
    cto_review: 'Pending CTO',
    finance_review: 'Pending Finance',
    ceo_review: 'Pending CEO',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  }
  return MAP[status] || status
}

/**
 * ROI PROPOSAL — approval chain (PM -> CTO -> Finance -> CEO).
 *
 * Same two-status-column pattern as src/lib/proposalApproval.js: roi_proposal.status
 * is the coarse vocabulary ('draft'/'pending_approval'/'approved'/'rejected') the
 * rest of the module reasons about; roi_proposal.approval_status is the chain
 * position ('pm_review'/'cto_review'/'finance_review'/'ceo_review'/'approved')
 * this engine walks. The chain itself is DB-configurable (sql/STEP212, workflow
 * 'roi_proposal', selector_type 'always') — admins can reassign roles/edit steps
 * from Settings -> Approval Chain, same as every other workflow.
 *
 * Per the brief's cross-cutting requirement: any capture-rate override or
 * cost-driver edit made after a proposal has left 'draft' re-triggers approval —
 * enforced in roiProposals.js by resetting status back to 'draft' on such edits,
 * not here.
 */
import { supabase } from './supabase'

const DEFAULT_CHAIN = [
  { key: 'pm', label: 'PM', short: 'PM', status: 'pm_review' },
  { key: 'cto', label: 'CTO', short: 'CTO', status: 'cto_review' },
  { key: 'finance', label: 'Finance', short: 'Fin', status: 'finance_review' },
  { key: 'ceo', label: 'CEO', short: 'CEO', status: 'ceo_review' },
]

let cachedChain = null

export async function getChain() {
  if (cachedChain) return cachedChain
  try {
    const { data: chainRow, error: chainErr } = await supabase.from('approval_chains')
      .select('id').eq('workflow', 'roi_proposal').eq('selector_type', 'always').eq('is_active', true).maybeSingle()
    if (chainErr || !chainRow) return DEFAULT_CHAIN

    const { data: steps, error: stepsErr } = await supabase.from('approval_chain_steps')
      .select('*').eq('chain_id', chainRow.id).order('step_order')
    if (stepsErr || !steps?.length) return DEFAULT_CHAIN

    cachedChain = steps.map(s => ({ key: s.approver_role, label: s.label, short: s.label.slice(0, 3), status: s.status_value }))
    return cachedChain
  } catch (err) {
    console.error('[roiApproval:getChain]', err)
    return DEFAULT_CHAIN
  }
}

export function getChainSync() {
  return cachedChain || DEFAULT_CHAIN
}

export async function warmChains() {
  await getChain()
}

export async function firstReviewStatus() {
  const chain = await getChain()
  return chain[0].status
}

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

export async function canActOn(role, currentStatus) {
  const chain = await getChain()
  return resolveCanActOn(chain, role, currentStatus)
}

export function canActOnSync(role, currentStatus) {
  return resolveCanActOn(getChainSync(), role, currentStatus)
}

function approvalColumns(stepKey) {
  const MAP = {
    pm: ['pm_approved_by', 'pm_approved_at'],
    cto: ['cto_approved_by', 'cto_approved_at'],
    finance: ['finance_approved_by', 'finance_approved_at'],
    ceo: ['ceo_approved_by', 'ceo_approved_at'],
  }
  return MAP[stepKey] || [null, null]
}

/**
 * action: 'approve' | 'reject'
 * Rejection resets the proposal to 'draft' (author edits and resubmits).
 */
export async function buildApprovalUpdate(action, currentApprovalStatus, profileId, note) {
  if (action === 'reject') {
    return { status: 'rejected', approval_status: null, rejection_reason: note || null }
  }

  const chain = await getChain()
  const step = chain.find(s => s.status === currentApprovalStatus)
  const toStatus = await nextApprovalStatus(currentApprovalStatus)
  const update = { approval_status: toStatus, rejection_reason: null }
  if (toStatus === 'approved') { update.status = 'approved'; update.approved_at = new Date().toISOString() }
  const [byCol, atCol] = approvalColumns(step?.key)
  if (byCol) { update[byCol] = profileId; update[atCol] = new Date().toISOString() }
  return update
}

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

export function statusLabel(status) {
  const MAP = {
    pm_review: 'Pending PM Review',
    cto_review: 'Pending CTO Review',
    finance_review: 'Pending Finance',
    ceo_review: 'Pending CEO',
    approved: 'Approved',
  }
  return MAP[status] || status || '—'
}

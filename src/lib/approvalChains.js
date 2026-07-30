import { supabase } from './supabase'

// Admin CRUD for the approval_chains / approval_chain_steps tables (see
// sql/STEP48_approval_chains.sql) — backs Settings → Approval Chain.
//
// Each workflow's runtime engine (approvalFlow.js, procurementApproval.js,
// warrantyApproval.js, timesheetApproval.js) hardcodes what a given
// status_value MEANS (which column it stamps, what triggers on it) and, for
// timesheet, even which POSITION it must sit at. So this admin UI treats
// status_value as chosen from a fixed per-workflow vocabulary (not free
// text) and leaves approver_role — the actually-configurable part — fully
// editable. selector_value is similarly constrained to the values each
// engine actually looks up; anything else would be seeded but never read.
export const WORKFLOWS = [
  {
    key: 'expense', label: 'Expense', selectorType: 'submitter_role',
    selectorLabel: 'Submitter role',
    selectorOptions: ['employee', 'manager', 'finance', 'hr', 'department_head'],
    statusValues: ['manager_review', 'ceo_review', 'finance_review'],
  },
  {
    key: 'travel', label: 'Travel', selectorType: 'submitter_role',
    selectorLabel: 'Submitter role',
    selectorOptions: ['employee', 'manager', 'finance', 'hr', 'department_head'],
    statusValues: ['manager_review', 'ceo_review', 'finance_review'],
  },
  {
    key: 'procurement', label: 'Procurement', selectorType: 'chain_type',
    selectorLabel: 'Chain type',
    selectorOptions: ['short', 'full'],
    statusValues: ['procurement_lead_review', 'pm_review', 'cto_review', 'finance_review', 'ceo_review'],
  },
  {
    key: 'warranty', label: 'Warranty', selectorType: 'always',
    selectorLabel: null, selectorOptions: [null],
    statusValues: ['PM Review', 'CEO Review', 'Finance Review'],
  },
  {
    key: 'timesheet', label: 'Timesheet', selectorType: 'always',
    selectorLabel: null, selectorOptions: [null],
    statusValues: ['pending_manager', 'pending_hr', 'pending_finance'],
    note: 'Step position is wired to fixed database columns (manager/HR/finance) — reordering steps changes which column gets stamped, not just labels. Reassign roles freely; leave the order as-is.',
  },
  {
    key: 'leave', label: 'Leave', selectorType: 'always',
    selectorLabel: null, selectorOptions: [null],
    statusValues: ['pending'],
    note: 'Leave approval is a simple role-gate in code, not chain-driven — this entry is for visibility/consistency only and has no effect on live behavior.',
  },
]

export function workflowConfig(workflow) {
  return WORKFLOWS.find(w => w.key === workflow)
}

/** All chains with their steps attached (steps: [], ordered by step_order). */
export async function listChainsWithSteps() {
  const [{ data: chains, error: chainErr }, { data: steps, error: stepErr }] = await Promise.all([
    supabase.from('approval_chains').select('*').order('workflow').order('label'),
    supabase.from('approval_chain_steps').select('*').order('step_order'),
  ])
  if (chainErr) throw chainErr
  if (stepErr) throw stepErr
  const stepsByChain = {}
  ;(steps || []).forEach(s => { (stepsByChain[s.chain_id] ||= []).push(s) })
  return (chains || []).map(c => ({ ...c, steps: stepsByChain[c.id] || [] }))
}

/**
 * Create a new chain + its steps. If `activate` is true, any other active
 * chain matching the same (workflow, selector_type, selector_value) is
 * deactivated first — PostgREST's .maybeSingle() lookup in each engine
 * errors if more than one active row matches the same selector.
 */
export async function createChain({ workflow, key, label, selectorType, selectorValue, steps }, userId, activate = true) {
  if (!key?.trim()) throw new Error('Key is required')
  if (!label?.trim()) throw new Error('Label is required')
  if (!steps?.length) throw new Error('At least one step is required')

  if (activate) await deactivateSiblings(workflow, selectorType, selectorValue, null)

  const { data: chain, error } = await supabase.from('approval_chains').insert({
    workflow, key: key.trim(), label: label.trim(),
    selector_type: selectorType, selector_value: selectorValue || null,
    is_active: activate, is_custom: true, created_by: userId,
  }).select().single()
  if (error) throw error

  const rows = steps.map((s, i) => ({
    chain_id: chain.id, step_order: i + 1, status_value: s.status_value, approver_role: s.approver_role, label: s.label,
  }))
  const { error: stepErr } = await supabase.from('approval_chain_steps').insert(rows)
  if (stepErr) throw stepErr
  return chain
}

/** Replace a chain's steps entirely (used after editing roles/labels/order). */
export async function saveChainSteps(chainId, steps) {
  if (!steps?.length) throw new Error('At least one step is required')
  const { error: delErr } = await supabase.from('approval_chain_steps').delete().eq('chain_id', chainId)
  if (delErr) throw delErr
  const rows = steps.map((s, i) => ({
    chain_id: chainId, step_order: i + 1, status_value: s.status_value, approver_role: s.approver_role, label: s.label,
  }))
  const { error: insErr } = await supabase.from('approval_chain_steps').insert(rows)
  if (insErr) throw insErr
  await supabase.from('approval_chains').update({ updated_at: new Date().toISOString() }).eq('id', chainId)
}

export async function updateChainLabel(chainId, label) {
  const { error } = await supabase.from('approval_chains').update({ label, updated_at: new Date().toISOString() }).eq('id', chainId)
  if (error) throw error
}

/** Activate/deactivate a chain. Activating deactivates conflicting siblings first. */
export async function setChainActive(chain, isActive) {
  if (isActive) await deactivateSiblings(chain.workflow, chain.selector_type, chain.selector_value, chain.id)
  const { error } = await supabase.from('approval_chains').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', chain.id)
  if (error) throw error
}

async function deactivateSiblings(workflow, selectorType, selectorValue, exceptChainId) {
  let q = supabase.from('approval_chains').update({ is_active: false })
    .eq('workflow', workflow).eq('selector_type', selectorType).eq('is_active', true)
  q = selectorValue == null ? q.is('selector_value', null) : q.eq('selector_value', selectorValue)
  if (exceptChainId) q = q.neq('id', exceptChainId)
  const { error } = await q
  if (error) throw error
}

/** Only custom (admin-created) chains can be hard-deleted — seeded defaults should be deactivated instead. */
export async function deleteChain(chain) {
  if (!chain.is_custom) throw new Error('Built-in chains can only be deactivated, not deleted')
  await supabase.from('approval_chain_steps').delete().eq('chain_id', chain.id)
  const { error } = await supabase.from('approval_chains').delete().eq('id', chain.id)
  if (error) throw error
}

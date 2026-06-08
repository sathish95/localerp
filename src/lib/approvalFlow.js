/**
 * PROCUREPRO — Centralised Approval Flow Engine
 *
 * Rules (role of the SUBMITTER determines the chain):
 *   employee  → Manager → CEO → Finance
 *   manager   → CEO → Finance
 *   finance   → Manager → CEO
 *   hr        → Manager → CEO → Finance
 *   (admin/ceo bypass — auto-approved or skipped)
 *
 * Status progression in the DB (approval_status enum):
 *   submitted → manager_review → ceo_review → finance_review → approved
 *
 * Each role can act only on the status that is waiting for them.
 */

// Chain definition: array of { label, short, status (the DB status that represents "this person's turn") }
const CHAINS = {
  employee:  [
    { label: 'Employee',  short: 'Emp', status: 'submitted' },
    { label: 'Manager',   short: 'Mgr', status: 'manager_review' },
    { label: 'CEO',       short: 'CEO', status: 'ceo_review' },
    { label: 'Finance',   short: 'Fin', status: 'finance_review' },
  ],
  manager:   [
    { label: 'Manager',   short: 'Mgr', status: 'submitted' },
    { label: 'CEO',       short: 'CEO', status: 'ceo_review' },
    { label: 'Finance',   short: 'Fin', status: 'finance_review' },
  ],
  finance:   [
    { label: 'Finance',   short: 'Fin', status: 'submitted' },
    { label: 'Manager',   short: 'Mgr', status: 'manager_review' },
    { label: 'CEO',       short: 'CEO', status: 'ceo_review' },
  ],
  hr:        [
    { label: 'HR',        short: 'HR',  status: 'submitted' },
    { label: 'Manager',   short: 'Mgr', status: 'manager_review' },
    { label: 'CEO',       short: 'CEO', status: 'ceo_review' },
    { label: 'Finance',   short: 'Fin', status: 'finance_review' },
  ],
  department_head: [
    { label: 'Dept Head', short: 'DH',  status: 'submitted' },
    { label: 'CEO',       short: 'CEO', status: 'ceo_review' },
    { label: 'Finance',   short: 'Fin', status: 'finance_review' },
  ],
  // admin/ceo: no chain — they can approve anything
}

/** Get the chain steps for a given submitter role */
export function getChain(submitterRole) {
  return CHAINS[submitterRole] || CHAINS.employee
}

/**
 * What DB status comes NEXT after this approver acts (approve action)?
 * currentStatus = what the record currently has
 * approverRole  = who is approving
 */
export function nextApprovalStatus(currentStatus, approverRole, submitterRole) {
  const chain = getChain(submitterRole)
  const idx = chain.findIndex(s => s.status === currentStatus)
  if (idx === -1 || idx === chain.length - 1) return 'approved'
  return chain[idx + 1].status
}

/**
 * Can this role act on this item right now?
 * Returns true/false
 */
export function canActOn(approverRole, currentStatus, submitterRole) {
  if (approverRole === 'admin') return ['submitted','manager_review','ceo_review','finance_review'].includes(currentStatus)
  const chain = getChain(submitterRole)
  const step  = chain.find(s => s.status === currentStatus)
  if (!step) return false
  // Who acts at this step?
  const actorLabel = step.label.toLowerCase()
  if (actorLabel === 'manager' || actorLabel === 'dept head') return ['manager','department_head'].includes(approverRole)
  if (actorLabel === 'ceo')     return approverRole === 'ceo'
  if (actorLabel === 'finance') return approverRole === 'finance'
  if (actorLabel === 'hr')      return approverRole === 'hr'
  return false
}

/** DB columns to stamp when a role approves */
export function approvedByColumn(currentStatus) {
  if (currentStatus === 'submitted')      return { manager_approved_by: true, manager_approved_at: true }
  if (currentStatus === 'manager_review') return { manager_approved_by: true, manager_approved_at: true }
  if (currentStatus === 'ceo_review')     return { ceo_approved_by: true, ceo_approved_at: true }
  if (currentStatus === 'finance_review') return { finance_approved_by: true, finance_approved_at: true }
  return {}
}

/**
 * Build the update payload for an approval action
 * action: 'approve' | 'reject' | 'cancel'
 */
export function buildApprovalUpdate(action, currentStatus, approverRole, submitterRole, profileId, note) {
  if (action === 'reject')  return { status: 'rejected',  rejection_reason: note || null }
  if (action === 'cancel')  return { status: 'closed' }

  // approve
  const toStatus = nextApprovalStatus(currentStatus, approverRole, submitterRole)
  const update   = { status: toStatus }
  const now      = new Date().toISOString()

  if (['submitted','manager_review'].includes(currentStatus)) {
    update.manager_approved_by  = profileId
    update.manager_approved_at  = now
  } else if (currentStatus === 'ceo_review') {
    update.ceo_approved_by  = profileId
    update.ceo_approved_at  = now
  } else if (currentStatus === 'finance_review') {
    update.finance_approved_by  = profileId
    update.finance_approved_at  = now
  }

  return update
}

/** Visual step state for the chain display */
export function stepState(chainStep, currentStatus, isRejected) {
  const ORDER = ['submitted','manager_review','ceo_review','finance_review','approved']
  if (isRejected) {
    const cur = ORDER.indexOf(currentStatus)
    const stepCur = ORDER.indexOf(chainStep.status)
    if (stepCur < cur) return 'done'
    if (stepCur === cur) return 'rejected'
    return 'pending'
  }
  if (currentStatus === 'approved') return 'done'
  const cur     = ORDER.indexOf(currentStatus)
  const stepCur = ORDER.indexOf(chainStep.status)
  if (stepCur < cur)  return 'done'
  if (stepCur === cur) return 'active'
  return 'pending'
}

/** Friendly label for current status */
export function statusLabel(status) {
  const MAP = {
    submitted:      'Pending Manager',
    manager_review: 'Pending CEO',
    ceo_review:     'Pending Finance',
    finance_review: 'In Finance Review',
    approved:       'Approved',
    rejected:       'Rejected',
    closed:         'Closed',
    draft:          'Draft',
  }
  return MAP[status] || status
}

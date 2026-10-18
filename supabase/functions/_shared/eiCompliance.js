// Project Document Compliance Register (STEP272) — pure evaluation, shared by
// the web app and tests (src/lib/eiCompliance.test.mjs).
//
// A register item says "this project needs document type X (at stage S)".
// Its state comes from the documents filed on the project (Email Intelligence
// document register) plus what a person recorded on the item:
//   MISSING            nothing of that type filed yet
//   RECEIVED           filed (current version); no approval needed
//   AWAITING_APPROVAL  filed, but the item needs an approval nobody recorded yet
//   APPROVED           approval recorded by a person (never inferred from an email)
//   WAIVED / NOT_APPLICABLE   decided by a person, with a note
// Expiry (guarantees, policies, permits): from the item, else the document's
// extracted expiry date → VALID / EXPIRING / EXPIRED / UNKNOWN.

export const STATE_LABEL = {
  MISSING: 'Missing', RECEIVED: 'Received', AWAITING_APPROVAL: 'Awaiting approval', APPROVED: 'Approved',
  WAIVED: 'Waived', NOT_APPLICABLE: 'Not applicable',
}
export const EXPIRY_LABEL = { VALID: 'Valid', EXPIRING: 'Expiring soon', EXPIRED: 'Expired', UNKNOWN: 'Expiry not known' }
const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86400000

export function expiryOf(doc) {
  const x = doc?.extraction || {}
  for (const k of ['expiry_date', 'valid_until', 'validity_date', 'valid_till', 'expiry']) {
    const v = x[k]?.value ?? x[k]
    if (v && ISO.test(String(v))) return String(v)
  }
  return null
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

/**
 * @param items      register items { id, stage_id, document_type_code, label, required, needs_approval, is_statutory, tracks_expiry, status, expiry_date, due_date }
 * @param stages     register stages { id, seq, name }
 * @param documents  project documents (ei_project_documents rows)
 */
export function evaluateRegister({ items = [], stages = [], documents = [], today, expiringDays = 30 }) {
  const byType = {}
  for (const d of documents) {
    if (d.is_current === false || !d.doc_type_code) continue
    ;(byType[d.doc_type_code] ||= []).push(d)
  }
  for (const k of Object.keys(byType)) byType[k].sort((a, b) => String(b.received_at || b.created_at || '').localeCompare(String(a.received_at || a.created_at || '')))

  const out = items.map(it => {
    const docs = byType[it.document_type_code] || []
    const latest = docs[0] || null
    let state
    if (it.status === 'WAIVED' || it.status === 'NOT_APPLICABLE') state = it.status
    else if (it.status === 'APPROVED') state = 'APPROVED'
    else if (latest) state = it.needs_approval ? 'AWAITING_APPROVAL' : 'RECEIVED'
    else state = 'MISSING'
    const expiry = it.expiry_date || (latest ? expiryOf(latest) : null)
    let expiryState = null
    if (it.tracks_expiry && !['WAIVED', 'NOT_APPLICABLE'].includes(state) && (latest || it.expiry_date)) {
      if (!expiry) expiryState = 'UNKNOWN'
      else { const left = daysBetween(today, expiry); expiryState = left < 0 ? 'EXPIRED' : left <= expiringDays ? 'EXPIRING' : 'VALID' }
    }
    const done = ['APPROVED', 'WAIVED', 'NOT_APPLICABLE', 'RECEIVED'].includes(state) && expiryState !== 'EXPIRED'
    const overdue = !done && !!it.due_date && it.due_date < today
    return { ...it, docs, latest, state, expiry, expiryState, daysToExpiry: expiry ? daysBetween(today, expiry) : null, done, overdue }
  })

  const stageRows = [...stages].sort((a, b) => a.seq - b.seq).map(s => {
    const its = out.filter(i => i.stage_id === s.id)
    const req = its.filter(i => i.required && i.state !== 'NOT_APPLICABLE')
    const ok = req.filter(i => i.done).length
    return { ...s, items: its, required: req.length, done: ok, missing: req.filter(i => i.state === 'MISSING').length, pct: req.length ? Math.round((ok / req.length) * 100) : null }
  })
  const unstaged = out.filter(i => !stages.some(s => s.id === i.stage_id))
  if (unstaged.length) stageRows.push({ id: null, seq: 999, name: 'Other requirements', items: unstaged, required: unstaged.filter(i => i.required).length, done: unstaged.filter(i => i.required && i.done).length, missing: unstaged.filter(i => i.required && i.state === 'MISSING').length, pct: null })

  const req = out.filter(i => i.required && i.state !== 'NOT_APPLICABLE')
  const totals = {
    items: out.length, required: req.length, satisfied: req.filter(i => i.done).length,
    missing: req.filter(i => i.state === 'MISSING').length,
    awaitingApproval: out.filter(i => i.state === 'AWAITING_APPROVAL').length,
    statutoryMissing: out.filter(i => i.is_statutory && i.required && i.state === 'MISSING').length,
    expired: out.filter(i => i.expiryState === 'EXPIRED').length,
    expiring: out.filter(i => i.expiryState === 'EXPIRING').length,
    overdue: out.filter(i => i.overdue).length,
  }
  totals.pct = totals.required ? Math.round((totals.satisfied / totals.required) * 100) : null
  // current stage = first stage with required work left
  const current = stageRows.find(s => s.id && s.required > s.done) || null

  const alerts = []
  for (const i of out) {
    const name = i.label || i.document_type_code
    if (i.expiryState === 'EXPIRED') alerts.push({ sev: 3, item_id: i.id, text: `${name} expired on ${i.expiry}` })
    else if (i.expiryState === 'EXPIRING') alerts.push({ sev: 2, item_id: i.id, text: `${name} expires in ${i.daysToExpiry} day${i.daysToExpiry === 1 ? '' : 's'} (${i.expiry})` })
    if (i.is_statutory && i.required && i.state === 'MISSING') alerts.push({ sev: 3, item_id: i.id, text: `Statutory: ${name} not received` })
    if (i.overdue) alerts.push({ sev: 2, item_id: i.id, text: `${name} was due ${i.due_date}` })
    if (i.state === 'AWAITING_APPROVAL') alerts.push({ sev: 1, item_id: i.id, text: `${name} received — approval not recorded` })
    if (i.expiryState === 'UNKNOWN') alerts.push({ sev: 1, item_id: i.id, text: `${name}: expiry date not found — enter it` })
  }
  alerts.sort((a, b) => b.sev - a.sev)
  return { items: out, stages: stageRows, totals, current, alerts }
}

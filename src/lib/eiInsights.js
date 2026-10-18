// NeoX Email Intelligence — AI Overview insights and per-item guidance.
// Pure functions over real processing data (emails, attachments, exceptions,
// configuration); nothing here is invented or hard-coded as a metric.
// Run: node --test src/lib/eiInsights.test.mjs

const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d
const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const nice = code => String(code || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/**
 * @param emails      outlook_email_messages rows (status, category, intents, confidence, sender_email, sender_name, classifier, created_at)
 * @param attachments ei_attachments rows (doc_type_code, doc_confidence, extraction_confidence, vendor_confidence, vendor_id, po_id, grn_ids, outcome, text_method)
 * @param exceptions  OPEN ei_exceptions rows (kind, priority, summary, message_id, detail, created_at)
 * @param context     { aiConfigured, mailboxLive, categoryNames: {code: name}, now }
 */
export function buildInsights({ emails = [], attachments = [], exceptions = [], context = {} }) {
  const now = context.now ?? Date.now()
  const names = context.categoryNames || {}
  const label = c => names[c] || nice(c)
  const handled = emails.filter(e => ['PROCESSED', 'TASK_CREATED', 'IGNORED'].includes(e.status))
  const needsPeople = new Set(exceptions.map(x => x.message_id).filter(Boolean))
  const automatic = handled.filter(e => !needsPeople.has(e.id) && e.status !== 'REVIEW')
  const done = emails.filter(e => !['PENDING', 'PROCESSING'].includes(e.status))

  // stage confidence (only where the stage ran)
  const stage = (key, rows) => ({ key, value: avg(rows), n: rows.length })
  const stages = [
    stage('Email intent', emails.map(e => Number(e.confidence)).filter(Number.isFinite)),
    stage('Document type', attachments.map(a => Number(a.doc_confidence)).filter(Number.isFinite)),
    stage('Field extraction', attachments.map(a => Number(a.extraction_confidence)).filter(Number.isFinite)),
    stage('Vendor match', attachments.map(a => Number(a.vendor_confidence)).filter(v => Number.isFinite(v) && v > 0)),   // matches made; unknown vendors show under Attention
  ]

  const tally = (items, keyFn) => {
    const m = new Map()
    for (const it of items) { const k = keyFn(it); if (k) m.set(k, (m.get(k) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))
  }
  const intentMix = tally(emails, e => e.category || e.intents?.primary).map(x => ({ ...x, label: label(x.key) }))
  const exceptionMix = tally(exceptions, x => (x.kind.startsWith('CATEGORY_REVIEW:') ? 'CATEGORY_REVIEW' : x.kind))
  const docMix = tally(attachments, a => a.doc_type_code).map(x => ({ ...x, label: nice(x.key) }))
  const invoiceDocs = attachments.filter(a => ['TAX_INVOICE', 'REVISED_INVOICE'].includes(a.doc_type_code))
  const invoicesCreated = attachments.filter(a => a.outcome === 'INVOICE_CREATED').length
  const touchless = invoiceDocs.length ? invoicesCreated / invoiceDocs.length : null
  const oldest = exceptions.reduce((m, x) => Math.max(m, now - new Date(x.created_at).getTime()), 0)

  // ── recommendations: each tied to data + a place to act ──
  const recs = []
  const add = (severity, title, detail, action) => recs.push({ severity, title, detail, action })
  const byKind = k => exceptions.filter(x => x.kind === k)
  const bank = [...byKind('BANK_DETAIL_CHANGE'), ...byKind('VENDOR_MASTER_CHANGE')]
  if (bank.length) add('critical', `${bank.length} vendor bank / master change request${bank.length > 1 ? 's' : ''} to verify`, 'Never apply from email. Call the vendor on the number already in the vendor master before any change.', { tab: 'exceptions', label: 'Verify now' })
  const dup = byKind('DUPLICATE_REVIEW')
  if (dup.length) add('high', `${dup.length} possible duplicate invoice${dup.length > 1 ? 's' : ''}`, 'Compare with the invoice already in the register, then dismiss the copy. Nothing was posted twice.', { tab: 'exceptions', label: 'Review duplicates' })
  const mism = byKind('INVOICE_MISMATCH')
  if (mism.length) add('high', `${mism.length} invoice${mism.length > 1 ? 's exceed' : ' exceeds'} what was received or ordered`, 'Ask the vendor for a credit note or a revised invoice, or confirm an additional receipt with stores.', { tab: 'exceptions', label: 'Open mismatches' })
  const grn = byKind('PENDING_RECEIPT')
  if (grn.length) add('medium', `${grn.length} invoice${grn.length > 1 ? 's' : ''} waiting for a goods receipt`, 'Stores / project teams need to post the GRN (or service confirmation); the invoice can then be created.', { tab: 'exceptions', label: 'See which POs' })
  const unknown = byKind('VENDOR_VERIFICATION')
  if (unknown.length) {
    const senders = [...new Set(unknown.map(x => (x.summary.match(/[\w.+-]+@[\w.-]+/) || [])[0]).filter(Boolean))]
    add('medium', `${unknown.length} email${unknown.length > 1 ? 's' : ''} from senders not in the vendor master`, senders.length ? `Map ${senders.slice(0, 3).join(', ')}${senders.length > 3 ? '…' : ''} to an existing vendor (Configuration → Vendor mapping) or start onboarding.` : 'Map the sender to an existing vendor or start onboarding.', { tab: 'config', label: 'Vendor mapping' })
  }
  const noPo = byKind('PENDING_PO')
  if (noPo.length) add('medium', `${noPo.length} invoice${noPo.length > 1 ? 's' : ''} without a recognisable PO`, 'Ask the vendor for the PO number, or allow non-PO invoices for service vendors in Matching & AI.', { tab: 'exceptions', label: 'Open' })
  const scanned = attachments.filter(a => a.text_method === 'NONE' && ['TAX_INVOICE', 'UNKNOWN_DOCUMENT', 'REVISED_INVOICE', 'CREDIT_NOTE'].includes(a.doc_type_code))
  if (!context.aiConfigured && (scanned.length || emails.some(e => (e.classifier || '').startsWith('rules')))) {
    add('medium', 'AI is not configured — classification uses keyword rules only', `${scanned.length ? `${scanned.length} scanned document${scanned.length > 1 ? 's' : ''} could not be read. ` : ''}Add a Claude, DeepSeek or Gemini key in Settings → AI / LLM Keys so scanned PDFs and photos are read and unclear emails get a second opinion.`, { href: '/settings?tab=ai-keys', label: 'Add AI key' })
  }
  const lowExtraction = attachments.filter(a => a.extraction_confidence != null && a.extraction_confidence < 0.75)
  if (lowExtraction.length >= 3) add('low', `${lowExtraction.length} documents read with low confidence`, 'Check the extraction patterns of those document types or enable AI field extraction.', { tab: 'config', label: 'Document types' })
  const failed = emails.filter(e => ['FAILED', 'DEAD'].includes(e.status))
  if (failed.length) add('high', `${failed.length} email${failed.length > 1 ? 's' : ''} failed to process`, 'Usually a mailbox connection or permission problem — see the error on each email and re-run.', { tab: 'failed', label: 'Open failed' })
  if (!context.mailboxLive) add('low', 'No mailbox is processing live mail yet', 'Everything shown comes from sample emails. Connect Microsoft 365 to process real mail.', { tab: 'settings', label: 'Connect mailbox' })
  if (oldest > 2 * 86400000 && exceptions.length) add('medium', `Oldest open item is ${Math.floor(oldest / 86400000)} days old`, 'Assign owners so nothing ages in the queue.', { tab: 'exceptions', label: 'Assign' })
  const ORDER = { critical: 0, high: 1, medium: 2, low: 3 }
  recs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])

  // 14-day series (oldest → newest) and where every email ended up
  const day = t => new Date(new Date(t).toISOString().slice(0, 10)).getTime()
  const today = day(now)
  const series = Array.from({ length: 14 }, (_, i) => {
    const d = today - (13 - i) * 86400000
    const es = emails.filter(e => e.created_at && day(e.created_at) === d)
    const auto = es.filter(e => ['PROCESSED', 'TASK_CREATED', 'IGNORED'].includes(e.status) && !needsPeople.has(e.id))
    return { date: new Date(d).toISOString().slice(0, 10), emails: es.length, automatic: auto.length,
      invoices: attachments.filter(a => a.outcome === 'INVOICE_CREATED' && a.created_at && day(a.created_at) === d).length }
  })
  const outcomes = [
    ['Recorded / processed', automatic.length, '#16a34a'],
    ['Action item created', emails.filter(e => e.status === 'TASK_CREATED' && !needsPeople.has(e.id)).length, '#6366f1'],
    ['Waiting for a person', emails.filter(e => needsPeople.has(e.id) || e.status === 'REVIEW').length, '#f59e0b'],
    ['Ignored', emails.filter(e => ['IGNORED', 'DISMISSED'].includes(e.status) && !needsPeople.has(e.id)).length, '#94a3b8'],
    ['Failed', emails.filter(e => ['FAILED', 'DEAD'].includes(e.status)).length, '#dc2626'],
  ].map(([label, count, color]) => ({ label, count, color }))
  // automatic already includes TASK_CREATED / IGNORED — keep the bar additive
  outcomes[0].count = Math.max(0, outcomes[0].count - outcomes[1].count - outcomes[3].count)
  const flow = [
    { label: 'Received', count: emails.length },
    { label: 'Classified', count: emails.filter(e => e.category || e.intents?.primary).length },
    { label: 'Documents read', count: attachments.filter(a => a.text_method && a.text_method !== 'NONE').length },
    { label: 'Matched to PO', count: attachments.filter(a => a.po_id).length },
    { label: 'Invoices created', count: invoicesCreated },
  ]

  // why invoices did not go straight through (one reason per held invoice document)
  const HOLD = { PENDING_RECEIPT: 'Waiting for GRN', DUPLICATE_REVIEW: 'Duplicate', INVOICE_MISMATCH: 'Amount mismatch', VENDOR_VERIFICATION: 'Unknown vendor',
    PENDING_PO: 'No PO', DATA_VALIDATION: 'Data check failed', CLASSIFICATION_REVIEW: 'Unclear document', REVISED_INVOICE: 'Revision', DOCUMENT_REVIEW: 'Always reviewed' }
  const PRECEDENCE = ['DUPLICATE_REVIEW', 'VENDOR_VERIFICATION', 'INVOICE_MISMATCH', 'PENDING_PO', 'PENDING_RECEIPT', 'DATA_VALIDATION', 'REVISED_INVOICE', 'CLASSIFICATION_REVIEW', 'DOCUMENT_REVIEW']
  const byAtt = new Map()
  for (const x of exceptions) if (x.attachment_id) (byAtt.get(x.attachment_id) || byAtt.set(x.attachment_id, []).get(x.attachment_id)).push(x.kind)
  const holds = tally(invoiceDocs.filter(a => a.outcome !== 'INVOICE_CREATED'), a => {
    const ks = byAtt.get(a.id) || []
    const k = PRECEDENCE.find(p => ks.includes(p))
    return k ? HOLD[k] : 'Other'
  }).map(h => ({ label: h.key, count: h.count }))

  // headline: the single most important thing right now
  const sevCount = s => exceptions.filter(x => x.priority === s).length
  const groupOf = k => (['BANK_DETAIL_CHANGE', 'VENDOR_MASTER_CHANGE', 'VENDOR_VERIFICATION'].includes(k) ? 'vendor & bank checks'
    : k.startsWith('CATEGORY_REVIEW:') ? 'category reviews' : 'invoice checks')
  const urgent = exceptions.filter(x => ['critical', 'high'].includes(x.priority))
  const urgentGroups = tally(urgent, x => groupOf(x.kind))
  const headline = !emails.length ? { tone: 'neutral', text: 'No email processed yet — connect a mailbox or send a sample email.' }
    : urgent.length ? { tone: 'bad', text: `${urgent.length} high-priority item${urgent.length > 1 ? 's' : ''} need${urgent.length > 1 ? '' : 's'} a decision — mostly ${urgentGroups[0].key}${sevCount('critical') ? ` (${sevCount('critical')} critical)` : ''}.` }
    : exceptions.length ? { tone: 'warn', text: `Flowing, with ${exceptions.length} routine item${exceptions.length > 1 ? 's' : ''} to review.` }
    : { tone: 'good', text: 'Everything flowed through automatically — nothing needs a person.' }
  const quickWin = recs.find(r => r.action?.tab === 'config' || r.action?.href) || null

  return {
    series, outcomes, flow, holds, headline, blocker: recs[0] || null, quickWin: quickWin && quickWin !== recs[0] ? quickWin : null,
    totals: {
      emails: emails.length, processed: done.length, automatic: automatic.length,
      automationRate: handled.length ? automatic.length / handled.length : null,
      openExceptions: exceptions.length, invoiceDocs: invoiceDocs.length, invoicesCreated, touchless,
      oldestOpenHours: exceptions.length ? round(oldest / 3600000) : null,
    },
    stages, intentMix, exceptionMix, docMix, recommendations: recs,
  }
}

/** Next best action for one exception, from its kind and evidence. */
export function suggestAction(x) {
  const d = x.detail || {}
  const po = (x.summary.match(/PO\s+([A-Z0-9/-]+)/) || [])[1]
  switch (x.kind) {
    case 'BANK_DETAIL_CHANGE': case 'VENDOR_MASTER_CHANGE':
      return 'Call the vendor on the phone number already in the vendor master (not one from this email). If they confirm, update the master through its normal approval and resolve this with the call details.'
    case 'DUPLICATE_REVIEW':
      return 'Open the existing invoice under Related and compare number, amount and date. If it is the same bill, dismiss this as a duplicate; if it is genuinely new, ask the vendor for a distinct invoice number.'
    case 'INVOICE_MISMATCH':
      return 'The amount goes beyond what was received or ordered. Ask stores whether more was delivered (post a GRN), or ask the vendor for a revised invoice / credit note for the difference.'
    case 'PENDING_RECEIPT':
      return `Ask stores / the project team to post the goods receipt${po ? ` for ${po}` : ''}. Once it exists, use “Correct & create invoice” or re-run the email.`
    case 'PENDING_PO':
      return 'Ask the vendor for the PO number, or pick the PO yourself in “Correct & create invoice”. For service vendors without POs, consider turning off “Require a known PO”.'
    case 'VENDOR_VERIFICATION':
      return d.candidates?.length > 1
        ? 'Several vendors match this sender — pick the right one in “Correct & create invoice”, then add a verified mapping so it is automatic next time.'
        : 'The sender is not in the vendor master. If it is an existing vendor writing from a new address, add a verified mapping (Configuration → Vendor mapping); otherwise start vendor onboarding. Never create the vendor from the email itself.'
    case 'CREDIT_NOTE':
      return 'Check the referenced invoice and the reason (returns, damage, rate difference) and record the credit against it in Invoices.'
    case 'REVISED_INVOICE':
      return 'Compare with the original invoice. If it replaces it, reject the original in Invoices and create this one with “Correct & create invoice”.'
    case 'DATA_VALIDATION':
      return 'Open the file and correct the fields that failed (amounts, GSTIN, dates) in “Correct & create invoice”, or ask the vendor for a corrected copy.'
    case 'CLASSIFICATION_REVIEW':
      return 'The automation was not sure what this is. Open the email and file; if a rule should have caught it, add or strengthen a keyword rule in Configuration.'
    default:
      if (x.kind.startsWith('CATEGORY_REVIEW:')) return 'Read the email and take the action your team uses for this kind of request; resolve it with a short note of what was done.'
      return 'Review the evidence and resolve with a note.'
  }
}

/** The pipeline steps for one attachment: what was decided, with what confidence. */
export function decisionTrace(a = {}, exceptionKinds = []) {
  const has = k => exceptionKinds.includes(k)
  const step = (label, state, detail, conf) => ({ label, state, detail, conf })
  const invoiceLike = ['TAX_INVOICE', 'REVISED_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PROFORMA_INVOICE'].includes(a.doc_type_code)
  const steps = [
    step('Read file', a.text_method === 'NONE' ? 'warn' : 'ok', a.text_method === 'NONE' ? 'No text layer — needs AI to read' : `Text via ${String(a.text_method || '').toLowerCase().replace('_', ' ')}`),
    step('Classify document', (a.doc_confidence ?? 0) >= 0.75 ? 'ok' : 'warn', nice(a.doc_type_code), a.doc_confidence),
  ]
  if (invoiceLike) {
    const failedChecks = (a.validations || []).filter(v => !v.ok)
    steps.push(step('Extract fields', a.extraction_confidence == null ? 'skip' : a.extraction_confidence >= 0.75 && !failedChecks.length ? 'ok' : 'warn',
      a.extraction ? `${Object.keys(a.extraction).length} fields${failedChecks.length ? ` · ${failedChecks.length} check(s) failed` : ''}` : 'Nothing extracted', a.extraction_confidence))
    steps.push(step('Identify vendor', a.vendor_id ? 'ok' : has('VENDOR_VERIFICATION') ? 'bad' : 'skip', a.vendor_id ? `by ${String(a.vendor_method || '').toLowerCase()}` : 'Not in the vendor master', a.vendor_confidence))
    steps.push(step('Match PO', a.po_id ? 'ok' : has('PENDING_PO') ? 'bad' : 'skip', a.po_id ? 'PO found and owned by the vendor' : 'No PO matched'))
    steps.push(step('Match receipt', a.grn_ids?.length ? 'ok' : has('PENDING_RECEIPT') ? 'bad' : 'skip', a.grn_ids?.length ? `${a.grn_ids.length} GRN` : 'No goods receipt'))
    steps.push(step('Duplicate check', has('DUPLICATE_REVIEW') ? 'bad' : 'ok', has('DUPLICATE_REVIEW') ? 'Already in the register' : 'No duplicate found'))
    steps.push(step('Amounts', has('INVOICE_MISMATCH') ? 'bad' : a.po_id ? 'ok' : 'skip', has('INVOICE_MISMATCH') ? 'Beyond received / PO value' : a.po_id ? 'Within tolerance' : 'Not checked'))
  }
  steps.push(step('Decision', a.outcome === 'INVOICE_CREATED' ? 'ok' : a.outcome === 'EXCEPTION' ? 'warn' : 'skip',
    { INVOICE_CREATED: 'Invoice created (status uploaded)', EXCEPTION: 'Sent to review', RECORDED: 'Recorded', SKIPPED: 'Skipped' }[a.outcome] || '—'))
  return steps
}

/* ═══ bank-detail change requests ═══ */

export const maskAccount = a => {
  const s = String(a || '').replace(/\s/g, '')
  return s.length > 4 ? `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}` : s || null
}

/** Bank details an email asks to switch to (account, IFSC, bank name) — for comparison only, never applied. */
export function parseBankRequest(text) {
  const t = String(text || '')
  const ifsc = (t.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/) || [])[1] || null
  const acct = (t.match(/\b(?:a\/?c|acc(?:ount)?)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9][0-9 ]{7,22}[0-9])\b/i) || [])[1]?.replace(/\s/g, '') || null
  const bank = (t.match(/\b(?:bank(?:\s*name)?)\s*[:\-]\s*([A-Za-z][A-Za-z .&]{2,40})/i) || [])[1]?.trim() || null
  const swift = (t.match(/\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b(?=.*swift|\s*\(swift)/i) || [])[1] || null
  return { account: acct, ifsc, bank, swift }
}

/**
 * Risk signals for a bank-detail change request. Every signal is evidence from
 * this email or the vendor master; the request is always verified by phone
 * regardless of the score.
 */
export function bankChangeRisk({ email = {}, vendor = null, requested = {}, priorRequests = 0 }) {
  const body = `${email.subject || ''}\n${email.body_excerpt || ''}`
  const dom = d => String(d || '').toLowerCase().split('@')[1] || ''
  const sig = []
  const add = (level, text) => sig.push({ level, text })
  if (!vendor) add('high', 'Sender is not a known vendor contact — the request cannot be tied to a vendor in the master')
  else if (vendor.email && dom(vendor.email) !== dom(email.sender_email)) add('high', `Sent from ${dom(email.sender_email)}, but the vendor master email is on ${dom(vendor.email)}`)
  else add('ok', 'Sender address matches the vendor master')
  if (/\b(urgent|immediately|today|asap|effective immediately|right away)\b/i.test(body)) add('high', 'Urgency language — a common pressure tactic in payment-redirection fraud')
  if (/\b(confidential|do not call|don't call|cannot (be reached|take calls)|only (reply|respond) (to|by) (this )?email)\b/i.test(body)) add('high', 'Discourages verification by phone')
  if (requested.account && vendor?.bank_account && requested.account.replace(/\s/g, '') === String(vendor.bank_account).replace(/\s/g, '')) add('ok', 'Requested account equals the one already on file')
  else if (requested.account) add('medium', 'Asks to pay a different bank account than the one on file')
  if (requested.ifsc && vendor?.bank_ifsc && requested.ifsc.slice(0, 4) !== String(vendor.bank_ifsc).slice(0, 4)) add('medium', `Different bank (${requested.ifsc.slice(0, 4)} instead of ${String(vendor.bank_ifsc).slice(0, 4)})`)
  if (!requested.account && !requested.ifsc) add('medium', 'No complete bank details in the email — ask for a bank letter on letterhead')
  if (!vendor?.phone) add('medium', 'No phone number in the vendor master to call back — find one from an independent source, not this email')
  if (priorRequests > 0) add('medium', `${priorRequests} earlier bank-change request${priorRequests > 1 ? 's' : ''} from this vendor`)
  const score = sig.reduce((s, x) => s + ({ high: 3, medium: 1, ok: 0 }[x.level] || 0), 0)
  return { level: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low', score, signals: sig }
}

export const BANK_CHECKS = [
  { key: 'callback', label: 'Called the vendor on the phone number already in the vendor master', hint: 'Never a number, link or contact from this email.' },
  { key: 'confirmed', label: 'The vendor confirmed the change and the new account details on that call' },
  { key: 'document', label: 'Bank letter / cancelled cheque on the vendor’s letterhead received' },
  { key: 'second', label: 'A second person reviewed this (segregation of duties)' },
  { key: 'approval', label: 'Change raised in the vendor master through its normal approval — not edited from this screen' },
]

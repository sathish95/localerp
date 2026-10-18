// Run: node --test src/lib/eiInsights.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInsights, suggestAction, decisionTrace, parseBankRequest, bankChangeRisk, maskAccount } from './eiInsights.js'

const now = Date.parse('2026-10-15T10:00:00Z')
const emails = [
  { id: 'm1', status: 'PROCESSED', category: 'INVOICE_SUBMISSION', confidence: 0.9, classifier: 'rules' },
  { id: 'm2', status: 'PROCESSED', category: 'INVOICE_SUBMISSION', confidence: 0.8, classifier: 'rules' },
  { id: 'm3', status: 'PROCESSED', category: 'BANK_DETAIL_CHANGE', confidence: 0.92, classifier: 'rules' },
  { id: 'm4', status: 'FAILED' },
]
const attachments = [
  { doc_type_code: 'TAX_INVOICE', doc_confidence: 0.9, extraction_confidence: 0.95, vendor_confidence: 0.97, vendor_id: 'v', po_id: 'p', grn_ids: ['g'], outcome: 'INVOICE_CREATED', text_method: 'PDF_TEXT' },
  { doc_type_code: 'TAX_INVOICE', doc_confidence: 0.85, extraction_confidence: 0.8, outcome: 'EXCEPTION', text_method: 'PDF_TEXT' },
]
const exceptions = [
  { kind: 'BANK_DETAIL_CHANGE', priority: 'critical', summary: 'Bank change by x@beta.com', message_id: 'm3', created_at: '2026-10-12T10:00:00Z' },
  { kind: 'PENDING_RECEIPT', priority: 'medium', summary: 'invoice BL-1: no goods receipt yet for PO PO-0050', message_id: 'm2', created_at: '2026-10-15T09:00:00Z' },
]

test('automation rate, stages, mixes come from the data', () => {
  const r = buildInsights({ emails, attachments, exceptions, context: { now, aiConfigured: false, mailboxLive: false } })
  assert.equal(r.totals.automatic, 1)                     // m1 only (m2, m3 have open items)
  assert.equal(r.totals.automationRate, 1 / 3)
  assert.equal(r.totals.touchless, 0.5)
  assert.equal(r.stages.find(s => s.key === 'Vendor match').n, 1)
  assert.equal(r.intentMix[0].key, 'INVOICE_SUBMISSION')
  assert.equal(r.totals.oldestOpenHours, 72)
})

test('recommendations are ordered by severity and point somewhere actionable', () => {
  const r = buildInsights({ emails, attachments, exceptions, context: { now, aiConfigured: false, mailboxLive: false } })
  assert.equal(r.recommendations[0].severity, 'critical')
  assert.match(r.recommendations[0].title, /bank/)
  assert.ok(r.recommendations.some(x => /AI is not configured/.test(x.title)))
  assert.ok(r.recommendations.some(x => /failed/.test(x.title) && x.action.tab === 'failed'))
  assert.ok(r.recommendations.every(x => x.action && (x.action.tab || x.action.href)))
  assert.equal(buildInsights({ emails: [], context: { aiConfigured: true, mailboxLive: true } }).recommendations.length, 0)
})

test('suggested actions and decision trace', () => {
  assert.match(suggestAction(exceptions[1]), /PO-0050/)
  assert.match(suggestAction(exceptions[0]), /phone number already in the vendor master/)
  const t = decisionTrace(attachments[0], [])
  assert.deepEqual(t.map(s => s.state), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
  const t2 = decisionTrace({ ...attachments[1], vendor_id: 'v', po_id: 'p' }, ['PENDING_RECEIPT'])
  assert.equal(t2.find(s => s.label === 'Match receipt').state, 'bad')
  assert.equal(decisionTrace({ doc_type_code: 'SUPPORTING_PHOTOGRAPH', text_method: 'NONE', outcome: 'RECORDED' }).length, 3)
})

test('bank change: parse requested details, mask, score risk from evidence', () => {
  const r = parseBankRequest('Please note our new bank account: A/c 0000111122223333, IFSC SAMP0000123. Change of bank effective immediately.')
  assert.equal(r.account, '0000111122223333'); assert.equal(r.ifsc, 'SAMP0000123')
  assert.equal(maskAccount(r.account), '••••••••3333')
  const vendor = { email: 'billing@beta.example', phone: '+91 98400 00000', bank_account: '999988887777', bank_ifsc: 'HDFC0001234' }
  const risk = bankChangeRisk({ email: { sender_email: 'billing@beta.example', body_excerpt: 'effective immediately' }, vendor, requested: r })
  assert.ok(risk.signals.some(s => /Urgency/.test(s.text)))
  assert.ok(risk.signals.some(s => /different bank account/.test(s.text)))
  assert.ok(risk.signals.some(s => /Different bank \(SAMP instead of HDFC\)/.test(s.text)))
  assert.equal(risk.level, 'high')
  const spoof = bankChangeRisk({ email: { sender_email: 'billing@beta-payments.co' }, vendor, requested: {} })
  assert.ok(spoof.signals.some(s => s.level === 'high' && /vendor master email is on beta.example/.test(s.text)))
  assert.ok(bankChangeRisk({ email: { sender_email: 'x@y.com' }, vendor: null, requested: {} }).signals[0].text.match(/not a known vendor/))
})

test('trend series and outcome split add up', () => {
  const es = emails.map((e, i) => ({ ...e, created_at: new Date(now - i * 86400000).toISOString() }))
  const r = buildInsights({ emails: es, attachments, exceptions, context: { now } })
  assert.equal(r.series.length, 14)
  assert.equal(r.series.reduce((s, d) => s + d.emails, 0), 4)
  assert.equal(r.outcomes.reduce((s, o) => s + o.count, 0), 4)
  assert.equal(r.flow[0].count, 4)
})

test('readout: headline, invoice hold reasons, blocker and quick win', () => {
  const atts = [
    { id: 'a1', doc_type_code: 'TAX_INVOICE', outcome: 'INVOICE_CREATED' },
    { id: 'a2', doc_type_code: 'TAX_INVOICE', outcome: 'EXCEPTION' },
    { id: 'a3', doc_type_code: 'TAX_INVOICE', outcome: 'EXCEPTION' },
  ]
  const exc = [
    { kind: 'PENDING_RECEIPT', priority: 'medium', summary: 'x', attachment_id: 'a2', created_at: '2026-10-15T09:00:00Z' },
    { kind: 'DUPLICATE_REVIEW', priority: 'high', summary: 'y', attachment_id: 'a3', created_at: '2026-10-15T09:00:00Z' },
    { kind: 'INVOICE_MISMATCH', priority: 'high', summary: 'z', attachment_id: 'a3', created_at: '2026-10-15T09:00:00Z' },
  ]
  const r = buildInsights({ emails, attachments: atts, exceptions: exc, context: { now, aiConfigured: false, mailboxLive: true } })
  assert.deepEqual(r.holds.map(h => h.label).sort(), ['Duplicate', 'Waiting for GRN'])   // one reason per invoice, duplicate wins
  assert.equal(r.headline.tone, 'bad')
  assert.match(r.headline.text, /2 high-priority items need a decision — mostly invoice checks/)
  assert.equal(r.blocker.severity, 'high')
  assert.ok(r.quickWin && /AI is not configured/.test(r.quickWin.title))
  assert.equal(buildInsights({ emails: [], context: {} }).headline.tone, 'neutral')
})

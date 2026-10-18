// Run: node --test src/lib/eiCompliance.test.mjs
// Project Document Compliance Register (STEP272) + lifecycle templates.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateRegister, expiryOf } from '../../supabase/functions/_shared/eiCompliance.js'
import { LIFECYCLE_TEMPLATES, EXPIRY_CODES, parseRequirement } from '../../supabase/functions/_shared/eiLifecycleData.js'
import { buildBaseline } from '../../supabase/functions/_shared/eiTaxonomy.js'

const STEP264 = ['TAX_INVOICE', 'PROFORMA_INVOICE', 'REVISED_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'QUOTATION', 'GOODS_RECEIPT_NOTE', 'DELIVERY_CHALLAN', 'PACKING_LIST', 'PROOF_OF_DELIVERY', 'PAYMENT_ADVICE', 'VENDOR_STATEMENT', 'BANK_CONFIRMATION', 'TAX_CERTIFICATE', 'VENDOR_REGISTRATION', 'CONTRACT', 'PURCHASE_AGREEMENT', 'WORK_ORDER', 'COMPLETION_CERTIFICATE', 'MEASUREMENT_SHEET', 'PROJECT_EXPENSE_EVIDENCE', 'SERVICE_REPORT', 'MAINTENANCE_REPORT', 'WARRANTY_DOCUMENT', 'INSURANCE_CERTIFICATE', 'COMPLIANCE_CERTIFICATE', 'SPREADSHEET', 'SUPPORTING_PHOTOGRAPH', 'GENERAL_ATTACHMENT', 'UNKNOWN_DOCUMENT']
const known = new Set([...buildBaseline().types.map(t => t.code), ...STEP264])

test('every template requirement and expiry code is a real document type', () => {
  assert.equal(LIFECYCLE_TEMPLATES[0].stages.length, 16)   // brief §5: 16 government stages
  for (const t of LIFECYCLE_TEMPLATES) for (const [, reqs] of t.stages) for (const r of reqs) assert.ok(known.has(parseRequirement(r).document_type_code), `${t.key}: ${r}`)
  for (const c of EXPIRY_CODES) assert.ok(known.has(c), c)
  const b = buildBaseline().types.find(t => t.code === 'PERFORMANCE_BANK_GUARANTEE')
  assert.ok(b.fields.some(f => f.key === 'expiry_date'))
  assert.deepEqual(parseRequirement('NO_OBJECTION_CERTIFICATE|s a e o'), { document_type_code: 'NO_OBJECTION_CERTIFICATE', required: false, needs_approval: true, is_statutory: true, tracks_expiry: true })
})

const today = '2026-10-15'
const stages = [{ id: 's1', seq: 1, name: 'Award' }, { id: 's2', seq: 2, name: 'Permissions' }]
const items = [
  { id: 'i1', stage_id: 's1', document_type_code: 'LETTER_OF_ACCEPTANCE', label: 'LOA', required: true, needs_approval: true, status: 'OPEN' },
  { id: 'i2', stage_id: 's1', document_type_code: 'PERFORMANCE_BANK_GUARANTEE', label: 'PBG', required: true, tracks_expiry: true, status: 'OPEN' },
  { id: 'i3', stage_id: 's2', document_type_code: 'NO_OBJECTION_CERTIFICATE', label: 'NOC', required: true, is_statutory: true, status: 'OPEN', due_date: '2026-10-01' },
  { id: 'i4', stage_id: 's2', document_type_code: 'ENVIRONMENTAL_CLEARANCE', label: 'EC', required: true, status: 'NOT_APPLICABLE' },
  { id: 'i5', stage_id: 's1', document_type_code: 'INSURANCE_POLICY', label: 'CAR policy', required: true, tracks_expiry: true, status: 'OPEN', expiry_date: '2026-09-30' },
]
const documents = [
  { id: 'd1', doc_type_code: 'LETTER_OF_ACCEPTANCE', received_at: '2026-06-01', is_current: true },
  { id: 'd2', doc_type_code: 'PERFORMANCE_BANK_GUARANTEE', received_at: '2026-06-05', is_current: true, extraction: { expiry_date: { value: '2026-11-01' } } },
  { id: 'd2old', doc_type_code: 'PERFORMANCE_BANK_GUARANTEE', received_at: '2026-05-05', is_current: false },
  { id: 'd3', doc_type_code: 'INSURANCE_POLICY', received_at: '2026-06-05' },
]

test('item states, expiry and overdue', () => {
  const r = evaluateRegister({ items, stages, documents, today })
  const s = Object.fromEntries(r.items.map(i => [i.id, i]))
  assert.equal(s.i1.state, 'AWAITING_APPROVAL')
  assert.deepEqual([s.i2.state, s.i2.expiry, s.i2.expiryState, s.i2.latest.id], ['RECEIVED', '2026-11-01', 'EXPIRING', 'd2'])
  assert.deepEqual([s.i3.state, s.i3.overdue], ['MISSING', true])
  assert.equal(s.i4.state, 'NOT_APPLICABLE')
  assert.deepEqual([s.i5.expiryState, s.i5.done], ['EXPIRED', false])     // item date beats the document
  assert.equal(r.totals.required, 4)
  assert.equal(r.totals.satisfied, 1)                                       // PBG only
  assert.equal(r.totals.statutoryMissing, 1)
  assert.equal(r.current.id, 's1')
  assert.equal(r.alerts[0].sev, 3)
  assert.ok(r.alerts.some(a => /Statutory: NOC/.test(a.text)))
})

test('approval is only ever recorded by a person', () => {
  const r = evaluateRegister({ items: [{ ...items[0], status: 'APPROVED' }], stages, documents: [], today })
  assert.equal(r.items[0].state, 'APPROVED')
  assert.equal(evaluateRegister({ items: [items[0]], stages, documents, today }).items[0].state, 'AWAITING_APPROVAL')
})

test('expiry from extraction variants', () => {
  assert.equal(expiryOf({ extraction: { valid_until: { value: '2027-01-31' } } }), '2027-01-31')
  assert.equal(expiryOf({ extraction: { expiry_date: { value: '31/01/2027' } } }), null)
  assert.equal(expiryOf(null), null)
})

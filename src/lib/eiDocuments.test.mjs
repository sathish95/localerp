// Run: node --test src/lib/eiDocuments.test.mjs
// Document register rules (STEP268) + the pipeline filing documents on projects.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mappingFor, documentMeta, resolveDocumentProject, reviewStateFor, AREA_KEYS } from '../../supabase/functions/_shared/eiDocuments.js'
import { runEmailIntelligence } from '../../supabase/functions/_shared/eiPipeline.js'
import { CONFIG, docDeps, CTX } from './eiFixtures.mjs'

test('mapping: configured type wins, defaults by code, unknown → OTHER', () => {
  assert.deepEqual(mappingFor({ code: 'TAX_INVOICE' }), { area: 'FINANCE', primary_module: 'invoices', related_modules: ['procurement', 'projects'] })
  assert.deepEqual(mappingFor({ code: 'TAX_INVOICE', area: 'PROCUREMENT', primary_module: 'pos', related_modules: ['pos', 'grn'] }), { area: 'PROCUREMENT', primary_module: 'pos', related_modules: ['grn'] })
  assert.equal(mappingFor(null, 'NEW_THING').area, 'OTHER')
  assert.equal(mappingFor({ code: 'X', area: 'NOT_AN_AREA' }).area, 'OTHER')
  assert.ok(AREA_KEYS.includes('HANDOVER'))
})

test('meta: number / date / revision from fields, file name or AI — never invented', () => {
  const m = documentMeta({ fields: { invoice_number: { value: 'INV-9' }, invoice_date: { value: '2026-10-01' } }, fileName: 'Drawing_GA_Rev_B.pdf' })
  assert.deepEqual(m, { title: 'Drawing GA Rev B', document_number: 'INV-9', document_date: '2026-10-01', revision: 'B' })
  const n = documentMeta({ fields: {}, fileName: 'photo.jpg' })
  assert.equal(n.document_number, null); assert.equal(n.document_date, null); assert.equal(n.revision, null)
  assert.equal(documentMeta({ fields: { invoice_date: { value: '01/10/2026' } } }).document_date, null)
  assert.equal(documentMeta({ ai: { title: 'Method Statement — Piling', document_number: 'MS-004', document_date: '2026-09-30' } }).document_number, 'MS-004')
})

test('project: PO beats text; confidence decides auto-file vs suggestion', () => {
  assert.equal(resolveDocumentProject({ poProjectId: 'p1', match: { status: 'MATCHED', project: { id: 'p2' }, confidence: 0.99 } }).project_id, 'p1')
  const hi = resolveDocumentProject({ match: { status: 'MATCHED', project: { id: 'p2' }, method: 'CODE', confidence: 0.97 } })
  assert.deepEqual([hi.status, hi.project_id], ['MATCHED', 'p2'])
  const lo = resolveDocumentProject({ match: { status: 'MATCHED', project: { id: 'p2' }, method: 'CUSTOMER', confidence: 0.7 } })
  assert.deepEqual([lo.status, lo.project_id], ['SUGGESTED', 'p2'])
  assert.equal(resolveDocumentProject({ match: { status: 'MATCHED', project: { id: 'p2' }, confidence: 0.7 }, settings: { documents: { auto_link_min: 0.6 } } }).status, 'MATCHED')
  assert.equal(resolveDocumentProject({ match: { status: 'AMBIGUOUS', candidates: [{ id: 'a' }, { id: 'b' }] } }).status, 'AMBIGUOUS')
  assert.equal(resolveDocumentProject({ match: null }).status, 'UNASSIGNED')
})

test('review state', () => {
  assert.equal(reviewStateFor({ docCode: 'CONTRACT', docConfidence: 0.9, projectStatus: 'MATCHED' }), 'OK')
  assert.equal(reviewStateFor({ docCode: 'CONTRACT', docConfidence: 0.9, projectStatus: 'SUGGESTED' }), 'NEEDS_PROJECT')
  assert.equal(reviewStateFor({ docCode: 'UNKNOWN_DOCUMENT', docConfidence: 0.9, projectStatus: 'CONFIRMED' }), 'NEEDS_TYPE')
  assert.equal(reviewStateFor({ docCode: 'CONTRACT', docConfidence: 0.4, projectStatus: 'UNASSIGNED' }), 'NEEDS_BOTH')
})

/* pipeline: a non-invoice document is filed on the project named in its text */
const ROW = { id: 'm', organization_id: 'o' }

test('pipeline files a work order on the project whose code is in the document', async () => {
  const { st, d } = docDeps([{ id: 'a', name: 'WO_Rev_2.pdf', text: 'WORK ORDER No WO-77 for project PRJ-202 Solar Park' }], CTX)
  const rep = await runEmailIntelligence({ row: ROW, email: { subject: 'Work order', body: 'Please find attached', senderEmail: 'x@gov.in' }, config: CONFIG, version: 1, deps: d })
  const u = st.updates['att-a']
  assert.deepEqual([u.project_id, u.project_status, u.project_method, u.area, u.primary_module, u.revision, u.review_state],
    ['p2', 'MATCHED', 'CODE', 'TENDER_CONTRACT', 'projects', '2', 'OK'])
  assert.equal(rep.attachments[0].project_status, 'MATCHED')
})

test('pipeline leaves a document unassigned when nothing identifies the project', async () => {
  const { st, d } = docDeps([{ id: 'b', name: 'scan.pdf', text: 'Some letter' }], CTX)
  await runEmailIntelligence({ row: ROW, email: { subject: 'Hello', body: 'see attached', senderEmail: 'x@y.com' }, config: CONFIG, version: 1, deps: d })
  const u = st.updates['att-b']
  assert.deepEqual([u.project_id, u.project_status, u.review_state], [null, 'UNASSIGNED', 'NEEDS_BOTH'])
})

test('without the STEP268 columns the pipeline writes only the old fields', async () => {
  const { st, d } = docDeps([{ id: 'c', name: 'WO.pdf', text: 'work order PRJ-101' }], CTX)
  d.documentRegister = false
  await runEmailIntelligence({ row: ROW, email: { subject: 's', body: 'b', senderEmail: 'x@y.com' }, config: CONFIG, version: 1, deps: d })
  assert.equal(st.updates['att-c'].project_status, undefined)
  assert.equal(st.updates['att-c'].project_id, 'p1')
})

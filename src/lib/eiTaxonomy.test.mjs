// Run: node --test src/lib/eiTaxonomy.test.mjs
// Baseline taxonomy, acronym resolution and title-zone classification (STEP269).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBaseline, codeFor, isAcronym, parseTypeEntry, resolveAcronym, matchTaxonomy, findAcronyms } from '../../supabase/functions/_shared/eiTaxonomy.js'
import { FAMILIES } from '../../supabase/functions/_shared/eiTaxonomyData.js'
import { runEmailIntelligence } from '../../supabase/functions/_shared/eiPipeline.js'
import { docDeps, CTX } from './eiFixtures.mjs'

const base = buildBaseline()
const byCode = Object.fromEntries(base.types.map(t => [t.code, t]))

test('codes are valid ei_document_types codes and unique', () => {
  const re = /^[A-Z][A-Z0-9_]{1,59}$/
  for (const t of base.types) assert.match(t.code, re, t.name)
  assert.equal(new Set(base.types.map(t => t.code)).size, base.types.length)
  assert.equal(codeFor("Employer's requirements"), 'EMPLOYER_S_REQUIREMENTS')
  assert.equal(codeFor('8D report'), 'D_8D_REPORT')
  assert.equal(codeFor('P&ID'), 'P_AND_ID')
})

test('baseline covers all 26 families and several hundred types', () => {
  assert.equal(FAMILIES.length, 26)
  assert.ok(base.types.length > 450, `only ${base.types.length}`)
  assert.equal(byCode.TAX_INVOICE.family, 'Finance and Accounting')       // keeps the STEP264 code
  assert.equal(byCode.PURCHASE_ORDER.primary_module, 'procurement')
  assert.equal(byCode.RUNNING_ACCOUNT_BILL.area, 'FINANCE')               // per-type area override
  assert.ok(byCode.NOTICE_INVITING_TENDER.aliases.includes('NIT'))
  assert.ok(byCode.NOTICE_INVITING_TENDER.industries.includes('government'))
})

test('entry parsing and acronym detection', () => {
  assert.deepEqual(parseTypeEntry('Bill of lading|B/L;BL'), { name: 'Bill of lading', aliases: ['B/L', 'BL'], area: null })
  assert.equal(parseTypeEntry('Cube test report|QUALITY').area, null)   // 2nd part is aliases
  assert.equal(parseTypeEntry('Cube test report||QUALITY').area, 'QUALITY')
  for (const a of ['RFQ', 'MoU', 'P&ID', 'B/L', '8D', 'EoT']) assert.ok(isAcronym(a), a)
  for (const a of ['Quote', 'RA bill', 'Pour card', 'X']) assert.ok(!isAcronym(a), a)
})

test('acronyms: one meaning resolves; several need context; ambiguous never decides', () => {
  const reg = base.acronyms
  assert.equal(resolveAcronym('NIT', { text: 'tender' }, reg).entry.document_type_code, 'NOTICE_INVITING_TENDER')
  assert.equal(resolveAcronym('RPC', { text: 'Please find attached' }, reg).status, 'AMBIGUOUS')
  const it = resolveAcronym('RPC', { text: 'the RPC endpoint on the API server times out' }, reg)
  assert.deepEqual([it.status, it.entry.expansion], ['RESOLVED', 'Remote procedure call'])
  const gov = resolveAcronym('RPC', { text: 'RPC sanction for the revised cost estimate' }, reg)
  assert.equal(gov.entry.expansion, 'Revised project cost')
  assert.equal(resolveAcronym('ZZZ', {}, reg).status, 'UNKNOWN')
})

test('acronyms: client-specific meaning only applies to that client', () => {
  const reg = [
    { acronym: 'RPC', expansion: 'Remote procedure call', industries: ['it'], context_terms: ['api'] },
    { acronym: 'RPC', expansion: 'Rate Proposal Certificate', customer_id: 'c-metro', document_type_code: 'QUOTATION', context_terms: [] },
  ]
  assert.equal(resolveAcronym('RPC', { text: 'attached', customerId: 'c-metro' }, reg).entry.expansion, 'Rate Proposal Certificate')
  assert.equal(resolveAcronym('RPC', { text: 'attached', customerId: 'c-other' }, reg).entry.expansion, 'Remote procedure call')
})

test('title-zone classification', () => {
  const types = base.types
  const ms = matchTaxonomy({ file_name: 'Method_Statement_Piling_Rev1.pdf', text: 'Method Statement for bored piling works' }, types, base.acronyms)
  assert.equal(ms.code, 'METHOD_STATEMENT')
  assert.ok(ms.confidence >= 0.74)
  const loa = matchTaxonomy({ file_name: 'scan001.pdf', text: 'LOA\nLetter of Acceptance for the work of road widening' }, types, base.acronyms)
  assert.equal(loa.code, 'LETTER_OF_ACCEPTANCE')
  const rpc = matchTaxonomy({ file_name: 'RPC.pdf', text: 'RPC' }, types, base.acronyms)
  assert.equal(rpc.code, null)
  assert.deepEqual(rpc.ambiguous, ['RPC'])
  assert.equal(matchTaxonomy({ file_name: 'IMG_2231.jpg', text: '' }, types, base.acronyms), null)
  assert.deepEqual(findAcronyms('Our MoU and the BOQ', base.acronyms).sort(), ['BOQ', 'MOU'].sort())
})

test('pipeline uses the taxonomy when no keyword rule fires', async () => {
  const config = {
    settings: { attachments: { max_mb: 15, max_count: 15, allowed_ext: ['pdf'] } },
    categories: [{ code: 'OTHER', name: 'Other', workflow_key: 'RECORD_ONLY', is_active: true }],
    document_types: [...base.types.map(t => ({ ...t, fields: [], confidence_threshold: 0.7, destination: 'NONE', is_active: true })),
      { code: 'UNKNOWN_DOCUMENT', name: 'Unknown', fields: [], confidence_threshold: 0.75, is_active: true }],
    rules: [], vendor_aliases: [], acronyms: base.acronyms,
  }
  const { st, d } = docDeps([{ id: 't', name: 'WIR-034.pdf', text: 'Work Inspection Request\nProject PRJ-101 Metro Depot\nLocation: Pier P12' }], CTX)
  const rep = await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 'WIR', body: 'pls inspect', senderEmail: 'qa@contractor.in' }, config, version: 2, deps: d })
  const u = st.updates['att-t']
  assert.deepEqual([u.doc_type_code, u.area, u.project_id], ['WORK_INSPECTION_REQUEST', 'QUALITY', 'p1'])
  assert.equal(rep.attachments[0].doc_source, 'taxonomy')
})

// Run: node --test src/lib/eiDiscovery.test.mjs
// New document type discovery (STEP270): the AI proposes, a person decides.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSuggestion } from '../../supabase/functions/_shared/eiAI.js'
import { runEmailIntelligence } from '../../supabase/functions/_shared/eiPipeline.js'
import { CONFIG, docDeps, CTX } from './eiFixtures.mjs'

test('suggestions are cleaned and generic names refused', () => {
  const s = normalizeSuggestion({ name: 'hindrance  register<script>', family: 'Construction', aliases: ['HR', 'x', 'Hindrance log'], why: 'Lists site hindrances' })
  assert.equal(s.name, 'Hindrance register script')
  assert.deepEqual(s.aliases, ['HR', 'Hindrance log'])
  assert.equal(s.rationale, 'Lists site hindrances')
  for (const bad of [null, {}, { name: 'Unknown' }, { name: 'document' }, { name: 'ab' }]) assert.equal(normalizeSuggestion(bad), null)
})

// Claude mock: answers the document call with a new-type proposal
const aiProposing = (suggested, docType = null) => ({ provider: 'claude', apiKey: 'k', fetchImpl: async (url, init) => {
  const body = JSON.parse(init.body)
  const text = /document_type/.test(body.system)
    ? JSON.stringify({ document_type: docType, confidence: 0.4, fields: {}, suggested_type: suggested })
    : JSON.stringify({ primary: 'OTHER', confidence: 0.9 })
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) }
} })

test('unknown file → suggestion recorded, file stays unknown and in review', async () => {
  const { st, d } = docDeps([{ id: 'u', name: 'scan.pdf', text: 'Daily hindrance log for site 4' }], CTX)
  d.ai = aiProposing({ name: 'Hindrance register', family: 'EPC and Construction', aliases: ['Hindrance log'], why: 'Lists events stopping work' })
  const calls = []
  d.db.suggestType = async s => calls.push(s)
  const rep = await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 'Log', body: 'attached', senderEmail: 'x@y.com' }, config: CONFIG, version: 4, deps: d })
  assert.equal(calls.length, 1)
  assert.deepEqual([calls[0].code, calls[0].name, calls[0].attachmentId, calls[0].version], ['HINDRANCE_REGISTER', 'Hindrance register', 'att-u', 4])
  const u = st.updates['att-u']
  assert.equal(u.suggested_type_code, 'HINDRANCE_REGISTER')
  assert.notEqual(u.doc_type_code, 'HINDRANCE_REGISTER')         // never applied without approval
  assert.ok(['NEEDS_TYPE', 'NEEDS_BOTH'].includes(u.review_state))
  assert.equal(rep.attachments[0].suggested_type.code, 'HINDRANCE_REGISTER')
})

test('no suggestion when a configured type fits, in a dry run, or when the code already exists', async () => {
  // AI picks a configured type → no proposal
  let { d } = docDeps([{ id: 'a', name: 'x.pdf', text: 'some text' }], CTX)
  d.ai = aiProposing({ name: 'Something new' }, 'WORK_ORDER')
  let calls = 0; d.db.suggestType = async () => { calls++ }
  await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 's', body: 'b', senderEmail: 'x@y.com' }, config: CONFIG, version: 1, deps: d })
  assert.equal(calls, 0)
  // dry run writes nothing
  ;({ d } = docDeps([{ id: 'b', name: 'y.pdf', text: 'other text' }], CTX))
  d.ai = aiProposing({ name: 'Hindrance register' })
  calls = 0; d.db.suggestType = async () => { calls++ }
  const rep = await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 's', body: 'b', senderEmail: 'x@y.com' }, config: CONFIG, version: 1, deps: d, simulate: true })
  assert.equal(calls, 0)
  assert.equal(rep.attachments[0].suggested_type.name, 'Hindrance register')   // still shown in the test report
  // the proposed name maps to an existing code → nothing to suggest
  ;({ d } = docDeps([{ id: 'c', name: 'z.pdf', text: 'more text' }], CTX))
  d.ai = aiProposing({ name: 'Work order' })
  calls = 0; d.db.suggestType = async () => { calls++ }
  await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 's', body: 'b', senderEmail: 'x@y.com' }, config: CONFIG, version: 1, deps: d })
  assert.equal(calls, 0)
})

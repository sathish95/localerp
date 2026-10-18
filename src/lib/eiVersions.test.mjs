// Run: node --test src/lib/eiVersions.test.mjs
// Duplicates and revision chains (STEP271).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normNumber, revisionRank, titleSimilarity, relateDocument } from '../../supabase/functions/_shared/eiVersions.js'
import { runEmailIntelligence } from '../../supabase/functions/_shared/eiPipeline.js'
import { CONFIG, docDeps, CTX } from './eiFixtures.mjs'

test('numbers and revisions', () => {
  assert.equal(normNumber('No. DWG-101/A'), 'DWG101A')
  assert.equal(normNumber('NOV-2026'), 'NOV2026')
  assert.equal(normNumber(''), null)
  assert.ok(revisionRank('B') > revisionRank('A'))
  assert.ok(revisionRank('C1') > revisionRank('C'))
  assert.equal(revisionRank('Rev 02'), 2)
  assert.equal(revisionRank('R3'), 3)
  assert.equal(revisionRank('P03'), 3)
  assert.equal(revisionRank(null), 0)
  assert.ok(titleSimilarity('Method Statement Piling Rev 1.pdf', 'Method_Statement_Piling_Rev_2.pdf') >= 0.99)
  assert.ok(titleSimilarity('Method statement piling', 'Invoice 4411') < 0.2)
})

const old = { id: 'd1', sha256: 'aaa', document_number: 'DWG-101', revision: 'A', doc_type_code: 'DRAWING', project_id: 'p1', title: 'GA drawing', file_name: 'GA_RevA.pdf', sender_email: 'x@arch.com', received_at: '2026-10-01', version_group_id: 'd1' }

test('relations', () => {
  assert.equal(relateDocument({ ...old, id: 'n', sha256: 'aaa' }, [old]).relation, 'EXACT_DUPLICATE')
  const rev = relateDocument({ ...old, id: 'n', sha256: 'bbb', revision: 'B' }, [old])
  assert.deepEqual([rev.relation, rev.related_id, rev.group_id], ['NEW_REVISION', 'd1', 'd1'])
  // compared with the chain head, not the oldest member
  const revB = { ...old, id: 'd2', sha256: 'bbb', revision: 'B', version_group_id: 'd1' }
  assert.deepEqual([relateDocument({ ...old, id: 'n', sha256: 'ccc', revision: 'C' }, [revB, old]).related_id], ['d2'])
  assert.equal(relateDocument({ ...old, id: 'n', sha256: 'ccc', revision: null }, [revB, old]).relation, 'OLDER_REVISION')
  assert.equal(relateDocument({ ...old, id: 'n', sha256: 'zzz' }, [old]).relation, 'SAME_REVISION')
  // another project's document with the same number is not a version
  assert.equal(relateDocument({ ...old, id: 'n', sha256: 'zzz', project_id: 'p2', revision: 'B' }, [old]).relation, 'NONE')
  // no number: near-identical title from the same sender → suggestion only
  const sim = relateDocument({ id: 'n', sha256: 'q', title: 'GA drawing', file_name: 'GA drawing final.pdf', doc_type_code: 'DRAWING', sender_email: 'y@arch.com' }, [{ ...old, document_number: null }])
  assert.equal(sim.relation, 'SIMILAR')
  assert.equal(relateDocument({ id: 'n', sha256: 'q', title: 'GA drawing', doc_type_code: 'DRAWING', sender_email: 'y@other.com' }, [{ ...old, document_number: null }]).relation, 'NONE')
})

test('pipeline links a new revision through the injected db call', async () => {
  const { st, d } = docDeps([{ id: 'w', name: 'Work_Order_Solar_Rev_2.pdf', text: 'WORK ORDER PRJ-202 Solar Park' }], CTX)
  const prior = { id: 'prev', sha256: 'other', document_number: null, revision: '1', doc_type_code: 'WORK_ORDER', project_id: 'p2', title: 'Work Order Solar Rev 1', file_name: 'Work_Order_Solar_Rev_1.pdf', sender_email: 'x@gov.in', received_at: '2026-10-01', version_group_id: null }
  d.lookup.relatedDocuments = async () => [prior]
  const links = []
  d.db.linkVersion = async (id, rel) => links.push({ id, ...rel })
  await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 'Work order', body: 'attached', senderEmail: 'x@gov.in' }, config: CONFIG, version: 1, deps: d })
  assert.equal(links.length, 1)
  assert.equal(links[0].relation, 'SIMILAR')
  assert.equal(links[0].related_id, 'prev')
  assert.ok(st.updates['att-w'])
})

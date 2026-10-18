// Email Intelligence — duplicates and revision chains (STEP271). Import-free;
// tested in src/lib/eiVersions.test.mjs.
//
// For one newly received document and earlier documents of the same org:
//   EXACT_DUPLICATE  same file bytes (SHA-256) — linked, never deleted
//   NEW_REVISION     same document number (+ same type / project), a later revision
//   OLDER_REVISION   same number, an earlier revision arriving late (kept, not current)
//   SAME_REVISION    same number and revision but different content — needs a person
//   SIMILAR          no number, but near-identical title, same type and sender — suggested
// Nothing is overwritten: every version stays its own record; the chain only
// records which one is current.

export const normNumber = n => String(n || '').toUpperCase().replace(/^(NO|NUMBER|REF)[\s.:#-]+/, '').replace(/[^A-Z0-9]/g, '') || null

// "B" → 2, "C1" → 3.01, "2" / "R2" / "Rev 02" → 2, "P03" → 3, null → 0
export function revisionRank(rev) {
  const r = String(rev || '').toUpperCase().replace(/^(REVISION|REV|R|VERSION|VER|V|P|ISSUE)[\s.:\-#]*/, '').trim()
  if (!r) return 0
  if (/^\d+$/.test(r)) return Number(r)
  const m = r.match(/^([A-Z])(\d*)$/)
  if (m) return (m[1].charCodeAt(0) - 64) + (m[2] ? Number(m[2]) / 100 : 0)
  const d = r.match(/(\d+)/)
  return d ? Number(d[1]) : 0
}

const STOP = new Set(['rev', 'revision', 'ver', 'version', 'v', 'r', 'final', 'draft', 'copy', 'signed', 'scan', 'scanned'])
const tokens = s => new Set(String(s || '').toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').replace(/[^a-z0-9]+/g, ' ')
  .split(' ').filter(w => w.length > 1 && !STOP.has(w) && !/^\d{1,2}$/.test(w)))
export function titleSimilarity(a, b) {
  const x = tokens(a), y = tokens(b)
  if (!x.size || !y.size) return 0
  let inter = 0; for (const t of x) if (y.has(t)) inter++
  return inter / (x.size + y.size - inter)
}
const domain = e => String(e || '').toLowerCase().split('@')[1] || ''

/**
 * @param doc        { id, sha256, document_number, revision, doc_type_code, project_id, title, file_name, sender_email, received_at }
 * @param candidates earlier documents (same org), newest first, with the same fields + version_group_id
 * @returns { relation, related_id, group_id, confidence, reason } | { relation: 'NONE' }
 */
export function relateDocument(doc, candidates = [], { similarMin = 0.8 } = {}) {
  const others = candidates.filter(c => c.id !== doc.id)
  const exact = doc.sha256 && others.find(c => c.sha256 && c.sha256 === doc.sha256)
  if (exact) return { relation: 'EXACT_DUPLICATE', related_id: exact.id, group_id: exact.version_group_id || exact.id, confidence: 1, reason: `Same file as ${exact.file_name || 'an earlier document'}` }

  const num = normNumber(doc.document_number)
  if (num && num.length >= 3) {
    const compatible = c => normNumber(c.document_number) === num
      && (!doc.doc_type_code || !c.doc_type_code || c.doc_type_code === doc.doc_type_code || c.doc_type_code === 'UNKNOWN_DOCUMENT' || doc.doc_type_code === 'UNKNOWN_DOCUMENT')
      && (!doc.project_id || !c.project_id || c.project_id === doc.project_id)
    const same = others.filter(compatible)
    if (same.length) {
      // compare with the current head of that chain (highest revision, then newest)
      const head = [...same].sort((a, b) => revisionRank(b.revision) - revisionRank(a.revision) || String(b.received_at || '').localeCompare(String(a.received_at || '')))[0]
      const group = head.version_group_id || head.id
      const mine = revisionRank(doc.revision), theirs = revisionRank(head.revision)
      if (mine > theirs) return { relation: 'NEW_REVISION', related_id: head.id, group_id: group, confidence: 0.92, reason: `Document ${doc.document_number} revision ${doc.revision || '?'} after ${head.revision || 'the original'}` }
      if (mine < theirs) return { relation: 'OLDER_REVISION', related_id: head.id, group_id: group, confidence: 0.9, reason: `Revision ${doc.revision || 'original'} of ${doc.document_number} arrived after revision ${head.revision}` }
      return { relation: 'SAME_REVISION', related_id: head.id, group_id: group, confidence: 0.7, reason: `Same number ${doc.document_number}${doc.revision ? ` and revision ${doc.revision}` : ''} but different content — check which one is right` }
    }
  }

  const sameSender = c => domain(c.sender_email) && domain(c.sender_email) === domain(doc.sender_email)
  let best = null
  for (const c of others) {
    if (doc.doc_type_code && c.doc_type_code !== doc.doc_type_code) continue
    if (doc.project_id && c.project_id && c.project_id !== doc.project_id) continue
    if (!sameSender(c)) continue
    // two different printed numbers are two different documents, however alike the titles
    if (normNumber(doc.document_number) && normNumber(c.document_number) && normNumber(doc.document_number) !== normNumber(c.document_number)) continue
    // generic one-word names ("Invoice.pdf", "scan.pdf") say nothing
    if (tokens(doc.title || doc.file_name).size < 2) continue
    const s = Math.max(titleSimilarity(doc.title || doc.file_name, c.title || c.file_name), titleSimilarity(doc.file_name, c.file_name))
    if (s >= similarMin && (!best || s > best.s)) best = { c, s }
  }
  if (best) return { relation: 'SIMILAR', related_id: best.c.id, group_id: best.c.version_group_id || best.c.id, confidence: Math.round(best.s * 100) / 100, reason: `Title close to ${best.c.title || best.c.file_name} from the same sender` }
  return { relation: 'NONE' }
}

// Auto-linked relations become part of the chain; the rest wait for a person.
export const AUTO_LINK = ['EXACT_DUPLICATE', 'NEW_REVISION', 'OLDER_REVISION']
export const RELATION_LABEL = {
  EXACT_DUPLICATE: 'Exact duplicate', NEW_REVISION: 'New revision', OLDER_REVISION: 'Older revision',
  SAME_REVISION: 'Same number, different content', SIMILAR: 'Possibly the same document', NONE: '—',
}

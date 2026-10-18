// Email Intelligence — document taxonomy + acronym intelligence (STEP269).
// Import-free apart from sibling modules: runs in the worker, the web app and
// node tests (src/lib/eiTaxonomy.test.mjs).
//
//  • buildBaseline()   turns eiTaxonomyData.js into importable rows
//  • resolveAcronym()  picks ONE meaning of an acronym only when the context
//                      supports it — several plausible meanings = ambiguous,
//                      and an ambiguous acronym never decides a document type
//  • matchTaxonomy()   classifies a file by its title zone (file name + top of
//                      the text) against type names, aliases and acronyms

import { termMatches } from './eiEngine.js'
import { FAMILIES, EXTRA_ACRONYMS } from './eiTaxonomyData.js'
import { EXPIRY_CODES, EXPIRY_FIELDS } from './eiLifecycleData.js'

const AREAS = ['CORRESPONDENCE', 'TENDER_CONTRACT', 'ENGINEERING', 'PROCUREMENT', 'SITE', 'LOGISTICS', 'QUALITY', 'FINANCE', 'SAFETY_COMPLIANCE', 'PM_REPORTING', 'OPERATIONS', 'HANDOVER', 'OTHER']

export const codeFor = name => String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'D_$1').slice(0, 60) || 'UNNAMED'

// "MoU", "RFQ", "B/L", "P&ID", "8D" — short, no spaces, ≥ 2 capitals (or a digit + capital)
export function isAcronym(s) {
  const t = String(s || '').trim()
  if (!/^[A-Za-z0-9&/.\-]{2,8}$/.test(t)) return false
  const caps = (t.match(/[A-Z]/g) || []).length
  return caps >= 2 || (caps >= 1 && /\d/.test(t))
}

// Parse 'Name|ALIAS;Alias two|AREA'
export function parseTypeEntry(entry) {
  const [name, aliasPart = '', area = ''] = String(entry).split('|')
  const aliases = aliasPart.split(';').map(a => a.trim()).filter(Boolean)
  return { name: name.trim(), aliases: [...new Set(aliases.filter(a => a.toLowerCase() !== name.trim().toLowerCase()))], area: AREAS.includes(area.trim()) ? area.trim() : null }
}

// → { types: [...], acronyms: [...] } deduplicated by code / (acronym, expansion)
export function buildBaseline(families = FAMILIES, extra = EXTRA_ACRONYMS) {
  const types = new Map()
  const acr = new Map()
  const addAcr = (a) => {
    const k = `${a.acronym.toUpperCase()}|${a.expansion.toLowerCase()}`
    const cur = acr.get(k)
    if (!cur) acr.set(k, a)
    else {
      cur.industries = [...new Set([...cur.industries, ...a.industries])]
      cur.context_terms = [...new Set([...(cur.context_terms || []), ...(a.context_terms || [])])]
      cur.document_type_code ||= a.document_type_code
    }
  }
  for (const f of families) {
    for (const entry of f.types) {
      const t = parseTypeEntry(entry)
      const code = codeFor(t.name)
      const existing = types.get(code)
      if (existing) {   // same document in two families: keep the first, merge tags
        existing.industries = [...new Set([...existing.industries, ...f.industries])]
        existing.aliases = [...new Set([...existing.aliases, ...t.aliases])]
      } else {
        types.set(code, {
          code, name: t.name.charAt(0).toUpperCase() + t.name.slice(1), family: f.name, category: null,
          industries: [...f.industries], aliases: t.aliases,
          area: t.area || f.area, primary_module: f.module, related_modules: f.related || [],
          // guarantees, policies, permits: read number / amount / expiry (compliance register)
          ...(EXPIRY_CODES.includes(code) ? { fields: EXPIRY_FIELDS } : {}),
        })
      }
      for (const a of t.aliases.filter(isAcronym)) addAcr({ acronym: a, expansion: t.name, industries: [...f.industries], document_type_code: code, context_terms: [] })
    }
  }
  for (const x of extra) addAcr({ acronym: x.acronym, expansion: x.expansion, industries: x.industries || ['all'], document_type_code: x.document_type_code || null, context_terms: x.context || [] })
  return { types: [...types.values()], acronyms: [...acr.values()] }
}

const words = s => String(s || '').toLowerCase()
const hasWord = (text, w) => termMatches(w, text, 'PHRASE', false)

/**
 * @param acronym  as found in the document
 * @param ctx      { text, industries: [..], customerId, projectId }
 * @param registry active ei_acronyms rows
 * @returns { status: RESOLVED|AMBIGUOUS|UNKNOWN, entry, score, candidates }
 */
export function resolveAcronym(acronym, ctx = {}, registry = []) {
  const key = String(acronym || '').trim().toUpperCase()
  const text = words(ctx.text)
  const inds = new Set((ctx.industries || []).map(x => String(x).toLowerCase()))
  const rows = registry.filter(r => r.is_active !== false && String(r.acronym).toUpperCase() === key)
    // a client- / project-specific meaning only applies to that client / project
    .filter(r => (!r.project_id || r.project_id === ctx.projectId) && (!r.customer_id || r.customer_id === ctx.customerId))
  if (!rows.length) return { status: 'UNKNOWN', entry: null, score: 0, candidates: [] }
  const scored = rows.map(r => {
    const hits = (r.context_terms || []).filter(t => hasWord(text, t))
    const ind = (r.industries || []).some(i => inds.has(String(i).toLowerCase())) ? 1 : 0
    const score = (r.project_id ? 3 : 0) + (r.customer_id ? 2 : 0) + ind + hits.length + (hasWord(text, r.expansion) ? 3 : 0)
    return { entry: r, score, hits }
  }).sort((a, b) => b.score - a.score)
  const candidates = scored.map(s => ({ expansion: s.entry.expansion, document_type_code: s.entry.document_type_code || null, score: s.score }))
  if (scored.length === 1) return { status: 'RESOLVED', entry: scored[0].entry, score: scored[0].score, candidates }
  const [a, b] = scored
  // several meanings: only when the context clearly prefers one
  if (a.score >= 1 && a.score - b.score >= 1 && (a.hits.length > 0 || a.entry.project_id || a.entry.customer_id || hasWord(text, a.entry.expansion))) {
    return { status: 'RESOLVED', entry: a.entry, score: a.score, candidates }
  }
  return { status: 'AMBIGUOUS', entry: null, score: a.score, candidates }
}

// Acronym-looking tokens in a text (case-sensitive), e.g. "RFQ", "MoU", "P&ID"
export function findAcronyms(text, registry = []) {
  // case-insensitive search, but the occurrence itself must look like an
  // acronym ("MoU", "MOU" — not the word "mou" in running text)
  const t = String(text || '')
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const known = [...new Set(registry.map(r => String(r.acronym).trim().toUpperCase()))]
  return known.filter(a => {
    const re = new RegExp(`(^|[^A-Za-z0-9])(${esc(a)})(?=$|[^A-Za-z0-9])`, 'gi')
    for (const m of t.matchAll(re)) if (isAcronym(m[2])) return true
    return false
  })
}

/**
 * Classify one file by its title zone.
 * @param att   { file_name, text }
 * @param types active document types (with name / aliases)
 * @returns { code, confidence, rules, alternatives, source: 'taxonomy', ambiguous: [acronym…] } | null
 */
export function matchTaxonomy(att, types = [], registry = [], ctx = {}) {
  const fileZone = String(att.file_name || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_\-.]+/g, ' ')
  const textZone = String(att.text || '').slice(0, 800)
  const title = `${fileZone}\n${textZone}`
  const cand = new Map()
  const put = (code, conf, why, len) => {
    const c = cand.get(code)
    if (!c || conf > c.conf || (conf === c.conf && len > c.len)) cand.set(code, { code, conf, why, len })
  }
  for (const t of types) {
    if (t.is_active === false || t.code === 'UNKNOWN_DOCUMENT') continue
    for (const phrase of [t.name, ...(t.aliases || []).filter(a => !isAcronym(a))]) {
      if (!phrase || phrase.length < 4) continue
      const inFile = termMatches(phrase, fileZone, 'PHRASE', false)
      const inText = !inFile && termMatches(phrase, textZone, 'PHRASE', false)
      if (inFile || inText) put(t.code, Math.min(0.85, (inFile ? 0.74 : 0.68) + Math.min(0.08, phrase.length / 300)), `"${phrase}" in the ${inFile ? 'file name' : 'document title area'}`, phrase.length)
    }
  }
  const ambiguous = []
  for (const a of findAcronyms(title, registry)) {
    const r = resolveAcronym(a, { ...ctx, text: `${title}\n${String(att.text || '').slice(0, 4000)}` }, registry)
    if (r.status === 'AMBIGUOUS') { ambiguous.push(a); continue }
    if (r.status === 'RESOLVED' && r.entry.document_type_code && types.some(t => t.code === r.entry.document_type_code && t.is_active !== false)) {
      put(r.entry.document_type_code, r.score >= 2 ? 0.74 : 0.66, `"${a}" = ${r.entry.expansion}`, a.length)
    }
  }
  const ranked = [...cand.values()].sort((x, y) => y.conf - x.conf || y.len - x.len)
  if (!ranked.length) return ambiguous.length ? { code: null, confidence: 0, rules: [], alternatives: [], source: 'taxonomy', ambiguous } : null
  // two different types tied at the top → lower confidence (needs a person)
  const tied = ranked[1] && ranked[1].conf === ranked[0].conf
  return {
    code: ranked[0].code, confidence: tied ? Math.min(ranked[0].conf, 0.6) : ranked[0].conf,
    rules: [{ name: `Taxonomy: ${ranked[0].why}` }], alternatives: ranked.slice(1, 4).map(r => r.code), source: 'taxonomy', ambiguous,
  }
}

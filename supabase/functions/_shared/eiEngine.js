// Email Intelligence engine (STEP263–265) — pure, import-free, deterministic.
//
// Everything business-specific comes from the published configuration
// snapshot (categories, keyword rules, document types, aliases, settings);
// nothing here hard-codes a keyword, category or tolerance. Used by the
// outlook-sync Edge Function, the Settings simulator (web) and node --test
// (src/lib/emailIntelligence.test.mjs).
//
// Precedence (deterministic):
//   1. safety: exclusion rules veto, sensitive intents (VENDOR_VERIFICATION)
//      are always surfaced, email text can never authorise anything
//   2. vendor-scoped rules  >  general rules  (specificity bonus)
//   3. higher weight  >  lower weight;  ALL-of-several-terms  >  single term
//   4. AI is consulted only when rules are not confident; a disagreement
//      between a medium rule result and the AI goes to review
//   5. anything unresolved → review queue

/* ═══ text matching ═══ */

const MAX_TEXT = 60000
export const LOCATIONS = ['SUBJECT', 'BODY', 'SENDER', 'SENDER_DOMAIN', 'ATTACHMENT_NAME', 'ATTACHMENT_TEXT']
export const MATCH_MODES = ['PHRASE', 'WORD', 'PARTIAL', 'REGEX']

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const collapse = s => String(s || '').replace(/\s+/g, ' ')

// Same guard as the SQL trigger: no nested repetition, bounded length.
export function safeRegex(pattern, flags = 'i') {
  const p = String(pattern || '')
  if (!p || p.length > 200 || /\([^)]*[+*][^)]*\)[+*{]/.test(p)) return null
  try { return new RegExp(p, flags) } catch { return null }
}

export function termMatches(term, text, mode = 'PHRASE', caseSensitive = false) {
  const t = collapse(term).trim()
  const s = collapse(text).slice(0, MAX_TEXT)
  if (!t || !s) return false
  const flags = caseSensitive ? '' : 'i'
  if (mode === 'PARTIAL') return caseSensitive ? s.includes(t) : s.toLowerCase().includes(t.toLowerCase())
  if (mode === 'REGEX') { const re = safeRegex(t, flags); return !!re && re.test(s) }
  // PHRASE and WORD: the term (one word or a contiguous phrase) bounded by non-alphanumerics
  return new RegExp(`(^|[^A-Za-z0-9])${esc(t).replace(/ /g, '\\s+')}(?=$|[^A-Za-z0-9])`, flags).test(s)
}

const domainOf = e => String(e || '').toLowerCase().split('@')[1] || ''

export function locationText(ctx, loc) {
  switch (loc) {
    case 'SUBJECT': return ctx.subject || ''
    case 'BODY': return ctx.body || ''
    case 'SENDER': return `${ctx.senderEmail || ''} ${ctx.senderName || ''}`
    case 'SENDER_DOMAIN': return domainOf(ctx.senderEmail)
    case 'ATTACHMENT_NAME': return (ctx.attachmentNames || []).join('\n')
    case 'ATTACHMENT_TEXT': return (ctx.attachmentTexts || []).join('\n').slice(0, MAX_TEXT)
    default: return ''
  }
}

export const isEffective = (item, today) =>
  item.is_active !== false && (!item.effective_from || item.effective_from <= today) && (!item.effective_to || item.effective_to >= today)

// → { matched, hits: [{ term, location }] }
export function evaluateRule(rule, ctx) {
  if (rule.vendor_ids?.length && !rule.vendor_ids.includes(ctx.vendorId)) return { matched: false, hits: [], outOfScope: true }
  const hits = []
  for (const term of rule.terms || []) {
    const loc = (rule.locations || []).find(l => termMatches(term, locationText(ctx, l), rule.match_mode, rule.case_sensitive))
    if (loc) hits.push({ term, location: loc })
  }
  const matched = rule.combine === 'ALL' ? hits.length === (rule.terms || []).length && hits.length > 0 : hits.length > 0
  return { matched, hits }
}

function ruleScore(rule) {
  return Number(rule.weight || 50) + (rule.vendor_ids?.length ? 20 : 0) + (rule.combine === 'ALL' && rule.terms.length > 1 ? 5 * Math.min(rule.terms.length, 4) : 0)
}
const confFromScore = (best, count) => Math.min(0.97, Math.round((0.45 + best / 200 + 0.04 * Math.max(0, count - 1)) * 1000) / 1000)

/* ═══ email intent ═══ */

/**
 * @returns { primary, secondary: [code], scores: [{code, name, confidence, rules:[…], workflow_key}], vetoed: [code],
 *            conflict: bool, confidence, unclassified: bool }
 */
export function classifyIntents(ctx, config, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const cats = (config.categories || []).filter(c => isEffective(c, today))
  const byCode = Object.fromEntries(cats.map(c => [c.code, c]))
  const medium = Number(config.settings?.confidence?.medium ?? 0.6)
  const agg = {}
  const vetoed = new Set()
  for (const rule of (config.rules || []).filter(r => r.category_code && isEffective(r, today) && byCode[r.category_code])) {
    const ev = evaluateRule(rule, ctx)
    if (!ev.matched) continue
    if (rule.is_exclusion) { vetoed.add(rule.category_code); continue }
    const a = (agg[rule.category_code] ||= { code: rule.category_code, best: 0, count: 0, rules: [] })
    a.best = Math.max(a.best, ruleScore(rule))
    a.count++
    a.rules.push({ id: rule.id, name: rule.name, weight: rule.weight, hits: ev.hits, action: rule.proposed_action || null })
  }
  // keyword-only ranking (for conflict detection) before document evidence is added
  const kw = Object.values(agg).filter(a => !vetoed.has(a.code)).map(a => ({ code: a.code, wf: byCode[a.code].workflow_key, score: a.best + a.count }))
    .sort((x, y) => y.score - x.score)
  // Attachments are evidence too: a category whose related document types were
  // found in the email gains settings.scoring.document_evidence_weight (an email that just says "Hi"
  // with a tax invoice attached is an invoice submission).
  const DOC_EVIDENCE_WEIGHT = Number(config.settings?.scoring?.document_evidence_weight ?? 70)
  for (const d of ctx.documentTypes || []) {
    if (!d.code || Number(d.confidence || 0) < 0.6) continue
    for (const c of cats.filter(c => (c.related_document_types || []).includes(d.code))) {
      if (vetoed.has(c.code)) continue
      const a = (agg[c.code] ||= { code: c.code, best: 0, count: 0, rules: [] })
      if (a.rules.some(r => r.document === d.code)) continue
      a.best = Math.max(a.best, DOC_EVIDENCE_WEIGHT)
      a.count++
      a.rules.push({ id: null, name: `Attachment is a ${d.name || d.code}`, document: d.code, hits: [{ term: d.file_name || d.code, location: 'ATTACHMENT' }] })
    }
  }
  const scores = Object.values(agg).filter(a => !vetoed.has(a.code)).map(a => ({
    code: a.code, name: byCode[a.code].name, workflow_key: byCode[a.code].workflow_key, sort: byCode[a.code].sort_order ?? 100,
    confidence: confFromScore(a.best, a.count), score: a.best + a.count, rules: a.rules,
  })).sort((x, y) => y.score - x.score || y.confidence - x.confidence || x.sort - y.sort)

  const top = scores[0]
  // Two different handlers with near-equal KEYWORD evidence = genuine conflict
  const [k1, k2] = kw
  const conflict = !!(k1 && k2 && k2.wf !== k1.wf && k2.score >= k1.score * 0.9
    && !['RECORD_ONLY', 'IGNORE'].includes(k2.wf) && !['RECORD_ONLY', 'IGNORE'].includes(k1.wf))
  const fallback = byCode.OTHER ? 'OTHER' : null
  return {
    primary: top ? top.code : fallback,
    secondary: scores.slice(1).filter(s => s.confidence >= medium || s.workflow_key === 'VENDOR_VERIFICATION').map(s => s.code),
    scores: scores.map(({ sort, ...s }) => s),
    vetoed: [...vetoed],
    conflict,
    confidence: top ? top.confidence : 0,
    unclassified: !top,
  }
}

// Combine rule result with an (optional) AI verdict. The AI can only pick
// configured, active codes; rules that are confident always win.
export function mergeIntent(rules, ai, config) {
  const high = Number(config.settings?.confidence?.high ?? 0.85)
  const cats = Object.fromEntries((config.categories || []).filter(c => c.is_active !== false).map(c => [c.code, c]))
  const threshold = code => Number(cats[code]?.confidence_threshold ?? 0.75)
  const out = { ...rules, source: 'rules', review: false, reviewReason: null }
  const aiOk = ai && cats[ai.primary] ? ai : null
  if (rules.conflict) { out.review = true; out.reviewReason = `Rules point to different workflows: ${rules.scores.slice(0, 2).map(s => s.name).join(' vs ')}` }
  if (!rules.unclassified && rules.confidence >= Math.max(high, threshold(rules.primary))) return out
  if (aiOk) {
    const aiSec = (aiOk.secondary || []).filter(c => cats[c] && c !== aiOk.primary)
    if (rules.unclassified) {
      return { ...out, primary: aiOk.primary, confidence: aiOk.confidence, secondary: [...new Set([...aiSec, ...rules.secondary])], source: 'ai',
        review: out.review || aiOk.confidence < threshold(aiOk.primary), reviewReason: out.reviewReason || (aiOk.confidence < threshold(aiOk.primary) ? `AI confidence ${pct(aiOk.confidence)} below ${pct(threshold(aiOk.primary))}` : null) }
    }
    if (aiOk.primary === rules.primary) {
      return { ...out, confidence: Math.max(rules.confidence, aiOk.confidence), secondary: [...new Set([...rules.secondary, ...aiSec])], source: 'rules+ai' }
    }
    return { ...out, secondary: [...new Set([...rules.secondary, aiOk.primary, ...aiSec])].filter(c => c !== rules.primary), source: 'rules+ai',
      review: true, reviewReason: `Rules say ${cats[rules.primary]?.name}, AI says ${cats[aiOk.primary]?.name}` }
  }
  if (!rules.unclassified && rules.confidence < threshold(rules.primary)) {
    out.review = true
    out.reviewReason = out.reviewReason || `Confidence ${pct(rules.confidence)} below ${pct(threshold(rules.primary))} for ${cats[rules.primary]?.name}`
  }
  return out
}
const pct = v => `${Math.round(Number(v || 0) * 100)}%`

/* ═══ document (attachment) classification ═══ */

export const extOf = name => (String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || ''
const IMAGE = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic']
const SHEET = ['xlsx', 'xls', 'csv', 'ods']

export function classifyDocument(att, ctx, config, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const types = (config.document_types || []).filter(d => d.is_active !== false)
  const byCode = Object.fromEntries(types.map(d => [d.code, d]))
  const ext = extOf(att.file_name)
  // Only the file itself decides its type — never the email's subject or body.
  const actx = { vendorId: ctx.vendorId, subject: '', body: '', senderEmail: '', senderName: '', attachmentNames: [att.file_name || ''], attachmentTexts: [att.text || ''] }
  const agg = {}
  const vetoed = new Set()
  for (const rule of (config.rules || []).filter(r => r.document_type_code && isEffective(r, today) && byCode[r.document_type_code])) {
    // document rules only look at the attachment itself (+ subject/body when configured)
    const ev = evaluateRule(rule, actx)
    if (!ev.matched) continue
    if (rule.is_exclusion) { vetoed.add(rule.document_type_code); continue }
    const fmts = byCode[rule.document_type_code].formats || []
    if (fmts.length && ext && !fmts.includes(ext)) continue
    const a = (agg[rule.document_type_code] ||= { code: rule.document_type_code, best: 0, count: 0, rules: [] })
    a.best = Math.max(a.best, ruleScore(rule))
    a.count++
    a.rules.push({ id: rule.id, name: rule.name, hits: ev.hits })
  }
  const scores = Object.values(agg).filter(a => !vetoed.has(a.code)).map(a => ({
    code: a.code, name: byCode[a.code].name, confidence: confFromScore(a.best, a.count), score: a.best + a.count, rules: a.rules,
  })).sort((x, y) => y.score - x.score || (byCode[x.code].sort_order ?? 100) - (byCode[y.code].sort_order ?? 100))
  if (scores.length) return { code: scores[0].code, confidence: scores[0].confidence, rules: scores[0].rules, alternatives: scores.slice(1, 4).map(s => s.code), source: 'rules' }
  // no rule fired: structural fallbacks, low confidence (never auto-processed)
  const fb = IMAGE.includes(ext) && !String(att.text || '').trim() ? 'SUPPORTING_PHOTOGRAPH'
    : SHEET.includes(ext) ? 'SPREADSHEET'
    : String(att.text || '').trim() ? 'GENERAL_ATTACHMENT' : 'UNKNOWN_DOCUMENT'
  const code = byCode[fb] ? fb : byCode.UNKNOWN_DOCUMENT ? 'UNKNOWN_DOCUMENT' : null
  return { code, confidence: code ? 0.5 : 0, rules: [], alternatives: [], source: 'fallback' }
}

/* ═══ field extraction ═══ */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
export function parseDate(s) {
  const t = String(s || '').trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = t.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/)          // Indian convention: day first
  if (m) return valid(year(m[3]), +m[2], +m[1])
  m = t.match(/^(\d{1,2})[-/. ]?([A-Za-z]{3,9})[-/., ]+(\d{2,4})$/)
  if (m) {
    const name = m[2].toLowerCase()
    const mo = MONTHS[name.slice(0, 4)] ?? MONTHS[name.slice(0, 3)]
    if (mo) return valid(year(m[3]), mo, +m[1])
  }
  return null
}
const year = y => (y.length === 2 ? 2000 + +y : +y)
function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y > 1990 && y < 2100 ? dt.toISOString().slice(0, 10) : null
}
export const parseMoney = s => { const n = Number(String(s || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && String(s || '').match(/\d/) ? Math.round(n * 100) / 100 : null }

// GSTIN check digit (mod-36 weighted)
export function validGstin(g) {
  const s = String(g || '').toUpperCase()
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return false
  const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < 14; i++) { const p = cs.indexOf(s[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36) }
  return cs[(36 - (sum % 36)) % 36] === s[14]
}

export function normalizeField(type, raw) {
  if (raw == null || raw === '') return null
  switch (type) {
    case 'money': case 'number': return parseMoney(raw)
    case 'date': return parseDate(raw)
    case 'gstin': return String(raw).toUpperCase().trim()
    default: return String(raw).trim().slice(0, 200) || null
  }
}

/** Pattern extraction from the configured schema → { key: { value, confidence, source, evidence } } */
export function extractWithPatterns(text, docType) {
  const out = {}
  const t = String(text || '').slice(0, MAX_TEXT)
  for (const f of docType?.fields || []) {
    if (!f.pattern) continue
    const re = safeRegex(f.pattern, 'i')
    const m = re && t.match(re)
    if (!m) continue
    const raw = m[1] ?? m[0]
    const value = normalizeField(f.type, raw)
    if (value == null) continue
    // a labelled pattern ("Invoice No:", "Grand Total:") is a reliable read
    out[f.key] = { value, confidence: f.type === 'gstin' ? (validGstin(value) ? 0.9 : 0.4) : 0.8, source: 'pattern', evidence: m[0].slice(0, 120) }
  }
  // amounts that reconcile (taxable + tax = total) corroborate each other
  const ta = out.taxable_amount?.value, tx = out.tax_amount?.value, to = out.total_amount?.value
  if (ta != null && tx != null && to != null && Math.abs(ta + tx - to) <= 1) for (const k of ['taxable_amount', 'tax_amount', 'total_amount']) out[k].confidence = 0.95
  return out
}

// AI fields (already parsed JSON) → same shape; only configured keys survive.
export function normalizeAiFields(raw, docType) {
  const out = {}
  for (const f of docType?.fields || []) {
    const v = raw?.[f.key]
    const value = normalizeField(f.type, typeof v === 'object' && v !== null ? v.value : v)
    if (value == null) continue
    let c = Number(typeof v === 'object' && v !== null ? v.confidence : raw?.confidence)
    if (!Number.isFinite(c)) c = 0.8
    if (f.type === 'gstin' && !validGstin(value)) c = Math.min(c, 0.4)
    out[f.key] = { value, confidence: Math.max(0, Math.min(1, c)), source: 'ai', evidence: typeof v === 'object' && v?.evidence ? String(v.evidence).slice(0, 120) : null }
  }
  return out
}

// Pattern and AI agree → stronger; disagree on a key field → keep AI value, flag low confidence.
export function mergeFields(pattern, ai) {
  const out = { ...pattern }
  for (const [k, a] of Object.entries(ai || {})) {
    const p = pattern[k]
    if (!p) out[k] = a
    else if (String(p.value).toLowerCase() === String(a.value).toLowerCase()) out[k] = { ...a, confidence: Math.min(0.99, Math.max(a.confidence, p.confidence) + 0.1), source: 'ai+pattern' }
    else out[k] = { ...a, confidence: Math.min(a.confidence, 0.5), conflict: p.value }
  }
  return out
}

export const fieldValue = (fields, k) => fields?.[k]?.value ?? null

/** → [{ check, ok, detail }] */
export function validateExtraction(fields, docType, settings = {}) {
  const v = []
  for (const k of docType?.required_fields || []) {
    const f = fields[k]
    v.push({ check: `required:${k}`, ok: !!f && f.value != null, detail: f ? null : `${labelOf(docType, k)} not found` })
  }
  const taxable = fieldValue(fields, 'taxable_amount'), tax = fieldValue(fields, 'tax_amount'), total = fieldValue(fields, 'total_amount')
  if (total != null) v.push({ check: 'total_positive', ok: total > 0, detail: total > 0 ? null : 'Total must be greater than zero' })
  if (taxable != null && tax != null && total != null) {
    const tol = Number(settings.matching?.tax_tolerance_abs ?? 1)
    const ok = Math.abs(taxable + tax - total) <= tol
    v.push({ check: 'arithmetic', ok, detail: ok ? null : `Taxable ${taxable} + tax ${tax} = ${round2(taxable + tax)}, but total says ${total}` })
  }
  const g = fieldValue(fields, 'vendor_gstin')
  if (g) v.push({ check: 'gstin_checksum', ok: validGstin(g), detail: validGstin(g) ? null : `GSTIN ${g} fails its check digit` })
  const d = fieldValue(fields, 'invoice_date'), due = fieldValue(fields, 'due_date')
  if (d && due) v.push({ check: 'due_after_invoice', ok: due >= d, detail: due >= d ? null : 'Due date is before the invoice date' })
  for (const [k, f] of Object.entries(fields)) if (f.conflict != null) v.push({ check: `conflict:${k}`, ok: false, detail: `${labelOf(docType, k)}: document text says "${f.conflict}", AI read "${f.value}"` })
  return v
}
const labelOf = (dt, k) => dt?.fields?.find(f => f.key === k)?.label || k
const round2 = n => Math.round(n * 100) / 100

export function extractionConfidence(fields, docType) {
  const keys = docType?.required_fields?.length ? docType.required_fields : Object.keys(fields)
  if (!keys.length) return 1
  return round3(Math.min(...keys.map(k => fields[k]?.confidence ?? 0)))
}
const round3 = n => Math.round(n * 1000) / 1000

/* ═══ vendor identification ═══ */

const PUBLIC = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'rediffmail.com', 'aol.com', 'proton.me', 'protonmail.com', 'zohomail.com', 'zohomail.in'])
const normName = s => String(s || '').toLowerCase().replace(/\b(private|pvt|limited|ltd|llp|inc|co|company|corporation|corp|the)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Existing vendor master only — never creates one.
 * @returns { status: IDENTIFIED|AMBIGUOUS|UNKNOWN|CONFLICT, vendor, method, confidence, candidates, evidence }
 */
export function identifyVendor({ senderEmail, fields = {}, vendors = [], aliases = [], contacts = [] }) {
  const active = vendors.filter(v => v.status !== 'blacklisted')
  const byId = new Map(active.map(v => [v.id, v]))
  const email = String(senderEmail || '').toLowerCase()
  const dom = domainOf(email)
  const evidence = []
  const pick = (ids, method, conf) => { const u = [...new Set(ids)].filter(id => byId.has(id)); return u.length ? { ids: u, method, conf } : null }

  const gst = fieldValue(fields, 'vendor_gstin')
  const byGst = gst ? pick([...active.filter(v => String(v.gst_number || '').toUpperCase() === gst).map(v => v.id),
    ...aliases.filter(a => a.alias_type === 'GSTIN' && a.value.toUpperCase() === gst).map(a => a.vendor_id)], 'GSTIN', 0.97) : null
  const byEmail = email ? pick([...active.filter(v => String(v.email || '').toLowerCase() === email).map(v => v.id),
    ...aliases.filter(a => a.alias_type === 'EMAIL' && a.verified && a.value === email).map(a => a.vendor_id),
    ...contacts.filter(c => c.vendor_id && String(c.email || '').toLowerCase() === email && c.status !== 'inactive').map(c => c.vendor_id)], 'EMAIL', 0.9) : null
  const byDomain = dom && !PUBLIC.has(dom) ? pick([...active.filter(v => domainOf(v.email) === dom).map(v => v.id),
    ...aliases.filter(a => a.alias_type === 'DOMAIN' && a.verified && a.value === dom).map(a => a.vendor_id),
    ...contacts.filter(c => c.vendor_id && domainOf(c.email) === dom).map(c => c.vendor_id)], 'DOMAIN', 0.8) : null
  const vname = normName(fieldValue(fields, 'vendor_name'))
  const byName = vname ? pick([...active.filter(v => normName(v.name) === vname).map(v => v.id),
    ...aliases.filter(a => a.alias_type === 'NAME' && normName(a.value) === vname).map(a => a.vendor_id)], 'NAME', 0.75) : null

  for (const e of [byGst, byEmail, byDomain, byName]) if (e) evidence.push({ method: e.method, vendor_ids: e.ids })
  const result = (status, extra) => ({ status, vendor: null, method: null, confidence: 0, candidates: [], evidence, ...extra })
  const cand = ids => ids.map(id => ({ id, name: byId.get(id)?.name }))

  // Document identity (GSTIN) vs sender identity disagreeing is a red flag, not a tie-break.
  const doc = byGst?.ids.length === 1 ? byGst.ids[0] : null
  const snd = byEmail?.ids.length === 1 ? byEmail.ids[0] : byDomain?.ids.length === 1 ? byDomain.ids[0] : null
  if (doc && snd && doc !== snd) return result('CONFLICT', { candidates: cand([doc, snd]), reason: `Document GSTIN belongs to ${byId.get(doc).name}, sender belongs to ${byId.get(snd).name}` })
  for (const e of [byGst, byEmail, byDomain, byName]) {
    if (!e) continue
    if (e.ids.length === 1) {
      const v = byId.get(e.ids[0])
      if (v.status && v.status !== 'active') return result('AMBIGUOUS', { candidates: cand(e.ids), reason: `Vendor ${v.name} is ${v.status}` })
      return { status: 'IDENTIFIED', vendor: v, method: e.method, confidence: e.conf, candidates: cand(e.ids), evidence }
    }
    return result('AMBIGUOUS', { candidates: cand(e.ids), reason: `${e.method} matches ${e.ids.length} vendors` })
  }
  return result('UNKNOWN', { reason: email ? `No vendor in the master matches ${email}${gst ? ` or GSTIN ${gst}` : ''}` : 'No sender' })
}

/* ═══ PO / receipt / duplicates ═══ */

const normRef = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** pos = candidate POs of the org (by number and/or by vendor). */
export function matchPO({ fields, text = '', vendor, pos = [] }) {
  const ref = fieldValue(fields, 'po_number')
  let hits = ref ? pos.filter(p => normRef(p.po_number) === normRef(ref)) : []
  let method = 'PO_NUMBER'
  if (!hits.length) {
    hits = pos.filter(p => p.po_number && termMatches(p.po_number, text, 'PHRASE') && (!vendor || p.vendor_id === vendor.id))
    method = 'PO_IN_TEXT'
  }
  if (!hits.length) return { status: 'NOT_FOUND', po: null, reason: ref ? `PO ${ref} is not in the PO register` : 'No PO number on the document' }
  if (hits.length > 1) {
    const own = vendor ? hits.filter(p => p.vendor_id === vendor.id) : []
    if (own.length !== 1) return { status: 'AMBIGUOUS', po: null, candidates: hits.map(p => ({ id: p.id, po_number: p.po_number })), reason: 'Several POs match' }
    hits = own
  }
  const po = hits[0]
  if (vendor && po.vendor_id !== vendor.id) return { status: 'INVALID', po, reason: `PO ${po.po_number} belongs to a different vendor` }
  if (['draft', 'cancelled'].includes(po.status)) return { status: 'INVALID', po, reason: `PO ${po.po_number} is ${po.status}` }
  return { status: 'MATCHED', po, method, reason: null }
}

/** Receipts against the PO (multiple GRNs / partial deliveries add up). */
export function matchReceipts({ po, grns = [] }) {
  const own = grns.filter(g => g.po_id === po?.id && ['partial', 'received', 'closed'].includes(g.status))
  const received = round2(own.reduce((s, g) => s + Number(g.received_amount || 0), 0))
  return { status: own.length ? (own.some(g => g.status === 'partial') ? 'PARTIAL' : 'RECEIVED') : 'PENDING', grns: own, received }
}

/**
 * Amount checks against the receipt value (or PO total when receipts don't
 * carry amounts) and the PO's remaining balance. Tolerance = max(pct, abs).
 */
export function checkAmounts({ total, po, receipts, otherInvoices = [], settings = {} }) {
  const m = settings.matching || {}
  const pctTol = Number(m.amount_tolerance_pct ?? 2), absTol = Number(m.amount_tolerance_abs ?? 0)
  const within = (a, ref) => Math.abs(a - ref) <= Math.max(Math.abs(ref) * pctTol / 100, absTol)
  const checks = []
  const reference = receipts?.received > 0 ? receipts.received : Number(po?.total_amount || 0)
  const billedBefore = round2(otherInvoices.reduce((s, i) => s + Number(i.total_amount || 0), 0))
  // Variance against what was received. Against a PO total it is only a variance
  // when billing goes past it — billing part of an open PO is partial billing.
  const variance = !reference ? null
    : receipts?.received > 0 ? round2((billedBefore + total - reference) / reference * 100)
    : billedBefore + total > reference ? round2((billedBefore + total - reference) / reference * 100) : null
  if (reference) {
    // invoiced-to-date across all invoices on the PO must stay within the reference
    const billed = round2(otherInvoices.reduce((s, i) => s + Number(i.total_amount || 0), 0))
    const ok = within(billed + total, reference) || billed + total <= reference
    checks.push({ check: receipts?.received > 0 ? 'amount_vs_received' : 'amount_vs_po', ok,
      detail: ok ? null : `Invoiced ${round2(billed + total)} (incl. this ${total}) vs ${receipts?.received > 0 ? 'received value' : 'PO total'} ${reference}` })
  }
  if (po?.total_amount) {
    const billed = round2(otherInvoices.reduce((s, i) => s + Number(i.total_amount || 0), 0))
    const ok = billed + total <= Number(po.total_amount) || within(billed + total, Number(po.total_amount))
    checks.push({ check: 'po_balance', ok, detail: ok ? null : `PO balance ${round2(Number(po.total_amount) - billed)} is less than this invoice ${total}` })
  }
  const allOk = checks.every(c => c.ok)
  return { checks, variance_percent: variance, match_status: !reference ? 'unmatched' : allOk ? 'matched' : 'variance', reference }
}

export function findDuplicates({ vendor, fields, sha256, invoices = [], attachments = [], selfAttachmentId }) {
  const num = normRef(fieldValue(fields, 'invoice_number'))
  const byNumber = vendor && num ? invoices.filter(i => i.vendor_id === vendor.id && normRef(i.invoice_number) === num) : []
  const byFile = sha256 ? attachments.filter(a => a.sha256 === sha256 && a.id !== selfAttachmentId) : []
  return { byNumber, byFile, any: byNumber.length > 0 || byFile.some(a => a.invoice_id) }
}

/* ═══ the invoice decision ═══ */

/**
 * Pure decision for one invoice-like attachment. Nothing is written here.
 * @returns { action: 'CREATE_INVOICE' | 'EXCEPTIONS' | 'RECORD', exceptions: [{kind, summary, priority, detail}], payload, validations }
 */
export function decideInvoice({ docType, docConfidence, fields, validations, vendorMatch, poMatch, receipts, amounts, duplicates, original, category, settings = {} }) {
  const m = settings.matching || {}
  const ex = []
  const add = (kind, summary, priority = 'medium', detail = {}) => ex.push({ kind, summary, priority, detail })
  const num = fieldValue(fields, 'invoice_number')
  const total = fieldValue(fields, 'total_amount')
  const label = num ? `invoice ${num}` : 'invoice'

  // 1. document confidence / required data
  if (docConfidence < Number(docType.confidence_threshold ?? 0.75)) add('CLASSIFICATION_REVIEW', `Not sure this file is a ${docType.name} (${pct(docConfidence)})`)
  const failed = validations.filter(v => !v.ok)
  if (failed.length) add('DATA_VALIDATION', `${label}: ${failed.map(f => f.detail).join('; ')}`.slice(0, 480), 'medium', { failed })
  // 2. vendor identity
  if (vendorMatch.status !== 'IDENTIFIED') add('VENDOR_VERIFICATION', `${label}: ${vendorMatch.reason || 'vendor not identified'}`, vendorMatch.status === 'CONFLICT' ? 'high' : 'medium', { candidates: vendorMatch.candidates, evidence: vendorMatch.evidence })
  // 3. credit / debit notes and revisions never go straight into the register
  if (docType.destination === 'CREDIT_NOTE_REVIEW') add('CREDIT_NOTE', `${docType.name}${original ? ` against invoice ${original.invoice_number}` : ''}${total != null ? ` for ${total}` : ''}`, 'medium', { original_invoice_id: original?.id || null })
  // 4. duplicates (a credit / debit note quotes the invoice it corrects — only an identical file is a duplicate)
  const isNote = docType.destination === 'CREDIT_NOTE_REVIEW'
  const isDuplicate = (!isNote && duplicates.byNumber.length > 0 && docType.code !== 'REVISED_INVOICE') || duplicates.byFile.length > 0
  if (!isNote && duplicates.byNumber.length && !(docType.code === 'REVISED_INVOICE')) add('DUPLICATE_REVIEW', `${label} from this vendor is already in the invoice register`, 'high', { invoice_ids: duplicates.byNumber.map(i => i.id) })
  else if (duplicates.byFile.length) add('DUPLICATE_REVIEW', `The same file was already received${duplicates.byFile.some(a => a.invoice_id) ? ' and became an invoice' : ''}`, 'high', { attachment_ids: duplicates.byFile.map(a => a.id) })
  if (docType.code === 'REVISED_INVOICE' || category === 'REVISED_INVOICE') {
    add('REVISED_INVOICE', original ? `Revision of invoice ${original.invoice_number} — confirm it replaces the original` : `Revised ${label}: original invoice not found`, 'medium', { original_invoice_id: original?.id || null })
  }
  // 5. PO + receipt — invoices only; notes are reviewed against the invoice they correct.
  // A duplicate's amount is not new billing, so no mismatch on top of the duplicate.
  if (vendorMatch.status === 'IDENTIFIED' && !isNote) {
    if (poMatch.status !== 'MATCHED') { if (m.require_po !== false) add('PENDING_PO', `${label}: ${poMatch.reason}`, 'medium', { candidates: poMatch.candidates || [] }) }
    else if (m.require_receipt !== false && receipts?.status === 'PENDING') add('PENDING_RECEIPT', `${label}: no goods receipt / service confirmation yet for PO ${poMatch.po.po_number}`)
    if (poMatch.status === 'MATCHED' && !isDuplicate && amounts && amounts.checks.some(c => !c.ok)) add('INVOICE_MISMATCH', `${label}: ${amounts.checks.filter(c => !c.ok).map(c => c.detail).join('; ')}`, 'high', { checks: amounts.checks })
  }
  // 6. configured review
  if (docType.requires_review && !ex.length) add('DOCUMENT_REVIEW', `${docType.name} ${label} is set to always need review`)

  const payload = vendorMatch.status === 'IDENTIFIED' ? {
    vendor_id: vendorMatch.vendor.id, invoice_number: num, invoice_date: fieldValue(fields, 'invoice_date'), due_date: fieldValue(fields, 'due_date'),
    po_id: poMatch.status === 'MATCHED' ? poMatch.po.id : null, grn_id: receipts?.grns?.length === 1 ? receipts.grns[0].id : null,
    project_id: poMatch.status === 'MATCHED' ? poMatch.po.project_id || null : null,
    subtotal: fieldValue(fields, 'taxable_amount'), gst_amount: fieldValue(fields, 'tax_amount') ?? 0, total_amount: total,
    currency: fieldValue(fields, 'currency') || 'INR',
    three_way_match: poMatch.status === 'MATCHED' && receipts?.status !== 'PENDING' && amounts?.match_status === 'matched',
    match_status: amounts?.match_status || 'unmatched', variance_percent: amounts?.variance_percent ?? null,
    revision_of_invoice_id: original?.id || null,
  } : null

  if (ex.length) return { action: 'EXCEPTIONS', exceptions: ex, payload }
  if (docType.destination !== 'INVOICE_REGISTER' || m.auto_create_invoice === false) return { action: 'RECORD', exceptions: [], payload }
  return { action: 'CREATE_INVOICE', exceptions: [], payload }
}

/* ═══ config validation (used by the admin UI before saving / publishing) ═══ */

export function validateRule(rule, { categories = [], documentTypes = [] } = {}) {
  const errs = []
  if (!String(rule.name || '').trim()) errs.push('Name is required')
  const terms = (rule.terms || []).map(t => String(t).trim()).filter(Boolean)
  if (!terms.length) errs.push('Add at least one keyword or phrase')
  if (!rule.category_code && !rule.document_type_code) errs.push('Pick an email category and/or a document type')
  if (rule.category_code && !categories.some(c => c.code === rule.category_code)) errs.push(`Unknown category ${rule.category_code}`)
  if (rule.document_type_code && !documentTypes.some(d => d.code === rule.document_type_code)) errs.push(`Unknown document type ${rule.document_type_code}`)
  if (!(rule.locations || []).length) errs.push('Pick at least one place to look')
  if ((rule.locations || []).some(l => !LOCATIONS.includes(l))) errs.push('Unknown match location')
  if (rule.match_mode === 'REGEX') for (const t of terms) if (!safeRegex(t)) errs.push(`Pattern "${t}" is invalid or too complex`)
  if (rule.effective_from && rule.effective_to && rule.effective_to < rule.effective_from) errs.push('Effective-to is before effective-from')
  return errs
}

/** Rules that can't both win: same terms + locations pointing at different targets, or an exclusion cancelling a rule entirely. */
export function findRuleConflicts(rules = []) {
  const out = []
  const key = r => `${r.match_mode}|${[...(r.locations || [])].sort().join(',')}|${[...(r.terms || [])].map(t => t.toLowerCase().trim()).sort().join('|')}|${[...(r.vendor_ids || [])].sort().join(',')}`
  const active = rules.filter(r => r.is_active !== false)
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j]
    if (key(a) !== key(b)) continue
    if (a.is_exclusion !== b.is_exclusion && (a.category_code === b.category_code || a.document_type_code === b.document_type_code)) {
      out.push({ a: a.id || a.name, b: b.id || b.name, reason: `"${a.name}" and "${b.name}" use the same keywords but one excludes what the other selects` })
    } else if (!a.is_exclusion && !b.is_exclusion && (a.category_code !== b.category_code || a.document_type_code !== b.document_type_code) && a.weight === b.weight) {
      out.push({ a: a.id || a.name, b: b.id || b.name, reason: `"${a.name}" and "${b.name}" use the same keywords and weight but point at different targets — give one a higher weight` })
    }
  }
  return out
}

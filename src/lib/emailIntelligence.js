import { supabase } from './supabase'
import { syncAction } from './outlookEmail'
export { validateRule, findRuleConflicts, LOCATIONS, MATCH_MODES } from '../../supabase/functions/_shared/eiEngine.js'

// Email Intelligence (STEP263–265): configuration CRUD (RLS: admin/ceo/finance
// write, managers read), publish / rollback / diff RPCs, exception queue,
// processed attachments, dry-run tester (outlook-sync 'dry_run').

export const WORKFLOWS = {
  AP_INVOICE: 'Invoice intake (PO / GRN / duplicate checks → invoice register)',
  PROJECT_ISSUE_TASK: 'Customer project issue → task (existing email-to-task flow)',
  REVIEW_QUEUE: 'Send to the review queue',
  VENDOR_VERIFICATION: 'Vendor-master change → mandatory verification (never applied)',
  RECORD_ONLY: 'Record and link only',
  IGNORE: 'Ignore',
}
export const DESTINATIONS = {
  INVOICE_REGISTER: 'Invoice register (after all checks pass)',
  CREDIT_NOTE_REVIEW: 'Credit / debit note review',
  REVIEW_QUEUE: 'Review queue',
  NONE: 'Record only',
}
export const LOCATION_LABELS = {
  SUBJECT: 'Subject', BODY: 'Email body', SENDER: 'Sender address', SENDER_DOMAIN: 'Sender domain',
  ATTACHMENT_NAME: 'Attachment file name', ATTACHMENT_TEXT: 'Attachment text',
}
export const MODE_LABELS = { PHRASE: 'Exact phrase', WORD: 'Whole word', PARTIAL: 'Partial (anywhere)', REGEX: 'Pattern (regular expression)' }
export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'gstin']
export const REVIEW_ROLES = ['finance', 'manager', 'department_head', 'admin', 'ceo', 'hr']
export const PRIORITIES = ['low', 'medium', 'high', 'critical']

export const EXCEPTION_KINDS = {
  VENDOR_VERIFICATION: 'Vendor verification', PENDING_PO: 'Pending PO identification', PENDING_RECEIPT: 'Pending GRN / receipt',
  DUPLICATE_REVIEW: 'Duplicate review', REVISED_INVOICE: 'Revised invoice', INVOICE_MISMATCH: 'Invoice mismatch',
  DATA_VALIDATION: 'Data validation', CREDIT_NOTE: 'Credit / debit note', CLASSIFICATION_REVIEW: 'Classification review',
  EXTRACTION_REVIEW: 'Extraction review', BANK_DETAIL_CHANGE: 'Bank detail change', VENDOR_MASTER_CHANGE: 'Vendor master change',
  DOCUMENT_REVIEW: 'Document review',
}
export const exceptionLabel = (kind, cats = {}) =>
  kind?.startsWith('CATEGORY_REVIEW:') ? (cats[kind.split(':')[1]]?.name || kind.split(':')[1]) : (EXCEPTION_KINDS[kind] || kind)
export const INVOICE_KINDS = ['VENDOR_VERIFICATION', 'PENDING_PO', 'PENDING_RECEIPT', 'DUPLICATE_REVIEW', 'REVISED_INVOICE', 'INVOICE_MISMATCH', 'DATA_VALIDATION', 'CREDIT_NOTE', 'DOCUMENT_REVIEW', 'CLASSIFICATION_REVIEW']

export const DEFAULT_SETTINGS = {
  ai: { classify_emails: true, classify_documents: true, extract_fields: true },
  confidence: { high: 0.85, medium: 0.6 },
  scoring: { document_evidence_weight: 70 },
  documents: { auto_link_min: 0.8, industries: [] },
  matching: { auto_create_invoice: true, require_po: true, require_receipt: true, amount_tolerance_pct: 2, amount_tolerance_abs: 100, tax_tolerance_abs: 1, duplicate_window_days: 730 },
  attachments: { max_mb: 15, max_count: 15, read_attached_emails: true, allowed_ext: ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls', 'csv', 'docx', 'doc', 'xml', 'txt', 'pptx', 'ppt', 'rtf', 'odt', 'eml', 'zip', 'json'] },
}

const raise = error => { if (error) throw new Error(error.message) }
const strip = (row, extra = []) => { const r = { ...row }; for (const k of ['created_at', 'updated_at', 'created_by', 'updated_by', 'organization_id', ...extra]) delete r[k]; return r }

export async function loadConfig() {
  const [cats, docs, rules, aliases, settings, versions] = await Promise.all([
    supabase.from('ei_email_categories').select('*').order('sort_order').order('code'),
    supabase.from('ei_document_types').select('*').order('sort_order').order('code'),
    supabase.from('ei_keyword_rules').select('*').order('weight', { ascending: false }).order('name'),
    supabase.from('ei_vendor_aliases').select('*').order('created_at'),
    supabase.from('ei_settings').select('*').maybeSingle(),
    supabase.from('ei_config_versions').select('id, version, note, restored_from, published_by, published_at').order('version', { ascending: false }).limit(50),
  ])
  for (const r of [cats, docs, rules, aliases, versions]) raise(r.error)
  const acr = await supabase.from('ei_acronyms').select('*').order('acronym').order('expansion').limit(5000)   // STEP269 — optional
  return {
    categories: cats.data || [], document_types: docs.data || [], rules: rules.data || [], vendor_aliases: aliases.data || [],
    acronyms: acr.error ? null : acr.data || [],
    settings: mergeSettings(settings.data?.settings || {}), versions: versions.data || [],
  }
}
export function mergeSettings(s) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  for (const [k, v] of Object.entries(s || {})) out[k] = typeof v === 'object' && !Array.isArray(v) ? { ...(out[k] || {}), ...v } : v
  return out
}

async function save(table, row) {
  const body = strip(row, ['id'])
  const q = row.id ? supabase.from(table).update(body).eq('id', row.id).select().single() : supabase.from(table).insert(body).select().single()
  const { data, error } = await q
  raise(error)
  return data
}
export const saveCategory = row => save('ei_email_categories', row)
export const saveDocumentType = row => save('ei_document_types', row)
export const saveRule = row => save('ei_keyword_rules', row)
export const saveAlias = row => save('ei_vendor_aliases', row)
export const saveAcronym = row => save('ei_acronyms', row)
// Baseline taxonomy (STEP269): ≈500 document types + acronym meanings, into the draft
export async function importBaselineTaxonomy() {
  const { buildBaseline } = await import('../../supabase/functions/_shared/eiTaxonomy.js')
  const { data, error } = await supabase.rpc('ei_import_taxonomy', { p: buildBaseline() })
  if (error) throw new Error(/ei_import_taxonomy|schema cache/i.test(error.message) ? 'Run sql/STEP269_ei_taxonomy_acronyms.sql in the Supabase SQL editor first.' : error.message)
  return data
}
export async function remove(table, id) { const { error } = await supabase.from(table).delete().eq('id', id); raise(error) }
export async function saveSettings(settings) {
  const { error } = await supabase.from('ei_settings').upsert({ settings }, { onConflict: 'organization_id' })
  raise(error)
}
export async function seedDefaults() { const { data, error } = await supabase.rpc('ei_seed_defaults'); raise(error); return data }
export async function configDiff() { const { data, error } = await supabase.rpc('ei_config_diff'); raise(error); return data }
export async function publish(note) { const { data, error } = await supabase.rpc('ei_publish_config', { p_note: note || null }); raise(error); return data }
export async function rollback(version, note) { const { data, error } = await supabase.rpc('ei_rollback_config', { p_version: version, p_note: note || null }); raise(error); return data }
export async function versionSnapshot(id) { const { data, error } = await supabase.from('ei_config_versions').select('snapshot').eq('id', id).single(); raise(error); return data.snapshot }
export async function configAudit(limit = 200) {
  const { data, error } = await supabase.from('ei_config_audit').select('id, entity, entity_id, action, before, after, actor_id, created_at').order('created_at', { ascending: false }).limit(limit)
  raise(error)
  return data || []
}

/* ═══ runtime ═══ */

export async function listExceptions({ status = 'OPEN', kind, limit = 300 } = {}) {
  let q = supabase.from('ei_exceptions').select('*').order('created_at', { ascending: false }).limit(limit)
  if (status) q = q.eq('status', status)
  if (kind) q = kind === 'CATEGORY_REVIEW' ? q.like('kind', 'CATEGORY_REVIEW:%') : q.eq('kind', kind)
  const { data, error } = await q
  raise(error)
  return data || []
}
export async function exceptionCounts() {
  const { data, error } = await supabase.from('ei_exceptions').select('kind, priority').eq('status', 'OPEN').limit(5000)
  raise(error)
  return data || []
}
export async function resolveException(id, status, note) { const { error } = await supabase.rpc('ei_resolve_exception', { p_id: id, p_status: status, p_note: note }); raise(error) }
export async function assignException(id, userId) { const { error } = await supabase.rpc('ei_assign_exception', { p_id: id, p_user: userId || null }); raise(error) }
export async function reviewCreateInvoice(attachmentId, payload, note) {
  const { data, error } = await supabase.rpc('ei_review_create_invoice', { p_attachment: attachmentId, p: payload, p_note: note })
  raise(error)
  return data
}

export async function listAttachments({ messageIds, ids, limit = 300 } = {}) {
  let q = supabase.from('ei_attachments').select('id, message_id, file_name, content_type, size_bytes, storage_path, status, skip_reason, text_method, doc_type_code, doc_confidence, doc_rules, extraction, extraction_confidence, validations, vendor_id, vendor_method, vendor_confidence, po_id, grn_ids, project_id, duplicate_of_invoice_id, invoice_id, outcome, outcome_reason, config_version, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (messageIds?.length) q = q.in('message_id', messageIds)
  if (ids?.length) q = q.in('id', ids)
  const { data, error } = await q
  raise(error)
  return data || []
}
export async function attachmentUrl(path) {
  const { data, error } = await supabase.storage.from('email-attachments').createSignedUrl(path, 300)
  raise(error)
  return data.signedUrl
}
export async function emailsByIds(ids) {
  if (!ids.length) return {}
  const { data } = await supabase.from('outlook_email_messages').select('id, subject, sender_email, sender_name, received_at, web_link, intents, status, body_excerpt, vendor_id').in('id', [...new Set(ids)])
  return Object.fromEntries((data || []).map(m => [m.id, m]))
}
export async function procurementLookups() {
  const [vendors, pos, projects] = await Promise.all([
    supabase.from('vendors').select('id, name, code, gst_number, email, status').order('name').limit(5000),
    supabase.from('purchase_orders').select('id, po_number, vendor_id, project_id, status, total_amount').order('created_at', { ascending: false }).limit(2000),
    supabase.from('projects').select('id, code, name, status').order('name'),
  ])
  return { vendors: vendors.data || [], pos: pos.data || [], projects: projects.data || [] }
}
export async function invoicesByIds(ids) {
  const u = [...new Set(ids.filter(Boolean))]
  if (!u.length) return {}
  const { data } = await supabase.from('invoices').select('id, invoice_number, total_amount, status, match_status').in('id', u)
  return Object.fromEntries((data || []).map(i => [i.id, i]))
}

// Read a File for the dry-run tester (base64 without the data: prefix)
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
export async function dryRun({ email, attachments = [], usePublished = false }) {
  return syncAction('dry_run', { email, attachments, use_published: usePublished })
}

// KPI: invoices that entered the register from email in the last 30 days
export async function invoicesFromEmailCount() {
  const { count, error } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
    .not('source_email_id', 'is', null).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
  if (error) return null
  return count ?? 0
}

/* ═══ document register (STEP268) ═══ */
const REGISTER_COLS = 'id, message_id, file_name, content_type, size_bytes, storage_path, status, text_method, doc_type_code, doc_confidence, extraction, extraction_confidence, vendor_id, po_id, invoice_id, project_id, title, document_number, document_date, revision, area, primary_module, related_modules, project_status, project_method, project_confidence, project_candidates, project_reason, review_state, filed_at, created_at'
const needsStep = e => (e && /review_state|project_status|ei_project_documents|ei_document_set|schema cache|does not exist/i.test(e.message)
  ? new Error('Run sql/STEP268_ei_document_register.sql in the Supabase SQL editor first.') : e)

export async function projectDocuments(projectId, includeSuggested = false) {
  const { data, error } = await supabase.rpc('ei_project_documents', { p_project: projectId, p_include_suggested: includeSuggested })
  if (error) throw needsStep(error)
  return data || []
}
export async function listDocumentsForReview({ limit = 500 } = {}) {
  const { data, error } = await supabase.from('ei_attachments').select(REGISTER_COLS)
    .eq('status', 'PROCESSED').neq('review_state', 'OK').order('created_at', { ascending: false }).limit(limit)
  if (error) throw needsStep(error)
  return data || []
}
export async function documentReviewCount() {
  const { data, error } = await supabase.rpc('ei_document_counts')
  if (error) return null
  return (data || []).filter(r => r.review_state !== 'OK').reduce((s, r) => s + Number(r.n), 0)
}
export async function setDocumentProject(id, projectId, note) {
  const { error } = await supabase.rpc('ei_document_set_project', { p_id: id, p_project: projectId || null, p_note: note || null })
  if (error) throw needsStep(error)
}
export async function setDocumentType(id, code, note) {
  const { error } = await supabase.rpc('ei_document_set_type', { p_id: id, p_code: code, p_note: note || null })
  if (error) throw needsStep(error)
}
export async function documentTypeOptions() {
  const { data } = await supabase.from('ei_document_types').select('code, name, is_active').order('name')
  return (data || []).filter(d => d.is_active !== false)
}

/* ═══ new document type suggestions (STEP270) ═══ */
export async function listTypeSuggestions(status = 'PENDING') {
  let q = supabase.from('ei_type_suggestions').select('*').order('last_seen_at', { ascending: false }).limit(300)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(/ei_type_suggestions|schema cache|does not exist/i.test(error.message) ? 'Run sql/STEP270_ei_type_discovery.sql in the Supabase SQL editor first.' : error.message)
  return data || []
}
export async function pendingSuggestionCount() {
  const { count, error } = await supabase.from('ei_type_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING')
  return error ? null : count
}
export async function decideTypeSuggestion(id, action, { target = null, type = {}, note = null, retype = true } = {}) {
  const { data, error } = await supabase.rpc('ei_decide_type_suggestion', { p_id: id, p_action: action, p_target: target, p_type: type, p_note: note, p_retype: retype })
  raise(error)
  return data
}

/* ═══ document versions (STEP271) ═══ */
export async function documentVersions(id) {
  const { data, error } = await supabase.rpc('ei_document_versions', { p_id: id })
  if (error) return null   // STEP271 not run yet
  return data || []
}
export async function versionSuggestions() {
  const { data, error } = await supabase.rpc('ei_version_suggestions')
  if (error) throw new Error(/ei_version_suggestions|schema cache/i.test(error.message) ? 'Run sql/STEP271_ei_document_versions.sql in the Supabase SQL editor first.' : error.message)
  return data || []
}
export async function decideVersion(id, accept, note) {
  const { error } = await supabase.rpc('ei_document_version_decide', { p_id: id, p_accept: accept, p_note: note || null })
  raise(error)
}

/* ═══ lifecycle templates + project compliance register (STEP272) ═══ */
const needs272 = e => (e && /ei_project_register|ei_lifecycle|ei_register|schema cache|does not exist/i.test(e.message)
  ? new Error('Run sql/STEP272_ei_compliance_register.sql in the Supabase SQL editor first.') : e)
export async function lifecycleTemplates() {
  const { data, error } = await supabase.from('ei_lifecycle_templates').select('id, key, name, sector, authority, department, country, description, is_active').order('name')
  if (error) throw needs272(error)
  return data || []
}
export async function importLifecycleTemplates() {
  const { LIFECYCLE_TEMPLATES, parseRequirement } = await import('../../supabase/functions/_shared/eiLifecycleData.js')
  const p = LIFECYCLE_TEMPLATES.map(t => ({ key: t.key, name: t.name, sector: t.sector, description: t.description,
    stages: t.stages.map(([name, reqs]) => ({ name, requirements: reqs.map(parseRequirement) })) }))
  const { data, error } = await supabase.rpc('ei_import_lifecycle_templates', { p })
  if (error) throw needs272(error)
  return data
}
export async function loadRegister(projectId) {
  const { data: reg, error } = await supabase.from('ei_project_registers').select('*').eq('project_id', projectId).maybeSingle()
  if (error) throw needs272(error)
  if (!reg) return null
  const [st, it] = await Promise.all([
    supabase.from('ei_project_register_stages').select('*').eq('register_id', reg.id).order('seq'),
    supabase.from('ei_project_register_items').select('*').eq('register_id', reg.id).order('sort_order'),
  ])
  raise(st.error); raise(it.error)
  return { register: reg, stages: st.data || [], items: it.data || [] }
}
export async function createRegister(projectId, templateId) {
  const { data, error } = await supabase.rpc('ei_create_project_register', { p_project: projectId, p_template: templateId || null })
  if (error) throw needs272(error)
  return data
}
export async function saveRegisterItem(row) {
  const body = { ...row }
  for (const k of ['id', 'updated_by', 'updated_at', 'approved_by', 'approved_at', 'organization_id', 'docs', 'latest', 'state', 'expiry', 'expiryState', 'daysToExpiry', 'done', 'overdue']) delete body[k]
  const q = row.id ? supabase.from('ei_project_register_items').update(body).eq('id', row.id) : supabase.from('ei_project_register_items').insert(body)
  const { error } = await q
  raise(error)
}
export async function deleteRegisterItem(id) { const { error } = await supabase.from('ei_project_register_items').delete().eq('id', id); raise(error) }
export async function registerOverview() {
  const { data, error } = await supabase.rpc('ei_register_overview')
  if (error) throw needs272(error)
  return data || []
}

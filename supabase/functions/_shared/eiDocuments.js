// Email Intelligence — document register rules (STEP268). Import-free, so the
// worker (Deno), the web app and node tests all use the same code
// (src/lib/eiDocuments.test.mjs).
//
// Every attachment row in ei_attachments is the ONE canonical document record:
// its type, its project (with how sure we are), the workspace area it is filed
// under on the project, and the app modules it relates to. Nothing here
// approves anything — mapping a document never changes the business record.

// Project document workspace areas (brief §10)
export const AREAS = [
  { key: 'CORRESPONDENCE', label: 'Client & government correspondence' },
  { key: 'TENDER_CONTRACT', label: 'Tendering & contracts' },
  { key: 'ENGINEERING', label: 'Engineering & design' },
  { key: 'PROCUREMENT', label: 'Procurement & vendors' },
  { key: 'SITE', label: 'Construction & site execution' },
  { key: 'LOGISTICS', label: 'Logistics & material' },
  { key: 'QUALITY', label: 'Quality & inspections' },
  { key: 'FINANCE', label: 'Finance, billing & payment' },
  { key: 'SAFETY_COMPLIANCE', label: 'Safety, permits & compliance' },
  { key: 'PM_REPORTING', label: 'Project management & reporting' },
  { key: 'OPERATIONS', label: 'IT, operations & maintenance' },
  { key: 'HANDOVER', label: 'Approvals, handover & closure' },
  { key: 'OTHER', label: 'Other documents' },
]
export const AREA_KEYS = AREAS.map(a => a.key)
export const areaLabel = k => AREAS.find(a => a.key === k)?.label || 'Other documents'

// Default filing for the STEP264 document types, used until an admin sets
// area / modules on the type (ei_document_types.area, primary_module, related_modules).
// Module keys are the app's real keys from src/config/modules.js.
export const DOC_TYPE_MAPPING = {
  TAX_INVOICE: ['FINANCE', 'invoices', ['procurement', 'projects']],
  PROFORMA_INVOICE: ['FINANCE', 'invoices', ['procurement']],
  REVISED_INVOICE: ['FINANCE', 'invoices', ['procurement']],
  CREDIT_NOTE: ['FINANCE', 'invoices', ['payments']],
  DEBIT_NOTE: ['FINANCE', 'invoices', ['payments']],
  PURCHASE_ORDER: ['PROCUREMENT', 'pos', ['procurement', 'projects']],
  PURCHASE_REQUISITION: ['PROCUREMENT', 'procurement', ['projects']],
  QUOTATION: ['PROCUREMENT', 'procurement', ['vendors']],
  GOODS_RECEIPT_NOTE: ['LOGISTICS', 'grn', ['pos', 'inventory']],
  DELIVERY_CHALLAN: ['LOGISTICS', 'delivery-notes', ['grn', 'pos']],
  PACKING_LIST: ['LOGISTICS', 'delivery-notes', ['grn']],
  PROOF_OF_DELIVERY: ['LOGISTICS', 'delivery-notes', ['projects', 'customer-invoices']],
  PAYMENT_ADVICE: ['FINANCE', 'payments', ['invoices']],
  VENDOR_STATEMENT: ['FINANCE', 'invoices', ['vendors', 'payments']],
  BANK_CONFIRMATION: ['FINANCE', 'vendors', ['payments']],
  TAX_CERTIFICATE: ['FINANCE', 'vendors', ['invoices']],
  VENDOR_REGISTRATION: ['PROCUREMENT', 'vendors', []],
  CONTRACT: ['TENDER_CONTRACT', 'projects', ['vendors', 'customers']],
  PURCHASE_AGREEMENT: ['TENDER_CONTRACT', 'procurement', ['vendors']],
  WORK_ORDER: ['TENDER_CONTRACT', 'projects', ['pos']],
  COMPLETION_CERTIFICATE: ['HANDOVER', 'projects', ['customer-invoices']],
  MEASUREMENT_SHEET: ['SITE', 'projects', ['customer-invoices']],
  PROJECT_EXPENSE_EVIDENCE: ['FINANCE', 'expenses', ['projects']],
  SERVICE_REPORT: ['OPERATIONS', 'projects', ['golive-support']],
  MAINTENANCE_REPORT: ['OPERATIONS', 'assets', ['projects']],
  WARRANTY_DOCUMENT: ['OPERATIONS', 'warranty', ['assets']],
  INSURANCE_CERTIFICATE: ['SAFETY_COMPLIANCE', 'vendors', ['projects']],
  COMPLIANCE_CERTIFICATE: ['SAFETY_COMPLIANCE', 'projects', ['vendors']],
  SPREADSHEET: ['OTHER', null, []],
  SUPPORTING_PHOTOGRAPH: ['SITE', 'projects', []],
  GENERAL_ATTACHMENT: ['OTHER', null, []],
  UNKNOWN_DOCUMENT: ['OTHER', null, []],
}

export function mappingFor(dt, code = dt?.code) {
  const d = DOC_TYPE_MAPPING[code] || ['OTHER', null, []]
  const area = AREA_KEYS.includes(dt?.area) ? dt.area : d[0]
  const primary = dt?.primary_module || d[1]
  const related = (Array.isArray(dt?.related_modules) && dt.related_modules.length ? dt.related_modules : d[2]).filter(m => m && m !== primary)
  return { area, primary_module: primary, related_modules: [...new Set(related)] }
}

const first = (fields, keys) => {
  for (const k of keys) { const v = fields?.[k]?.value; if (v != null && String(v).trim() !== '') return String(v).trim() }
  return null
}
const NUMBER_KEYS = ['document_number', 'invoice_number', 'credit_note_number', 'debit_note_number', 'po_number', 'grn_number', 'challan_number', 'work_order_number', 'contract_number', 'reference_number', 'certificate_number', 'quotation_number']
const DATE_KEYS = ['document_date', 'invoice_date', 'po_date', 'grn_date', 'challan_date', 'issue_date', 'effective_date', 'date']
const REV = /\b(?:rev(?:ision)?|version|ver|v)[\s.:\-#]*([0-9]{1,3}[a-z]?|[a-z])\b/i

// Header data that is common to every document, from extraction + file name.
// Null when not found — never guessed.
export function documentMeta({ fields = {}, fileName = '', ai = {} }) {
  const dateRaw = first(fields, DATE_KEYS) || (ai.document_date ? String(ai.document_date) : null)
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null
  const revFrom = first(fields, ['revision', 'version']) || (String(fileName).replace(/_+/g, ' ').match(REV) || [])[1] || ai.revision || null
  const title = (ai.title && String(ai.title).trim()) || String(fileName || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim() || null
  return {
    title: title ? title.slice(0, 200) : null,
    document_number: (first(fields, NUMBER_KEYS) || (ai.document_number ? String(ai.document_number) : null))?.slice(0, 120) || null,
    document_date: date,
    revision: revFrom ? String(revFrom).toUpperCase().slice(0, 20) : null,
  }
}

// Decide a document's project.
//   poProjectId — project of the PO the document was matched to (strongest)
//   match       — outlookMatcher.matchProject() result for email + document text
// status: MATCHED (auto-filed) | SUGGESTED (likely, needs confirmation) |
//         AMBIGUOUS (several candidates) | UNASSIGNED (nothing found)
export function resolveDocumentProject({ poProjectId = null, match = null, settings = {} }) {
  const autoMin = Number(settings?.documents?.auto_link_min ?? 0.8)
  if (poProjectId) return { project_id: poProjectId, status: 'MATCHED', method: 'PO', confidence: 0.95, candidates: [], reason: 'Project of the matched purchase order' }
  if (!match) return { project_id: null, status: 'UNASSIGNED', method: null, confidence: 0, candidates: [], reason: 'Project matching not run' }
  const candidates = (match.candidates || []).slice(0, 10)
  if (match.status === 'MATCHED' && match.project) {
    const conf = Number(match.confidence || 0)
    return conf >= autoMin
      ? { project_id: match.project.id, status: 'MATCHED', method: match.method, confidence: conf, candidates, reason: match.reason }
      : { project_id: match.project.id, status: 'SUGGESTED', method: match.method, confidence: conf, candidates, reason: `${match.reason} — below the ${Math.round(autoMin * 100)}% auto-file level` }
  }
  if (match.status === 'AMBIGUOUS') return { project_id: null, status: 'AMBIGUOUS', method: null, confidence: 0, candidates, reason: match.reason }
  return { project_id: null, status: 'UNASSIGNED', method: null, confidence: 0, candidates, reason: match.reason || 'No project found' }
}

// What a person still has to look at for this document.
export function reviewStateFor({ docCode, docConfidence, threshold = 0.75, projectStatus }) {
  const typeOk = docCode && docCode !== 'UNKNOWN_DOCUMENT' && Number(docConfidence || 0) >= Number(threshold)
  const projOk = ['MATCHED', 'CONFIRMED'].includes(projectStatus)
  return typeOk && projOk ? 'OK' : !typeOk && !projOk ? 'NEEDS_BOTH' : !typeOk ? 'NEEDS_TYPE' : 'NEEDS_PROJECT'
}
export const REVIEW_LABEL = { OK: 'Filed', NEEDS_TYPE: 'Type to confirm', NEEDS_PROJECT: 'Project to confirm', NEEDS_BOTH: 'Type & project to confirm' }
export const PROJECT_STATUS_LABEL = { MATCHED: 'Auto-filed', CONFIRMED: 'Confirmed', SUGGESTED: 'Suggested', AMBIGUOUS: 'Several candidates', UNASSIGNED: 'No project' }

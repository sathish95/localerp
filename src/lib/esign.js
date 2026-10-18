// Agreements & e-Sign (STEP273) — data access. Writes to a document only work
// while it is a DRAFT (RLS); everything after "Send" goes through the RPCs.
import { supabase } from './supabase'
import { bytesToBase64, base64ToBytes } from './esignPdf'

export const SIGNER_COLS = 'id, document_id, seq, name, email, role_label, profile_id, status, notified_at, viewed_at, signed_at, typed_name, signature_kind, signature_png, ip, user_agent, decline_reason, created_at'
const LIST_SIGNER_COLS = 'id, seq, name, email, role_label, profile_id, status, signed_at'

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data }

export async function listDocuments() {
  return must(await supabase.from('esign_documents')
    .select(`id, doc_number, title, doc_type, source, status, counterparty_name, counterparty_kind, project_id, contract_value, currency,
             effective_date, end_date, sign_by, sent_at, completed_at, created_by, created_at, updated_at, esign_signers(${LIST_SIGNER_COLS})`)
    .order('updated_at', { ascending: false }).limit(500))
}

export async function loadDocument(id) {
  const [doc, signers, events] = await Promise.all([
    supabase.from('esign_documents').select('*').eq('id', id).single(),
    supabase.from('esign_signers').select(SIGNER_COLS).eq('document_id', id).order('seq').order('created_at'),
    supabase.from('esign_events').select('id, signer_id, actor_id, event, detail, ip, at').eq('document_id', id).order('at'),
  ])
  return { doc: must(doc), signers: must(signers), events: must(events) }
}

const DOC_FIELDS = ['title', 'doc_type', 'source', 'template_key', 'content', 'fields', 'file_name', 'counterparty_kind', 'counterparty_id',
  'counterparty_name', 'project_id', 'contract_value', 'currency', 'effective_date', 'end_date', 'signing_order', 'require_otp', 'message', 'sign_by']
const pick = d => Object.fromEntries(DOC_FIELDS.filter(k => k in d).map(k => [k, d[k] === '' ? null : d[k]]))

// Save the draft and replace its signer list.
export async function saveDraft(draft, signers) {
  let id = draft.id
  if (id) must(await supabase.from('esign_documents').update(pick(draft)).eq('id', id).select('id'))
  else id = must(await supabase.from('esign_documents').insert(pick(draft)).select('id').single()).id
  const existing = must(await supabase.from('esign_signers').select('id').eq('document_id', id)).map(r => r.id)
  const keep = new Set(signers.filter(s => s.id).map(s => s.id))
  const drop = existing.filter(x => !keep.has(x))
  if (drop.length) must(await supabase.from('esign_signers').delete().in('id', drop))
  for (const [i, s] of signers.entries()) {
    const row = { seq: Number(s.seq) || i + 1, name: s.name.trim(), email: s.email.trim().toLowerCase(), role_label: s.role_label || null, profile_id: s.profile_id || null }
    if (s.id && existing.includes(s.id)) must(await supabase.from('esign_signers').update(row).eq('id', s.id).select('id'))
    else must(await supabase.from('esign_signers').insert({ ...row, document_id: id }).select('id'))
  }
  return id
}

export async function uploadPdf(docId, file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  return must(await supabase.rpc('esign_set_file', { p_doc: docId, p_file_name: file.name, p_base64: bytesToBase64(bytes) }))
}
export async function fileBytes(docId) {
  const b64 = must(await supabase.rpc('esign_file_base64', { p_doc: docId }))
  return b64 ? base64ToBytes(b64) : null
}

/* ── received documents (Email Intelligence) → agreement (STEP275) ── */
const TYPE_FROM_CODE = [
  [/NDA|NON_DISCLOSURE|CONFIDENTIALITY/, 'NDA'], [/EPC/, 'EPC_CONTRACT'], [/WORK_ORDER/, 'WORK_ORDER'],
  [/PURCHASE_ORDER/, 'PURCHASE_ORDER'], [/STATEMENT_OF_WORK|(^|_)SOW(_|$)/, 'SOW'], [/MASTER_SERVICE|(^|_)MSA(_|$)/, 'MSA'],
  [/AMENDMENT|ADDENDUM/, 'AMENDMENT'], [/AGREEMENT|CONTRACT/, 'AGREEMENT'],
]
const agreementType = code => (TYPE_FROM_CODE.find(([re]) => re.test(code || '')) || [null, 'OTHER'])[1]
const isPdf = att => att.content_type === 'application/pdf' || /\.pdf$/i.test(att.file_name || '')

// Returns the agreement id for a received document, creating the draft from
// its PDF the first time. Throws { code: 'NOT_PDF' | 'NOT_ALLOWED' } when the
// caller should just open the file instead.
export async function agreementFromAttachment(att, { projectId } = {}) {
  const { data: found } = await supabase.from('esign_documents').select('id').eq('source_attachment_id', att.id).limit(1)
  if (found?.length) return found[0].id
  if (!isPdf(att)) throw Object.assign(new Error('Only PDF documents can be signed'), { code: 'NOT_PDF' })
  const { data: blob, error: dlErr } = await supabase.storage.from('email-attachments').download(att.storage_path)
  if (dlErr) throw new Error(dlErr.message)
  const { data: doc, error } = await supabase.from('esign_documents').insert({
    title: att.title || String(att.file_name || 'Document').replace(/\.pdf$/i, ''),
    doc_type: agreementType(att.doc_type_code), source: 'UPLOAD', file_name: att.file_name,
    project_id: att.project_id || projectId || null, source_attachment_id: att.id,
    counterparty_kind: 'OTHER', counterparty_name: att.sender_name || null,
    effective_date: att.document_date || null, signing_order: 'SEQUENTIAL', require_otp: true,
  }).select('id').single()
  if (error) {
    if (error.code === '23505') return agreementFromAttachment(att, { projectId })        // created meanwhile
    if (error.code === '42501' || /row-level security|permission/i.test(error.message)) throw Object.assign(new Error(error.message), { code: 'NOT_ALLOWED' })
    throw new Error(error.message)
  }
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    must(await supabase.rpc('esign_set_file', { p_doc: doc.id, p_file_name: att.file_name || 'document.pdf', p_base64: bytesToBase64(bytes) }))
  } catch (e) {
    await supabase.from('esign_documents').delete().eq('id', doc.id)   // no half-made draft
    throw e
  }
  return doc.id
}

export const sendDocument = async id => must(await supabase.rpc('esign_send', { p_doc: id }))
export const remindSigner = async id => must(await supabase.rpc('esign_remind', { p_signer: id }))
export const cancelDocument = async (id, reason) => must(await supabase.rpc('esign_cancel', { p_doc: id, p_reason: reason }))
export const deleteDraft = async id => must(await supabase.from('esign_documents').delete().eq('id', id))
export const myToken = async docId => must(await supabase.rpc('esign_my_signing_token', { p_doc: docId }))
export async function signingLink(signerId) {
  const path = must(await supabase.rpc('esign_signing_link', { p_signer: signerId }))
  return `${window.location.origin}${path}`
}

/* ── custom templates ── */
export const listTemplates = async () => must(await supabase.from('esign_templates').select('*').eq('is_active', true).order('name'))
export async function saveTemplate(t) {
  const row = { name: t.name, doc_type: t.doc_type, body: t.body, fields: t.fields || [], updated_at: new Date().toISOString() }
  return t.id ? must(await supabase.from('esign_templates').update(row).eq('id', t.id).select().single())
    : must(await supabase.from('esign_templates').insert(row).select().single())
}
export const archiveTemplate = async id => must(await supabase.from('esign_templates').update({ is_active: false }).eq('id', id))

/* ── public signing (anon) ── */
export const publicGet = async token => must(await supabase.rpc('esign_public_get', { p_token: token }))
export async function publicFile(token) {
  const b64 = must(await supabase.rpc('esign_public_file', { p_token: token }))
  return b64 ? base64ToBytes(b64) : null
}
export const publicSendCode = async token => must(await supabase.rpc('esign_public_send_code', { p_token: token }))
export const publicSign = async (token, p) => must(await supabase.rpc('esign_public_sign', {
  p_token: token, p_code: p.code || null, p_typed_name: p.typedName, p_signature_png: p.png, p_kind: p.kind, p_consent: !!p.consent,
  p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
}))
export const publicDecline = async (token, reason) => must(await supabase.rpc('esign_public_decline', { p_token: token, p_reason: reason }))

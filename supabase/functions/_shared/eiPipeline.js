// Email Intelligence pipeline (STEP263–265): one email → attachments stored
// and classified independently → intents → per-document extraction,
// vendor / PO / GRN / duplicate checks → invoice intake or typed exceptions.
//
// Every side effect is injected (`deps`), so the SAME code runs:
//   • live in outlook-sync (Graph + Supabase),
//   • in simulation (Settings → Email Intelligence → Test) with simulate=true:
//     nothing is stored, no invoice / exception / notification is written,
//   • under node --test with mocks.
//
// It never approves, posts or pays; invoices enter the existing register as
// 'uploaded' through ei_create_invoice(), which re-checks everything in SQL.

import { detectInjection } from './outlookClassifier.js'
import {
  classifyIntents, mergeIntent, classifyDocument, extractWithPatterns, normalizeAiFields, mergeFields, validateExtraction,
  extractionConfidence, identifyVendor, matchPO, matchReceipts, checkAmounts, findDuplicates, decideInvoice, fieldValue, extOf,
} from './eiEngine.js'
import { aiClassifyIntent, aiAnalyzeDocument } from './eiAI.js'
import { matchProject, resolveCustomer } from './outlookMatcher.js'
import { matchTaxonomy, codeFor } from './eiTaxonomy.js'
import { mappingFor, documentMeta, resolveDocumentProject, reviewStateFor } from './eiDocuments.js'
import { relateDocument } from './eiVersions.js'

const IMAGE = /^image\//i
const safeName = n => String(n || 'file').replace(/[^\w.\-]+/g, '_').slice(-120)
const INVOICE_LIKE = ['INVOICE_REGISTER', 'CREDIT_NOTE_REVIEW']

/**
 * @param p.row      outlook_email_messages row (id, organization_id, mailbox_id)
 * @param p.email    normalized email (subject, body, senderEmail, senderName, receivedAt)
 * @param p.config   published snapshot {categories, document_types, rules, vendor_aliases, settings}
 * @param p.version  published version number
 * @param p.deps     see README in this file's header comment
 * @param p.simulate true = read-only dry run
 */
export async function runEmailIntelligence({ row, email, config, version, deps, simulate = false, today }) {
  const s = config.settings || {}
  const lim = s.attachments || {}
  const maxBytes = Number(lim.max_mb ?? 15) * 1024 * 1024
  const allowed = new Set((lim.allowed_ext || []).map(x => String(x).toLowerCase()))
  const ai = deps.ai?.provider && deps.ai?.apiKey ? deps.ai : null
  const report = { version, attachments: [], exceptions: [], invoices: [], notes: [] }
  const exceptions = []
  const raise = (kind, summary, extra = {}) => exceptions.push({ kind, summary, priority: 'medium', ...extra })
  const injectionInEmail = detectInjection(`${email.subject}\n${email.body}`)

  // ── 1. attachments: store, checksum, read text ──
  // ZIP archives and attached emails are opened (after validation) and each
  // file inside becomes its own document (one level deep). Files that cannot
  // be read (password-protected, damaged, unsafe, unsupported) are recorded
  // with the reason and raised for review — never silently dropped.
  const listed = deps.attachments ? await deps.attachments.list() : []
  const files = []
  const maxCount = Number(lim.max_count ?? 15)
  const readItems = lim.read_attached_emails !== false && !!deps.text?.expand
  let seen = 0
  const unreadable = async (saved, name, reason) => {
    if (!simulate) await deps.db.updateAttachment(saved.id, { status: 'SKIPPED', skip_reason: reason })
    report.attachments.push({ ...saved, status: 'SKIPPED', outcome: 'SKIPPED', outcome_reason: reason })
    raise('DOCUMENT_REVIEW', `${name}: ${reason}`, { attachmentId: saved.id, role: 'manager' })
  }
  // store + checksum + text; container = true keeps a ZIP itself out of the document list
  async function ingest(saved, name, contentType, bytes, ext, { container = false, textOverride = null } = {}) {
    const sha256 = await deps.sha256(bytes)
    let storage_path = saved.storage_path || null
    if (!simulate && !storage_path) {
      storage_path = `${row.organization_id}/${row.id}/${saved.id}-${safeName(name)}`
      await deps.storage.put(storage_path, bytes, contentType)
    }
    let text = textOverride || '', method = textOverride ? 'CONTAINER' : 'NONE'
    if (!textOverride) {
      try { ({ text, method } = await deps.text.extract(bytes, ext, contentType)) }
      catch (e) {
        if (e?.code && ['ENCRYPTED', 'CORRUPT', 'UNSUPPORTED', 'BAD_PATH', 'BOMB', 'TOO_LARGE', 'TOO_MANY'].includes(e.code)) {
          if (!simulate) await deps.db.updateAttachment(saved.id, { sha256, storage_path })
          return unreadable({ ...saved, storage_path }, name, String(e.message || e).slice(0, 200))
        }
        report.notes.push(`${name}: could not read text (${String(e.message || e).slice(0, 80)})`)
      }
    }
    if (container) {
      if (!simulate) await deps.db.updateAttachment(saved.id, { status: 'PROCESSED', sha256, storage_path, text_method: 'ARCHIVE', text_excerpt: String(text || '').slice(0, 20000), outcome: 'RECORDED', outcome_reason: 'Archive opened — each file inside is its own document', config_version: version })
      report.attachments.push({ ...saved, file_name: name, sha256, outcome: 'RECORDED', outcome_reason: 'Archive opened — each file inside is its own document' })
      return
    }
    files.push({ ...saved, file_name: name, content_type: contentType, sha256, storage_path, text: String(text || '').slice(0, 20000), text_method: method, bytes })
  }
  const precheck = (name, size, ext, kind) => {
    if (seen >= maxCount) return `More than ${maxCount} attachments`
    if (kind !== 'item' && allowed.size && !allowed.has(ext)) return `File type .${ext || '?'} is not enabled`
    if (Number(size || 0) > maxBytes) return `Larger than ${lim.max_mb ?? 15} MB`
    return null
  }

  for (const a of listed) {
    const isItem = a.kind === 'item'
    const name = isItem && !/\.eml$/i.test(a.name || '') ? `${a.name || 'Attached email'}.eml` : a.name
    const ext = isItem ? 'eml' : extOf(a.name)
    let skip = null
    if (a.isInline && IMAGE.test(a.contentType || '')) skip = 'Inline image (signature / logo)'
    else if (a.kind === 'reference') skip = 'Link to a cloud file — open it from the email'
    else if (isItem && !readItems) skip = 'Attached email — open it in Outlook'
    else if (a.kind && !['file', 'item'].includes(a.kind)) skip = 'Unsupported attachment kind'
    else skip = precheck(name, a.size, ext, a.kind)
    const rec = { graph_attachment_id: a.id, file_name: name, content_type: isItem ? 'message/rfc822' : a.contentType, size_bytes: a.size || null, status: skip ? 'SKIPPED' : 'PENDING', skip_reason: skip }
    const saved = simulate ? { id: `sim-${seen + report.attachments.length}`, ...rec } : await deps.db.upsertAttachment(row, rec)
    if (skip) { report.attachments.push({ ...saved, outcome: 'SKIPPED', outcome_reason: skip }); continue }
    seen++
    try {
      const bytes = await deps.attachments.fetchBytes(a)
      if (bytes.length > maxBytes) throw new Error(`Larger than ${lim.max_mb ?? 15} MB`)
      const isContainer = deps.text?.expand && (ext === 'zip' || ext === 'eml')
      if (!isContainer) { await ingest(saved, name, rec.content_type, bytes, ext); continue }
      let box
      try { box = await deps.text.expand(bytes, ext, rec.content_type) }
      catch (e) { if (e?.code) { await unreadable(saved, name, String(e.message || e).slice(0, 200)); continue } throw e }
      // an attached email is itself a document (correspondence); a ZIP is only a container
      await ingest(saved, name, rec.content_type, bytes, ext, { container: ext === 'zip', textOverride: box.text })
      let i = 0
      for (const c of box.children) {
        i++
        const cext = extOf(c.name)
        const crec = { graph_attachment_id: `${a.id}#${i}`, file_name: c.name, content_type: c.contentType, size_bytes: c.bytes.length, status: 'PENDING', skip_reason: null }
        const cskip = precheck(c.name, c.bytes.length, cext, 'file') || (['zip', 'eml', 'msg'].includes(cext) ? 'Archive or email inside an archive — open it manually' : null)
        crec.status = cskip ? 'SKIPPED' : 'PENDING'; crec.skip_reason = cskip
        const csaved = simulate ? { id: `sim-${seen + report.attachments.length}-${i}`, ...crec } : await deps.db.upsertAttachment(row, crec)
        if (cskip) { report.attachments.push({ ...csaved, outcome: 'SKIPPED', outcome_reason: cskip }); continue }
        seen++
        try { await ingest(csaved, c.name, c.contentType, c.bytes, cext) }
        catch (e) {
          const err = String(e?.message || e).slice(0, 300)
          if (!simulate) await deps.db.updateAttachment(csaved.id, { status: 'FAILED', skip_reason: err })
          report.attachments.push({ ...csaved, status: 'FAILED', outcome: 'SKIPPED', outcome_reason: err })
        }
      }
    } catch (e) {
      const err = String(e?.message || e).slice(0, 300)
      if (!simulate) await deps.db.updateAttachment(saved.id, { status: 'FAILED', skip_reason: err })
      report.attachments.push({ ...saved, status: 'FAILED', outcome: 'SKIPPED', outcome_reason: err })
    }
  }

  // ── 2. sender-level vendor (for vendor-scoped rules) ──
  const vendors = await deps.lookup.vendors()
  const contacts = await deps.lookup.contacts()
  const aliases = config.vendor_aliases || []
  const senderVendor = identifyVendor({ senderEmail: email.senderEmail, vendors, aliases, contacts })

  // ── 3. documents: type of each file ──
  // Each attachment is classified on its own (file content only).
  const docTypes = Object.fromEntries((config.document_types || []).map(d => [d.code, d]))
  const sctx = { vendorId: senderVendor.vendor?.id || null }
  // Project context (STEP268) — also scopes client-specific acronym meanings (STEP269)
  const projCtx = deps.lookup.projectContext ? await deps.lookup.projectContext().catch(() => null) : null
  const senderCustomer = projCtx ? resolveCustomer(email.senderEmail, projCtx).customer : null
  const acronyms = (config.acronyms || []).filter(a => a.is_active !== false)
  for (const f of files) {
    let dc = classifyDocument(f, sctx, config, { today })
    // keyword rules first; when none fired (or weakly), the taxonomy reads the title zone
    if (dc.source === 'fallback' || dc.confidence < 0.7) {
      const tx = matchTaxonomy(f, config.document_types || [], acronyms, { customerId: senderCustomer?.id || null, industries: config.settings?.documents?.industries || [] })
      if (tx?.ambiguous?.length) report.notes.push(`${f.file_name}: acronym ${tx.ambiguous.join(', ')} has several meanings here — not used to decide the type`)
      if (tx?.code && tx.confidence > (dc.source === 'fallback' ? 0 : dc.confidence)) {
        dc = { code: tx.code, confidence: tx.confidence, rules: tx.rules, alternatives: [...tx.alternatives, dc.code].filter(Boolean), source: 'taxonomy' }
      }
    }
    let aiDoc = null
    const wantAiDoc = ai && s.ai?.classify_documents !== false
    const lowDoc = !dc.code || dc.confidence < Number(docTypes[dc.code]?.confidence_threshold ?? 0.75)
    const needsFields = dc.code && (docTypes[dc.code]?.fields || []).length > 0
    if (wantAiDoc && (lowDoc || (needsFields && s.ai?.extract_fields !== false))) {
      try {
        aiDoc = await aiAnalyzeDocument(f, config, { provider: ai.provider, apiKey: ai.apiKey, fetchImpl: ai.fetchImpl, model: ai.model, base64: ai.provider === 'claude' || ai.provider === 'gemini' ? deps.toBase64?.(f.bytes) : null })
        if (aiDoc.doc_type && lowDoc && aiDoc.confidence >= Number(docTypes[aiDoc.doc_type]?.confidence_threshold ?? 0.75)) {
          dc = { code: aiDoc.doc_type, confidence: aiDoc.confidence, rules: dc.rules, alternatives: [dc.code, ...dc.alternatives].filter(Boolean), source: 'ai' }
        } else if (aiDoc.doc_type && aiDoc.doc_type !== dc.code && !lowDoc) {
          report.notes.push(`${f.file_name}: rules say ${dc.code}, AI says ${aiDoc.doc_type} — rules kept`)
        }
      } catch (e) { report.notes.push(`${f.file_name}: AI document reading unavailable (${String(e.message || e).slice(0, 100)})`) }
    }
    // nothing in the taxonomy fits: record the AI's proposal for an admin (STEP270);
    // the file keeps its unknown / low-confidence type until a person decides
    const weak = !dc.code || dc.code === 'UNKNOWN_DOCUMENT' || dc.source === 'fallback' || dc.confidence < Number(docTypes[dc.code]?.confidence_threshold ?? 0.75)
    if (weak && aiDoc?.suggestion && !aiDoc.injection_suspected) {
      const sug = { ...aiDoc.suggestion, code: codeFor(aiDoc.suggestion.name) }
      if (!docTypes[sug.code]) {
        f.suggestion = sug
        dc = { ...dc, rules: [...(dc.rules || []), { name: `New type suggested: ${sug.name}` }] }
        if (!simulate && deps.db.suggestType) {
          try { await deps.db.suggestType({ ...sug, attachmentId: f.id, version }) } catch (e) { report.notes.push(`${f.file_name}: could not record the type suggestion (${String(e.message || e).slice(0, 80)})`) }
        }
      }
    }
    f.dc = dc
    f.aiDoc = aiDoc
  }

  // ── 4. intents (keywords + document evidence + optional AI) ──
  const ctx = {
    subject: email.subject, body: email.body, senderEmail: email.senderEmail, senderName: email.senderName,
    attachmentNames: files.map(f => f.file_name), attachmentTexts: files.map(f => f.text), vendorId: senderVendor.vendor?.id || null,
    documentTypes: files.map(f => ({ code: f.dc.code, name: docTypes[f.dc.code]?.name, confidence: f.dc.confidence, file_name: f.file_name })),
  }
  const rules = classifyIntents(ctx, config, { today })
  let aiIntent = null
  const high = Number(s.confidence?.high ?? 0.85)
  if (ai && s.ai?.classify_emails !== false && (rules.unclassified || rules.confidence < high)) {
    try { aiIntent = await aiClassifyIntent({ ...email, attachmentNames: ctx.attachmentNames }, config, { provider: ai.provider, apiKey: ai.apiKey, fetchImpl: ai.fetchImpl, model: ai.model }) }
    catch (e) { report.notes.push(`AI intent unavailable: ${String(e.message || e).slice(0, 120)}`) }
  }
  const intents = mergeIntent(rules, aiIntent, config)
  const cats = Object.fromEntries((config.categories || []).map(c => [c.code, c]))
  const primary = cats[intents.primary] || null
  const injection = injectionInEmail.length > 0 || aiIntent?.injection_suspected === true
  report.intents = {
    primary: intents.primary, primary_name: primary?.name || null, secondary: intents.secondary, confidence: intents.confidence,
    source: intents.source, review: intents.review, review_reason: intents.reviewReason, conflict: rules.conflict,
    matched_rules: rules.scores.flatMap(x => x.rules.map(r => ({ category: x.code, rule: r.name, hits: r.hits, action: r.action }))),
    vetoed: rules.vetoed, injection_suspected: injection,
  }

  // ── 5. documents: extraction, matching, decision ──
  // Filing every document on its project (STEP268) — without project
  // context documents are simply left unassigned.
  const threadHistory = projCtx && email.conversationId && deps.lookup.conversationProjects
    ? await deps.lookup.conversationProjects(email.conversationId).catch(() => []) : []
  let invoiceLikeCount = 0
  for (const f of files) {
    const out = { id: f.id, file_name: f.file_name, sha256: f.sha256, text_method: f.text_method, config_version: version }
    const dc = f.dc
    const aiDoc = f.aiDoc
    const dt = docTypes[dc.code] || null
    Object.assign(out, { doc_type_code: dc.code, doc_type_name: dt?.name || null, doc_confidence: dc.confidence, doc_rules: dc.rules, doc_source: dc.source, suggested_type: f.suggestion || null })

    if (dt && (dt.fields || []).length) {
      const pat = extractWithPatterns(f.text, dt)
      const aiF = aiDoc && aiDoc.doc_type === dt.code ? normalizeAiFields(aiDoc.fields, dt) : {}
      const fields = mergeFields(pat, aiF)
      const validations = validateExtraction(fields, dt, s)
      out.extraction = fields
      out.extraction_confidence = extractionConfidence(fields, dt)
      out.validations = validations
      if (aiDoc?.injection_suspected) validations.push({ check: 'document_instructions', ok: false, detail: 'The document contains instructions aimed at the automation' })
      if (injection) validations.push({ check: 'email_instructions', ok: false, detail: 'The email contains instructions aimed at the automation' })
      if (dt.required_fields?.length && out.extraction_confidence < Number(dt.confidence_threshold ?? 0.75) && validations.every(v => v.ok)) {
        validations.push({ check: 'extraction_confidence', ok: false, detail: `Extraction confidence ${Math.round(out.extraction_confidence * 100)}% below ${Math.round(Number(dt.confidence_threshold ?? 0.75) * 100)}%` })
      }

      if (INVOICE_LIKE.includes(dt.destination)) {
        invoiceLikeCount++
        const vm = identifyVendor({ senderEmail: email.senderEmail, fields, vendors, aliases, contacts })
        const vendor = vm.status === 'IDENTIFIED' ? vm.vendor : null
        const poNum = fieldValue(fields, 'po_number')
        const pos = [...(poNum ? await deps.lookup.posByNumbers([poNum]) : []), ...(vendor ? await deps.lookup.posByVendor(vendor.id) : [])]
        const uniqPos = [...new Map(pos.map(p => [p.id, p])).values()]
        const pm = matchPO({ fields, text: `${f.text}\n${email.subject}\n${email.body}`, vendor, pos: uniqPos })
        const receipts = pm.status === 'MATCHED' ? matchReceipts({ po: pm.po, grns: await deps.lookup.grnsByPo(pm.po.id) }) : null
        const vendorInvoices = vendor ? await deps.lookup.invoicesByVendor(vendor.id) : []
        const poInvoices = pm.status === 'MATCHED' ? (await deps.lookup.invoicesByPo(pm.po.id)).filter(i => i.source_attachment_id !== f.id) : []
        const total = fieldValue(fields, 'total_amount')
        const amounts = pm.status === 'MATCHED' && total != null ? checkAmounts({ total, po: pm.po, receipts, otherInvoices: poInvoices, settings: s }) : null
        const dups = findDuplicates({ vendor, fields, sha256: f.sha256, invoices: vendorInvoices.filter(i => i.source_attachment_id !== f.id), attachments: await deps.lookup.attachmentsBySha(f.sha256), selfAttachmentId: f.id })
        const origNum = fieldValue(fields, 'original_invoice_number') || (dt.code === 'REVISED_INVOICE' ? fieldValue(fields, 'invoice_number') : null)
        const original = origNum ? vendorInvoices.find(i => String(i.invoice_number).toUpperCase().replace(/[^A-Z0-9]/g, '') === origNum.toUpperCase().replace(/[^A-Z0-9]/g, '')) || null : null
        const decision = decideInvoice({ docType: dt, docConfidence: dc.confidence, fields, validations, vendorMatch: vm, poMatch: pm, receipts, amounts, duplicates: dups, original, category: intents.primary, settings: s })

        Object.assign(out, {
          vendor_id: vendor?.id || null, vendor_name: vendor?.name || null, vendor_method: vm.method, vendor_confidence: vm.confidence, vendor_status: vm.status,
          po_id: pm.po?.id || null, po_number: pm.po?.po_number || null, po_status: pm.status,
          grn_ids: receipts?.grns?.map(g => g.id) || [], receipt_status: receipts?.status || null, received_value: receipts?.received ?? null,
          project_id: pm.status === 'MATCHED' ? pm.po.project_id || null : null,
          amount_checks: amounts?.checks || [], variance_percent: amounts?.variance_percent ?? null,
          duplicate_of_invoice_id: dups.byNumber[0]?.id || null, decision: decision.action, payload: decision.payload,
        })
        if (decision.action === 'CREATE_INVOICE') {
          const r = simulate ? { status: 'SIMULATED' } : await deps.db.createInvoice(f.id, decision.payload)
          out.invoice_result = r.status
          if (r.status === 'CREATED' || r.status === 'EXISTS') { out.invoice_id = r.invoice_id; out.outcome = 'INVOICE_CREATED'; report.invoices.push(r.invoice_id) }
          else if (r.status === 'SIMULATED') { out.outcome = 'WOULD_CREATE_INVOICE' }
          else {
            out.outcome = 'EXCEPTION'
            raise(r.status === 'DUPLICATE' ? 'DUPLICATE_REVIEW' : 'DATA_VALIDATION',
              r.status === 'DUPLICATE' ? `Invoice ${fieldValue(fields, 'invoice_number')} from ${vendor?.name} is already in the invoice register` : `Invoice not created: ${r.reason}`,
              { attachmentId: f.id, priority: 'high', detail: { payload: decision.payload, existing_invoice_id: r.invoice_id || null }, role: 'finance' })
          }
        } else if (decision.action === 'EXCEPTIONS') {
          out.outcome = 'EXCEPTION'
          for (const e of decision.exceptions) raise(e.kind, e.summary, { attachmentId: f.id, priority: e.priority, detail: { ...e.detail, payload: decision.payload }, role: 'finance' })
        } else out.outcome = 'RECORDED'
      } else out.outcome = 'RECORDED'
    } else {
      out.outcome = 'RECORDED'
      if (primary?.workflow_key === 'AP_INVOICE' && (!dc.code || dc.code === 'UNKNOWN_DOCUMENT')) {   // photos / general files are normal here
        raise('CLASSIFICATION_REVIEW', `${f.file_name}: could not tell what this document is`, { attachmentId: f.id, role: primary.review_role || 'finance' })
        out.outcome = 'EXCEPTION'
      }
    }
    // ── filing: header data, workspace area, modules, project ──
    Object.assign(out, documentMeta({ fields: out.extraction || {}, fileName: f.file_name, ai: aiDoc?.meta || {} }), mappingFor(dt, dc.code))
    const proj = resolveDocumentProject({
      poProjectId: out.project_id || null,
      match: projCtx ? matchProject({ email: { ...email, body: `${email.body || ''}
${String(f.text || '').slice(0, 8000)}` }, ...projCtx, history: threadHistory }) : null,
      settings: s,
    })
    Object.assign(out, {
      project_id: proj.project_id, project_status: proj.status, project_method: proj.method, project_confidence: proj.confidence,
      project_candidates: proj.candidates, project_reason: proj.reason,
      review_state: reviewStateFor({ docCode: dc.code, docConfidence: dc.confidence, threshold: dt?.confidence_threshold ?? 0.75, projectStatus: proj.status }),
    })
    // ── duplicates / revisions (STEP271): compare with earlier documents ──
    if (deps.lookup.relatedDocuments) {
      try {
        const me = { id: f.id, sha256: f.sha256, document_number: out.document_number, revision: out.revision, doc_type_code: dc.code, project_id: out.project_id,
          title: out.title, file_name: f.file_name, sender_email: email.senderEmail, received_at: email.receivedAt || null }
        const cands = await deps.lookup.relatedDocuments({ ...me, conversation_id: email.conversationId || null })
        const rel = relateDocument(me, cands || [])
        if (rel.relation !== 'NONE') out.version = rel
      } catch (e) { report.notes.push(`${f.file_name}: version check unavailable (${String(e.message || e).slice(0, 80)})`) }
    }
    out.outcome_reason = out.outcome === 'EXCEPTION' ? exceptions.filter(e => e.attachmentId === f.id).map(e => e.summary).join(' | ').slice(0, 500) : null
    report.attachments.push(out)
    if (!simulate) {
      await deps.db.updateAttachment(f.id, {
        status: 'PROCESSED', sha256: f.sha256, storage_path: f.storage_path, text_method: f.text_method, text_excerpt: f.text || null,
        doc_type_code: out.doc_type_code, doc_confidence: out.doc_confidence, doc_rules: out.doc_rules || [],
        extraction: out.extraction || null, extraction_confidence: out.extraction_confidence ?? null, validations: [...(out.validations || []), ...(out.amount_checks || [])],
        vendor_id: out.vendor_id || null, vendor_method: out.vendor_method || null, vendor_confidence: out.vendor_confidence ?? null,
        po_id: out.po_id || null, grn_ids: out.grn_ids || [], project_id: out.project_id || null, duplicate_of_invoice_id: out.duplicate_of_invoice_id || null,
        outcome: out.outcome, outcome_reason: out.outcome_reason, config_version: version,
        ...(deps.documentRegister ? {
          title: out.title, document_number: out.document_number, document_date: out.document_date, revision: out.revision,
          area: out.area, primary_module: out.primary_module, related_modules: out.related_modules,
          project_status: out.project_status, project_method: out.project_method, project_confidence: out.project_confidence,
          project_candidates: out.project_candidates, project_reason: out.project_reason, review_state: out.review_state,
          conversation_id: email.conversationId || null,
          ...(f.suggestion && deps.db.suggestType ? { suggested_type_code: f.suggestion.code } : {}),
        } : {}),
      })
      if (out.version && deps.db.linkVersion) {
        try { await deps.db.linkVersion(f.id, out.version) } catch (e) { report.notes.push(`${f.file_name}: could not link versions (${String(e.message || e).slice(0, 80)})`) }
      }
    }
  }

  // ── 6. email-level workflow (primary + secondary intents) ──
  const subj = email.subject || '(no subject)'
  if (intents.review) raise('CLASSIFICATION_REVIEW', `${subj}: ${intents.reviewReason}`, { role: primary?.review_role || 'manager', priority: primary?.default_priority })
  if (injection) raise('CLASSIFICATION_REVIEW', `${subj}: the email contains instructions aimed at the automation — nothing was done automatically`, { role: 'admin', priority: 'high' })
  const handled = new Set()
  for (const code of [intents.primary, ...intents.secondary]) {
    const c = cats[code]
    if (!c || handled.has(c.workflow_key + code)) continue
    handled.add(c.workflow_key + code)
    const isPrimary = code === intents.primary
    if (c.workflow_key === 'VENDOR_VERIFICATION') {
      raise(code === 'BANK_DETAIL_CHANGE' ? 'BANK_DETAIL_CHANGE' : 'VENDOR_MASTER_CHANGE',
        `${c.name} requested by ${email.senderEmail}${senderVendor.vendor ? ` (${senderVendor.vendor.name})` : ''}: "${subj}". Verify independently with a known contact before changing anything — never from this email.`,
        { role: c.review_role || 'finance', priority: c.default_priority === 'low' ? 'high' : c.default_priority, departmentId: c.department_id, detail: { category: code, sender_vendor_id: senderVendor.vendor?.id || null } })
    } else if (c.workflow_key === 'REVIEW_QUEUE' && (isPrimary || Number(rules.scores.find(x => x.code === code)?.confidence ?? 0) >= Number(c.confidence_threshold ?? 0.75))) {
      raise(`CATEGORY_REVIEW:${code}`, `${c.name}: ${subj}`, { role: c.review_role || 'manager', priority: c.default_priority, departmentId: c.department_id, detail: { category: code } })
    } else if (c.workflow_key === 'AP_INVOICE' && isPrimary && invoiceLikeCount === 0) {
      raise('DATA_VALIDATION', `${c.name} email without a readable invoice document: ${subj}`, { role: c.review_role || 'finance', priority: c.default_priority })
    }
    if (c.requires_review && isPrimary && !['VENDOR_VERIFICATION', 'REVIEW_QUEUE'].includes(c.workflow_key) && !exceptions.length) {
      raise(`CATEGORY_REVIEW:${code}`, `${c.name} is set to always be reviewed: ${subj}`, { role: c.review_role || 'manager', priority: c.default_priority, departmentId: c.department_id })
    }
  }

  // ── 7. persist exceptions + decide the email's status ──
  for (const e of exceptions) {
    const id = simulate ? null : await deps.db.raiseException({ ...e, version })
    report.exceptions.push({ id, kind: e.kind, summary: e.summary, priority: e.priority, role: e.role || null, attachment_id: e.attachmentId || null })
  }
  const delegate = primary?.workflow_key === 'PROJECT_ISSUE_TASK' && !report.invoices.length && invoiceLikeCount === 0
  const ignore = primary?.workflow_key === 'IGNORE' && !exceptions.length
  report.status = delegate ? 'DELEGATE' : ignore ? 'IGNORED' : 'PROCESSED'
  report.vendor_id = senderVendor.vendor?.id || report.attachments.find(a => a.vendor_id)?.vendor_id || null
  report.summary = [
    primary ? primary.name : 'Unclassified',
    intents.secondary.length ? `+ ${intents.secondary.map(c => cats[c]?.name || c).join(', ')}` : null,
    files.length ? `${files.length} attachment${files.length > 1 ? 's' : ''}` : null,
    report.invoices.length ? `${report.invoices.length} invoice${report.invoices.length > 1 ? 's' : ''} created` : null,
    exceptions.length ? `${exceptions.length} item${exceptions.length > 1 ? 's' : ''} for review` : null,
  ].filter(Boolean).join(' · ')
  return report
}

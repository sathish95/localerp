import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FileSignature, Plus, Upload, Send, Copy, BellRing, Ban, Download, Trash2, Pencil, Files, FileText, X, ArrowUp, ArrowDown, UserPlus, Sparkles,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { Loader, SearchBox, Confirm } from '../components/ui'
import { Drawer, Stats, Seg, Group, Field, EmptyState, ago, fullTime } from '../components/ei/ui'
import {
  BUILT_IN_TEMPLATES, DOC_TYPES, DOC_TYPE_LABEL, fieldsFor, fillTemplate, defaultValues, validateSigners, itemsSummary, fmtMoney,
} from '../lib/esignTemplates'
import {
  listDocuments, loadDocument, saveDraft, uploadPdf, fileBytes, sendDocument, remindSigner, cancelDocument, deleteDraft, signingLink,
  listTemplates, saveTemplate, archiveTemplate, myToken,
} from '../lib/esign'
import { signedPdf, contentPdf, downloadBytes, fileBase, istTime, eventLabel } from '../lib/esignPdf'
import { DocumentText, PdfFrame, StatusPill } from '../components/esign/DocumentView'
import SigningView from '../components/esign/SigningView'
import { PRESETS, presetFor } from '../lib/esignPresets'

const MANAGE_ROLES = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'hr']
const OPEN = ['SENT', 'IN_PROGRESS']

export default function AgreementsPage() {
  const { profile } = useAuth()
  const canManage = MANAGE_ROLES.includes(profile?.role)
  const orgName = profile?.org?.name || ''
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('documents')
  const [docs, setDocs] = useState(null)
  const [templates, setTemplates] = useState([])
  const [err, setErr] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [editing, setEditing] = useState(null)      // { draft, signers } or { id }
  const [openId, setOpenId] = useState(params.get('id'))
  const [lookups, setLookups] = useState({ customers: [], vendors: [], projects: [], people: [] })

  const refresh = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([listDocuments(), listTemplates().catch(() => [])])
      setDocs(d); setTemplates(t); setErr('')
    } catch (e) { setErr(e.message); setDocs([]) }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    (async () => {
      const [c, v, p, u] = await Promise.all([
        supabase.from('customers').select('id, name, email, contact_name, address, city, gst_number').order('name'),
        supabase.from('vendors').select('id, name, email, address, city, state, gst_number').order('name'),
        supabase.from('projects').select('id, code, name, customer_id, client_name, status').order('name'),
        supabase.from('profiles').select('id, full_name, email, role, is_active').order('full_name'),
      ])
      setLookups({ customers: c.data || [], vendors: v.data || [], projects: p.data || [], people: (u.data || []).filter(x => x.is_active !== false && x.email) })
    })()
  }, [])
  const openDoc = id => { setOpenId(id); setParams(id ? { id } : {}, { replace: true }) }
  // Signing inside the tab: the email / notification link is /agreements?id=<doc>&sign=1 (STEP274).
  const [signing, setSigning] = useState(null)      // { id, token }
  const startSigning = useCallback(async id => {
    try {
      const token = await myToken(id)
      if (!token) throw new Error('You are not a signer on this document')
      setSigning({ id, token })
    } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => {
    const id = params.get('id')
    if (id && params.get('sign') === '1') { startSigning(id); setParams({ id }, { replace: true }) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = { all: 0, DRAFT: 0, OPEN: 0, COMPLETED: 0, CLOSED: 0 }
    for (const d of docs || []) {
      c.all++
      if (d.status === 'DRAFT') c.DRAFT++
      else if (OPEN.includes(d.status)) c.OPEN++
      else if (d.status === 'COMPLETED') c.COMPLETED++
      else c.CLOSED++
    }
    return c
  }, [docs])
  const rows = useMemo(() => (docs || []).filter(d => {
    if (status === 'DRAFT' && d.status !== 'DRAFT') return false
    if (status === 'OPEN' && !OPEN.includes(d.status)) return false
    if (status === 'COMPLETED' && d.status !== 'COMPLETED') return false
    if (status === 'CLOSED' && !['DECLINED', 'CANCELLED', 'EXPIRED'].includes(d.status)) return false
    if (type && d.doc_type !== type) return false
    const s = q.trim().toLowerCase()
    return !s || [d.doc_number, d.title, d.counterparty_name, ...(d.esign_signers || []).map(x => `${x.name} ${x.email}`)].join(' ').toLowerCase().includes(s)
  }), [docs, status, type, q])

  const startFrom = (tpl, upload) => {
    setChoosing(false)
    const t = tpl || BUILT_IN_TEMPLATES.find(x => x.key === 'blank')
    const values = upload ? {} : defaultValues(t, { orgName })
    setEditing({
      draft: {
        title: upload ? '' : t.name, doc_type: t.doc_type || 'AGREEMENT', source: upload ? 'UPLOAD' : 'TEMPLATE',
        template_key: upload ? null : (t.id ? `custom:${t.id}` : t.key), fields: values, currency: 'INR',
        signing_order: 'SEQUENTIAL', require_otp: true, counterparty_kind: 'CUSTOMER',
      },
      template: upload ? null : t,
      signers: [],
    })
  }

  if (!docs) return <Loader />
  const addAllTypes = async () => {
    setErr('')
    try {
      for (const [key, preset] of Object.entries(PRESETS).filter(([, x]) => !docs.some(d => d.title === x.title))) {
        const t = BUILT_IN_TEMPLATES.find(x => x.key === key)
        const values = { ...defaultValues(t, { orgName }), ...preset.values }
        const { text } = fillTemplate(t, values)
        await saveDraft({
          title: preset.title, doc_type: t.doc_type, source: 'TEMPLATE', template_key: key, content: text, fields: values,
          counterparty_kind: 'OTHER', counterparty_name: preset.counterparty_name, contract_value: preset.contract_value ?? null, currency: 'INR',
          effective_date: values.effective_date || null, end_date: values.end_date || null, sign_by: preset.sign_by || null, message: preset.message || null,
          signing_order: 'SEQUENTIAL', require_otp: true,
        }, [])
      }
      await refresh()
    } catch (e) { setErr(e.message) }
  }
  const pendingMine = (docs || []).filter(d => OPEN.includes(d.status) && (d.esign_signers || []).some(s => s.profile_id === profile?.id && !['SIGNED', 'DECLINED'].includes(s.status)))

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Agreements & e-Sign</div>
          <div className="page-subtitle">Prepare agreements, NDAs, EPC contracts, SOWs, purchase orders and work orders, get them signed online and download the signed PDF</div>
        </div>
        {canManage && tab === 'documents' && (
          <div className="esg-row">
            {!Object.values(PRESETS).every(x => docs.some(d => d.title === x.title)) && <button className="btn btn-outline" onClick={addAllTypes} title="Creates a filled-in draft of every agreement type; add the signers before sending"><Sparkles size={15} /> Create all agreement types</button>}
            <button className="btn btn-primary" onClick={() => setChoosing(true)}><Plus size={15} /> New document</button>
          </div>
        )}
      </div>
      {err && <div className="olk-msg error" style={{ marginBottom: 12 }}>{/esign_|schema cache|does not exist/.test(err) ? 'Run sql/STEP273_esign_agreements.sql in Supabase to turn this module on.' : err}</div>}

      {pendingMine.length > 0 && (
        <div className="esg-note" style={{ marginBottom: 14 }}>
          <b>Waiting for your signature:</b> {pendingMine.map(d => <button key={d.id} className="esg-link" onClick={() => startSigning(d.id)}>{d.doc_number} {d.title}</button>)}
        </div>
      )}

      <div style={{ marginBottom: 14 }}><Seg value={tab} onChange={setTab} options={[['documents', 'Documents', counts.all], ['templates', 'Templates']]} /></div>

      {tab === 'documents' ? (
        <>
          <Stats items={[['Drafts', counts.DRAFT], ['Out for signature', counts.OPEN, counts.OPEN ? 'amber' : ''], ['Signed', counts.COMPLETED, 'green'], ['Declined / cancelled / expired', counts.CLOSED]]} />
          <div className="card" style={{ padding: 0, marginTop: 14 }}>
            <div className="gl-bar">
              <Seg value={status} onChange={setStatus} options={[['all', 'All'], ['DRAFT', 'Drafts'], ['OPEN', 'Out for signature'], ['COMPLETED', 'Signed'], ['CLOSED', 'Closed']]} />
              <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
                <option value="">All types</option>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <span className="gl-grow" />
              <div style={{ minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="Search number, title, party, signer" /></div>
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={FileSignature} title={docs.length ? 'No documents match' : 'No documents yet'}>
                {docs.length ? 'Change the filters above.' : canManage ? 'Click "New document" to start from a template or upload a PDF.' : 'Documents you are asked to sign appear here.'}
              </EmptyState>
            ) : (
              <div className="gl-tscroll"><table className="gl-table eic-list">
                <thead><tr><th>Number</th><th>Title</th><th>Type</th><th>Other party</th><th>Signed</th><th>Status</th><th>Updated</th></tr></thead>
                <tbody>{rows.map(d => {
                  const ss = d.esign_signers || []
                  return (
                    <tr key={d.id} onClick={() => openDoc(d.id)} style={{ cursor: 'pointer' }}>
                      <td className="gl-meta">{d.doc_number}</td>
                      <td><b>{d.title}</b>{d.source === 'UPLOAD' && <span className="gl-meta"> · PDF</span>}</td>
                      <td>{DOC_TYPE_LABEL[d.doc_type] || d.doc_type}</td>
                      <td>{d.counterparty_name || <span className="gl-st-zero">—</span>}</td>
                      <td className="num">{ss.length ? `${ss.filter(s => s.status === 'SIGNED').length} / ${ss.length}` : '—'}</td>
                      <td><StatusPill status={d.status} /></td>
                      <td className="gl-meta">{ago(d.updated_at)}</td>
                    </tr>
                  )
                })}</tbody>
              </table></div>
            )}
          </div>
        </>
      ) : (
        <TemplatesTab templates={templates} canManage={canManage} onChanged={refresh} onUse={t => { setTab('documents'); startFrom(t) }} />
      )}

      {choosing && <Chooser templates={templates} onClose={() => setChoosing(false)} onPick={startFrom} />}
      {editing && (
        <Editor initial={editing} orgName={orgName} lookups={lookups} templates={templates} me={profile}
          onClose={() => setEditing(null)} onSaved={async id => { setEditing(null); await refresh(); openDoc(id) }} />
      )}
      {signing && (
        <div className="esg-overlay">
          <div className="esg-overlay-bar">
            <b><FileSignature size={15} /> Sign document</b>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSigning(null); refresh() }}><X size={14} /> Close</button>
          </div>
          <div className="esg-overlay-body"><SigningView key={signing.token} token={signing.token} onChanged={refresh} /></div>
        </div>
      )}
      {openId && !editing && !signing && (
        <Detail id={openId} onSign={startSigning} orgName={orgName} me={profile} canManage={canManage} onClose={() => openDoc(null)} onChanged={refresh}
          onEdit={async id => { const { doc, signers } = await loadDocument(id); setEditing({ draft: doc, signers, template: templateOf(doc, templates) }) }}
          onDuplicate={async id => {
            const { doc, signers } = await loadDocument(id)
            const { id: _i, doc_number: _n, status: _s, sent_at: _a, completed_at: _c, content_hash: _h, created_by: _b, created_at: _t, updated_at: _u, cancel_reason: _r, organization_id: _o, ...rest } = doc
            setEditing({ draft: { ...rest, title: `${doc.title} (copy)`, source: doc.source === 'UPLOAD' ? 'UPLOAD' : 'TEMPLATE', file_name: null },
              signers: signers.map(({ name, email, role_label, profile_id, seq }) => ({ name, email, role_label, profile_id, seq })), template: templateOf(doc, templates) })
          }} />
      )}
    </div>
  )
}

function templateOf(doc, custom) {
  if (!doc.template_key) return null
  if (doc.template_key.startsWith('custom:')) return custom.find(t => `custom:${t.id}` === doc.template_key) || null
  return BUILT_IN_TEMPLATES.find(t => t.key === doc.template_key) || null
}

/* ── pick a starting point ── */
function Chooser({ templates, onClose, onPick }) {
  return (
    <Drawer title="New document" subtitle="Start from a template, or upload a PDF that is ready to sign" onClose={onClose} wide>
      <button className="esg-tpl esg-tpl-upload" onClick={() => onPick(null, true)}>
        <Upload size={18} /><div><b>Upload a PDF</b><span>Your own agreement, the customer's PO or a signed-off draft — max 10 MB</span></div>
      </button>
      <Group title="Templates" hint="Fill in the fields; the text is generated for you and can still be edited">
        <div className="esg-tpl-grid">
          {[...BUILT_IN_TEMPLATES, ...templates].map(t => (
            <button key={t.id || t.key} className="esg-tpl" onClick={() => onPick(t)}>
              <FileText size={18} /><div><b>{t.name}</b><span>{DOC_TYPE_LABEL[t.doc_type] || t.doc_type}{t.id ? ' · your template' : ''}{t.description ? ` — ${t.description}` : ''}</span></div>
            </button>
          ))}
        </div>
      </Group>
    </Drawer>
  )
}

/* ── editor ── */
function Editor({ initial, orgName, lookups, templates, me, onClose, onSaved }) {
  const [d, setD] = useState(initial.draft)
  const [signers, setSigners] = useState(initial.signers?.length ? initial.signers.map(s => ({ ...s })) : [])
  const [tpl] = useState(initial.template)
  const [manual, setManual] = useState(!!initial.draft.fields?._manual || (initial.draft.source === 'TEMPLATE' && !!initial.draft.id && !initial.template))
  const [view, setView] = useState('details')
  const [file, setFile] = useState(null)
  const [existingFile, setExistingFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = patch => setD(x => ({ ...x, ...patch }))
  const values = d.fields || {}
  const setValue = (k, v) => set({ fields: { ...values, [k]: v } })
  const upload = d.source === 'UPLOAD'

  useEffect(() => { if (upload && d.id && d.file_name) fileBytes(d.id).then(setExistingFile).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filled = useMemo(() => (tpl && !upload ? fillTemplate(tpl, values, d.currency || 'INR') : null), [tpl, values, upload, d.currency])
  const content = upload ? null : manual || !filled ? (d.content || '') : filled.text
  const fields = tpl ? fieldsFor(tpl) : []

  const cpList = d.counterparty_kind === 'VENDOR' ? lookups.vendors : d.counterparty_kind === 'CUSTOMER' ? lookups.customers : []
  const pickParty = id => {
    const p = cpList.find(x => x.id === id)
    if (!p) return set({ counterparty_id: null })
    const addr = [p.address, p.city, p.state].filter(Boolean).join(', ')
    const f = { ...values }
    if (fields.some(x => x.key === 'party_name')) f.party_name = p.name
    if (fields.some(x => x.key === 'party_address') && addr) f.party_address = addr
    if (fields.some(x => x.key === 'vendor_gstin') && p.gst_number) f.vendor_gstin = p.gst_number
    set({ counterparty_id: p.id, counterparty_name: p.name, fields: f })
  }
  const pickProject = id => {
    const p = lookups.projects.find(x => x.id === id)
    const f = { ...values }
    if (p && fields.some(x => x.key === 'project_name')) f.project_name = p.name
    set({ project_id: id || null, fields: f })
  }
  const addSigner = s => setSigners(list => [...list, { seq: list.length + 1, name: '', email: '', role_label: '', ...s }])
  const party = cpList.find(x => x.id === d.counterparty_id)

  const save = async send => {
    setMsg(null)
    if (!String(d.title || '').trim()) return setMsg({ ok: false, text: 'Give the document a title' })
    if (upload && !file && !d.file_name) return setMsg({ ok: false, text: 'Choose the PDF to be signed' })
    if (send) {
      const errs = validateSigners(signers)
      if (filled && !manual && filled.missing.length) errs.unshift(`Fill in: ${filled.missing.map(k => fields.find(f => f.key === k)?.label || k).join(', ')}`)
      if (errs.length) { setView(errs[0].startsWith('Fill in') ? 'fields' : 'signers'); return setMsg({ ok: false, text: errs.join(' · ') }) }
    }
    setBusy(true)
    try {
      const total = tpl && values.items ? itemsSummary(values.items, values.gst_rate).total : null
      const draft = {
        ...d, content: upload ? null : content, fields: { ...values, _manual: manual || undefined },
        contract_value: d.contract_value ?? (total || null),
        effective_date: d.effective_date || (values.effective_date || null),
        end_date: d.end_date || (values.end_date || null),
      }
      const id = await saveDraft(draft, signers.filter(s => s.name || s.email))
      if (upload && file) await uploadPdf(id, file)
      if (send) await sendDocument(id)
      onSaved(id)
    } catch (e) { setMsg({ ok: false, text: e.message }); setBusy(false) }
  }

  return (
    <Drawer wide title={d.id ? `Edit ${d.doc_number || 'draft'}` : 'New document'} subtitle={upload ? 'Uploaded PDF' : tpl?.name || 'Own text'} onClose={onClose}
      footer={<>
        {msg && <div className={`olk-msg ${msg.ok ? 'success' : 'error'}`} style={{ flex: '1 1 100%' }}>{msg.text}</div>}
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <button className="btn btn-outline" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}><Send size={14} /> {busy ? 'Working…' : 'Save & send for signing'}</button>
      </>}>
      <div style={{ marginBottom: 14 }}>
        <Seg value={view} onChange={setView} options={[['details', 'Details'], ...(upload ? [['file', 'PDF']] : [['fields', 'Fields'], ['preview', 'Preview']]), ['signers', 'Signers', signers.length]]} />
      </div>

      {view === 'details' && (
        <>
          <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={d.title || ''} onChange={e => set({ title: e.target.value })} placeholder="e.g. NDA with Acme Infra" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={d.doc_type} onChange={e => set({ doc_type: e.target.value })}>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Project</label>
              <select className="form-select" value={d.project_id || ''} onChange={e => pickProject(e.target.value)}>
                <option value="">— none —</option>{lookups.projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Other party is a</label>
              <select className="form-select" value={d.counterparty_kind || 'OTHER'} onChange={e => set({ counterparty_kind: e.target.value, counterparty_id: null })}>
                <option value="CUSTOMER">Customer</option><option value="VENDOR">Vendor</option><option value="OTHER">Other</option>
              </select></div>
            <div className="form-group"><label className="form-label">Other party</label>
              {d.counterparty_kind === 'OTHER'
                ? <input className="form-input" value={d.counterparty_name || ''} onChange={e => set({ counterparty_name: e.target.value })} placeholder="Company name" />
                : <select className="form-select" value={d.counterparty_id || ''} onChange={e => pickParty(e.target.value)}>
                    <option value="">— choose —</option>{cpList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Contract value (INR)</label><input className="form-input" type="number" value={d.contract_value ?? ''} onChange={e => set({ contract_value: e.target.value === '' ? null : Number(e.target.value) })} placeholder={tpl && values.items ? 'Taken from the line items' : ''} /></div>
            <div className="form-group"><label className="form-label">Sign by (link expires after)</label><input className="form-input" type="date" value={d.sign_by || ''} onChange={e => set({ sign_by: e.target.value || null })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Effective date</label><input className="form-input" type="date" value={d.effective_date || ''} onChange={e => set({ effective_date: e.target.value || null })} /></div>
            <div className="form-group"><label className="form-label">End / renewal date</label><input className="form-input" type="date" value={d.end_date || ''} onChange={e => set({ end_date: e.target.value || null })} /></div>
          </div>
          <div className="form-group"><label className="form-label">Message to signers</label><textarea className="form-input form-textarea" value={d.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Shown in the email and on the signing page" /></div>
        </>
      )}

      {view === 'file' && (
        <div className="form-group">
          <label className="form-label">PDF to be signed *</label>
          <input type="file" accept="application/pdf,.pdf" onChange={e => { const f = e.target.files?.[0]; setFile(f || null); if (f && !d.title) set({ title: f.name.replace(/\.pdf$/i, '') }) }} />
          <div className="gl-meta" style={{ marginTop: 6 }}>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : d.file_name ? `Current file: ${d.file_name}` : 'Max 10 MB. A signature certificate page is added to it when signed.'}</div>
          {(file || existingFile) && <div style={{ marginTop: 12 }}><LocalPdf file={file} bytes={existingFile} /></div>}
        </div>
      )}

      {view === 'fields' && (
        <>
          {!tpl && <div className="olk-msg" style={{ marginBottom: 12 }}>This document has no template — edit its text below.</div>}
          {tpl && presetFor(tpl.key) && !manual && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => {
              const preset = presetFor(tpl.key)
              set({ fields: { ...values, ...preset.values }, title: d.title && d.title !== tpl.name ? d.title : preset.title, counterparty_name: d.counterparty_name || preset.counterparty_name, contract_value: d.contract_value ?? preset.contract_value ?? null })
            }}><Sparkles size={13} /> Auto-fill details</button>
          )}
          {tpl && (
            <label className="esg-consent" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={manual} onChange={e => { if (e.target.checked) set({ content: filled?.text || d.content }); setManual(e.target.checked) }} />
              <span>Edit the text myself (the fields below stop updating it)</span>
            </label>
          )}
          {manual || !tpl
            ? <textarea className="form-input form-textarea esg-text" value={d.content || ''} onChange={e => set({ content: e.target.value })} placeholder={'# Heading\n\nParagraph text…\n\n## 1. Clause\n- bullet'} />
            : fields.map(f => <FieldInput key={f.key} f={f} value={values[f.key]} onChange={v => setValue(f.key, v)} missing={filled?.missing.includes(f.key)} />)}
        </>
      )}

      {view === 'preview' && (content ? <DocumentText content={content} /> : <EmptyState icon={FileText} title="Nothing to preview yet" />)}

      {view === 'signers' && (
        <>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Signing order</label>
              <select className="form-select" value={d.signing_order} onChange={e => set({ signing_order: e.target.value })}>
                <option value="SEQUENTIAL">One after another (in the order below)</option><option value="PARALLEL">Everyone at the same time</option>
              </select></div>
            <div className="form-group"><label className="form-label">Identity check</label>
              <select className="form-select" value={d.require_otp ? 'otp' : 'link'} onChange={e => set({ require_otp: e.target.value === 'otp' })}>
                <option value="otp">Email a one-time code before signing (recommended)</option><option value="link">Personal link only</option>
              </select></div>
          </div>
          {signers.length === 0 && <div className="gl-meta" style={{ marginBottom: 10 }}>Add who signs — usually the other party first, then your authorised signatory.</div>}
          {signers.map((s, i) => (
            <div key={i} className="esg-signer-edit">
              <span className="esg-seq">{d.signing_order === 'PARALLEL' ? '•' : i + 1}</span>
              <input className="form-input" placeholder="Full name" value={s.name} onChange={e => setSigners(l => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="form-input" placeholder="Email" type="email" value={s.email} onChange={e => setSigners(l => l.map((x, j) => (j === i ? { ...x, email: e.target.value, profile_id: null } : x)))} />
              <input className="form-input" placeholder="Signs as (e.g. Director, Vendor)" value={s.role_label || ''} onChange={e => setSigners(l => l.map((x, j) => (j === i ? { ...x, role_label: e.target.value } : x)))} />
              <span className="esg-signer-tools">
                <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => setSigners(l => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n.map((x, j) => ({ ...x, seq: j + 1 })) })}><ArrowUp size={13} /></button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={i === signers.length - 1} onClick={() => setSigners(l => { const n = [...l]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n.map((x, j) => ({ ...x, seq: j + 1 })) })}><ArrowDown size={13} /></button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSigners(l => l.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq: j + 1 })))}><X size={13} /></button>
              </span>
              {s.profile_id && <span className="gl-meta esg-signer-note">Team member — also gets an in-app notification</span>}
            </div>
          ))}
          <div className="esg-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => addSigner({})}><UserPlus size={13} /> Add signer</button>
            {party?.email && !signers.some(s => s.email?.toLowerCase() === party.email.toLowerCase()) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSigner({ name: party.contact_name || party.name, email: party.email, role_label: d.counterparty_kind === 'VENDOR' ? 'Vendor' : 'Customer' })}><Plus size={13} /> {party.contact_name || party.name}</button>
            )}
            {me?.email && !signers.some(s => s.profile_id === me.id) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSigner({ name: me.full_name || '', email: me.email, profile_id: me.id, role_label: orgName })}><Plus size={13} /> Me</button>
            )}
            <select className="form-select" style={{ width: 'auto' }} value="" onChange={e => { const p = lookups.people.find(x => x.id === e.target.value); if (p) addSigner({ name: p.full_name || p.email, email: p.email, profile_id: p.id, role_label: orgName }) }}>
              <option value="">+ Team member…</option>{lookups.people.filter(p => !signers.some(s => s.profile_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </select>
          </div>
        </>
      )}
    </Drawer>
  )
}

function LocalPdf({ file, bytes }) {
  const [b, setB] = useState(bytes)
  useEffect(() => { if (file) file.arrayBuffer().then(x => setB(new Uint8Array(x))); else setB(bytes) }, [file, bytes])
  return b ? <PdfFrame bytes={b} name={file?.name} /> : null
}

function FieldInput({ f, value, onChange, missing }) {
  const label = <label className="form-label">{f.label}{f.required && ' *'}{missing && <span className="esg-missing-tag">required</span>}</label>
  if (f.type === 'items') {
    const rows = Array.isArray(value) && value.length ? value : [{ description: '', qty: 1, unit: 'Nos', rate: '' }]
    const upd = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
    const sum = itemsSummary(rows, 0)
    return (
      <div className="form-group">{label}
        <div className="esg-items">
          <div className="esg-items-h"><span>Description</span><span>Qty</span><span>Unit</span><span>Rate</span><span>Amount</span><span /></div>
          {rows.map((r, i) => (
            <div key={i} className="esg-items-r">
              <input className="form-input" value={r.description} onChange={e => upd(i, 'description', e.target.value)} placeholder="Item or work" />
              <input className="form-input" type="number" value={r.qty} onChange={e => upd(i, 'qty', e.target.value)} />
              <input className="form-input" value={r.unit} onChange={e => upd(i, 'unit', e.target.value)} />
              <input className="form-input" type="number" value={r.rate} onChange={e => upd(i, 'rate', e.target.value)} />
              <span className="num">{fmtMoney((Number(r.qty) || 0) * (Number(r.rate) || 0))}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
          ))}
          <div className="esg-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, { description: '', qty: 1, unit: 'Nos', rate: '' }])}><Plus size={12} /> Add line</button><span className="gl-grow" /><b>{fmtMoney(sum.subtotal)}</b></div>
        </div>
      </div>
    )
  }
  const common = { className: `form-input${f.type === 'textarea' ? ' form-textarea' : ''}`, value: value ?? '', onChange: e => onChange(e.target.value) }
  return (
    <div className="form-group">{label}
      {f.type === 'textarea' ? <textarea {...common} /> : <input {...common} type={f.type === 'date' ? 'date' : ['number', 'money'].includes(f.type) ? 'number' : 'text'} />}
    </div>
  )
}

/* ── detail ── */
function Detail({ id, orgName, me, canManage, onClose, onChanged, onEdit, onDuplicate, onSign }) {
  const [data, setData] = useState(null)
  const [file, setFile] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('summary')
  const [confirm, setConfirm] = useState(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await loadDocument(id)
      setData(r)
      if (r.doc.source === 'UPLOAD' && r.doc.file_name) setFile(await fileBytes(id))
    } catch (e) { setMsg({ ok: false, text: e.message }) }
  }, [id])
  useEffect(() => { load() }, [load])
  if (!data) return <Drawer title="Loading…" onClose={onClose}>{msg ? <div className="olk-msg error">{msg.text}</div> : <Loader />}</Drawer>

  const { doc, signers, events } = data
  const mine = doc.created_by === me?.id || canManage
  const act = async (fn, ok) => {
    setBusy(true); setMsg(null)
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); await load(); onChanged() } catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy(false)
  }
  const download = async signed => {
    setBusy(true)
    try {
      const bytes = signed ? await signedPdf({ doc, signers, events, orgName, originalBytes: file }) : (file || contentPdf(doc, orgName))
      downloadBytes(bytes, `${fileBase(doc)}${signed ? (doc.status === 'COMPLETED' ? '-signed' : '-certificate-draft') : ''}.pdf`)
    } catch (e) { setMsg({ ok: false, text: `Could not build the PDF: ${e.message}` }) }
    setBusy(false)
  }
  const copyLink = async s => act(async () => { await navigator.clipboard.writeText(await signingLink(s.id)) }, `Signing link for ${s.name} copied — it is personal to them`)
  const myTurn = signers.find(s => s.profile_id === me?.id && !['SIGNED', 'DECLINED'].includes(s.status))
  const open = OPEN.includes(doc.status)

  return (
    <Drawer wide title={doc.title} subtitle={`${doc.doc_number} · ${DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type}`} onClose={onClose}
      footer={<>
        {msg && <div className={`olk-msg ${msg.ok ? 'success' : 'error'}`} style={{ flex: '1 1 100%' }}>{msg.text}</div>}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => download(false)}><Download size={13} /> {doc.source === 'UPLOAD' ? 'Original PDF' : 'PDF'}</button>
        {doc.status !== 'DRAFT' && <button className={`btn btn-sm ${doc.status === 'COMPLETED' ? 'btn-primary' : 'btn-outline'}`} disabled={busy} onClick={() => download(true)}><Download size={13} /> {doc.status === 'COMPLETED' ? 'Signed PDF' : 'PDF + certificate so far'}</button>}
        <span className="gl-grow" />
        {mine && <button className="btn btn-ghost btn-sm" onClick={() => onDuplicate(doc.id)}><Files size={13} /> Duplicate</button>}
        {mine && doc.status === 'DRAFT' && <>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('delete')}><Trash2 size={13} /> Delete</button>
          <button className="btn btn-outline btn-sm" onClick={() => onEdit(doc.id)}><Pencil size={13} /> Edit</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => sendDocument(doc.id), 'Sent — signers are being emailed')}><Send size={13} /> Send</button>
        </>}
        {mine && open && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('cancel')}><Ban size={13} /> Cancel</button>}
      </>}>
      {myTurn && open && (
        <div className="esg-note" style={{ marginBottom: 12 }}>
          It's your turn to sign. <button className="btn btn-primary btn-sm" onClick={() => onSign(doc.id)}><FileSignature size={13} /> Sign now</button>
        </div>
      )}
      <div style={{ marginBottom: 14 }}><Seg value={view} onChange={setView} options={[['summary', 'Summary'], ['document', 'Document'], ['trail', 'Audit trail', events.length]]} /></div>

      {view === 'summary' && (
        <>
          <dl className="eic-kvs two">
            <Field label="Status"><StatusPill status={doc.status} /></Field>
            <Field label="Other party">{doc.counterparty_name}</Field>
            <Field label="Value">{doc.contract_value != null ? fmtMoney(doc.contract_value, doc.currency) : null}</Field>
            <Field label="Effective / end">{doc.effective_date || doc.end_date ? `${doc.effective_date ? dateFmt(doc.effective_date) : '—'} → ${doc.end_date ? dateFmt(doc.end_date) : '—'}` : null}</Field>
            <Field label="Sent">{doc.sent_at ? fullTime(doc.sent_at) : null}</Field>
            <Field label="Completed">{doc.completed_at ? fullTime(doc.completed_at) : null}</Field>
            <Field label="Sign by">{doc.sign_by ? dateFmt(doc.sign_by) : null}</Field>
            <Field label="Identity check">{doc.require_otp ? 'Email code' : 'Link only'}</Field>
          </dl>
          {doc.cancel_reason && <div className="olk-msg error" style={{ marginTop: 10 }}>Cancelled: {doc.cancel_reason}</div>}
          {doc.content_hash && <div className="gl-meta esg-hash">SHA-256 {doc.content_hash}</div>}
          <Group title="Signers" hint={doc.signing_order === 'PARALLEL' ? 'Any order' : 'One after another'}>
            {signers.map(s => (
              <div key={s.id} className="esg-signer">
                <span className="esg-seq">{doc.signing_order === 'PARALLEL' ? '•' : s.seq}</span>
                <div className="esg-signer-main">
                  <b>{s.name}</b>
                  <span>{s.email}{s.role_label ? ` · ${s.role_label}` : ''}</span>
                  <span>{s.signed_at ? `Signed ${istTime(s.signed_at)}${s.ip ? ` · IP ${s.ip}` : ''}` : s.decline_reason ? `Declined: ${s.decline_reason}` : s.viewed_at ? `Opened ${ago(s.viewed_at)}` : s.notified_at ? `Emailed ${ago(s.notified_at)}` : ''}</span>
                </div>
                {s.signature_png && <img className="esg-sig-thumb" src={s.signature_png} alt={`Signature of ${s.name}`} />}
                <StatusPill status={s.status} signer />
                {mine && open && !['SIGNED', 'DECLINED'].includes(s.status) && (
                  <span className="esg-signer-tools">
                    <button className="btn btn-ghost btn-sm" title="Copy signing link" disabled={busy} onClick={() => copyLink(s)}><Copy size={13} /></button>
                    {s.status !== 'PENDING' && <button className="btn btn-ghost btn-sm" title="Send reminder" disabled={busy} onClick={() => act(() => remindSigner(s.id), `Reminder sent to ${s.email}`)}><BellRing size={13} /></button>}
                  </span>
                )}
              </div>
            ))}
            {!signers.length && <div className="gl-meta">No signers yet.</div>}
          </Group>
        </>
      )}
      {view === 'document' && (doc.source === 'UPLOAD' ? (file ? <PdfFrame bytes={file} name={doc.file_name} /> : <EmptyState icon={FileText} title="No PDF uploaded yet" />) : <DocumentText content={doc.content || ''} />)}
      {view === 'trail' && (
        <div className="esg-trail">
          {events.map(e => (
            <div key={e.id}><span className="gl-meta">{istTime(e.at)}</span><b>{eventLabel(e.event)}</b>
              <span>{signers.find(s => s.id === e.signer_id)?.name || ''}{e.detail?.reason ? ` — ${e.detail.reason}` : ''}{e.detail?.email && !e.signer_id ? ` ${e.detail.email}` : ''}</span>
              <span className="gl-meta">{e.ip || ''}</span></div>
          ))}
        </div>
      )}

      <Confirm open={confirm === 'delete'} danger message="Delete this draft? This can't be undone." onCancel={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); try { await deleteDraft(doc.id); onChanged(); onClose() } catch (e) { setMsg({ ok: false, text: e.message }) } }} />
      {confirm === 'cancel' && (
        <Drawer title="Cancel signing" subtitle={doc.doc_number} onClose={() => setConfirm(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Back</button><button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={async () => { await act(() => cancelDocument(doc.id, reason), 'Cancelled — the signing links no longer work'); setConfirm(null) }}>Cancel document</button></>}>
          <p className="gl-meta">The signing links stop working. Signatures already given stay in the audit trail.</p>
          <textarea className="form-input form-textarea" placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} />
        </Drawer>
      )}
    </Drawer>
  )
}

/* ── templates ── */
function TemplatesTab({ templates, canManage, onChanged, onUse }) {
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState(null)
  const save = async () => {
    setMsg(null)
    try {
      if (!edit.name.trim() || !edit.body.trim()) throw new Error('Give the template a name and some text')
      const fields = fieldsFor({ body: edit.body, fields: [] }).map(f => ({ ...f, label: edit.labels?.[f.key] || f.label }))
      await saveTemplate({ ...edit, fields })
      setEdit(null); onChanged()
    } catch (e) { setMsg(e.message) }
  }
  return (
    <>
      <div className="gl-meta" style={{ marginBottom: 10 }}>Put <code>{'{{field_name}}'}</code> in the text wherever a value goes — the field appears in the form when someone uses the template. Use <code>{'{{items_table}}'}</code> / <code>{'{{items_total}}'}</code> for line items.</div>
      <div className="esg-tpl-grid">
        {BUILT_IN_TEMPLATES.map(t => (
          <div key={t.key} className="esg-tpl static">
            <FileText size={18} /><div><b>{t.name}</b><span>{DOC_TYPE_LABEL[t.doc_type]} · built in · {fieldsFor(t).length} fields</span>
              <div className="esg-row" style={{ marginTop: 8 }}>
                {canManage && <button className="btn btn-ghost btn-sm" onClick={() => onUse(t)}>Use</button>}
                {canManage && <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ name: `${t.name} (ours)`, doc_type: t.doc_type, body: t.body })}><Files size={12} /> Copy & edit</button>}
              </div></div>
          </div>
        ))}
        {templates.map(t => (
          <div key={t.id} className="esg-tpl static">
            <FileText size={18} /><div><b>{t.name}</b><span>{DOC_TYPE_LABEL[t.doc_type] || t.doc_type} · updated {ago(t.updated_at)}</span>
              <div className="esg-row" style={{ marginTop: 8 }}>
                {canManage && <button className="btn btn-ghost btn-sm" onClick={() => onUse(t)}>Use</button>}
                {canManage && <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...t, labels: Object.fromEntries((t.fields || []).map(f => [f.key, f.label])) })}><Pencil size={12} /> Edit</button>}
                {canManage && <button className="btn btn-ghost btn-sm" onClick={async () => { await archiveTemplate(t.id); onChanged() }}><Trash2 size={12} /> Remove</button>}
              </div></div>
          </div>
        ))}
        {canManage && <button className="esg-tpl esg-tpl-upload" onClick={() => setEdit({ name: '', doc_type: 'AGREEMENT', body: '# Title\n\nThis agreement is made on {{effective_date}} between {{company_name}} and {{party_name}}.\n' })}><Plus size={18} /><div><b>New template</b><span>Write your own with fields</span></div></button>}
      </div>
      {edit && (
        <Drawer wide title={edit.id ? 'Edit template' : 'New template'} onClose={() => setEdit(null)}
          footer={<>{msg && <div className="olk-msg error" style={{ flex: '1 1 100%' }}>{msg}</div>}<button className="btn btn-ghost" onClick={() => setEdit(null)}>Close</button><button className="btn btn-primary" onClick={save}>Save template</button></>}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={edit.doc_type} onChange={e => setEdit({ ...edit, doc_type: e.target.value })}>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label">Text</label><textarea className="form-input form-textarea esg-text" value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} /></div>
          <Group title="Fields found in the text" hint="Rename how they are shown in the form">
            {fieldsFor({ body: edit.body, fields: [] }).map(f => (
              <div key={f.key} className="esg-row" style={{ marginBottom: 6 }}>
                <code style={{ minWidth: 160 }}>{f.key}</code>
                <input className="form-input" value={edit.labels?.[f.key] ?? f.label} onChange={e => setEdit({ ...edit, labels: { ...(edit.labels || {}), [f.key]: e.target.value } })} />
                <span className="gl-meta">{f.type}</span>
              </div>
            ))}
          </Group>
        </Drawer>
      )}
    </>
  )
}

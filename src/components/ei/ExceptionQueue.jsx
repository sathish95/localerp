import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import OpenInAgreements from '../esign/OpenInAgreements'
import { useAuth } from '../../context/AuthContext'
import { Modal } from '../ui'
import { Search } from '../golive/shared'
import {
  listExceptions, resolveException, assignException, reviewCreateInvoice, listAttachments, attachmentUrl, emailsByIds, procurementLookups,
  exceptionLabel, INVOICE_KINDS, invoicesByIds,
} from '../../lib/emailIntelligence'
import { categoryLabel } from '../../lib/outlookEmail'
import { Drawer, Group, Field, Seg, EmptyState, ago, fullTime, initials, pct, ConfBar, DecisionTrace, AiSuggestion } from './ui'
import { suggestAction, decisionTrace } from '../../lib/eiInsights'
import BankChangeReview from './BankChangeReview'
import { ExternalLink, FileText, CheckCircle2, XCircle, PlusCircle, RefreshCw, ShieldCheck, ShieldAlert, FileImage, FileSpreadsheet, File as FileIcon, AlertTriangle, Download } from 'lucide-react'

const PRIO_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }
const KIND_TONE = { BANK_DETAIL_CHANGE: 'red', VENDOR_MASTER_CHANGE: 'red', DUPLICATE_REVIEW: 'red', INVOICE_MISMATCH: 'red' }
const KIND_GROUPS = [
  ['', 'All kinds'], ['invoice', 'Invoice checks'], ['vendor', 'Vendor & bank'], ['category', 'Category reviews'],
]
const inGroup = (kind, g) => !g
  || (g === 'invoice' && INVOICE_KINDS.includes(kind) && kind !== 'VENDOR_VERIFICATION')
  || (g === 'vendor' && ['VENDOR_VERIFICATION', 'BANK_DETAIL_CHANGE', 'VENDOR_MASTER_CHANGE'].includes(kind))
  || (g === 'category' && kind.startsWith('CATEGORY_REVIEW:'))

// Exception Centre: everything the automation would not do on its own.
// One clean row per item; the evidence, extracted fields and actions open in a drawer.
export default function ExceptionQueue({ categories = [], people = [], onChanged }) {
  const { profile } = useAuth()
  const canFinance = ['admin', 'ceo', 'finance'].includes(profile?.role)
  const cats = useMemo(() => Object.fromEntries(categories.map(c => [c.code, c])), [categories])
  const [status, setStatus] = useState('OPEN')
  const [group, setGroup] = useState('')
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const [rows, setRows] = useState(null)
  const [emails, setEmails] = useState({})
  const [atts, setAtts] = useState({})
  const [sel, setSel] = useState(null)
  const [err, setErr] = useState('')
  const [resolving, setResolving] = useState(null)
  const [creating, setCreating] = useState(null)

  async function load() {
    setErr('')
    try {
      const list = await listExceptions({ status })
      setRows(list)
      const [e, a] = await Promise.all([emailsByIds(list.map(x => x.message_id).filter(Boolean)), listAttachments({ ids: list.map(x => x.attachment_id).filter(Boolean) })])
      setEmails(e); setAtts(Object.fromEntries(a.map(x => [x.id, x])))
    } catch (e) { setErr(e.message); setRows([]) }
  }
  useEffect(() => { setRows(null); setSel(null); load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  const peopleById = Object.fromEntries(people.map(p => [p.id, p.full_name]))
  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(x => inGroup(x.kind, group)
    && (!mine || x.assigned_to === profile?.id || (!x.assigned_to && x.assigned_role === profile?.role))
    && (!ql || `${x.summary} ${emails[x.message_id]?.sender_email || ''} ${emails[x.message_id]?.subject || ''}`.toLowerCase().includes(ql)))
    .sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9) || new Date(b.created_at) - new Date(a.created_at))
  const groupCount = g => (rows || []).filter(x => inGroup(x.kind, g)).length
  const done = async () => { await load(); onChanged?.() }
  const current = sel && rows?.find(x => x.id === sel)

  return (
    <div className="table-wrap">
      <div className="gl-bar">
        <Search value={q} onChange={setQ} placeholder="Summary, sender or subject…" />
        <Seg value={status} onChange={setStatus} options={[['OPEN', 'Open'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed']]} />
        <Seg value={group} onChange={setGroup} options={KIND_GROUPS.map(([k, l]) => [k, l, k ? groupCount(k) : null])} />
        <label className="eic-check"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Mine</label>
        <div className="gl-grow" />
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button>
      </div>
      {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
      <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
        <table className="gl-table eic-list">
          <thead><tr><th style={{ width: 200 }}>Type</th><th>What needs doing</th><th style={{ width: 210 }}>From</th><th style={{ width: 150 }}>Owner</th><th style={{ width: 90 }} className="num">Raised</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="gl-st-empty">Loading…</td></tr>}
            {rows && !shown.length && <tr><td colSpan={5}><EmptyState icon={ShieldCheck} title={status === 'OPEN' ? 'All clear' : 'Nothing here'}>{status === 'OPEN' ? 'Every email was handled automatically.' : ''}</EmptyState></td></tr>}
            {shown.map(x => {
              const em = emails[x.message_id]
              return (
                <tr key={x.id} className={`eic-row${sel === x.id ? ' sel' : ''}`} onClick={() => setSel(x.id)}>
                  <td><div className="eic-kind"><span className="eic-kind-bar" style={{ background: { critical: '#dc2626', high: '#ea580c', medium: '#6366f1', low: '#94a3b8' }[x.priority] }} /><div><div className="eic-kind-n">{exceptionLabel(x.kind, cats)}</div><div className="eic-kind-p">{x.priority}</div></div></div></td>
                  <td><div className="eic-clip2">{x.summary}</div></td>
                  <td>{em ? <div className="eic-who"><span className="gl-st-av">{initials(em.sender_name || em.sender_email)}</span><div style={{ minWidth: 0 }}><div className="eic-who-n">{em.sender_name || em.sender_email}</div><div className="eic-who-e">{em.subject}</div></div></div> : <span className="gl-st-zero">—</span>}</td>
                  <td>{x.status === 'OPEN' ? (x.assigned_to ? <span className="eic-owner">{peopleById[x.assigned_to] || 'Assigned'}</span> : <span className="eic-owner queue">{(x.assigned_role || 'finance').replace('_', ' ')} queue</span>) : <span className="gl-meta">{peopleById[x.resolved_by] || '—'}</span>}</td>
                  <td className="num gl-meta" title={fullTime(x.created_at)}>{ago(x.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {current && <ExceptionDrawer x={current} em={emails[current.message_id]} att={atts[current.attachment_id]} cats={cats} people={people} canFinance={canFinance}
        onClose={() => setSel(null)} onAssign={uid => assignException(current.id, uid).then(done).catch(e => setErr(e.message))}
        onResolve={s => setResolving({ x: current, status: s })} onCreate={() => setCreating(current)} onDone={async () => { setSel(null); await done() }} />}
      {resolving && <ResolveModal {...resolving} onClose={() => setResolving(null)} onDone={async () => { setResolving(null); setSel(null); await done() }} />}
      {creating && <CreateInvoiceModal x={creating} att={atts[creating.attachment_id]} onClose={() => setCreating(null)} onDone={async () => { setCreating(null); setSel(null); await done() }} />}
    </div>
  )
}

function ExceptionDrawer({ x, em, att, cats, people, canFinance, onClose, onAssign, onResolve, onCreate, onDone }) {
  const [inv, setInv] = useState({})
  const d = x.detail || {}
  useEffect(() => { invoicesByIds([d.existing_invoice_id, d.original_invoice_id, ...(d.invoice_ids || []), att?.invoice_id]).then(setInv) }, [x.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const sensitive = ['BANK_DETAIL_CHANGE', 'VENDOR_MASTER_CHANGE'].includes(x.kind)
  const open = x.status === 'OPEN'
  const canAct = open && (!sensitive || canFinance)
  const canCreate = canFinance && open && att && !att.invoice_id && INVOICE_KINDS.includes(x.kind) && x.kind !== 'CREDIT_NOTE'
  const failed = [...(d.failed || []), ...((d.checks || []).filter(c => !c.ok))]
  if (sensitive) {
    return (
      <Drawer wide title={exceptionLabel(x.kind, cats)} subtitle={`${em?.sender_email || 'Unknown sender'} · raised ${fullTime(x.created_at)} · ${x.priority} priority`} onClose={onClose}
        footer={<>{open && <select className="form-select" style={{ maxWidth: 260 }} value={x.assigned_to || ''} onChange={e => onAssign(e.target.value)}>
          <option value="">{(x.assigned_role || 'finance').replace('_', ' ')} queue (unassigned)</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
          <span style={{ flex: 1 }} /><button className="btn btn-ghost" onClick={onClose}>Close</button></>}>
        <BankChangeReview x={x} em={em} canFinance={canFinance} onDone={onDone} />
      </Drawer>
    )
  }
  return (
    <Drawer wide title={exceptionLabel(x.kind, cats)} subtitle={`Raised ${fullTime(x.created_at)} · ${x.priority} priority${x.config_version ? ` · config v${x.config_version}` : ''}`} onClose={onClose}
      footer={<>
        {em?.web_link && <a className="btn btn-ghost" href={em.web_link} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Outlook</a>}
        <span style={{ flex: 1 }} />
        {canAct && <button className="btn btn-ghost" onClick={() => onResolve('DISMISSED')}><XCircle size={13} /> Dismiss</button>}
        {canAct && <button className={`btn ${canCreate ? 'btn-ghost' : 'btn-primary'}`} onClick={() => onResolve('RESOLVED')}><CheckCircle2 size={13} /> Resolve</button>}
        {canCreate && <button className="btn btn-primary" onClick={onCreate}><PlusCircle size={13} /> Correct & create invoice</button>}
      </>}>
      <div className={`eic-callout ${sensitive || x.priority === 'critical' || x.priority === 'high' ? 'bad' : ''}`}><b>{open ? 'To do' : x.status === 'RESOLVED' ? 'Resolved' : 'Dismissed'}</b><span>{x.summary}</span></div>
      {open && <AiSuggestion>{suggestAction(x)}</AiSuggestion>}
      {sensitive && <div className="eic-callout bad"><ShieldAlert size={14} /><span>Do not change vendor bank or master details from this email. Verify with the vendor on a phone number already in the vendor master, then update the master through its normal approval.</span></div>}
      {x.resolution_note && <div className="eic-callout"><b>Resolution</b><span>{x.resolution_note}</span></div>}
      {failed.length > 0 && <Group title="Checks that failed"><ul className="eic-fails">{failed.map((f, i) => <li key={i}><AlertTriangle size={13} /> {f.detail}</li>)}</ul></Group>}

      {open && <Group title="Owner">
        <select className="form-select" value={x.assigned_to || ''} onChange={e => onAssign(e.target.value)}>
          <option value="">{(x.assigned_role || 'finance').replace('_', ' ')} queue (unassigned)</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </Group>}

      {em && <Group title="Email">
        <dl className="eic-kvs">
          <Field label="Subject">{em.subject || '(no subject)'}</Field>
          <Field label="From">{em.sender_name ? `${em.sender_name} <${em.sender_email}>` : em.sender_email}</Field>
          <Field label="Received">{fullTime(em.received_at)}</Field>
          {em.intents?.primary && <Field label="Intent">{categoryLabel(em.intents.primary)}{em.intents.secondary?.length ? <span className="gl-meta"> + {em.intents.secondary.map(categoryLabel).join(', ')}</span> : null}</Field>}
        </dl>
      </Group>}

      {att && <Group title="Decision trace" hint="How the automation handled this document"><DecisionTrace steps={decisionTrace(att, [x.kind])} /></Group>}

      {att && <Group title="Document">
        <div className="eic-doc-card">
          <DocIcon name={att.file_name} />
          <div style={{ flex: 1, minWidth: 0 }}><div className="eic-who-n">{att.file_name}</div><div className="gl-meta">{(att.doc_type_code || 'Unknown').replace(/_/g, ' ').toLowerCase()} · text via {att.text_method || '—'}</div></div>
          {att.storage_path && <button className="btn btn-ghost btn-sm" onClick={async () => window.open(await attachmentUrl(att.storage_path), '_blank', 'noopener')}><FileText size={12} /> Open</button>}
        </div>
        <dl className="eic-kvs" style={{ marginTop: 10 }}>
          <Field label="Classified"><ConfBar v={att.doc_confidence} /></Field>
          <Field label="Extraction">{att.extraction_confidence != null ? <ConfBar v={att.extraction_confidence} /> : null}</Field>
          {att.vendor_method && <Field label="Vendor match">{att.vendor_method.toLowerCase()} <span className="gl-meta">({pct(att.vendor_confidence)})</span></Field>}
        </dl>
      </Group>}

      {(d.payload || att?.extraction) && <Group title="Extracted data">
        <dl className="eic-kvs two">
          {Object.entries(att?.extraction || {}).map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')}>{String(v.value)} <span className="gl-meta">{pct(v.confidence)}</span></Field>)}
          {!att?.extraction && d.payload && Object.entries(d.payload).filter(([, v]) => v != null && v !== '').map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')}>{String(v)}</Field>)}
        </dl>
      </Group>}

      {(d.candidates?.length > 0 || Object.values(inv).length > 0) && <Group title="Related">
        {d.candidates?.length > 0 && <div className="gl-meta" style={{ marginBottom: 6 }}>Candidates: {d.candidates.map(c => c.name || c.po_number || c.id).join(', ')}</div>}
        {Object.values(inv).map(i => <Link key={i.id} to="/invoices" className="eic-link-chip" style={{ marginRight: 6 }}>{i.invoice_number} · ₹{Number(i.total_amount).toLocaleString('en-IN')} · {i.status}</Link>)}
      </Group>}
    </Drawer>
  )
}

function DocIcon({ name }) {
  const ext = (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1]
  const Icon = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? FileImage : ['xlsx', 'xls', 'csv'].includes(ext) ? FileSpreadsheet : ext === 'pdf' ? FileText : FileIcon
  return <span className={`eic-docicon ${ext || ''}`}><Icon size={16} /></span>
}

function ResolveModal({ x, status, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  return (
    <Modal open onClose={onClose} title={`${status === 'RESOLVED' ? 'Resolve' : 'Dismiss'} — ${x.summary.slice(0, 60)}`}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!note.trim()} onClick={() => resolveException(x.id, status, note).then(onDone).catch(e => setErr(e.message))}>{status === 'RESOLVED' ? 'Resolve' : 'Dismiss'}</button></>}>
      {err && <div className="olk-msg error">{err}</div>}
      <div className="form-group"><label className="form-label">What was done / why (required, kept in the audit trail)</label><textarea className="form-textarea" rows={4} value={note} onChange={e => setNote(e.target.value)} /></div>
    </Modal>
  )
}

function CreateInvoiceModal({ x, att, onClose, onDone }) {
  const p = x.detail?.payload || {}
  const ex = att?.extraction || {}
  const v = k => p[k] ?? ex[k === 'gst_amount' ? 'tax_amount' : k === 'subtotal' ? 'taxable_amount' : k]?.value ?? ''
  const [lk, setLk] = useState({ vendors: [], pos: [], projects: [] })
  const [f, setF] = useState({ vendor_id: p.vendor_id || att?.vendor_id || '', invoice_number: v('invoice_number'), invoice_date: v('invoice_date'), due_date: v('due_date'),
    po_id: p.po_id || att?.po_id || '', project_id: p.project_id || att?.project_id || '', subtotal: v('subtotal'), gst_amount: v('gst_amount'), total_amount: v('total_amount'), currency: p.currency || 'INR' })
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { procurementLookups().then(setLk) }, [])
  const set = (k, val) => setF(o => ({ ...o, [k]: val }))
  const pos = lk.pos.filter(po => !f.vendor_id || po.vendor_id === f.vendor_id)
  async function save() {
    setBusy(true); setErr('')
    try {
      const r = await reviewCreateInvoice(att.id, { ...f, po_id: f.po_id || null, project_id: f.project_id || null, total_amount: Number(f.total_amount), subtotal: f.subtotal === '' ? null : Number(f.subtotal), gst_amount: f.gst_amount === '' ? 0 : Number(f.gst_amount) }, note)
      if (r.status === 'CREATED' || r.status === 'EXISTS') await onDone()
      else setErr(r.status === 'DUPLICATE' ? 'This vendor already has an invoice with that number in the register.' : r.reason || r.status)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Correct & create invoice"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.vendor_id || !String(f.invoice_number).trim() || !f.total_amount || !note.trim()} onClick={save}>{busy ? 'Creating…' : 'Create invoice'}</button></>}>
      <div className="olk-hint" style={{ marginTop: 0 }}>Creates the invoice in the invoice register with status "uploaded", linked to this email and file. The same ownership and duplicate checks run again; verification, matching approval and payment stay in Invoices.</div>
      {err && <div className="olk-msg error">{err}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Vendor *</label><select className="form-select" value={f.vendor_id} onChange={e => set('vendor_id', e.target.value)}><option value="">Choose…</option>{lk.vendors.filter(x => x.status === 'active').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Invoice number *</label><input className="form-input" value={f.invoice_number} onChange={e => set('invoice_number', e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Invoice date</label><input className="form-input" type="date" value={f.invoice_date || ''} onChange={e => set('invoice_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Due date</label><input className="form-input" type="date" value={f.due_date || ''} onChange={e => set('due_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">PO</label><select className="form-select" value={f.po_id} onChange={e => { const po = lk.pos.find(x => x.id === e.target.value); set('po_id', e.target.value); if (po?.project_id) set('project_id', po.project_id) }}><option value="">No PO</option>{pos.map(po => <option key={po.id} value={po.id}>{po.po_number} · {po.total_amount}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Project</label><select className="form-select" value={f.project_id} onChange={e => set('project_id', e.target.value)}><option value="">—</option>{lk.projects.map(pr => <option key={pr.id} value={pr.id}>{pr.code} · {pr.name}</option>)}</select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Taxable amount</label><input className="form-input" type="number" value={f.subtotal} onChange={e => set('subtotal', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Tax</label><input className="form-input" type="number" value={f.gst_amount} onChange={e => set('gst_amount', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Total *</label><input className="form-input" type="number" value={f.total_amount} onChange={e => set('total_amount', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Currency</label><input className="form-input" value={f.currency} onChange={e => set('currency', e.target.value.toUpperCase().slice(0, 3))} /></div>
      </div>
      <div className="form-group"><label className="form-label">Reason for the manual correction *</label><textarea className="form-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. PO number was handwritten; confirmed with the vendor" /></div>
    </Modal>
  )
}


const OUT = { INVOICE_CREATED: ['Invoice created', 'green'], EXCEPTION: ['In review', 'amber'], RECORDED: ['Recorded', 'gray'], SKIPPED: ['Skipped', 'gray'] }

// Documents: every attachment, classified on its own.
export function DocumentQueue() {
  const [rows, setRows] = useState(null)
  const [emails, setEmails] = useState({})
  const [invs, setInvs] = useState({})
  const [q, setQ] = useState('')
  const [out, setOut] = useState('')
  const [sel, setSel] = useState(null)
  const [err, setErr] = useState('')
  const [kinds, setKinds] = useState({})
  useEffect(() => {
    listExceptions({ status: 'OPEN', limit: 1000 }).then(xs => {
      const m = {}; for (const x of xs) if (x.attachment_id) (m[x.attachment_id] ||= []).push(x.kind)
      setKinds(m)
    }).catch(() => {})
    listAttachments({ limit: 300 }).then(async list => {
      setRows(list)
      const [e, i] = await Promise.all([emailsByIds(list.map(x => x.message_id)), invoicesByIds(list.map(x => x.invoice_id))])
      setEmails(e); setInvs(i)
    }).catch(e => { setErr(e.message); setRows([]) })
  }, [])
  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(a => (!out || a.outcome === out) && (!ql || `${a.file_name} ${a.doc_type_code} ${emails[a.message_id]?.sender_email || ''}`.toLowerCase().includes(ql)))
  const n = k => (rows || []).filter(a => a.outcome === k).length
  const current = sel && rows?.find(a => a.id === sel)
  return (
    <div className="table-wrap">
      <div className="gl-bar">
        <Search value={q} onChange={setQ} placeholder="File, type or sender…" />
        <Seg value={out} onChange={setOut} options={[['', 'All'], ['INVOICE_CREATED', 'Invoice created', n('INVOICE_CREATED')], ['EXCEPTION', 'In review', n('EXCEPTION')], ['RECORDED', 'Recorded', n('RECORDED')], ['SKIPPED', 'Skipped', n('SKIPPED')]]} />
      </div>
      {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
      <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
        <table className="gl-table eic-list">
          <thead><tr><th>File</th><th style={{ width: 190 }}>Document type</th><th style={{ width: 120 }}>Extraction</th><th style={{ width: 210 }}>From</th><th style={{ width: 170 }}>Outcome</th><th style={{ width: 90 }} className="num">Received</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="gl-st-empty">Loading…</td></tr>}
            {rows && !shown.length && <tr><td colSpan={6}><EmptyState icon={FileText} title="No documents yet." /></td></tr>}
            {shown.map(a => {
              const em = emails[a.message_id]
              const [ol, tone] = OUT[a.outcome] || [a.status, 'gray']
              const inv = invs[a.invoice_id]
              return (
                <tr key={a.id} className={`eic-row${sel === a.id ? ' sel' : ''}`} onClick={() => setSel(a.id)}>
                  <td><div className="eic-who"><DocIcon name={a.file_name} /><div style={{ minWidth: 0 }}><div className="eic-who-n">{a.file_name}</div><div className="eic-who-e">{a.text_method === 'NONE' ? 'no text layer' : a.text_method?.toLowerCase().replace('_', ' ')}{a.skip_reason ? ` · ${a.skip_reason}` : ''}</div></div></div></td>
                  <td><div className="eic-who-n" style={{ fontWeight: 600 }}>{(a.doc_type_code || '—').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())}</div><ConfBar v={a.doc_confidence} /></td>
                  <td>{a.extraction_confidence != null ? <ConfBar v={a.extraction_confidence} /> : <span className="gl-st-zero">—</span>}</td>
                  <td>{em ? <><div className="eic-who-n">{em.sender_name || em.sender_email}</div><div className="eic-who-e">{em.subject}</div></> : '—'}</td>
                  <td><span className={`gl-pill ${tone}`}>{ol}</span>{inv && <div className="eic-who-e">{inv.invoice_number} · {inv.match_status}</div>}</td>
                  <td className="num gl-meta" title={fullTime(a.created_at)}>{ago(a.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {current && <DocumentDrawer a={current} em={emails[current.message_id]} inv={invs[current.invoice_id]} kinds={kinds[current.id] || []} onClose={() => setSel(null)} />}
    </div>
  )
}

function DocumentDrawer({ a, em, inv, kinds, onClose }) {
  const [ol, tone] = OUT[a.outcome] || [a.status, 'gray']
  const checks = Array.isArray(a.validations) ? a.validations : []
  return (
    <Drawer wide title={a.file_name} subtitle={`${(a.doc_type_code || 'Unknown').replace(/_/g, ' ').toLowerCase()} · config v${a.config_version ?? '—'}`} onClose={onClose}
      footer={<>{a.storage_path && <OpenInAgreements att={a} />}
        {a.storage_path && <button className="btn btn-ghost" onClick={async () => window.open(await attachmentUrl(a.storage_path), '_blank', 'noopener')}><Download size={13} /> Download</button>}
        {em?.web_link && <a className="btn btn-ghost" href={em.web_link} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Outlook</a>}<span style={{ flex: 1 }} /></>}>
      <div className="eic-drawer-status"><span className={`gl-pill ${tone}`}>{ol}</span>{inv && <Link to="/invoices" className="eic-link-chip">{inv.invoice_number} · {inv.match_status}</Link>}</div>
      {a.outcome_reason && <div className={`eic-callout ${a.outcome === 'EXCEPTION' ? 'bad' : ''}`}><b>Outcome</b><span>{a.outcome_reason}</span></div>}
      <Group title="Decision trace" hint="Each step the automation took, with its confidence"><DecisionTrace steps={decisionTrace(a, kinds)} /></Group>
      <Group title="Classification">
        <dl className="eic-kvs">
          <Field label="Document type">{(a.doc_type_code || '—').replace(/_/g, ' ').toLowerCase()}</Field>
          <Field label="Confidence"><ConfBar v={a.doc_confidence} /></Field>
          <Field label="Text">{a.text_method}</Field>
          {(a.doc_rules || []).length > 0 && <Field label="Rules">{a.doc_rules.map(r => r.name).join(', ')}</Field>}
        </dl>
      </Group>
      {a.extraction && Object.keys(a.extraction).length > 0 && <Group title="Extracted fields" hint={a.extraction_confidence != null ? `Overall ${pct(a.extraction_confidence)}` : null}>
        <dl className="eic-kvs two">{Object.entries(a.extraction).map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')}>{String(v.value)} <span className="gl-meta">{pct(v.confidence)} · {v.source}</span></Field>)}</dl>
      </Group>}
      {(a.vendor_method || a.po_id) && <Group title="Matching">
        <dl className="eic-kvs">
          <Field label="Vendor">{a.vendor_method ? `${a.vendor_method.toLowerCase()} (${pct(a.vendor_confidence)})` : 'not identified'}</Field>
          <Field label="PO">{a.po_id ? 'matched' : 'not matched'}</Field>
          <Field label="Receipts">{a.grn_ids?.length ? `${a.grn_ids.length} GRN` : 'none'}</Field>
        </dl>
      </Group>}
      {checks.length > 0 && <Group title="Checks">
        <ul className="eic-checks">{checks.map((c, i) => <li key={i} className={c.ok ? 'ok' : 'bad'}>{c.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}<span>{c.ok ? c.check.replace(/[_:]/g, ' ') : c.detail}</span></li>)}</ul>
      </Group>}
      {em && <Group title="Email"><dl className="eic-kvs"><Field label="Subject">{em.subject}</Field><Field label="From">{em.sender_email}</Field><Field label="Received">{fullTime(em.received_at)}</Field></dl></Group>}
    </Drawer>
  )
}

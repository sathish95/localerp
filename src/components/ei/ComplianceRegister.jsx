import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Modal } from '../ui'
import { Drawer, Group, Stats, EmptyState } from './ui'
import {
  loadRegister, lifecycleTemplates, importLifecycleTemplates, createRegister, saveRegisterItem, deleteRegisterItem,
  projectDocuments, documentTypeOptions, attachmentUrl, registerOverview, procurementLookups,
} from '../../lib/emailIntelligence'
import { evaluateRegister, STATE_LABEL, EXPIRY_LABEL } from '../../../supabase/functions/_shared/eiCompliance.js'
import { ClipboardCheck, Plus, AlertTriangle, AlertCircle, Info, FileText, Pencil, Trash2 } from 'lucide-react'

// Project Document Compliance Register (STEP272): required vs received
// documents per lifecycle stage, approvals, statutory permits and expiring
// guarantees. Items are satisfied by documents filed on the project by Email
// Intelligence; approvals, waivers and N/A are recorded by a person only.

const MANAGE_ROLES = ['admin', 'ceo', 'manager', 'department_head']
const STATE_TONE = { MISSING: 'red', RECEIVED: 'green', AWAITING_APPROVAL: 'amber', APPROVED: 'green', WAIVED: 'gray', NOT_APPLICABLE: 'gray' }
const EXP_TONE = { VALID: 'green', EXPIRING: 'amber', EXPIRED: 'red', UNKNOWN: 'gray' }
const SEV_ICON = [Info, Info, AlertCircle, AlertTriangle]
const SEV_COLOR = ['#64748b', '#2563eb', '#d97706', '#dc2626']
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
const fmt = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export default function ComplianceRegister({ project }) {
  const { profile } = useAuth()
  const canManage = MANAGE_ROLES.includes(profile?.role)
  const [data, setData] = useState(undefined)   // undefined = loading, null = no register
  const [docs, setDocs] = useState([])
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    setErr('')
    Promise.all([loadRegister(project.id), projectDocuments(project.id).catch(() => [])])
      .then(([r, d]) => { setData(r); setDocs(d) })
      .catch(e => { setErr(e.message); setData(null) })
  }, [project.id, bump])
  const ev = useMemo(() => data ? evaluateRegister({ items: data.items, stages: data.stages, documents: docs, today: todayIST(), expiringDays: data.register.expiring_days }) : null, [data, docs])
  const reload = () => setBump(b => b + 1)

  if (data === undefined) return <div className="card" style={{ padding: 20 }}>Loading…</div>
  if (!data) return <Setup project={project} canManage={canManage} err={err} onCreated={reload} />

  const t = ev.totals
  async function quick(item, patch, note) {
    try { await saveRegisterItem({ ...item, ...patch, ...(note != null ? { status_note: note } : {}) }); reload() } catch (e) { alert(e.message) }
  }
  return (
    <div>
      {err && <div className="olk-msg error">{err}</div>}
      <Stats items={[
        ['Complete', t.pct == null ? '—' : `${t.pct}%`, t.pct === 100 ? 'good' : ''], ['Missing', t.missing, t.missing ? 'warn' : 'good'],
        ['Statutory missing', t.statutoryMissing, t.statutoryMissing ? 'bad' : ''], ['Awaiting approval', t.awaitingApproval, t.awaitingApproval ? 'warn' : ''],
        ['Expired', t.expired, t.expired ? 'bad' : ''], ['Expiring ≤ ' + data.register.expiring_days + ' d', t.expiring, t.expiring ? 'warn' : ''], ['Overdue', t.overdue, t.overdue ? 'bad' : ''],
      ]} />
      <div className="creg-head">
        <div><b>{data.register.name}</b>{ev.current && <span className="gl-meta"> · current stage: {ev.current.name}</span>}</div>
        {canManage && <button className="btn btn-outline btn-sm" onClick={() => setEdit({ register_id: data.register.id, project_id: project.id, stage_id: ev.current?.id || data.stages[0]?.id || null, document_type_code: '', label: '', required: true, needs_approval: false, is_statutory: false, tracks_expiry: false, status: 'OPEN', sort_order: 900 })}><Plus size={13} /> Add requirement</button>}
      </div>
      {ev.alerts.length > 0 && <div className="card creg-alerts">
        {ev.alerts.slice(0, 8).map((a, i) => { const Icon = SEV_ICON[a.sev]; return <div key={i} className="creg-alert"><Icon size={14} color={SEV_COLOR[a.sev]} /><span>{a.text}</span></div> })}
        {ev.alerts.length > 8 && <div className="gl-meta">+{ev.alerts.length - 8} more below</div>}
      </div>}
      {ev.stages.map(s => (
        <div key={s.id || 'other'} className="card creg-stage">
          <div className="creg-stage-h">
            <span className="creg-seq">{s.seq < 999 ? s.seq : '·'}</span>
            <b>{s.name}</b>
            <span className="gl-grow" />
            {s.required > 0 && <span className="gl-meta">{s.done}/{s.required} required</span>}
            {s.required > 0 && <div className="creg-bar"><div style={{ width: `${(s.done / s.required) * 100}%`, background: s.done === s.required ? '#059669' : '#6366f1' }} /></div>}
          </div>
          <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
            <table className="gl-table eic-list">
              <tbody>
                {!s.items.length && <tr><td className="gl-st-empty">No requirements in this stage.</td></tr>}
                {s.items.map(i => (
                  <tr key={i.id}>
                    <td style={{ minWidth: 220 }}>
                      <div className="eic-who-n" style={{ fontWeight: 600 }}>{i.label || i.document_type_code}</div>
                      <div className="creg-flags">{!i.required && <span>optional</span>}{i.is_statutory && <span className="red">statutory</span>}{i.needs_approval && <span>approval</span>}{i.tracks_expiry && <span>expiry</span>}</div>
                    </td>
                    <td style={{ width: 150 }}><span className={`gl-pill ${STATE_TONE[i.state]}`}>{STATE_LABEL[i.state]}</span>{i.overdue && <div className="eic-who-e" style={{ color: '#dc2626' }}>due {fmt(i.due_date)}</div>}{!i.overdue && i.due_date && !i.done && <div className="eic-who-e">due {fmt(i.due_date)}</div>}</td>
                    <td style={{ width: 230 }}>{i.latest ? <button className="creg-doc" onClick={async () => { if (i.latest.storage_path) window.open(await attachmentUrl(i.latest.storage_path), '_blank', 'noopener') }}><FileText size={12} /> {i.latest.title || i.latest.file_name}</button> : <span className="gl-st-zero">—</span>}
                      {i.docs.length > 1 && <div className="eic-who-e">{i.docs.length} documents</div>}{i.approval_ref && <div className="eic-who-e">Approval ref {i.approval_ref}</div>}</td>
                    <td style={{ width: 150 }}>{i.expiryState ? <><span className={`gl-pill ${EXP_TONE[i.expiryState]}`}>{EXPIRY_LABEL[i.expiryState]}</span>{i.expiry && <div className="eic-who-e">{fmt(i.expiry)}</div>}</> : <span className="gl-st-zero">—</span>}</td>
                    <td style={{ width: 220, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {canManage && i.state === 'AWAITING_APPROVAL' && <button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...i, status: 'APPROVED', _focus: 'approve' })}>Record approval</button>}
                      {canManage && <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEdit({ ...i })}><Pencil size={12} /></button>}
                      {canManage && i.status !== 'OPEN' && <button className="btn btn-ghost btn-sm" onClick={() => quick(i, { status: 'OPEN' }, null)}>Reopen</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {edit && <ItemDrawer row={edit} stages={data.stages} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </div>
  )
}

function Setup({ project, canManage, err, onCreated }) {
  const [templates, setTemplates] = useState(null)
  const [tpl, setTpl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(err)
  const load = () => lifecycleTemplates().then(t => { setTemplates(t); if (t[0] && !tpl) setTpl(t[0].id) }).catch(e => { setMsg(e.message); setTemplates([]) })
  useEffect(() => { load() }, [])
  async function run(fn) { setBusy(true); setMsg(''); try { await fn() } catch (e) { setMsg(e.message) } setBusy(false) }
  return (
    <div className="card eic-empty-setup">
      <ClipboardCheck size={28} />
      <h3>No compliance register for this project</h3>
      <p>Optional for contract-driven projects (government, EPC, IT delivery): track required vs received documents per stage, approvals, statutory permits and expiring guarantees. Documents filed on the project by email count automatically.</p>
      {msg && <div className="olk-msg error">{msg}</div>}
      {!canManage ? <div className="gl-meta">An admin, CEO or manager can set it up.</div>
        : templates && !templates.length ? <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await importLifecycleTemplates(); await load() })}>Load starting templates</button>
        : templates && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <select className="form-select" style={{ width: 'auto' }} value={tpl} onChange={e => setTpl(e.target.value)}>{templates.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="">Empty register</option></select>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await createRegister(project.id, tpl || null); onCreated() })}>Create register</button>
          </div>}
      <div className="gl-meta" style={{ marginTop: 8 }}>Templates are starting points — every item can be changed, waived or marked not applicable for this project. Load the baseline document taxonomy (Email Intelligence → Configuration → Document types) so the documents can match.</div>
    </div>
  )
}

function ItemDrawer({ row, stages, onClose, onSaved }) {
  const [f, setF] = useState({ ...row })
  const [types, setTypes] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState(false)
  useEffect(() => { documentTypeOptions().then(setTypes) }, [])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const needsNote = ['WAIVED', 'NOT_APPLICABLE'].includes(f.status) && !String(f.status_note || '').trim()
  async function save() {
    setBusy(true); setErr('')
    try {
      const { _focus, ...r } = f
      await saveRegisterItem({ ...r, label: r.label || types.find(t => t.code === r.document_type_code)?.name || r.document_type_code, expiry_date: r.expiry_date || null, due_date: r.due_date || null })
      onSaved()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <Drawer title={row.id ? (row.label || row.document_type_code) : 'New requirement'} subtitle="Compliance register item" onClose={onClose}
      footer={<>{row.id && <button className="btn btn-ghost" onClick={() => setDel(true)}><Trash2 size={13} /> Remove</button>}<span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.document_type_code || needsNote} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      {err && <div className="olk-msg error">{err}</div>}
      <Group title="Requirement">
        <div className="form-group"><label className="form-label">Document type *</label><select className="form-select" value={f.document_type_code} onChange={e => set('document_type_code', e.target.value)}><option value="">Choose…</option>{types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Label</label><input className="form-input" value={f.label || ''} onChange={e => set('label', e.target.value)} placeholder="Defaults to the type name" /></div>
          <div className="form-group"><label className="form-label">Stage</label><select className="form-select" value={f.stage_id || ''} onChange={e => set('stage_id', e.target.value || null)}><option value="">Other</option>{stages.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}</select></div>
        </div>
        <div className="creg-checks">
          {[['required', 'Required'], ['needs_approval', 'Needs approval'], ['is_statutory', 'Statutory'], ['tracks_expiry', 'Track expiry']].map(([k, l]) => (
            <label key={k}><input type="checkbox" checked={!!f[k]} onChange={e => set(k, e.target.checked)} /> {l}</label>))}
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Due date</label><input className="form-input" type="date" value={f.due_date || ''} onChange={e => set('due_date', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Expiry date</label><input className="form-input" type="date" value={f.expiry_date || ''} onChange={e => set('expiry_date', e.target.value)} /><div className="olk-hint">Leave empty to use the date read from the document.</div></div>
        </div>
      </Group>
      <Group title="Status" hint="Approval, waiver and N/A are recorded by you — never taken from an email">
        <select className="form-select" value={f.status} onChange={e => set('status', e.target.value)}>
          <option value="OPEN">Open — follows the documents received</option>
          <option value="APPROVED">Approved</option>
          <option value="WAIVED">Waived</option>
          <option value="NOT_APPLICABLE">Not applicable</option>
        </select>
        {f.status === 'APPROVED' && <div className="form-group" style={{ marginTop: 10 }}><label className="form-label">Approval reference</label><input className="form-input" value={f.approval_ref || ''} onChange={e => set('approval_ref', e.target.value)} placeholder="e.g. authority letter no." autoFocus={row._focus === 'approve'} /></div>}
        <div className="form-group" style={{ marginTop: 10 }}><label className="form-label">Note{['WAIVED', 'NOT_APPLICABLE'].includes(f.status) ? ' *' : ''}</label><input className="form-input" value={f.status_note || ''} onChange={e => set('status_note', e.target.value)} /></div>
      </Group>
      {del && <Modal open onClose={() => setDel(false)} title="Remove requirement?" footer={<><button className="btn btn-ghost" onClick={() => setDel(false)}>Cancel</button><button className="btn btn-danger" onClick={async () => { try { await deleteRegisterItem(row.id); onSaved() } catch (e) { setErr(e.message); setDel(false) } }}>Remove</button></>}>
        This removes the requirement from this project's register only. The change is kept in the register's audit trail.</Modal>}
    </Drawer>
  )
}

/* ── cross-project overview (Email Intelligence → Compliance registers) ── */
export function ComplianceOverview() {
  const [rows, setRows] = useState(null)
  const [projects, setProjects] = useState({})
  const [err, setErr] = useState('')
  useEffect(() => {
    registerOverview().then(setRows).catch(e => { setErr(e.message); setRows([]) })
    procurementLookups().then(l => setProjects(Object.fromEntries(l.projects.map(p => [p.id, p])))).catch(() => {})
  }, [])
  return (
    <div className="table-wrap">
      {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
      <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
        <table className="gl-table eic-list">
          <thead><tr><th>Project</th><th className="num">Complete</th><th className="num">Missing</th><th className="num">Statutory missing</th><th className="num">Awaiting approval</th><th className="num">Expired</th><th className="num">Expiring</th><th className="num">Overdue</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={8} className="gl-st-empty">Loading…</td></tr>}
            {rows && !rows.length && <tr><td colSpan={8}><EmptyState icon={ClipboardCheck} title="No compliance registers yet.">Create one from a project's Documents tab → Compliance register.</EmptyState></td></tr>}
            {(rows || []).map(r => {
              const p = projects[r.project_id]
              const pct = r.required ? Math.round((r.satisfied / r.required) * 100) : null
              const n = (v, bad) => v ? <b style={{ color: bad ? '#dc2626' : '#d97706' }}>{v}</b> : <span className="gl-st-zero">0</span>
              return (
                <tr key={r.register_id}>
                  <td><Link to={`/projects?pid=${r.project_id}&view=documents`} className="eic-who-n" style={{ fontWeight: 600 }}>{p ? `${p.code} · ${p.name}` : r.project_id}</Link><div className="eic-who-e">{r.register_name}</div></td>
                  <td className="num">{pct == null ? '—' : `${pct}%`}<div className="eic-who-e">{r.satisfied}/{r.required}</div></td>
                  <td className="num">{n(r.missing)}</td><td className="num">{n(r.statutory_missing, true)}</td><td className="num">{n(r.awaiting_approval)}</td>
                  <td className="num">{n(r.expired, true)}</td><td className="num">{n(r.expiring)}</td><td className="num">{n(r.overdue, true)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="gl-meta" style={{ padding: 10 }}>Counts here treat a requirement as received when a current filed document of its type exists; open a project for the full register.</div>
    </div>
  )
}

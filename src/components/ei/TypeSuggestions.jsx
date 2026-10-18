import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Search } from '../golive/shared'
import { Drawer, Group, Field, Seg, EmptyState, ago, fullTime } from './ui'
import { listTypeSuggestions, decideTypeSuggestion, listAttachments, attachmentUrl, documentTypeOptions } from '../../lib/emailIntelligence'
import { AREAS } from '../../../supabase/functions/_shared/eiDocuments.js'
import { codeFor } from '../../../supabase/functions/_shared/eiTaxonomy.js'
import { MODULES } from '../../config/modules'
import { Sparkles, CheckCircle2, GitMerge, XCircle, FileText } from 'lucide-react'

// New document types (STEP270): types the AI met that the taxonomy doesn't
// have. Nothing is applied until an admin approves, merges or rejects; the
// files meanwhile wait in Document filing with their unknown type.
const STATUS_TONE = { PENDING: 'amber', APPROVED: 'green', MERGED: 'green', REJECTED: 'gray' }

export default function TypeSuggestions({ onChanged }) {
  const { profile } = useAuth()
  const canDecide = ['admin', 'ceo', 'finance'].includes(profile?.role)
  const [status, setStatus] = useState('PENDING')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    setRows(null)
    listTypeSuggestions(status).then(setRows).catch(e => { setErr(e.message); setRows([]) })
  }, [status, bump])
  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(r => !ql || `${r.name} ${r.family || ''} ${(r.aliases || []).join(' ')}`.toLowerCase().includes(ql))
  const current = sel && rows?.find(r => r.id === sel)
  return (
    <div className="table-wrap">
      <div className="gl-bar">
        <Search value={q} onChange={setQ} placeholder="Suggested name, family or alias…" />
        <Seg value={status} onChange={setStatus} options={[['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['MERGED', 'Merged'], ['REJECTED', 'Rejected'], ['', 'All']]} />
      </div>
      {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
      <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
        <table className="gl-table eic-list">
          <thead><tr><th>Suggested type</th><th style={{ width: 200 }}>Family</th><th style={{ width: 90 }} className="num">Seen</th><th style={{ width: 120 }}>Status</th><th style={{ width: 100 }} className="num">Last seen</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="gl-st-empty">Loading…</td></tr>}
            {rows && !shown.length && <tr><td colSpan={5}><EmptyState icon={Sparkles} title={status === 'PENDING' ? 'No new document types waiting.' : 'Nothing here.'}>When a received file matches no configured type, the AI describes it and it appears here for a decision.</EmptyState></td></tr>}
            {shown.map(r => (
              <tr key={r.id} className={`eic-row${sel === r.id ? ' sel' : ''}`} onClick={() => setSel(r.id)}>
                <td><div className="eic-who-n" style={{ fontWeight: 600 }}>{r.name}</div><div className="eic-who-e">{r.description || r.rationale || r.proposed_code}</div></td>
                <td>{r.family || <span className="gl-st-zero">—</span>}</td>
                <td className="num"><b>{r.occurrences}</b> file{r.occurrences === 1 ? '' : 's'}</td>
                <td><span className={`gl-pill ${STATUS_TONE[r.status]}`}>{r.status.toLowerCase()}</span>{r.resulting_code && <div className="eic-who-e">{r.resulting_code}</div>}</td>
                <td className="num gl-meta" title={fullTime(r.last_seen_at)}>{ago(r.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current && <SuggestionDrawer s={current} canDecide={canDecide} onClose={() => setSel(null)} onDone={() => { setSel(null); setBump(b => b + 1); onChanged?.() }} />}
    </div>
  )
}

function SuggestionDrawer({ s, canDecide, onClose, onDone }) {
  const [files, setFiles] = useState([])
  const [types, setTypes] = useState([])
  const [mode, setMode] = useState('APPROVE')
  const [t, setT] = useState({ name: s.name, code: s.proposed_code, family: s.family || '', aliases: (s.aliases || []).join('; '), industries: '', area: '', primary_module: '', description: s.description || '' })
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  useEffect(() => {
    if (s.example_attachment_ids?.length) listAttachments({ ids: s.example_attachment_ids, limit: 20 }).then(setFiles).catch(() => {})
    documentTypeOptions().then(setTypes)
  }, [s.id])
  const set = (k, v) => setT(x => ({ ...x, [k]: v }))
  const pending = s.status === 'PENDING'
  const codeOk = /^[A-Z][A-Z0-9_]{1,59}$/.test(t.code)
  async function decide() {
    setBusy(true); setErr('')
    try {
      const list = x => x.split(/[;,\n]/).map(v => v.trim()).filter(Boolean)
      const r = await decideTypeSuggestion(s.id, mode, {
        target: mode === 'MERGE' ? target : null, note,
        type: mode === 'APPROVE' ? { code: t.code, name: t.name, family: t.family, aliases: list(t.aliases), industries: list(t.industries).map(v => v.toLowerCase()), area: t.area, primary_module: t.primary_module, description: t.description } : {},
      })
      setDone(r)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <Drawer wide title={s.name} subtitle={`Suggested type · ${s.occurrences} file${s.occurrences === 1 ? '' : 's'} · first seen ${fullTime(s.first_seen_at)}`} onClose={done ? onDone : onClose}
      footer={pending && canDecide && !done ? <><button className="btn btn-ghost" onClick={onClose}>Cancel</button><span style={{ flex: 1 }} />
        <button className={`btn ${mode === 'REJECT' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (mode === 'APPROVE' && (!t.name.trim() || !codeOk)) || (mode === 'MERGE' && !target) || (mode === 'REJECT' && !note.trim())} onClick={decide}>
          {busy ? 'Saving…' : mode === 'APPROVE' ? 'Approve as new type' : mode === 'MERGE' ? 'Merge' : 'Reject'}</button></>
        : <button className="btn btn-primary" onClick={done ? onDone : onClose}>Close</button>}>
      {done && <div className="eic-callout"><b>Done</b><span>{mode === 'REJECT' ? 'Suggestion rejected.' : `${done.code}: ${done.documents_retyped} document${done.documents_retyped === 1 ? '' : 's'} re-typed. ${mode === 'APPROVE' ? 'The new type is in the draft configuration — publish it so new emails use it.' : 'The aliases were added to the draft configuration — publish to make them live.'}`}</span></div>}
      {err && <div className="olk-msg error">{err}</div>}
      <Group title="What the AI saw">
        <dl className="eic-kvs">
          <Field label="Proposed name">{s.name}</Field>
          <Field label="Family">{s.family}</Field>
          <Field label="Aliases">{(s.aliases || []).join(', ') || null}</Field>
          <Field label="Description">{s.description}</Field>
          <Field label="Why">{s.rationale}</Field>
          {!pending && <Field label="Decision">{s.status.toLowerCase()}{s.resulting_code ? ` → ${s.resulting_code}` : ''}{s.decision_note ? ` · ${s.decision_note}` : ''}</Field>}
        </dl>
      </Group>
      {files.length > 0 && <Group title="Example files">
        <ul className="eic-checks">{files.map(f => (
          <li key={f.id} className="ok"><FileText size={13} /><span>{f.file_name}</span>
            {f.storage_path && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={async () => window.open(await attachmentUrl(f.storage_path), '_blank', 'noopener')}>Open</button>}</li>))}
        </ul>
      </Group>}
      {pending && canDecide && !done && <Group title="Decision" hint="Approving or merging re-types the waiting files; nothing else changes">
        <Seg value={mode} onChange={setMode} options={[['APPROVE', 'New type'], ['MERGE', 'Merge into existing'], ['REJECT', 'Reject']]} />
        <div style={{ marginTop: 12 }}>
          {mode === 'APPROVE' && <>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={t.name} onChange={e => { set('name', e.target.value); set('code', codeFor(e.target.value)) }} /></div>
              <div className="form-group"><label className="form-label">Code *</label><input className="form-input eic-mono" value={t.code} onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Family</label><input className="form-input" value={t.family} onChange={e => set('family', e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Industries</label><input className="form-input" value={t.industries} onChange={e => set('industries', e.target.value)} placeholder="e.g. construction; government" /></div>
            </div>
            <div className="form-group"><label className="form-label">Aliases & acronyms</label><input className="form-input" value={t.aliases} onChange={e => set('aliases', e.target.value)} /></div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Project workspace area</label><select className="form-select" value={t.area} onChange={e => set('area', e.target.value)}><option value="">Other documents</option>{AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Primary module</label><select className="form-select" value={t.primary_module} onChange={e => set('primary_module', e.target.value)}><option value="">None</option>{MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            </div>
          </>}
          {mode === 'MERGE' && <div className="form-group"><label className="form-label">Existing document type *</label>
            <select className="form-select" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose…</option>{types.map(x => <option key={x.code} value={x.code}>{x.name}</option>)}</select>
            <div className="olk-hint">"{s.name}" and its aliases become aliases of the chosen type.</div></div>}
          <div className="form-group"><label className="form-label">Note{mode === 'REJECT' ? ' *' : ''}</label><input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder={mode === 'REJECT' ? 'Why this is not a document type of its own' : 'Optional'} /></div>
        </div>
      </Group>}
      {pending && !canDecide && <div className="eic-note">Admin, CEO or finance decides on new document types.</div>}
    </Drawer>
  )
}

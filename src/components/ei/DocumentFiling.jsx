import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Search } from '../golive/shared'
import { Drawer, Group, Field, Seg, EmptyState, ago, fullTime, pct, ConfBar } from './ui'
import {
  projectDocuments, listDocumentsForReview, setDocumentProject, setDocumentType, documentTypeOptions,
  attachmentUrl, emailsByIds, procurementLookups, documentVersions, versionSuggestions, decideVersion,
} from '../../lib/emailIntelligence'
import { RELATION_LABEL } from '../../../supabase/functions/_shared/eiVersions.js'
import ComplianceRegister from './ComplianceRegister'
import OpenInAgreements from '../esign/OpenInAgreements'
import { AREAS, areaLabel, REVIEW_LABEL, PROJECT_STATUS_LABEL } from '../../../supabase/functions/_shared/eiDocuments.js'
import { MODULES } from '../../config/modules'
import { FileText, ExternalLink, FolderInput, Tag, FolderOpen, Inbox, GitBranch, Check, X as XIcon, Download } from 'lucide-react'

// Project document workspace + document filing review (STEP268).
// Every file received by email is one record (ei_attachments); here it is
// filed on a project under a workspace area. Filing never approves anything.

const EI_VIEW_ROLES = ['admin', 'ceo', 'finance', 'manager', 'department_head']
const moduleLabel = k => MODULES.find(m => m.key === k)?.label || k
const typeLabel = (code, name) => name || (code || 'Unknown').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())
const STATUS_TONE = { MATCHED: 'green', CONFIRMED: 'green', SUGGESTED: 'amber', AMBIGUOUS: 'amber', UNASSIGNED: 'gray' }

async function openFile(path) { window.open(await attachmentUrl(path), '_blank', 'noopener') }

/* ── project workspace (Projects → Documents) ── */
export default function ProjectDocuments({ project }) {
  const [view, setView] = useState('documents')
  return (
    <div>
      <div style={{ marginBottom: 12 }}><Seg value={view} onChange={setView} options={[['documents', 'Documents'], ['register', 'Compliance register']]} /></div>
      {view === 'documents' ? <ProjectDocumentList project={project} /> : <ComplianceRegister project={project} />}
    </div>
  )
}

function ProjectDocumentList({ project }) {
  const { profile } = useAuth()
  const canFile = EI_VIEW_ROLES.includes(profile?.role)
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [area, setArea] = useState('')
  const [q, setQ] = useState('')
  const [withSuggested, setWithSuggested] = useState(false)
  const [withOld, setWithOld] = useState(false)
  const [sel, setSel] = useState(null)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    setRows(null); setErr('')
    projectDocuments(project.id, canFile && withSuggested).then(setRows).catch(e => { setErr(e.message); setRows([]) })
  }, [project.id, withSuggested, bump])

  const counts = useMemo(() => {
    const m = {}; for (const r of rows || []) m[r.area || 'OTHER'] = (m[r.area || 'OTHER'] || 0) + 1
    return m
  }, [rows])
  const ql = q.trim().toLowerCase()
  const oldCount = (rows || []).filter(r => r.is_current === false).length
  const shown = (rows || []).filter(r => (withOld || r.is_current !== false) && (!area || (r.area || 'OTHER') === area) && (!ql ||
    [r.title, r.file_name, r.doc_type_name, r.doc_type_code, r.document_number, r.sender_email, r.sender_name, r.subject].join(' ').toLowerCase().includes(ql)))
  const current = sel && rows?.find(r => r.id === sel)

  return (
    <div className="pdoc">
      <aside className="pdoc-areas card">
        <button className={`pdoc-area${!area ? ' on' : ''}`} onClick={() => setArea('')}><FolderOpen size={14} /> All documents <span>{rows?.length ?? ''}</span></button>
        {AREAS.filter(a => counts[a.key]).map(a => (
          <button key={a.key} className={`pdoc-area${area === a.key ? ' on' : ''}`} onClick={() => setArea(a.key)}>{a.label}<span>{counts[a.key]}</span></button>
        ))}
        {rows && !rows.length && <div className="pdoc-muted" style={{ padding: '6px 10px' }}>Areas appear as documents arrive.</div>}
      </aside>
      <div className="table-wrap pdoc-main">
        <div className="gl-bar">
          <Search value={q} onChange={setQ} placeholder="Title, number, type, sender…" />
          <span className="gl-grow" />
          {oldCount > 0 && <label className="pdoc-check"><input type="checkbox" checked={withOld} onChange={e => setWithOld(e.target.checked)} /> Show older versions & copies ({oldCount})</label>}
          {canFile && <label className="pdoc-check"><input type="checkbox" checked={withSuggested} onChange={e => setWithSuggested(e.target.checked)} /> Include suggested</label>}
        </div>
        {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
        <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
          <table className="gl-table eic-list">
            <thead><tr><th>Document</th><th style={{ width: 170 }}>Type</th><th style={{ width: 150 }}>Number / rev.</th><th style={{ width: 200 }}>From</th><th style={{ width: 90 }} className="num">Received</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={5} className="gl-st-empty">Loading…</td></tr>}
              {rows && !shown.length && <tr><td colSpan={5}><EmptyState icon={FileText} title={rows.length ? 'Nothing matches.' : 'No documents filed on this project yet.'}>{!rows.length && 'Documents received by email are filed here automatically when their project is identified.'}</EmptyState></td></tr>}
              {shown.map(r => (
                <tr key={r.id} className={`eic-row${sel === r.id ? ' sel' : ''}`} onClick={() => setSel(r.id)}>
                  <td>
                    <div className="eic-who-n" style={{ fontWeight: 600 }}>{r.title || r.file_name}</div>
                    <div className="eic-who-e">{r.file_name}{!area && ` · ${areaLabel(r.area)}`}{r.project_status === 'SUGGESTED' && <span className="gl-pill amber" style={{ marginLeft: 6 }}>Suggested</span>}</div>
                  </td>
                  <td><div className="eic-who-n">{typeLabel(r.doc_type_code, r.doc_type_name)}</div>{r.primary_module && <div className="eic-who-e">{moduleLabel(r.primary_module)}</div>}</td>
                  <td>{r.document_number || <span className="gl-st-zero">—</span>}
                    {(r.revision || r.versions > 1) && <div className="eic-who-e">{r.revision ? `Rev ${r.revision}` : ''}{r.versions > 1 ? `${r.revision ? ' · ' : ''}${r.versions} versions` : ''}</div>}
                    {r.is_current === false && <span className="gl-pill gray">{r.version_relation === 'EXACT_DUPLICATE' ? 'Copy' : 'Superseded'}</span>}</td>
                  <td><div className="eic-who-n">{r.sender_name || r.sender_email || '—'}</div><div className="eic-who-e">{r.subject}</div></td>
                  <td className="num gl-meta" title={fullTime(r.received_at || r.created_at)}>{ago(r.received_at || r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {current && <DocumentDetail doc={current} email={current} canFile={canFile} projectId={project.id} onClose={() => setSel(null)} onDone={() => { setSel(null); setBump(b => b + 1) }} />}
    </div>
  )
}

/* ── filing review queue (Email Intelligence → Document filing) ── */
export function DocumentReviewQueue({ onChanged }) {
  const [rows, setRows] = useState(null)
  const [emails, setEmails] = useState({})
  const [projects, setProjects] = useState({})
  const [err, setErr] = useState('')
  const [state, setState] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    setErr('')
    listDocumentsForReview().then(async list => {
      setRows(list)
      setEmails(await emailsByIds(list.map(x => x.message_id)))
    }).catch(e => { setErr(e.message); setRows([]) })
    procurementLookups().then(l => setProjects(Object.fromEntries(l.projects.map(p => [p.id, p])))).catch(() => {})
  }, [bump])
  const [vers, setVers] = useState(null)
  useEffect(() => { versionSuggestions().then(setVers).catch(() => setVers(null)) }, [bump])
  const n = k => (rows || []).filter(r => r.review_state === k).length
  const ql = q.trim().toLowerCase()
  const shown = (rows || []).filter(r => (!state || r.review_state === state) && (!ql ||
    `${r.file_name} ${r.title} ${r.doc_type_code} ${emails[r.message_id]?.sender_email || ''} ${emails[r.message_id]?.subject || ''}`.toLowerCase().includes(ql)))
  const current = sel && rows?.find(r => r.id === sel)
  return (
    <div className="table-wrap">
      <div className="gl-bar">
        <Search value={q} onChange={setQ} placeholder="File, type, sender or subject…" />
        <Seg value={state} onChange={setState} options={[['', 'All'], ['NEEDS_PROJECT', 'Project to confirm', n('NEEDS_PROJECT')], ['NEEDS_TYPE', 'Type to confirm', n('NEEDS_TYPE')], ['NEEDS_BOTH', 'Both', n('NEEDS_BOTH')], ...(vers ? [['VERSIONS', 'Versions to confirm', vers.length]] : [])]} />
      </div>
      {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
      {state === 'VERSIONS' ? <VersionQueue rows={vers || []} onDone={() => { setBump(b => b + 1); onChanged?.() }} /> : <>
      <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
        <table className="gl-table eic-list">
          <thead><tr><th>Document</th><th style={{ width: 180 }}>Type</th><th style={{ width: 230 }}>Project</th><th style={{ width: 200 }}>From</th><th style={{ width: 90 }} className="num">Received</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="gl-st-empty">Loading…</td></tr>}
            {rows && !shown.length && <tr><td colSpan={5}><EmptyState icon={Inbox} title="Nothing to file — every document has a confirmed type and project." /></td></tr>}
            {shown.map(r => {
              const em = emails[r.message_id]
              const p = projects[r.project_id]
              return (
                <tr key={r.id} className={`eic-row${sel === r.id ? ' sel' : ''}`} onClick={() => setSel(r.id)}>
                  <td><div className="eic-who-n" style={{ fontWeight: 600 }}>{r.title || r.file_name}</div><div className="eic-who-e">{r.file_name}</div></td>
                  <td><div className="eic-who-n">{typeLabel(r.doc_type_code)}</div><ConfBar v={r.doc_confidence} /></td>
                  <td>
                    <span className={`gl-pill ${STATUS_TONE[r.project_status] || 'gray'}`}>{PROJECT_STATUS_LABEL[r.project_status] || r.project_status}</span>
                    {p && <div className="eic-who-e">{p.code} · {p.name}</div>}
                    {!p && (r.project_candidates || []).length > 0 && <div className="eic-who-e">{r.project_candidates.length} candidates</div>}
                  </td>
                  <td>{em ? <><div className="eic-who-n">{em.sender_name || em.sender_email}</div><div className="eic-who-e">{em.subject}</div></> : '—'}</td>
                  <td className="num gl-meta" title={fullTime(r.created_at)}>{ago(r.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {current && <DocumentDetail doc={current} email={emails[current.message_id]} canFile onClose={() => setSel(null)} onDone={() => { setSel(null); setBump(b => b + 1); onChanged?.() }} />}
      </>}
    </div>
  )
}

/* ── suggested version links (STEP271) ── */
function VersionQueue({ rows, onDone }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  async function decide(id, accept) {
    setBusy(id); setErr('')
    try { await decideVersion(id, accept); onDone() } catch (e) { setErr(e.message) }
    setBusy(null)
  }
  return (
    <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
      {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
      <table className="gl-table eic-list">
        <thead><tr><th>New document</th><th>Earlier document</th><th style={{ width: 220 }}>Why</th><th style={{ width: 170 }} /></tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={4}><EmptyState icon={GitBranch} title="No version links to confirm." /></td></tr>}
          {rows.map(r => (
            <tr key={r.id}>
              <td><div className="eic-who-n" style={{ fontWeight: 600 }}>{r.title || r.file_name}</div><div className="eic-who-e">{r.file_name}{r.revision ? ` · Rev ${r.revision}` : ''}</div></td>
              <td><div className="eic-who-n">{r.related_file}</div><div className="eic-who-e">{r.related_revision ? `Rev ${r.related_revision} · ` : ''}{fullTime(r.related_received)}</div></td>
              <td><span className="gl-pill amber">{RELATION_LABEL[r.version_relation] || r.version_relation}</span><div className="eic-who-e">{r.version_reason}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => decide(r.id, true)} title="Same document — the newer one becomes current"><Check size={12} /> Same document</button>{' '}
                <button className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => decide(r.id, false)} title="Different documents"><XIcon size={12} /> Different</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── one document: metadata, links, filing actions ── */
function DocumentDetail({ doc, email, canFile, onClose, onDone, projectId }) {
  const fields = doc.extraction && typeof doc.extraction === 'object' ? Object.entries(doc.extraction) : []
  const webLink = email?.web_link
  return (
    <Drawer wide title={doc.title || doc.file_name} subtitle={`${typeLabel(doc.doc_type_code, doc.doc_type_name)} · ${areaLabel(doc.area)}`} onClose={onClose}
      footer={<>{doc.storage_path && <OpenInAgreements att={doc} projectId={projectId} />}
        {doc.storage_path && <button className="btn btn-ghost" onClick={() => openFile(doc.storage_path).catch(e => alert(e.message))}><Download size={13} /> Download</button>}
        {webLink && <a className="btn btn-ghost" href={webLink} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Original email</a>}<span style={{ flex: 1 }} /></>}>
      <div className="eic-drawer-status">
        <span className={`gl-pill ${STATUS_TONE[doc.project_status] || 'gray'}`}>{PROJECT_STATUS_LABEL[doc.project_status] || doc.project_status}</span>
        {doc.review_state && doc.review_state !== 'OK' && <span className="gl-pill amber">{REVIEW_LABEL[doc.review_state]}</span>}
      </div>
      {doc.project_reason && <div className="eic-callout"><b>Project</b><span>{doc.project_reason}{doc.project_confidence != null ? ` (${pct(doc.project_confidence)})` : ''}</span></div>}
      <Group title="Document">
        <dl className="eic-kvs two">
          <Field label="File">{doc.file_name}</Field>
          <Field label="Type">{typeLabel(doc.doc_type_code, doc.doc_type_name)} <ConfBar v={doc.doc_confidence} /></Field>
          <Field label="Number">{doc.document_number}</Field>
          <Field label="Revision">{doc.revision}</Field>
          <Field label="Document date">{doc.document_date}</Field>
          <Field label="Area">{areaLabel(doc.area)}</Field>
          <Field label="Primary module">{doc.primary_module ? moduleLabel(doc.primary_module) : null}</Field>
          <Field label="Related modules">{(doc.related_modules || []).length ? doc.related_modules.map(moduleLabel).join(', ') : null}</Field>
        </dl>
      </Group>
      <VersionHistory doc={doc} />
      {fields.length > 0 && <Group title="Extracted fields">
        <dl className="eic-kvs two">{fields.map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')}>{String(v?.value ?? '')} <span className="gl-meta">{pct(v?.confidence)}</span></Field>)}</dl>
      </Group>}
      {email && <Group title="Email"><dl className="eic-kvs"><Field label="Subject">{email.subject}</Field><Field label="From">{email.sender_name ? `${email.sender_name} <${email.sender_email}>` : email.sender_email}</Field><Field label="Received">{fullTime(email.received_at)}</Field></dl></Group>}
      {canFile && <FilingPanel doc={doc} onDone={onDone} />}
    </Drawer>
  )
}

function VersionHistory({ doc }) {
  const [list, setList] = useState(null)
  useEffect(() => { documentVersions(doc.id).then(setList) }, [doc.id])
  if (!list || list.length < 2) return null
  return (
    <Group title="Versions" hint="Every version is kept; the current one is used">
      <ul className="eic-checks">{list.map(v => (
        <li key={v.id} className={v.is_current ? 'ok' : ''}>
          <GitBranch size={13} />
          <span><b>{v.revision ? `Rev ${v.revision}` : v.file_name}</b>{v.id === doc.id ? ' (this one)' : ''} · {fullTime(v.received_at || v.created_at)}
            {v.is_current ? ' · current' : v.version_relation === 'EXACT_DUPLICATE' ? ' · copy' : ' · superseded'}</span>
          {v.storage_path && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openFile(v.storage_path).catch(e => alert(e.message))}>Open</button>}
        </li>))}
      </ul>
    </Group>
  )
}

function FilingPanel({ doc, onDone }) {
  const [projects, setProjects] = useState([])
  const [types, setTypes] = useState([])
  const [projectId, setProjectId] = useState(doc.project_id || '')
  const [code, setCode] = useState(doc.doc_type_code || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    procurementLookups().then(l => setProjects(l.projects)).catch(() => {})
    documentTypeOptions().then(setTypes)
  }, [])
  const candidates = (doc.project_candidates || []).filter(c => c?.id)
  async function run(fn) {
    setBusy(true); setErr('')
    try { await fn(); onDone() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const projectChanged = projectId !== (doc.project_id || '') || !['MATCHED', 'CONFIRMED'].includes(doc.project_status)
  return (
    <Group title="Filing" hint="Only changes where the document is filed — never approves the related transaction">
      {err && <div className="olk-msg error">{err}</div>}
      {candidates.length > 0 && <div className="pdoc-cands">Candidates: {candidates.map(c => (
        <button key={c.id} type="button" className={`eic-link-chip${projectId === c.id ? ' on' : ''}`} onClick={() => setProjectId(c.id)}>{c.code || ''} {c.name || ''}</button>
      ))}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Project</label>
          <select className="form-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}{p.status && p.status !== 'active' ? ` (${p.status})` : ''}</option>)}
          </select>
        </div>
        <div className="form-group"><label className="form-label">Document type</label>
          <select className="form-select" value={code} onChange={e => setCode(e.target.value)}>
            <option value="">—</option>
            {types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group"><label className="form-label">Note (kept in the audit log)</label><input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional — e.g. confirmed with site engineer" /></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy || !projectChanged} onClick={() => run(() => setDocumentProject(doc.id, projectId || null, note))}>
          <FolderInput size={13} /> {projectId ? (projectId === doc.project_id ? 'Confirm project' : 'File on project') : 'Remove from project'}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy || !code || (code === doc.doc_type_code && Number(doc.doc_confidence) >= 1)} onClick={() => run(() => setDocumentType(doc.id, code, note))}>
          <Tag size={13} /> {code === doc.doc_type_code ? 'Confirm type' : 'Change type'}
        </button>
      </div>
    </Group>
  )
}

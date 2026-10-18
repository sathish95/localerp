import { useEffect, useMemo, useState, Fragment } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Confirm, Toggle } from '../ui'
import { Search } from '../golive/shared'
import {
  loadConfig, saveCategory, saveDocumentType, saveRule, saveAlias, remove, saveSettings, seedDefaults, configDiff, publish, rollback, configAudit,
  validateRule, findRuleConflicts, LOCATIONS, MATCH_MODES, LOCATION_LABELS, MODE_LABELS, WORKFLOWS, DESTINATIONS, FIELD_TYPES, REVIEW_ROLES, PRIORITIES,
  procurementLookups, saveAcronym, importBaselineTaxonomy,
} from '../../lib/emailIntelligence'
import { AREAS } from '../../../supabase/functions/_shared/eiDocuments.js'
import { MODULES } from '../../config/modules'
import { evaluateRule } from '../../../supabase/functions/_shared/eiEngine.js'
import { supabase } from '../../lib/supabase'
import EiTester from './EiTester'
import {
  Plus, Pencil, Trash2, UploadCloud, RotateCcw, AlertTriangle, CheckCircle2, X, Tags, KeyRound, FileStack, Building2, SlidersHorizontal,
  FlaskConical, History, ChevronDown, ChevronRight, ShieldCheck, Info, BookOpen, Library,
} from 'lucide-react'

const SECTIONS = [
  { id: 'categories', label: 'Email categories', icon: Tags, desc: 'What an email is about, and what happens next', diffKey: 'categories' },
  { id: 'rules', label: 'Keywords & rules', icon: KeyRound, desc: 'Phrases that classify emails and files', diffKey: 'rules' },
  { id: 'documents', label: 'Document types', icon: FileStack, desc: 'Attachment classes and fields to extract', diffKey: 'document_types' },
  { id: 'acronyms', label: 'Acronyms', icon: BookOpen, desc: 'Meanings of acronyms, resolved by context', diffKey: 'acronyms' },
  { id: 'vendors', label: 'Vendor mapping', icon: Building2, desc: 'Extra identities for existing vendors', diffKey: 'vendor_aliases' },
  { id: 'matching', label: 'Matching & AI', icon: SlidersHorizontal, desc: 'Tolerances, controls and AI use', diffKey: 'settings' },
  { id: 'test', label: 'Test', icon: FlaskConical, desc: 'Dry-run a sample email — writes nothing' },
  { id: 'versions', label: 'Publish & history', icon: History, desc: 'Versions, rollback and audit' },
]
const WF_SHORT = {
  AP_INVOICE: ['Invoice intake', 'indigo'], PROJECT_ISSUE_TASK: ['Project task', 'indigo'], REVIEW_QUEUE: ['Review queue', 'amber'],
  VENDOR_VERIFICATION: ['Verification', 'red'], RECORD_ONLY: ['Record only', 'gray'], IGNORE: ['Ignore', 'gray'],
}
const DEST_SHORT = { INVOICE_REGISTER: ['Invoice register', 'indigo'], CREDIT_NOTE_REVIEW: ['Note review', 'amber'], REVIEW_QUEUE: ['Review queue', 'amber'], NONE: ['Record only', 'gray'] }
const PRIO_DOT = { critical: '#dc2626', high: '#ea580c', medium: '#6366f1', low: '#94a3b8' }
const LOC_SHORT = { SUBJECT: 'Subject', BODY: 'Body', SENDER: 'Sender', SENDER_DOMAIN: 'Domain', ATTACHMENT_NAME: 'File name', ATTACHMENT_TEXT: 'File text' }
const when = t => (t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const pct = v => `${Math.round(Number(v || 0) * 100)}%`
const diffN = d => (d ? Number(d.added) + Number(d.removed) + Number(d.changed) : 0)

// Settings → Email Intelligence — configuration centre. Every routine business
// setting of the email / document automation lives here (no code): saved as a
// draft, tested, published as an immutable version the worker picks up within
// a minute, rolled back if needed. admin / ceo / finance edit; managers read.
export default function EmailIntelligenceSettings({ embedded = false }) {
  const { profile } = useAuth()
  const canEdit = ['admin', 'ceo', 'finance'].includes(profile?.role)
  const [sec, setSec] = useState('categories')
  const [cfg, setCfg] = useState(null)
  const [diff, setDiff] = useState(null)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [lookups, setLookups] = useState({ vendors: [], pos: [], projects: [] })
  const [departments, setDepartments] = useState([])

  async function load() {
    try {
      const [c, d] = await Promise.all([loadConfig(), configDiff().catch(() => null)])
      setCfg(c); setDiff(d); setErr('')
    } catch (e) { setErr(e.message); setCfg({ categories: [], document_types: [], rules: [], vendor_aliases: [], versions: [], settings: {} }) }
  }
  useEffect(() => {
    load()
    procurementLookups().then(l => supabase.from('customers').select('id, name').order('name').then(({ data }) => setLookups({ ...l, customers: data || [] }))).catch(() => {})
    supabase.from('departments').select('id, name').order('name').then(({ data }) => setDepartments(data || []))
  }, [])
  const flash = t => { setToast(t); setTimeout(() => setToast(''), 3200) }
  const act = async (fn, ok) => { setErr(''); try { await fn(); await load(); if (ok) flash(ok); return true } catch (e) { setErr(e.message); return false } }

  if (!cfg) return <div className="card" style={{ padding: 20 }}>Loading…</div>
  if (/ei_|does not exist|schema cache/i.test(err) && !cfg.categories.length) {
    return <div className="card" style={{ padding: 20 }}>Run <code>sql/STEP263</code>, <code>STEP264</code> and <code>STEP265</code> (Email Intelligence) in the Supabase SQL editor, then reload.</div>
  }
  if (!cfg.categories.length) {
    return (
      <div className="card eic-empty-setup">
        <ShieldCheck size={28} />
        <h3>Email Intelligence is not set up yet</h3>
        <p>Load the default email categories, document types, keyword rules and matching settings. They are ordinary editable rows — change anything afterwards; nothing is hard-coded.</p>
        {err && <div className="olk-msg error">{err}</div>}
        {canEdit ? <button className="btn btn-primary" onClick={() => act(seedDefaults, 'Defaults loaded and published as version 1.')}>Load defaults</button> : <div className="gl-meta">An admin, CEO or finance user can load them.</div>}
      </div>
    )
  }

  const pending = !!diff?.unpublished
  const counts = {
    categories: cfg.categories.length, rules: cfg.rules.length, documents: cfg.document_types.length, vendors: cfg.vendor_aliases.length, acronyms: cfg.acronyms?.length ?? null,
    versions: cfg.versions[0] ? `v${cfg.versions[0].version}` : null,
  }
  const cur = SECTIONS.find(s => s.id === sec)
  if (embedded) {
    // inside NeoX Email Intelligence: slim status bar + horizontal sections (the page already has a side menu)
    return (
      <div className="eic">
        <div className="eic-slimbar">
          <span className="eic-chip"><span className="eic-dot green" /> Live <b>v{diff?.published_version ?? '—'}</b></span>
          {pending ? <span className="eic-chip warn"><AlertTriangle size={12} /> Draft: {draftSummary(diff)}</span> : <span className="eic-chip ok"><CheckCircle2 size={12} /> No unpublished changes</span>}
          <span style={{ flex: 1 }} />
          {canEdit && <button className="btn btn-primary btn-sm" disabled={!pending} onClick={() => setSec('versions')}><UploadCloud size={13} /> Review & publish</button>}
        </div>
        <div className="eic-subnav">{SECTIONS.map(x => {
          const Icon = x.icon
          const changed = x.diffKey === 'settings' ? diff?.settings_changed : diffN(diff?.[x.diffKey]) > 0
          return <button key={x.id} type="button" className={sec === x.id ? 'on' : ''} onClick={() => setSec(x.id)}><Icon size={13} /> {x.label}{changed && <span className="eic-dot amber" />}{counts[x.id] != null && <span className="eic-count">{counts[x.id]}</span>}</button>
        })}</div>
        {err && <div className="olk-msg error">{err}</div>}
        {toast && <div className="eic-toast"><CheckCircle2 size={14} /> {toast}</div>}
        {!canEdit && <div className="eic-readonly"><Info size={13} /> Read-only — admin, CEO or finance can change the configuration.</div>}
        {sec === 'categories' && <Categories cfg={cfg} canEdit={canEdit} departments={departments} act={act} />}
        {sec === 'rules' && <Rules cfg={cfg} canEdit={canEdit} vendors={lookups.vendors} act={act} />}
        {sec === 'documents' && <DocumentTypes cfg={cfg} canEdit={canEdit} act={act} />}
        {sec === 'acronyms' && <Acronyms cfg={cfg} canEdit={canEdit} customers={lookups.customers || []} projects={lookups.projects} act={act} />}
        {sec === 'vendors' && <VendorMapping cfg={cfg} canEdit={canEdit} vendors={lookups.vendors} act={act} />}
        {sec === 'matching' && <Matching key={JSON.stringify(cfg.settings)} cfg={cfg} canEdit={canEdit} act={act} />}
        {sec === 'test' && <EiTester canRun={canEdit} cfg={cfg} />}
        {sec === 'versions' && <Versions cfg={cfg} diff={diff} canEdit={canEdit} act={act} />}
      </div>
    )
  }

  return (
    <div className="eic">
      <div className="eic-head card">
        <div className="eic-head-main">
          <div className="eic-head-title">Email Intelligence</div>
          <div className="eic-head-sub">Classification, document handling and PO / GRN / invoice matching for incoming email</div>
        </div>
        <div className="eic-head-status">
          <span className="eic-chip"><span className="eic-dot green" /> Live <b>v{diff?.published_version ?? '—'}</b></span>
          {pending
            ? <span className="eic-chip warn"><AlertTriangle size={12} /> Draft: {draftSummary(diff)}</span>
            : <span className="eic-chip ok"><CheckCircle2 size={12} /> No unpublished changes</span>}
        </div>
        <div className="eic-head-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setSec('test')}><FlaskConical size={13} /> Test draft</button>
          {canEdit && <button className="btn btn-primary btn-sm" disabled={!pending} onClick={() => setSec('versions')}><UploadCloud size={13} /> Review & publish</button>}
        </div>
      </div>
      {!canEdit && <div className="eic-readonly"><Info size={13} /> Read-only — admin, CEO or finance can change the configuration.</div>}

      <div className="eic-body">
        <nav className="eic-rail card">
          {SECTIONS.map(s => {
            const Icon = s.icon
            const changed = s.diffKey === 'settings' ? diff?.settings_changed : diffN(diff?.[s.diffKey]) > 0
            return (
              <button key={s.id} type="button" className={`eic-rail-item${sec === s.id ? ' on' : ''}`} onClick={() => setSec(s.id)}>
                <Icon size={15} />
                <span className="eic-rail-text"><span className="eic-rail-label">{s.label}</span><span className="eic-rail-desc">{s.desc}</span></span>
                {changed && <span className="eic-dot amber" title="Unpublished changes" />}
                {counts[s.id] != null && <span className="eic-count">{counts[s.id]}</span>}
              </button>
            )
          })}
        </nav>

        <main className="eic-main">
          {err && <div className="olk-msg error">{err}</div>}
          {toast && <div className="eic-toast"><CheckCircle2 size={14} /> {toast}</div>}
          {sec !== 'test' && sec !== 'versions' && <div className="eic-sec-head"><div><h2>{cur.label}</h2><p>{cur.desc}. Changes are saved to the draft; publish to make them live.</p></div></div>}
          {sec === 'categories' && <Categories cfg={cfg} canEdit={canEdit} departments={departments} act={act} />}
          {sec === 'rules' && <Rules cfg={cfg} canEdit={canEdit} vendors={lookups.vendors} act={act} />}
          {sec === 'documents' && <DocumentTypes cfg={cfg} canEdit={canEdit} act={act} />}
          {sec === 'acronyms' && <Acronyms cfg={cfg} canEdit={canEdit} customers={lookups.customers || []} projects={lookups.projects} act={act} />}
        {sec === 'vendors' && <VendorMapping cfg={cfg} canEdit={canEdit} vendors={lookups.vendors} act={act} />}
          {sec === 'matching' && <Matching key={JSON.stringify(cfg.settings)} cfg={cfg} canEdit={canEdit} act={act} />}
          {sec === 'test' && <><div className="eic-sec-head"><div><h2>Test</h2><p>Run a sample email and real files through the draft (or live) configuration. Reads your records, writes nothing.</p></div></div><EiTester canRun={canEdit} cfg={cfg} /></>}
          {sec === 'versions' && <Versions cfg={cfg} diff={diff} canEdit={canEdit} act={act} />}
        </main>
      </div>
    </div>
  )
}

function draftSummary(d) {
  const parts = [['categories', 'categories'], ['document_types', 'document types'], ['rules', 'rules'], ['vendor_aliases', 'mappings'], ['acronyms', 'acronyms']]
    .map(([k, l]) => (diffN(d?.[k]) ? `${diffN(d[k])} ${l}` : null)).filter(Boolean)
  if (d?.settings_changed) parts.push('settings')
  return parts.join(', ') || 'changes'
}

/* ═══ shared building blocks ═══ */

function Stats({ items }) {
  return <div className="eic-stats">{items.map(([label, value, tone]) => <div key={label} className={`eic-stat ${tone || ''}`}><div className="eic-stat-v">{value}</div><div className="eic-stat-l">{label}</div></div>)}</div>
}
function Pill({ map, k }) { const [l, t] = map[k] || [k, 'gray']; return <span className={`gl-pill ${t === 'indigo' ? 'gl-st-indigo' : t}`}>{l}</span> }
function Drawer({ title, subtitle, onClose, footer, children }) {
  useEffect(() => { const h = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer-panel eic-drawer">
        <div className="modal-header"><span><span className="eic-drawer-title">{title}</span>{subtitle && <span className="eic-drawer-sub">{subtitle}</span>}</span><button className="close-btn" onClick={onClose}><X size={14} /></button></div>
        <div className="modal-body eic-drawer-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
function Group({ title, hint, children }) {
  return <section className="eic-fgroup"><div className="eic-fgroup-h">{title}{hint && <span>{hint}</span>}</div>{children}</section>
}
function ChipPick({ options, value, onChange, disabled }) {
  return <div className="olk-chips">{options.map(([k, l]) => <button key={k} type="button" disabled={disabled} className={`chip-toggle ${value.includes(k) ? 'on' : ''}`} onClick={() => onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k])}>{l}</button>)}</div>
}
function Seg({ value, onChange, options }) {
  return <div className="gl-seg">{options.map(([k, l, n]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}{n != null && <span className="gl-st-n">{n}</span>}</button>)}</div>
}
function Empty({ children }) { return <tr><td colSpan={20} className="gl-st-empty">{children}</td></tr> }

/* ═══ categories ═══ */

const NEW_CAT = { code: '', name: '', description: '', group_name: '', default_priority: 'medium', confidence_threshold: 0.75, workflow_key: 'REVIEW_QUEUE', review_role: 'manager', department_id: null, requires_review: false, related_document_types: [], required_fields: [], sort_order: 100, is_active: true, effective_from: null, effective_to: null }

function Categories({ cfg, canEdit, departments, act }) {
  const [q, setQ] = useState('')
  const [wf, setWf] = useState('')
  const [status, setStatus] = useState('all')
  const [collapsed, setCollapsed] = useState({})
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const ruleCount = useMemo(() => cfg.rules.reduce((m, r) => (r.category_code ? { ...m, [r.category_code]: (m[r.category_code] || 0) + 1 } : m), {}), [cfg.rules])
  const rows = cfg.categories.filter(c => (!wf || c.workflow_key === wf) && (status === 'all' || (status === 'active') === c.is_active)
    && (!q || `${c.code} ${c.name} ${c.group_name} ${c.description || ''}`.toLowerCase().includes(q.toLowerCase())))
  const groups = [...new Set(rows.map(c => c.group_name || 'Other'))]
  const noRules = cfg.categories.filter(c => c.is_active && !ruleCount[c.code] && !(c.related_document_types || []).length && c.code !== 'OTHER').length
  return (
    <>
      <Stats items={[
        ['Categories', cfg.categories.length], ['Active', cfg.categories.filter(c => c.is_active).length, 'good'],
        ['Invoice intake', cfg.categories.filter(c => c.workflow_key === 'AP_INVOICE').length], ['Review queue', cfg.categories.filter(c => c.workflow_key === 'REVIEW_QUEUE').length],
        ['Verification', cfg.categories.filter(c => c.workflow_key === 'VENDOR_VERIFICATION').length], ['Without rules or evidence', noRules, noRules ? 'warn' : ''],
      ]} />
      <div className="table-wrap">
        <div className="gl-bar">
          <Search value={q} onChange={setQ} placeholder="Category, code, group…" />
          <select className="form-select" value={wf} onChange={e => setWf(e.target.value)}><option value="">All workflows</option>{Object.keys(WORKFLOWS).map(k => <option key={k} value={k}>{WF_SHORT[k][0]}</option>)}</select>
          <Seg value={status} onChange={setStatus} options={[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']]} />
          <div className="gl-grow" />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...NEW_CAT })}><Plus size={13} /> New category</button>}
        </div>
        <div className="gl-tscroll"><table className="gl-table gl-st-table eic-table">
          <thead><tr><th style={{ minWidth: 240 }}>Category</th><th>Then</th><th>Review by</th><th>Priority</th><th className="num">Threshold</th><th className="num">Rules</th><th className="num">Evidence</th><th>Active</th><th /></tr></thead>
          <tbody>
            {!rows.length && <Empty>No categories match these filters.</Empty>}
            {groups.map(g => {
              const items = rows.filter(c => (c.group_name || 'Other') === g)
              const isC = collapsed[g]
              return (
                <Fragment key={g}>
                  <tr className="eic-grp" onClick={() => setCollapsed(o => ({ ...o, [g]: !o[g] }))}><td colSpan={9}>{isC ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {g} <span className="gl-st-n">{items.length}</span></td></tr>
                  {!isC && items.map(c => (
                    <tr key={c.id} className={`eic-row${c.is_active ? '' : ' off'}`} onClick={() => setEdit({ ...c })}>
                      <td><div className="gl-st-name">{c.name}</div><div className="eic-code">{c.code}{c.requires_review ? ' · always reviewed' : ''}</div></td>
                      <td><Pill map={WF_SHORT} k={c.workflow_key} /></td>
                      <td className="eic-cap">{c.review_role?.replace('_', ' ')}</td>
                      <td><span className="eic-prio"><span style={{ background: PRIO_DOT[c.default_priority] }} />{c.default_priority}</span></td>
                      <td className="num">{pct(c.confidence_threshold)}</td>
                      <td className="num">{ruleCount[c.code] || <span className="gl-st-zero">–</span>}</td>
                      <td className="num">{(c.related_document_types || []).length || <span className="gl-st-zero">–</span>}</td>
                      <td onClick={e => e.stopPropagation()}><Toggle checked={c.is_active} disabled={!canEdit} label="Active" onChange={v => act(() => saveCategory({ ...c, is_active: v }), `${c.name} ${v ? 'activated' : 'deactivated'} (draft).`)} /></td>
                      <td onClick={e => e.stopPropagation()} className="nowrap">{canEdit && <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setDel(c)}><Trash2 size={12} /></button>}</td>
                    </tr>))}
                </Fragment>
              )
            })}
          </tbody></table></div>
      </div>
      {edit && <CategoryDrawer row={edit} cfg={cfg} canEdit={canEdit} departments={departments} ruleCount={ruleCount[edit.code] || 0} onClose={() => setEdit(null)}
        onSave={async r => { if (await act(() => saveCategory(r), 'Category saved to draft.')) setEdit(null) }} />}
      <Confirm open={!!del} danger message={del && (ruleCount[del.code] ? `"${del.name}" has ${ruleCount[del.code]} rule(s) — it will be deactivated instead of deleted.` : `Delete "${del.name}"? Emails already processed keep their history.`)}
        onCancel={() => setDel(null)} onConfirm={() => { const d = del; setDel(null); act(async () => { if (ruleCount[d.code]) await saveCategory({ ...d, is_active: false }); else await remove('ei_email_categories', d.id) }, ruleCount[d.code] ? 'Category deactivated (draft).' : 'Category deleted (draft).') }} />
    </>
  )
}

function CategoryDrawer({ row, cfg, canEdit, departments, ruleCount, onClose, onSave }) {
  const [f, setF] = useState(row)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const codeOk = /^[A-Z][A-Z0-9_]{1,59}$/.test(f.code || '')
  return (
    <Drawer title={row.id ? row.name : 'New email category'} subtitle={row.id ? `${row.code} · ${ruleCount} rule(s)` : 'Added to the draft'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>{canEdit && <button className="btn btn-primary" disabled={!f.name?.trim() || !codeOk} onClick={() => onSave(f)}>Save to draft</button>}</>}>
      <fieldset disabled={!canEdit} className="eic-fs">
        <Group title="Identity">
          <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Code *</label><input className="form-input eic-mono" value={f.code} disabled={!!row.id} onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} />{!row.id && <div className="olk-hint">A–Z, 0–9 and _. Cannot change later.</div>}</div>
            <div className="form-group"><label className="form-label">Group</label><input className="form-input" list="eic-groups" value={f.group_name || ''} onChange={e => set('group_name', e.target.value)} />
              <datalist id="eic-groups">{[...new Set(cfg.categories.map(c => c.group_name).filter(Boolean))].map(g => <option key={g} value={g} />)}</datalist></div>
          </div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" rows={2} value={f.description || ''} onChange={e => set('description', e.target.value)} /></div>
        </Group>
        <Group title="Handling" hint="What the automation does with emails of this kind">
          <div className="form-group"><label className="form-label">Then</label><select className="form-select" value={f.workflow_key} onChange={e => set('workflow_key', e.target.value)}>{Object.entries(WORKFLOWS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Review by (role)</label><select className="form-select" value={f.review_role} onChange={e => set('review_role', e.target.value)}>{REVIEW_ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Department</label><select className="form-select" value={f.department_id || ''} onChange={e => set('department_id', e.target.value || null)}><option value="">—</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Default priority</label><select className="form-select" value={f.default_priority} onChange={e => set('default_priority', e.target.value)}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Confidence threshold</label><select className="form-select" value={String(f.confidence_threshold)} onChange={e => set('confidence_threshold', Number(e.target.value))}>{[0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map(v => <option key={v} value={String(v)}>{pct(v)}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Order</label><input className="form-input" type="number" value={f.sort_order} onChange={e => set('sort_order', Number(e.target.value) || 100)} /></div>
          </div>
          <label className="olk-switch"><Toggle checked={f.requires_review} onChange={v => set('requires_review', v)} label="Always review" /> <span><b>Always send to review</b><br /><span className="olk-hint">Even when every check passes.</span></span></label>
        </Group>
        <Group title="Document evidence" hint="An attachment of these types counts towards this category">
          <ChipPick disabled={!canEdit} options={cfg.document_types.map(d => [d.code, d.name])} value={f.related_document_types || []} onChange={v => set('related_document_types', v)} />
        </Group>
        <Group title="Availability">
          <div className="form-row">
            <div className="form-group"><label className="form-label">Effective from</label><input className="form-input" type="date" value={f.effective_from || ''} onChange={e => set('effective_from', e.target.value || null)} /></div>
            <div className="form-group"><label className="form-label">Effective to</label><input className="form-input" type="date" value={f.effective_to || ''} onChange={e => set('effective_to', e.target.value || null)} /></div>
          </div>
          <label className="olk-switch"><Toggle checked={f.is_active} onChange={v => set('is_active', v)} label="Active" /> <span><b>Active</b></span></label>
        </Group>
      </fieldset>
    </Drawer>
  )
}

/* ═══ keyword rules ═══ */

const NEW_RULE = { name: '', terms: [], combine: 'ANY', locations: ['SUBJECT', 'BODY'], match_mode: 'PHRASE', case_sensitive: false, is_exclusion: false, category_code: null, document_type_code: null, weight: 50, vendor_ids: [], proposed_action: '', is_active: true, effective_from: null, effective_to: null }

function Rules({ cfg, canEdit, vendors, act }) {
  const [q, setQ] = useState('')
  const [target, setTarget] = useState('')
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState('all')
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const [showConflicts, setShowConflicts] = useState(false)
  const cats = Object.fromEntries(cfg.categories.map(c => [c.code, c]))
  const docs = Object.fromEntries(cfg.document_types.map(d => [d.code, d]))
  const conflicts = useMemo(() => findRuleConflicts(cfg.rules), [cfg.rules])
  const kindOf = r => (r.is_exclusion ? 'exclusion' : r.category_code ? 'intent' : 'document')
  const rows = cfg.rules.filter(r => (!target || r.category_code === target || r.document_type_code === target) && (kind === 'all' || kindOf(r) === kind)
    && (status === 'all' || (status === 'active') === r.is_active) && (!q || `${r.name} ${r.terms.join(' ')} ${r.proposed_action || ''}`.toLowerCase().includes(q.toLowerCase())))
  const n = k => cfg.rules.filter(r => kindOf(r) === k).length
  return (
    <>
      <Stats items={[
        ['Rules', cfg.rules.length], ['Active', cfg.rules.filter(r => r.is_active).length, 'good'], ['Email intent', n('intent')], ['Document', n('document')],
        ['Exclusions', n('exclusion')], ['Vendor-scoped', cfg.rules.filter(r => r.vendor_ids?.length).length], ['Possible conflicts', conflicts.length, conflicts.length ? 'warn' : ''],
      ]} />
      {conflicts.length > 0 && (
        <div className="eic-alert warn">
          <AlertTriangle size={14} /><div style={{ flex: 1 }}><b>{conflicts.length} possible rule conflict{conflicts.length > 1 ? 's' : ''}.</b> Rules with identical keywords pointing in different directions are decided by weight — make the intended one stronger.
            {showConflicts && <ul className="ei-list">{conflicts.map((c, i) => <li key={i}>{c.reason}</li>)}</ul>}</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowConflicts(s => !s)}>{showConflicts ? 'Hide' : 'Show'}</button>
        </div>
      )}
      <div className="table-wrap">
        <div className="gl-bar">
          <Search value={q} onChange={setQ} placeholder="Rule, keyword or action…" />
          <Seg value={kind} onChange={setKind} options={[['all', 'All'], ['intent', 'Email intent', n('intent')], ['document', 'Document', n('document')], ['exclusion', 'Exclusion', n('exclusion')]]} />
          <select className="form-select" value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">Any target</option>
            <optgroup label="Email categories">{cfg.categories.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</optgroup>
            <optgroup label="Document types">{cfg.document_types.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</optgroup>
          </select>
          <Seg value={status} onChange={setStatus} options={[['all', 'All'], ['active', 'Active'], ['inactive', 'Off']]} />
          <div className="gl-grow" />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...NEW_RULE })}><Plus size={13} /> New rule</button>}
        </div>
        <div className="gl-tscroll"><table className="gl-table gl-st-table eic-table">
          <thead><tr><th style={{ minWidth: 200 }}>Rule</th><th style={{ minWidth: 220 }}>Keywords</th><th>Looks in</th><th>Sets</th><th style={{ width: 120 }}>Weight</th><th>Active</th><th /></tr></thead>
          <tbody>
            {!rows.length && <Empty>No rules match these filters.</Empty>}
            {rows.map(r => (
              <tr key={r.id} className={`eic-row${r.is_active ? '' : ' off'}`} onClick={() => setEdit({ ...r })}>
                <td><div className="gl-st-name">{r.name}</div><div className="eic-code">{MODE_LABELS[r.match_mode]}{r.case_sensitive ? ' · case-sensitive' : ''}{r.vendor_ids?.length ? ` · ${r.vendor_ids.length} vendor(s)` : ''}</div></td>
                <td><div className="ei-terms">{r.terms.slice(0, 3).map(t => <span key={t} className="eic-term">{t}</span>)}{r.terms.length > 3 && <span className="eic-more">+{r.terms.length - 3}</span>}</div>{r.terms.length > 1 && <div className="eic-code">{r.combine === 'ALL' ? 'all must appear' : 'any one'}</div>}</td>
                <td><div className="eic-locs">{r.locations.map(l => <span key={l}>{LOC_SHORT[l]}</span>)}</div></td>
                <td>
                  {r.is_exclusion && <span className="gl-pill red" style={{ marginBottom: 3 }}>Excludes</span>}
                  {r.category_code && <div className="eic-target"><Tags size={11} /> {cats[r.category_code]?.name || r.category_code}</div>}
                  {r.document_type_code && <div className="eic-target"><FileStack size={11} /> {docs[r.document_type_code]?.name || r.document_type_code}</div>}
                </td>
                <td><div className="eic-weight"><div style={{ width: `${r.weight}%` }} /><span>{r.weight}</span></div></td>
                <td onClick={e => e.stopPropagation()}><Toggle checked={r.is_active} disabled={!canEdit} label="Active" onChange={v => act(() => saveRule({ ...r, is_active: v }), `Rule ${v ? 'on' : 'off'} (draft).`)} /></td>
                <td onClick={e => e.stopPropagation()}>{canEdit && <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setDel(r)}><Trash2 size={12} /></button>}</td>
              </tr>))}
          </tbody></table></div>
      </div>
      {edit && <RuleDrawer row={edit} cfg={cfg} canEdit={canEdit} vendors={vendors} onClose={() => setEdit(null)} onSave={async r => { if (await act(() => saveRule(r), 'Rule saved to draft.')) setEdit(null) }} />}
      <Confirm open={!!del} danger message={del && `Delete rule "${del.name}"?`} onCancel={() => setDel(null)} onConfirm={() => { const d = del; setDel(null); act(() => remove('ei_keyword_rules', d.id), 'Rule deleted (draft).') }} />
    </>
  )
}

function RuleDrawer({ row, cfg, canEdit, vendors, onClose, onSave }) {
  const [f, setF] = useState({ ...row, termsText: (row.terms || []).join('\n') })
  const [sample, setSample] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const rule = { ...f, terms: f.termsText.split('\n').map(t => t.trim()).filter(Boolean) }
  const errs = validateRule(rule, { categories: cfg.categories, documentTypes: cfg.document_types })
  const conflicts = findRuleConflicts([...cfg.rules.filter(r => r.id !== row.id), { ...rule, id: 'this', name: rule.name || 'this rule' }]).filter(c => c.a === 'this' || c.b === 'this')
  const trial = sample.trim() && !errs.length ? evaluateRule({ ...rule, vendor_ids: [] }, { subject: sample, body: sample, senderEmail: sample, attachmentNames: [sample], attachmentTexts: [sample] }) : null
  return (
    <Drawer title={row.id ? row.name : 'New keyword rule'} subtitle={row.id ? 'Edits go to the draft' : 'Added to the draft'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>{canEdit && <button className="btn btn-primary" disabled={errs.length > 0} onClick={() => { const { termsText, ...r } = rule; onSave(r) }}>Save to draft</button>}</>}>
      {(errs.length > 0 || conflicts.length > 0) && <div className="olk-msg error">{[...errs, ...conflicts.map(c => c.reason)].join(' · ')}</div>}
      <fieldset disabled={!canEdit} className="eic-fs">
        <Group title="Rule">
          <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Proposed action (shown to reviewers)</label><input className="form-input" value={f.proposed_action || ''} onChange={e => set('proposed_action', e.target.value)} /></div>
        </Group>
        <Group title="Keywords" hint="One keyword or phrase per line">
          <textarea className="form-textarea eic-mono" rows={4} value={f.termsText} onChange={e => set('termsText', e.target.value)} placeholder={'tax invoice\ninvoice attached'} />
          <div className="form-row" style={{ marginTop: 10 }}>
            <div className="form-group"><label className="form-label">Combine</label><select className="form-select" value={f.combine} onChange={e => set('combine', e.target.value)}><option value="ANY">Any keyword (OR)</option><option value="ALL">All keywords (AND)</option></select></div>
            <div className="form-group"><label className="form-label">Match mode</label><select className="form-select" value={f.match_mode} onChange={e => set('match_mode', e.target.value)}>{MATCH_MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}</select></div>
          </div>
          <label className="olk-switch"><Toggle checked={f.case_sensitive} onChange={v => set('case_sensitive', v)} label="Case sensitive" /> <span><b>Case-sensitive</b></span></label>
        </Group>
        <Group title="Try it" hint="Paste text to see whether this rule would fire">
          <textarea className="form-textarea" rows={2} value={sample} onChange={e => setSample(e.target.value)} placeholder="e.g. Please find the tax invoice attached" />
          {trial && <div className={`eic-trial ${trial.matched ? 'yes' : 'no'}`}>{trial.matched ? <><CheckCircle2 size={13} /> Fires — matched {trial.hits.map(h => `"${h.term}"`).join(', ')}</> : <><X size={13} /> Does not fire{rule.combine === 'ALL' && trial.hits.length ? ` (only ${trial.hits.length} of ${rule.terms.length} keywords found)` : ''}</>}</div>}
        </Group>
        <Group title="Where to look">
          <ChipPick disabled={!canEdit} options={LOCATIONS.map(l => [l, LOCATION_LABELS[l]])} value={f.locations} onChange={v => set('locations', v)} />
          <div className="olk-hint">Document-type rules only ever look at the file itself (name and text).</div>
        </Group>
        <Group title="What it sets">
          <div className="form-row">
            <div className="form-group"><label className="form-label">Email category</label><select className="form-select" value={f.category_code || ''} onChange={e => set('category_code', e.target.value || null)}><option value="">—</option>{cfg.categories.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Document type</label><select className="form-select" value={f.document_type_code || ''} onChange={e => set('document_type_code', e.target.value || null)}><option value="">—</option>{cfg.document_types.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label">Weight — {f.weight}</label><input type="range" min={1} max={100} value={f.weight} onChange={e => set('weight', Number(e.target.value))} style={{ width: '100%' }} /><div className="olk-hint">Higher weight wins when several rules match. Vendor-scoped rules get a bonus.</div></div>
          <label className="olk-switch"><Toggle checked={f.is_exclusion} onChange={v => set('is_exclusion', v)} label="Exclusion" /> <span><b>Exclusion rule</b><br /><span className="olk-hint">When it matches, the category / document type above is ruled out.</span></span></label>
        </Group>
        <Group title="Scope & availability">
          <div className="form-group"><label className="form-label">Only for these vendors (empty = any sender)</label>
            <select className="form-select" value="" onChange={e => e.target.value && set('vendor_ids', [...new Set([...(f.vendor_ids || []), e.target.value])])}>
              <option value="">+ Add vendor…</option>{vendors.filter(v => !(f.vendor_ids || []).includes(v.id)).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <div className="olk-chips" style={{ marginTop: 6 }}>{(f.vendor_ids || []).map(id => <button key={id} type="button" className="chip-toggle on" onClick={() => set('vendor_ids', f.vendor_ids.filter(x => x !== id))}>{vendors.find(v => v.id === id)?.name || 'Vendor'} ×</button>)}</div></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Effective from</label><input className="form-input" type="date" value={f.effective_from || ''} onChange={e => set('effective_from', e.target.value || null)} /></div>
            <div className="form-group"><label className="form-label">Effective to</label><input className="form-input" type="date" value={f.effective_to || ''} onChange={e => set('effective_to', e.target.value || null)} /></div>
          </div>
          <label className="olk-switch"><Toggle checked={f.is_active} onChange={v => set('is_active', v)} label="Active" /> <span><b>Active</b></span></label>
        </Group>
        <div className="eic-note"><ShieldCheck size={13} /> A keyword match only classifies. It never approves, posts, pays or changes vendor data.</div>
      </fieldset>
    </Drawer>
  )
}

/* ═══ document types ═══ */

const NEW_DOC = { code: '', name: '', description: '', formats: ['pdf'], fields: [], required_fields: [], duplicate_keys: [], destination: 'REVIEW_QUEUE', confidence_threshold: 0.75, requires_review: false, sort_order: 100, is_active: true }

function DocumentTypes({ cfg, canEdit, act }) {
  const [q, setQ] = useState('')
  const [dest, setDest] = useState('')
  const [fam, setFam] = useState('')
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const [importing, setImporting] = useState(false)
  const hasTaxonomy = cfg.document_types.some(d => 'aliases' in d)   // STEP269 columns present
  const families = useMemo(() => [...new Set(cfg.document_types.map(d => d.family).filter(Boolean))].sort(), [cfg.document_types])
  const used = useMemo(() => new Set(cfg.rules.map(r => r.document_type_code).filter(Boolean)), [cfg.rules])
  const ruleCount = useMemo(() => cfg.rules.reduce((m, r) => (r.document_type_code ? { ...m, [r.document_type_code]: (m[r.document_type_code] || 0) + 1 } : m), {}), [cfg.rules])
  const rows = cfg.document_types.filter(d => (!dest || d.destination === dest) && (!fam || (fam === '-' ? !d.family : d.family === fam))
    && (!q || `${d.code} ${d.name} ${(d.aliases || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())))
  async function loadBaseline() {
    setImporting(true)
    await act(async () => { const r = await importBaselineTaxonomy(); if (!r) throw new Error('Nothing imported') },
      'Baseline taxonomy loaded into the draft — review it, then publish.')
    setImporting(false)
  }
  return (
    <>
      <Stats items={[
        ['Document types', cfg.document_types.length], ['Active', cfg.document_types.filter(d => d.is_active).length, 'good'],
        ['With extraction', cfg.document_types.filter(d => (d.fields || []).length).length], ['To invoice register', cfg.document_types.filter(d => d.destination === 'INVOICE_REGISTER').length],
        ['Always reviewed', cfg.document_types.filter(d => d.requires_review).length],
      ]} />
      <div className="eic-note" style={{ marginBottom: 10 }}><Info size={13} /> Each attachment is classified on its own from its file name and content — never from the email text. Files nobody can identify go to review.</div>
      <div className="table-wrap">
        <div className="gl-bar">
          <Search value={q} onChange={setQ} placeholder="Document type or code…" />
          <select className="form-select" value={dest} onChange={e => setDest(e.target.value)}><option value="">Any handling</option>{Object.keys(DESTINATIONS).map(k => <option key={k} value={k}>{DEST_SHORT[k][0]}</option>)}</select>
          {families.length > 0 && <select className="form-select" value={fam} onChange={e => setFam(e.target.value)}><option value="">All families</option>{families.map(f => <option key={f} value={f}>{f}</option>)}<option value="-">No family</option></select>}
          <div className="gl-grow" />
          {canEdit && hasTaxonomy && <button className="btn btn-ghost btn-sm" disabled={importing} onClick={loadBaseline} title="Adds about 500 corporate document types (26 families) and acronym meanings to the draft. Existing types and your edits are kept."><Library size={13} /> {importing ? 'Loading…' : 'Load baseline taxonomy'}</button>}
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...NEW_DOC, ...(hasTaxonomy ? { family: null, category: null, industries: [], aliases: [], area: null, primary_module: null, related_modules: [] } : {}) })}><Plus size={13} /> New document type</button>}
        </div>
        <div className="gl-tscroll"><table className="gl-table gl-st-table eic-table">
          <thead><tr><th style={{ minWidth: 220 }}>Document type</th><th>Formats</th><th>Extraction</th><th>Then</th><th className="num">Threshold</th><th className="num">Rules</th><th>Active</th><th /></tr></thead>
          <tbody>
            {!rows.length && <Empty>No document types match.</Empty>}
            {rows.map(d => (
              <tr key={d.id} className={`eic-row${d.is_active ? '' : ' off'}`} onClick={() => setEdit({ ...d })}>
                <td><div className="gl-st-name">{d.name}</div><div className="eic-code">{d.code}{d.family ? ` · ${d.family}` : ''}{d.requires_review ? ' · always reviewed' : ''}</div>{(d.aliases || []).length > 0 && <div className="eic-code" title={d.aliases.join(', ')}>aka {d.aliases.slice(0, 3).join(', ')}{d.aliases.length > 3 ? '…' : ''}</div>}</td>
                <td><div className="eic-locs">{(d.formats || []).slice(0, 4).map(x => <span key={x}>{x}</span>)}{(d.formats || []).length > 4 && <span>+{d.formats.length - 4}</span>}</div></td>
                <td>{(d.fields || []).length ? <><b>{d.fields.length}</b> fields <span className="eic-code">· {(d.required_fields || []).length} required</span></> : <span className="gl-st-zero">–</span>}</td>
                <td><Pill map={DEST_SHORT} k={d.destination} /></td>
                <td className="num">{pct(d.confidence_threshold)}</td>
                <td className="num">{ruleCount[d.code] || <span className="gl-st-zero">–</span>}</td>
                <td onClick={e => e.stopPropagation()}><Toggle checked={d.is_active} disabled={!canEdit} label="Active" onChange={v => act(() => saveDocumentType({ ...d, is_active: v }), `${d.name} ${v ? 'activated' : 'deactivated'} (draft).`)} /></td>
                <td onClick={e => e.stopPropagation()}>{canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setDel(d)}><Trash2 size={12} /></button>}</td>
              </tr>))}
          </tbody></table></div>
      </div>
      {edit && <DocDrawer row={edit} canEdit={canEdit} hasTaxonomy={hasTaxonomy} families={families} onClose={() => setEdit(null)} onSave={async r => { if (await act(() => saveDocumentType(r), 'Document type saved to draft.')) setEdit(null) }} />}
      <Confirm open={!!del} danger message={del && (used.has(del.code) ? `"${del.name}" is used by keyword rules — it will be deactivated instead.` : `Delete "${del.name}"?`)}
        onCancel={() => setDel(null)} onConfirm={() => { const d = del; setDel(null); act(async () => { if (used.has(d.code)) await saveDocumentType({ ...d, is_active: false }); else await remove('ei_document_types', d.id) }, 'Saved to draft.') }} />
    </>
  )
}

const listText = a => (a || []).join('; ')
const textList = t => [...new Set(String(t || '').split(/[;,\n]/).map(x => x.trim()).filter(Boolean))]

function DocDrawer({ row, canEdit, hasTaxonomy, families = [], onClose, onSave }) {
  const [f, setF] = useState({ ...row, formatsText: (row.formats || []).join(', '), aliasesText: listText(row.aliases), industriesText: listText(row.industries), relatedText: listText(row.related_modules) })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const fields = f.fields || []
  const setField = (i, k, v) => set('fields', fields.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const keysOk = fields.every(x => /^[a-z][a-z0-9_]{0,40}$/.test(x.key || '') && x.label)
  const patternsOk = fields.every(x => !x.pattern || (() => { try { new RegExp(x.pattern, 'i'); return x.pattern.length <= 300 } catch { return false } })())
  const codeOk = /^[A-Z][A-Z0-9_]{1,59}$/.test(f.code || '')
  return (
    <Drawer title={row.id ? row.name : 'New document type'} subtitle={row.id ? row.code : 'Added to the draft'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>{canEdit && <button className="btn btn-primary" disabled={!f.name?.trim() || !codeOk || !keysOk || !patternsOk}
        onClick={() => {
          const { formatsText, aliasesText, industriesText, relatedText, ...r } = f
          const tax = hasTaxonomy ? { aliases: textList(aliasesText), industries: textList(industriesText).map(x => x.toLowerCase()), related_modules: textList(relatedText), area: r.area || null, primary_module: r.primary_module || null, family: r.family || null, category: r.category || null } : {}
          onSave({ ...r, ...tax, formats: formatsText.split(/[,\s]+/).map(x => x.replace(/^\./, '').toLowerCase()).filter(Boolean), required_fields: (r.required_fields || []).filter(k => fields.some(x => x.key === k)) })
        }}>Save to draft</button>}</>}>
      {!keysOk && <div className="olk-msg error">Each field needs a label and a key in lower_snake_case.</div>}
      {!patternsOk && <div className="olk-msg error">A field pattern is not a valid regular expression.</div>}
      <fieldset disabled={!canEdit} className="eic-fs">
        <Group title="Identity">
          <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Code *</label><input className="form-input eic-mono" value={f.code} disabled={!!row.id} onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} /></div>
            <div className="form-group"><label className="form-label">File formats</label><input className="form-input" value={f.formatsText} onChange={e => set('formatsText', e.target.value)} placeholder="pdf, jpg, png" /></div>
          </div>
        </Group>
        {hasTaxonomy && <Group title="Taxonomy & filing" hint="Aliases and acronyms help recognise the document from its title; area and modules decide where it is filed on a project">
          <div className="form-row">
            <div className="form-group"><label className="form-label">Family</label><input className="form-input" list="ei-families" value={f.family || ''} onChange={e => set('family', e.target.value)} placeholder="e.g. EPC and Construction" /><datalist id="ei-families">{families.map(x => <option key={x} value={x} />)}</datalist></div>
            <div className="form-group"><label className="form-label">Category</label><input className="form-input" value={f.category || ''} onChange={e => set('category', e.target.value)} placeholder="optional sub-group" /></div>
          </div>
          <div className="form-group"><label className="form-label">Aliases, acronyms and alternate titles</label><input className="form-input" value={f.aliasesText} onChange={e => set('aliasesText', e.target.value)} placeholder="e.g. WIR; Work inspection request; Inspection call" /></div>
          <div className="form-group"><label className="form-label">Industries</label><input className="form-input" value={f.industriesText} onChange={e => set('industriesText', e.target.value)} placeholder="e.g. construction; government — or all" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Project workspace area</label><select className="form-select" value={f.area || ''} onChange={e => set('area', e.target.value)}><option value="">Default</option>{AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Primary module</label><select className="form-select" value={f.primary_module || ''} onChange={e => set('primary_module', e.target.value)}><option value="">None</option>{MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label">Related modules (keys)</label><input className="form-input eic-mono" value={f.relatedText} onChange={e => set('relatedText', e.target.value)} placeholder="e.g. invoices; projects" /></div>
        </Group>}
        <Group title="Handling">
          <div className="form-group"><label className="form-label">Then</label><select className="form-select" value={f.destination} onChange={e => set('destination', e.target.value)}>{Object.entries(DESTINATIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Confidence threshold</label><select className="form-select" value={String(f.confidence_threshold)} onChange={e => set('confidence_threshold', Number(e.target.value))}>{[0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9].map(v => <option key={v} value={String(v)}>{pct(v)}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Duplicate check on</label><ChipPick disabled={!canEdit} options={[['vendor_id', 'Vendor'], ['invoice_number', 'Invoice number']]} value={f.duplicate_keys || []} onChange={v => set('duplicate_keys', v)} /></div>
          </div>
          <label className="olk-switch"><Toggle checked={f.requires_review} onChange={v => set('requires_review', v)} label="Always review" /> <span><b>Always send to review</b></span></label>
          <label className="olk-switch"><Toggle checked={f.is_active} onChange={v => set('is_active', v)} label="Active" /> <span><b>Active</b></span></label>
        </Group>
        <Group title="Extraction schema" hint="Pattern = optional regular expression; the first bracketed group is the value. AI fills the same fields when configured.">
          {fields.length ? <div className="eic-fields">{fields.map((x, i) => (
            <div key={i} className="eic-field">
              <div className="form-row">
                <div className="form-group"><label className="form-label">Label</label><input className="form-input" value={x.label || ''} onChange={e => setField(i, 'label', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Key</label><input className="form-input eic-mono" value={x.key || ''} onChange={e => setField(i, 'key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} /></div>
                <div className="form-group" style={{ maxWidth: 110 }}><label className="form-label">Type</label><select className="form-select" value={x.type || 'text'} onChange={e => setField(i, 'type', e.target.value)}>{FIELD_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div className="form-group"><label className="form-label">Pattern</label><input className="form-input eic-mono" value={x.pattern || ''} onChange={e => setField(i, 'pattern', e.target.value)} placeholder="optional" /></div>
              <div className="eic-field-foot">
                <label><input type="checkbox" checked={(f.required_fields || []).includes(x.key)} onChange={e => set('required_fields', e.target.checked ? [...(f.required_fields || []), x.key] : f.required_fields.filter(k => k !== x.key))} /> Required</label>
                {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('fields', fields.filter((_, j) => j !== i))}><Trash2 size={12} /> Remove</button>}
              </div>
            </div>))}</div> : <div className="gl-meta">No fields — files of this type are classified and recorded, not read.</div>}
          {canEdit && <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => set('fields', [...fields, { key: '', label: '', type: 'text' }])}><Plus size={12} /> Add field</button>}
        </Group>
      </fieldset>
    </Drawer>
  )
}

/* ═══ acronyms (STEP269) ═══ */

const NEW_ACR = { acronym: '', expansion: '', document_type_code: null, industries: [], context_terms: [], customer_id: null, project_id: null, region: null, notes: '', is_approved: true, is_active: true }

function Acronyms({ cfg, canEdit, customers, projects, act }) {
  const [q, setQ] = useState('')
  const [view, setView] = useState('')
  const [edit, setEdit] = useState(null)
  if (cfg.acronyms === null) return <div className="card" style={{ padding: 20 }}>Run <code>sql/STEP269_ei_taxonomy_acronyms.sql</code> in the Supabase SQL editor to enable the acronym registry.</div>
  const list = cfg.acronyms
  const meanings = list.reduce((m, a) => ({ ...m, [a.acronym.toUpperCase()]: (m[a.acronym.toUpperCase()] || 0) + 1 }), {})
  const docName = Object.fromEntries(cfg.document_types.map(d => [d.code, d.name]))
  const cust = Object.fromEntries(customers.map(c => [c.id, c.name]))
  const proj = Object.fromEntries(projects.map(p => [p.id, `${p.code} · ${p.name}`]))
  const rows = list.filter(a => (!view || (view === 'ambiguous' ? meanings[a.acronym.toUpperCase()] > 1 : view === 'pending' ? !a.is_approved : view === 'scoped' ? (a.customer_id || a.project_id) : true))
    && (!q || `${a.acronym} ${a.expansion} ${docName[a.document_type_code] || ''}`.toLowerCase().includes(q.toLowerCase())))
  const ambiguousCount = Object.values(meanings).filter(n => n > 1).length
  return (
    <>
      <Stats items={[['Acronyms', Object.keys(meanings).length], ['Meanings', list.length], ['With several meanings', ambiguousCount, ambiguousCount ? 'warn' : ''], ['Client / project specific', list.filter(a => a.customer_id || a.project_id).length], ['Suggested, not approved', list.filter(a => !a.is_approved).length, list.some(a => !a.is_approved) ? 'warn' : '']]} />
      <div className="eic-note" style={{ marginBottom: 10 }}><Info size={13} /> One row per meaning. When an acronym has several meanings, a document only uses one when its words (context), the client or the project clearly point to it — otherwise the acronym is ignored and the document goes to review. Nothing is routed on an acronym alone.</div>
      <div className="table-wrap">
        <div className="gl-bar">
          <Search value={q} onChange={setQ} placeholder="Acronym, meaning or document type…" />
          <Seg value={view} onChange={setView} options={[['', 'All'], ['ambiguous', 'Several meanings', ambiguousCount], ['scoped', 'Client / project'], ['pending', 'Suggested', list.filter(a => !a.is_approved).length]]} />
          <div className="gl-grow" />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...NEW_ACR })}><Plus size={13} /> New meaning</button>}
        </div>
        <div className="gl-tscroll"><table className="gl-table gl-st-table eic-table">
          <thead><tr><th style={{ width: 110 }}>Acronym</th><th>Meaning</th><th>Document type</th><th>Applies to</th><th>Context words</th><th>Approved</th><th>Active</th><th /></tr></thead>
          <tbody>
            {!rows.length && <Empty>{list.length ? 'Nothing matches.' : 'No acronyms yet — use "Load baseline taxonomy" under Document types, or add meanings here.'}</Empty>}
            {rows.slice(0, 500).map(a => (
              <tr key={a.id} className={`eic-row${a.is_active ? '' : ' off'}`} onClick={() => setEdit({ ...a })}>
                <td><b className="eic-mono">{a.acronym}</b>{meanings[a.acronym.toUpperCase()] > 1 && <div className="eic-code">{meanings[a.acronym.toUpperCase()]} meanings</div>}</td>
                <td>{a.expansion}</td>
                <td>{a.document_type_code ? docName[a.document_type_code] || a.document_type_code : <span className="gl-st-zero">meaning only</span>}</td>
                <td className="eic-code">{a.project_id ? proj[a.project_id] || 'project' : a.customer_id ? cust[a.customer_id] || 'client' : (a.industries || []).join(', ') || 'everyone'}</td>
                <td><div className="eic-locs">{(a.context_terms || []).slice(0, 4).map(t => <span key={t}>{t}</span>)}</div></td>
                <td onClick={e => e.stopPropagation()}><Toggle checked={a.is_approved} disabled={!canEdit} label="Approved" onChange={v => act(() => saveAcronym({ ...a, is_approved: v }), v ? 'Approved (draft).' : 'Moved back to suggested (draft).')} /></td>
                <td onClick={e => e.stopPropagation()}><Toggle checked={a.is_active} disabled={!canEdit} label="Active" onChange={v => act(() => saveAcronym({ ...a, is_active: v }), 'Saved to draft.')} /></td>
                <td onClick={e => e.stopPropagation()}>{canEdit && <button className="btn btn-ghost btn-sm" onClick={() => act(() => remove('ei_acronyms', a.id), 'Meaning removed (draft).')}><Trash2 size={12} /></button>}</td>
              </tr>))}
          </tbody></table></div>
        {rows.length > 500 && <div className="gl-meta" style={{ padding: 10 }}>Showing 500 of {rows.length} — search to narrow down.</div>}
      </div>
      {edit && <AcronymDrawer row={edit} cfg={cfg} customers={customers} projects={projects} canEdit={canEdit} onClose={() => setEdit(null)}
        onSave={async r => { if (await act(() => saveAcronym(r), 'Meaning saved to draft.')) setEdit(null) }} />}
    </>
  )
}

function AcronymDrawer({ row, cfg, customers, projects, canEdit, onClose, onSave }) {
  const [f, setF] = useState({ ...row, contextText: (row.context_terms || []).join('; '), industriesText: (row.industries || []).join('; ') })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const ok = f.acronym.trim() && f.expansion.trim().length >= 2
  return (
    <Drawer title={row.id ? `${row.acronym} — ${row.expansion}` : 'New acronym meaning'} subtitle="Saved to the draft" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>{canEdit && <button className="btn btn-primary" disabled={!ok} onClick={() => {
        const { contextText, industriesText, ...r } = f
        onSave({ ...r, document_type_code: r.document_type_code || null, customer_id: r.customer_id || null, project_id: r.project_id || null,
          context_terms: contextText.split(/[;,\n]/).map(x => x.trim()).filter(Boolean), industries: industriesText.split(/[;,\n]/).map(x => x.trim()).filter(Boolean) })
      }}>Save to draft</button>}</>}>
      <fieldset disabled={!canEdit} className="eic-fs">
        <Group title="Meaning">
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 140 }}><label className="form-label">Acronym *</label><input className="form-input eic-mono" value={f.acronym} onChange={e => set('acronym', e.target.value)} placeholder="RPC" /></div>
            <div className="form-group"><label className="form-label">Stands for *</label><input className="form-input" value={f.expansion} onChange={e => set('expansion', e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Document type it identifies</label><select className="form-select" value={f.document_type_code || ''} onChange={e => set('document_type_code', e.target.value)}><option value="">None — a meaning only</option>{cfg.document_types.filter(d => d.is_active).map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Context words that support this meaning</label><input className="form-input" value={f.contextText} onChange={e => set('contextText', e.target.value)} placeholder="e.g. sanction; revised; cost" /></div>
        </Group>
        <Group title="Applies to" hint="Leave empty for everyone. A client or project meaning wins for that client / project only.">
          <div className="form-group"><label className="form-label">Industries</label><input className="form-input" value={f.industriesText} onChange={e => set('industriesText', e.target.value)} placeholder="e.g. government; construction" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Client</label><select className="form-select" value={f.customer_id || ''} onChange={e => set('customer_id', e.target.value)}><option value="">Any</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Project</label><select className="form-select" value={f.project_id || ''} onChange={e => set('project_id', e.target.value)}><option value="">Any</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label">Region</label><input className="form-input" value={f.region || ''} onChange={e => set('region', e.target.value)} placeholder="optional, e.g. India / GCC" /></div>
          <div className="form-group"><label className="form-label">Notes</label><input className="form-input" value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
          <label className="olk-switch"><Toggle checked={f.is_approved} onChange={v => set('is_approved', v)} label="Approved" /> <span><b>Approved</b><br /><span className="olk-hint">Only approved meanings are published to the worker.</span></span></label>
        </Group>
      </fieldset>
    </Drawer>
  )
}

/* ═══ vendor mapping ═══ */

function VendorMapping({ cfg, canEdit, vendors, act }) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const byId = Object.fromEntries(vendors.map(v => [v.id, v]))
  const rows = cfg.vendor_aliases.filter(a => !q || `${a.value} ${byId[a.vendor_id]?.name || ''}`.toLowerCase().includes(q.toLowerCase()))
  const STEPS = [['GSTIN on the document', 'Vendor master GSTIN or a GSTIN mapping'], ['Sender email', 'Vendor email, vendor contacts or a verified email mapping'], ['Company domain', 'Vendor / contact domain or a verified domain mapping (never gmail.com & co)'], ['Legal name', 'Vendor name or a name mapping']]
  return (
    <>
      <Stats items={[['Vendors in master', vendors.length], ['Mappings', cfg.vendor_aliases.length], ['Verified', cfg.vendor_aliases.filter(a => a.verified).length, 'good'], ['Unverified', cfg.vendor_aliases.filter(a => !a.verified).length, cfg.vendor_aliases.some(a => !a.verified) ? 'warn' : '']]} />
      <div className="card eic-steps">
        <div className="eic-fgroup-h">How a sender becomes a vendor <span>Existing vendor master only — a vendor is never created from an email</span></div>
        <ol>{STEPS.map(([t, d], i) => <li key={t}><span className="eic-step-n">{i + 1}</span><div><b>{t}</b><div className="gl-meta">{d}</div></div></li>)}</ol>
        <div className="eic-note"><AlertTriangle size={13} /> If the document's GSTIN and the sender belong to different vendors, the email is flagged as a conflict and goes to Vendor verification.</div>
      </div>
      <div className="table-wrap">
        <div className="gl-bar"><Search value={q} onChange={setQ} placeholder="Vendor or value…" /><div className="gl-grow" />{canEdit && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={13} /> New mapping</button>}</div>
        <div className="gl-tscroll"><table className="gl-table gl-st-table eic-table">
          <thead><tr><th>Vendor</th><th>Type</th><th>Value</th><th>Verified</th><th /></tr></thead>
          <tbody>
            {!rows.length && <Empty>{cfg.vendor_aliases.length ? 'No mappings match.' : 'No extra mappings — vendors are matched on their master email, GSTIN and contacts.'}</Empty>}
            {rows.map(a => (
              <tr key={a.id}><td className="gl-st-name">{byId[a.vendor_id]?.name || a.vendor_id}</td><td><span className="eic-term">{a.alias_type}</span></td><td className="eic-mono">{a.value}</td>
                <td><Toggle checked={a.verified} disabled={!canEdit} onChange={v => act(() => saveAlias({ ...a, verified: v }), 'Mapping updated (draft).')} label="Verified" /></td>
                <td>{canEdit && <button className="btn btn-ghost btn-sm" onClick={() => act(() => remove('ei_vendor_aliases', a.id), 'Mapping removed (draft).')}><Trash2 size={12} /></button>}</td></tr>))}
          </tbody></table></div>
      </div>
      {adding && <AliasDrawer vendors={vendors} onClose={() => setAdding(false)} onSave={async f => { if (await act(() => saveAlias(f), 'Mapping saved to draft.')) setAdding(false) }} />}
    </>
  )
}
function AliasDrawer({ vendors, onClose, onSave }) {
  const [f, setF] = useState({ vendor_id: '', alias_type: 'EMAIL', value: '', verified: false, note: '' })
  return (
    <Drawer title="New vendor mapping" subtitle="Points an extra identity at an existing vendor" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.vendor_id || !f.value.trim()} onClick={() => onSave(f)}>Save to draft</button></>}>
      <Group title="Mapping">
        <div className="form-group"><label className="form-label">Vendor *</label><select className="form-select" value={f.vendor_id} onChange={e => setF({ ...f, vendor_id: e.target.value })}><option value="">Choose…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div className="form-row">
          <div className="form-group" style={{ maxWidth: 160 }}><label className="form-label">Type</label><select className="form-select" value={f.alias_type} onChange={e => setF({ ...f, alias_type: e.target.value })}>{['EMAIL', 'DOMAIN', 'NAME', 'GSTIN'].map(t => <option key={t}>{t}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Value *</label><input className="form-input" value={f.value} onChange={e => setF({ ...f, value: e.target.value })} placeholder={{ EMAIL: 'ap@vendor.com', DOMAIN: 'vendor.com', NAME: 'Vendor trading name', GSTIN: '29ABCDE1234F1Z5' }[f.alias_type]} /></div>
        </div>
        <label className="olk-switch"><Toggle checked={f.verified} onChange={v => setF({ ...f, verified: v })} label="Verified" /> <span><b>Verified</b><br /><span className="olk-hint">Email and domain mappings only identify a sender on their own when verified (e.g. confirmed with the vendor by phone).</span></span></label>
      </Group>
    </Drawer>
  )
}

/* ═══ matching & AI ═══ */

function Row({ label, help, children }) {
  return <div className="eic-setrow"><div className="eic-setrow-l"><b>{label}</b>{help && <span>{help}</span>}</div><div className="eic-setrow-c">{children}</div></div>
}

function Matching({ cfg, canEdit, act }) {
  const [s, setS] = useState(cfg.settings)
  const dirty = JSON.stringify(s) !== JSON.stringify(cfg.settings)
  const set = (sec, k, v) => setS(x => ({ ...x, [sec]: { ...(x[sec] || {}), [k]: v } }))
  const num = (sec, k, step = 1, suffix) => <div className="eic-num"><input className="form-input" type="number" step={step} min={0} disabled={!canEdit} value={s[sec]?.[k] ?? ''} onChange={e => set(sec, k, e.target.value === '' ? null : Number(e.target.value))} />{suffix && <span>{suffix}</span>}</div>
  const sw = (sec, k, label) => <Toggle checked={!!s[sec]?.[k]} disabled={!canEdit} onChange={v => set(sec, k, v)} label={label} />
  return (
    <div className="eic-settings">
      <section className="card"><div className="eic-card-h">PO / GRN / invoice matching</div>
        <Row label="Create invoices automatically" help="When every check passes the invoice enters the register as “uploaded”. Verification, approval and payment stay manual.">{sw('matching', 'auto_create_invoice', 'Auto-create')}</Row>
        <Row label="Require a known PO" help="Off allows non-PO invoices.">{sw('matching', 'require_po', 'Require PO')}</Row>
        <Row label="Require a goods receipt (GRN)" help="Off for service invoices / 2-way match against the PO total.">{sw('matching', 'require_receipt', 'Require receipt')}</Row>
        <Row label="Amount tolerance" help="Invoiced to date vs received value (or PO total) — the larger of the two applies.">{num('matching', 'amount_tolerance_pct', 0.1, '%')}{num('matching', 'amount_tolerance_abs', 1, 'abs')}</Row>
        <Row label="Tax arithmetic tolerance" help="Taxable + tax vs total.">{num('matching', 'tax_tolerance_abs', 0.01)}</Row>
        <Row label="Duplicate look-back" help="How far back vendor + invoice number duplicates are searched.">{num('matching', 'duplicate_window_days', 1, 'days')}</Row>
      </section>
      <section className="card"><div className="eic-card-h">Confidence</div>
        <Row label="High" help="At or above: rules decide alone and automated preparation is allowed.">{num('confidence', 'high', 0.01)}</Row>
        <Row label="Medium" help="Below: clarification / review. Secondary intents show from here.">{num('confidence', 'medium', 0.01)}</Row>
        <Row label="Attachment evidence weight" help="How strongly a classified attachment counts towards its related email category (1–100).">{num('scoring', 'document_evidence_weight', 1)}</Row>
        <div className="eic-note"><ShieldCheck size={13} /> Confidence never overrides a failed check — conflicts, duplicates and vendor problems always go to review.</div>
      </section>
      <section className="card"><div className="eic-card-h">AI</div>
        <Row label="Email intent" help="Ask the AI when the rules are not confident. It can only choose configured categories.">{sw('ai', 'classify_emails', 'AI intent')}</Row>
        <Row label="Document identification" help="Identify files the rules cannot.">{sw('ai', 'classify_documents', 'AI documents')}</Row>
        <Row label="Field extraction" help="Read invoice fields; Claude reads scanned PDFs and photos.">{sw('ai', 'extract_fields', 'AI fields')}</Row>
        <div className="eic-note"><Info size={13} /> Provider and keys: Settings → AI / LLM Keys. The mailbox's classifier setting picks the provider.</div>
      </section>
      <section className="card"><div className="eic-card-h">Attachments</div>
        <Row label="Maximum file size">{num('attachments', 'max_mb', 1, 'MB')}</Row>
        <Row label="Maximum attachments per email">{num('attachments', 'max_count', 1)}</Row>
        <Row label="Allowed file types" help="Text is read from PDF (text layer), XLSX/XLS/CSV, DOCX/PPTX/ODT, RTF, old DOC/PPT (best effort), EML and text files. ZIP archives are checked (size, count, zip bombs, unsafe paths, passwords) and each file inside becomes its own document. Scanned PDFs and photos need an AI provider. Outlook .msg files are recorded but not read."><input className="form-input" disabled={!canEdit} value={(s.attachments?.allowed_ext || []).join(', ')} onChange={e => set('attachments', 'allowed_ext', e.target.value.split(/[,\s]+/).map(x => x.replace(/^\./, '').toLowerCase()).filter(Boolean))} /></Row>
      </section>
      <section className="card"><div className="eic-card-h">Documents & projects</div>
        <Row label="Open attached emails" help="Emails attached to an email (Outlook 'attach item') are read like .eml files: their text is a document and their own attachments become documents.">{sw('attachments', 'read_attached_emails', 'Attached emails')}</Row>
        <Row label="Auto-file on a project from" help="A document is filed on a project automatically when the match is at least this sure (project code, conversation, name, customer). Below it the project is only suggested and waits in Document filing.">{num('documents', 'auto_link_min', 0.01)}</Row>
        <Row label="Your industries" help="Helps pick the right meaning of an acronym with several meanings, e.g. construction; government; it.">
          <input className="form-input" disabled={!canEdit} value={(s.documents?.industries || []).join('; ')} onChange={e => set('documents', 'industries', e.target.value.split(/[;,]+/).map(x => x.trim().toLowerCase()).filter(Boolean))} placeholder="construction; government" />
        </Row>
      </section>
      {canEdit && <div className={`eic-savebar${dirty ? ' on' : ''}`}><span>{dirty ? 'Unsaved changes' : 'All changes saved to the draft'}</span><div style={{ flex: 1 }} />
        <button className="btn btn-ghost" disabled={!dirty} onClick={() => setS(cfg.settings)}>Discard</button>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => act(() => saveSettings(s), 'Settings saved to draft.')}>Save to draft</button></div>}
    </div>
  )
}

/* ═══ publish, versions, audit ═══ */

function Versions({ cfg, diff, canEdit, act }) {
  const [note, setNote] = useState('')
  const [audit, setAudit] = useState(null)
  const [entity, setEntity] = useState('')
  const [rb, setRb] = useState(null)
  useEffect(() => { configAudit(300).then(setAudit).catch(() => setAudit([])) }, [cfg])
  const ENT = [['categories', 'Email categories'], ['rules', 'Keyword rules'], ['document_types', 'Document types'], ['vendor_aliases', 'Vendor mappings']]
  const auditRows = (audit || []).filter(a => !entity || a.entity === entity)
  return (
    <>
      <div className="eic-sec-head"><div><h2>Publish & history</h2><p>Publishing validates the draft and creates an immutable version. New emails use it from the next run (about a minute); processed emails keep the version they were processed with.</p></div></div>
      <div className="eic-publish">
        <section className="card">
          <div className="eic-card-h">Draft vs live (v{diff?.published_version ?? '—'})</div>
          <table className="gl-table eic-diff"><thead><tr><th>Area</th><th className="num">Added</th><th className="num">Changed</th><th className="num">Removed</th></tr></thead>
            <tbody>{ENT.map(([k, l]) => <tr key={k}><td>{l}</td><td className="num">{diff?.[k]?.added || <span className="gl-st-zero">–</span>}</td><td className="num">{diff?.[k]?.changed || <span className="gl-st-zero">–</span>}</td><td className="num">{diff?.[k]?.removed || <span className="gl-st-zero">–</span>}</td></tr>)}
              <tr><td>Matching & AI settings</td><td colSpan={3} className="num">{diff?.settings_changed ? 'changed' : <span className="gl-st-zero">–</span>}</td></tr></tbody></table>
          {canEdit && <>
            <div className="form-group" style={{ marginTop: 12 }}><label className="form-label">Release note</label><input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="What changed and why" /></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="gl-meta" style={{ flex: 1 }}>{diff?.unpublished ? 'Tip: run the Test tab against the draft first.' : 'Nothing to publish.'}</span>
              <button className="btn btn-primary" disabled={!diff?.unpublished} onClick={() => act(async () => { await publish(note); setNote('') }, 'Published — live within a minute.')}><UploadCloud size={14} /> Publish version {(diff?.published_version || 0) + 1}</button>
            </div></>}
        </section>
        <section className="card">
          <div className="eic-card-h">Versions</div>
          <ol className="eic-timeline">{cfg.versions.map((v, i) => (
            <li key={v.id} className={i === 0 ? 'live' : ''}>
              <span className="eic-tl-dot" />
              <div className="eic-tl-body">
                <div><b>Version {v.version}</b> {i === 0 && <span className="gl-pill green">Live</span>} {v.restored_from && <span className="gl-pill gray">rollback of v{v.restored_from}</span>}</div>
                <div className="gl-meta">{when(v.published_at)}{v.note ? ` · ${v.note}` : ''}</div>
              </div>
              {canEdit && i > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setRb(v)}><RotateCcw size={12} /> Restore</button>}
            </li>))}</ol>
        </section>
      </div>
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <div className="gl-bar"><b style={{ fontSize: 13 }}>Configuration audit</b><div className="gl-grow" />
          <select className="form-select" value={entity} onChange={e => setEntity(e.target.value)}><option value="">All changes</option>
            {[['ei_email_categories', 'Categories'], ['ei_keyword_rules', 'Rules'], ['ei_document_types', 'Document types'], ['ei_vendor_aliases', 'Vendor mappings'], ['ei_settings', 'Settings'], ['ei_config_versions', 'Publish / rollback']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="gl-tscroll"><table className="gl-table gl-st-table eic-table">
          <thead><tr><th>When</th><th>Action</th><th>Area</th><th>Change</th></tr></thead>
          <tbody>{auditRows.map(a => (
            <tr key={a.id}><td className="nowrap">{when(a.created_at)}</td><td><span className={`gl-pill ${a.action === 'DELETE' ? 'red' : a.action === 'PUBLISH' || a.action === 'ROLLBACK' ? 'gl-st-indigo' : 'gray'}`}>{a.action}</span></td>
              <td>{a.entity.replace('ei_', '').replace(/_/g, ' ')}</td><td className="gl-meta">{auditText(a)}</td></tr>))}
            {audit && !auditRows.length && <Empty>No changes yet.</Empty>}</tbody></table></div>
      </div>
      <Confirm open={!!rb} message={rb && `Restore version ${rb.version}? The current draft is replaced by it and it is published as a new version. Processed emails are unaffected.`}
        onCancel={() => setRb(null)} onConfirm={() => { const v = rb; setRb(null); act(() => rollback(v.version), `Version ${v.version} restored and published.`) }} />
    </>
  )
}
function auditText(a) {
  const n = a.after?.name || a.before?.name || a.after?.code || a.before?.code || a.after?.value || ''
  if (a.action === 'UPDATE' && a.before && a.after) {
    const ch = Object.keys(a.after).filter(k => !['updated_at', 'updated_by'].includes(k) && JSON.stringify(a.after[k]) !== JSON.stringify(a.before[k]))
    return `${n}${n ? ': ' : ''}${ch.join(', ')}`.slice(0, 200)
  }
  if (a.action === 'PUBLISH' || a.action === 'ROLLBACK') return `version ${a.after?.version}${a.after?.restored_from ? ` from v${a.after.restored_from}` : ''}${a.after?.note ? ` — ${a.after.note}` : ''}`
  if (a.action === 'SEED') return `defaults: ${a.after?.categories} categories, ${a.after?.document_types} document types, ${a.after?.rules} rules`
  return n
}

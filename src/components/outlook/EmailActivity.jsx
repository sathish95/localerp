import { useEffect, useMemo, useState, Fragment } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Modal } from '../ui'
import { Search } from '../golive/shared'
import {
  MESSAGE_STATUSES, EVENT_LABELS, categoryLabel, listMessages, listEvents, retryMessage, dismissMessage, reviewCreateTask, tasksByIds, pct,
} from '../../lib/outlookEmail'
import { ExternalLink, RotateCcw, XCircle, PlusCircle, RefreshCw, Inbox, Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { Drawer, Group, Field, EmptyState, ago, fullTime, initials, Prio } from '../ei/ui'

const VIEWS = {
  review:  { statuses: ['REVIEW'], empty: 'Nothing waiting for review.' },
  created: { statuses: ['TASK_CREATED'], empty: 'No action items created from email yet.' },
  failed:  { statuses: ['FAILED', 'DEAD'], empty: 'No failed emails.' },
  all:     { statuses: null, empty: 'No emails processed yet.' },
}
const METHOD = { CODE: 'project code', CONVERSATION: 'same conversation', NAME: 'project name', CUSTOMER: 'sender\'s customer', MANUAL: 'chosen by a reviewer' }

// Email types for grouping: the category's group (admin-configurable in
// Configuration → Email categories), shown with a short business label.
const GROUP_LABEL = {
  'Accounts Payable': 'Invoices', Procurement: 'Purchase orders', 'Goods Receipt': 'Goods receipt (GRN)', Payments: 'Payments',
  'Vendor Management': 'Vendor changes', Compliance: 'Compliance', Contracts: 'Contracts', Projects: 'Projects', Service: 'Service & warranty',
  Communication: 'General communication',
}
const GROUP_ORDER = ['Invoices', 'Purchase orders', 'Goods receipt (GRN)', 'Payments', 'Vendor changes', 'Projects', 'Contracts', 'Compliance', 'Service & warranty', 'Customer issues', 'General communication', 'Unclassified']
function emailGroup(r, catByCode) {
  const code = r.intents?.primary || r.category
  if (!code) return 'Unclassified'
  const c = catByCode[code]
  if (!c) return 'Customer issues'                       // STEP261 project-issue categories (BUG, DELAY …)
  if (code === 'OTHER') return 'Unclassified'
  return GROUP_LABEL[c.group_name] || c.group_name || 'Unclassified'
}

export default function EmailActivity({ view, lookups, onChanged, categories = [] }) {
  const [rows, setRows] = useState(null)
  const [tasks, setTasks] = useState({})
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(null)
  const [busy, setBusy] = useState('')
  const projById = useMemo(() => Object.fromEntries(lookups.projects.map(p => [p.id, p])), [lookups.projects])
  const catByCode = useMemo(() => Object.fromEntries(categories.map(c => [c.code, c])), [categories])
  const [groupBy, setGroupBy] = useState(() => { try { return localStorage.getItem('nx.emailGroupBy') || 'type' } catch { return 'type' } })
  const [collapsed, setCollapsed] = useState({})
  const [params, setParams] = useSearchParams()
  const typeTab = view === 'all' ? params.get('type') || '' : ''
  const setTypeTab = t => setParams(p => { const n = new URLSearchParams(p); if (t) n.set('type', t); else n.delete('type'); return n }, { replace: true })
  const setGrouping = v => { setGroupBy(v); try { localStorage.setItem('nx.emailGroupBy', v) } catch { /* private mode */ } }

  async function load() {
    setErr('')
    try {
      const list = await listMessages({ statuses: VIEWS[view].statuses, search: q })
      setRows(list)
      setTasks(await tasksByIds(list.map(r => r.task_id)))
    } catch (e) { setErr(e.message); setRows([]) }
  }
  useEffect(() => { setRows(null); setSel(null); load() }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key, fn) => {
    setBusy(key); setErr('')
    try { await fn(); await load(); onChanged?.() } catch (e) { setErr(e.message) }
    setBusy('')
  }
  const current = sel && rows?.find(r => r.id === sel)
  const allGroups = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) { const g = emailGroup(r, catByCode); (m.get(g) || m.set(g, []).get(g)).push(r) }
    return [...m.entries()].sort((x, y) => (GROUP_ORDER.indexOf(x[0]) + 1 || 99) - (GROUP_ORDER.indexOf(y[0]) + 1 || 99))
      .map(([name, rs]) => ({ name, rows: rs, open: rs.filter(r => ['REVIEW', 'FAILED', 'DEAD'].includes(r.status)).length }))
  }, [rows, catByCode])
  const groups = typeTab ? allGroups.filter(g => g.name === typeTab) : allGroups
  const shownRows = typeTab ? groups.flatMap(g => g.rows) : rows
  useEffect(() => { if (typeTab && rows && !q.trim() && !allGroups.some(g => g.name === typeTab)) setTypeTab('') }, [allGroups]) // eslint-disable-line react-hooks/exhaustive-deps
  const allCollapsed = groups.length > 0 && groups.every(g => collapsed[g.name])
  const renderRow = r => {
              const proj = projById[r.matched_project_id]
              const st = MESSAGE_STATUSES[r.status] || { label: r.status, tone: 'gray' }
              const task = tasks[r.task_id]
              const intents = [r.category, ...(r.intents?.secondary || [])].filter(Boolean)
              return (
                <tr key={r.id} className={`eic-row${sel === r.id ? ' sel' : ''}`} onClick={() => setSel(r.id)}>
                  <td><div className="eic-who"><span className="gl-st-av">{initials(r.sender_name || r.sender_email)}</span><div><div className="eic-who-n">{r.sender_name || r.sender_email || '—'}</div>{r.sender_name && <div className="eic-who-e">{r.sender_email}</div>}</div></div></td>
                  <td><div className="eic-subj">{r.source === 'MANUAL' && <span className="eic-sample">Sample</span>}{r.subject || (r.status === 'PENDING' ? 'Waiting to be fetched…' : '(no subject)')}</div>
                    {intents.length > 0 && <div className="eic-intents">{intents.slice(0, 3).map(c => <span key={c}>{catByCode[c]?.name || categoryLabel(c)}</span>)}{intents.length > 3 && <span>+{intents.length - 3}</span>}</div>}</td>
                  <td>{task ? <span className="eic-link-chip">{task.task_id}</span> : proj ? <span className="eic-link-chip muted">{proj.code}</span> : r.attachment_count ? <span className="gl-meta">{r.attachment_count} file{r.attachment_count > 1 ? 's' : ''}</span> : <span className="gl-st-zero">—</span>}</td>
                  <td><span className={`gl-pill ${st.tone}`}>{st.label}</span></td>
                  <td className="num gl-meta" title={fullTime(r.received_at || r.created_at)}>{ago(r.received_at || r.created_at)}</td>
                </tr>
              )
  }

  return (
    <div className="table-wrap">
      {view === 'all' && rows && rows.length > 0 && (
        <div className="eic-typetabs">
          <button type="button" className={!typeTab ? 'on' : ''} onClick={() => setTypeTab('')}>All <span>{rows.length}</span></button>
          {allGroups.map(g => (
            <button key={g.name} type="button" className={typeTab === g.name ? 'on' : ''} onClick={() => setTypeTab(g.name)}>
              {g.name} <span>{g.rows.length}</span>{g.open > 0 && <i title={`${g.open} need attention`} />}
            </button>
          ))}
        </div>
      )}
      <div className="gl-bar">
        <Search value={q} onChange={setQ} placeholder="Subject or sender…" />
        {!typeTab && <div className="gl-seg">{[['type', 'By type'], ['none', 'Flat list']].map(([k, l]) => <button key={k} type="button" className={groupBy === k ? 'on' : ''} onClick={() => setGrouping(k)}>{l}</button>)}</div>}
        {groupBy === 'type' && !typeTab && groups.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => setCollapsed(allCollapsed ? {} : Object.fromEntries(groups.map(g => [g.name, true])))}>{allCollapsed ? 'Expand all' : 'Collapse all'}</button>}
        <div className="gl-grow" />
        <span className="gl-meta">{rows ? `${shownRows.length} email${shownRows.length === 1 ? '' : 's'}` : ''}</span>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button>
      </div>
      {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
      <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
        <table className="gl-table eic-list">
          <thead><tr><th style={{ width: 220 }}>From</th><th>Subject</th><th style={{ width: 180 }}>Linked to</th><th style={{ width: 130 }}>Status</th><th style={{ width: 96 }} className="num">Received</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="gl-st-empty">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={5}><EmptyState icon={Inbox} title={VIEWS[view].empty} /></td></tr>}
            {rows && (groupBy !== 'type' || typeTab) && shownRows.map(renderRow)}
            {rows && groupBy === 'type' && !typeTab && groups.map(g => (
              <Fragment key={g.name}>
                <tr className="eic-grp" onClick={() => setCollapsed(o => ({ ...o, [g.name]: !o[g.name] }))}>
                  <td colSpan={5}>{collapsed[g.name] ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {g.name} <span className="gl-st-n">{g.rows.length}</span>
                    {g.open > 0 && <span className="eic-grp-flag">{g.open} need attention</span>}</td>
                </tr>
                {!collapsed[g.name] && g.rows.map(renderRow)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {current && <MessageDrawer r={current} task={tasks[current.task_id]} proj={projById[current.matched_project_id]} projById={projById} busy={busy} catByCode={catByCode} onClose={() => setSel(null)}
        onRetry={() => act(`retry-${current.id}`, () => retryMessage(current.id))}
        onDismiss={() => act(`dismiss-${current.id}`, () => dismissMessage(current.id))}
        onCreate={() => setCreating(current)} />}
      {creating && <CreateTaskModal r={creating} lookups={lookups} onClose={() => setCreating(null)}
        onDone={async () => { setCreating(null); await load(); onChanged?.() }} />}
    </div>
  )
}

function MessageDrawer({ r, task, proj, projById, busy, onClose, onRetry, onDismiss, onCreate, catByCode = {} }) {
  const [events, setEvents] = useState(null)
  useEffect(() => { setEvents(null); listEvents({ messageId: r.id, limit: 50 }).then(setEvents).catch(() => setEvents([])) }, [r.id])
  const c = r.classification || {}
  const st = MESSAGE_STATUSES[r.status] || { label: r.status, tone: 'gray' }
  const canCreate = ['REVIEW', 'FAILED', 'DEAD', 'IGNORED'].includes(r.status) && !r.task_id
  const canRetry = ['REVIEW', 'FAILED', 'DEAD', 'IGNORED', 'DISMISSED', 'PROCESSED'].includes(r.status) && !r.task_id
  const canDismiss = ['REVIEW', 'FAILED', 'DEAD', 'IGNORED'].includes(r.status)
  return (
    <Drawer wide title={r.subject || '(no subject)'} subtitle={`${r.sender_name ? `${r.sender_name} · ` : ''}${r.sender_email || ''} · ${fullTime(r.received_at || r.created_at)}`} onClose={onClose}
      footer={<>
        {r.web_link && <a className="btn btn-ghost" href={r.web_link} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Open in Outlook</a>}
        <span style={{ flex: 1 }} />
        {canDismiss && <button className="btn btn-ghost" disabled={!!busy} onClick={onDismiss}><XCircle size={13} /> Dismiss</button>}
        {canRetry && <button className="btn btn-ghost" disabled={!!busy} onClick={onRetry}><RotateCcw size={13} /> {busy ? 'Working…' : 'Re-run'}</button>}
        {canCreate && <button className="btn btn-primary" onClick={onCreate}><PlusCircle size={13} /> Create action item</button>}
      </>}>
      <div className="eic-drawer-status">
        <span className={`gl-pill ${st.tone}`}>{st.label}</span>
        {r.category && <span className="gl-tag">{categoryLabel(r.category)}</span>}
        {(r.intents?.secondary || []).map(x => <span key={x} className="gl-tag">{categoryLabel(x)}</span>)}
        {task && <Link className="eic-link-chip" to={`/tasks?taskId=${r.task_id}`}>{task.task_id}</Link>}
      </div>
      {r.decision_reason && <div className="eic-callout"><b>Outcome</b><span>{r.decision_reason}</span></div>}
      {r.last_error && <div className="eic-callout bad"><b>Error</b><span>{r.last_error}{r.status === 'FAILED' ? ` · attempt ${r.attempts}, next ${fullTime(r.next_attempt_at)}` : ''}</span></div>}
      {r.intents?.matched_rules?.length > 0 && <Group title="Keyword matches" hint="Which configured rules fired, grouped by what they point to">
        <div className="eic-kwgroups">{Object.entries(r.intents.matched_rules.reduce((m, x) => ((m[x.category] ||= []).push(x), m), {})).map(([code, list]) => (
          <div key={code} className={`eic-kwgroup${code === r.intents.primary ? ' primary' : ''}`}>
            <div className="eic-kwgroup-h"><span>{catByCode[code]?.name || categoryLabel(code)}</span>{code === r.intents.primary ? <em>primary</em> : <em className="sec">secondary</em>}
              <span className="eic-kwgroup-g">{GROUP_LABEL[catByCode[code]?.group_name] || catByCode[code]?.group_name || ''}</span></div>
            {list.map((m, i) => (
              <div key={i} className="eic-kwrule">
                <span className="eic-kwrule-n">{m.rule}</span>
                <span className="eic-kwrule-hits">{(m.hits || []).map((h, j) => <span key={j} className="eic-kwhit">"{h.term}"<i>{String(h.location || '').toLowerCase().replace('_', ' ')}</i></span>)}</span>
              </div>
            ))}
          </div>
        ))}</div>
        {r.intents.vetoed?.length > 0 && <div className="gl-meta" style={{ marginTop: 6 }}>Ruled out by exclusion rules: {r.intents.vetoed.map(c => catByCode[c]?.name || categoryLabel(c)).join(', ')}</div>}
      </Group>}
      <Group title="Classification">
        <dl className="eic-kvs">
          <Field label="Issue">{c.title}</Field>
          <Field label="Classified by">{r.classifier ? `${r.classifier} · ${pct(r.confidence)}` : null}</Field>
          <Field label="Priority">{r.priority ? <Prio p={r.priority} /> : null}</Field>
          <Field label="Config version">{r.config_version ? `v${r.config_version}` : null}</Field>
          {proj && <Field label="Project">{proj.code} · {proj.name} <span className="gl-meta">({METHOD[r.match_method] || r.match_method}, {pct(r.match_confidence)})</span></Field>}
          {!proj && r.candidates?.length > 0 && <Field label="Possible projects">{r.candidates.map(x => projById[x.id] ? `${projById[x.id].code} · ${projById[x.id].name}` : x.code || x.name).join(', ')}</Field>}
        </dl>
        {c.description && <p className="eic-para">{c.description}</p>}
        {c.injection_suspected && <div className="eic-callout bad"><b>Warning</b><span>The email contains instructions aimed at the automation.</span></div>}
      </Group>
      {r.body_excerpt && <Group title="Email"><pre className="eic-pre">{r.body_excerpt}</pre></Group>}
      <Group title="History">
        <ol className="eic-mini-tl">
          {events === null && <li className="gl-meta">Loading…</li>}
          {events?.map(e => <li key={e.id}><span>{fullTime(e.created_at)}</span><div><b>{EVENT_LABELS[e.event] || e.event}</b>{(e.detail?.reason || e.detail?.error || e.detail?.task_code || e.detail?.kind) && <div className="gl-meta">{e.detail.reason || e.detail.error || e.detail.task_code || e.detail.kind}</div>}</div></li>)}
        </ol>
      </Group>
    </Drawer>
  )
}

export function CreateTaskModal({ r, lookups, onClose, onDone }) {
  const c = r.classification || {}
  const candidateIds = (r.candidates || []).map(x => x.id)
  const open = lookups.projects.filter(p => ['active', 'planning', 'in_progress'].includes(String(p.status || 'active').toLowerCase()))
  const ordered = [...open.filter(p => candidateIds.includes(p.id)), ...open.filter(p => !candidateIds.includes(p.id))]
  const [f, setF] = useState({
    projectId: r.matched_project_id && open.some(p => p.id === r.matched_project_id) ? r.matched_project_id : (candidateIds.find(id => open.some(p => p.id === id)) || ''),
    title: c.title || r.subject || '',
    description: [c.description || r.body_excerpt || '', '', '— From a customer email (Outlook) —', `From: ${r.sender_name ? `${r.sender_name} <${r.sender_email}>` : r.sender_email}`,
      `Subject: ${r.subject || ''}`, r.web_link ? `Open in Outlook: ${r.web_link}` : ''].filter(l => l !== null).join('\n').trim(),
    priority: r.priority || 'medium', assigneeId: '', dueDate: c.due_date || '',
  })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const pm = lookups.projects.find(p => p.id === f.projectId)?.manager_id
    if (pm && !f.assigneeId) setF(x => ({ ...x, assigneeId: pm }))
  }, [f.projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  async function save() {
    setSaving(true); setErr('')
    try { await reviewCreateTask(r.id, f); await onDone() } catch (e) { setErr(e.message); setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title="Create action item from email" size="lg"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving || !f.projectId || !f.title.trim()} onClick={save}>{saving ? 'Creating…' : 'Create action item'}</button></>}>
      {err && <div className="olk-msg error">{err}</div>}
      <div className="form-group"><label className="form-label">Project *</label>
        <select className="form-select" value={f.projectId} onChange={e => set('projectId', e.target.value)}>
          <option value="">Choose the project…</option>
          {ordered.map(p => <option key={p.id} value={p.id}>{candidateIds.includes(p.id) ? '★ ' : ''}{p.code} · {p.name}</option>)}
        </select>
        {candidateIds.length > 0 && <div className="olk-hint">★ = suggested from the email.</div>}</div>
      <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={f.title} onChange={e => set('title', e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" rows={7} value={f.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Priority</label>
          <select className="form-select" value={f.priority} onChange={e => set('priority', e.target.value)}>{['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Assign to</label>
          <select className="form-select" value={f.assigneeId} onChange={e => set('assigneeId', e.target.value)}>
            <option value="">Unassigned</option>{lookups.people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Due date</label><input className="form-input" type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} /></div>
      </div>
    </Modal>
  )
}

const EVENT_GROUPS = {
  intake: ['RECEIVED', 'CLASSIFIED', 'PROCESSED', 'IGNORED', 'FAILED', 'DEAD_LETTER', 'RETRY_REQUESTED'],
  outcomes: ['TASK_CREATED', 'INVOICE_CREATED', 'SENT_TO_REVIEW', 'EXCEPTION_RAISED', 'REVIEW_RESOLVED', 'EXCEPTION_RESOLVED', 'EXCEPTION_DISMISSED', 'DISMISSED', 'MANUAL_CORRECTION', 'INTERNAL_REPLY'],
  connection: ['MAILBOX_ADDED', 'MAILBOX_REMOVED', 'CONFIG_CHANGED', 'SECRET_SET', 'SECRET_CLEARED', 'CLIENT_STATE_ROTATED', 'CONNECTION_TEST', 'SUBSCRIBED', 'RENEWED', 'UNSUBSCRIBED', 'SUBSCRIPTION_ERROR', 'LIFECYCLE', 'NOTIFICATION_REJECTED', 'RECONCILED', 'SYNC_ERROR'],
}
const BAD = ['FAILED', 'DEAD_LETTER', 'SUBSCRIPTION_ERROR', 'SYNC_ERROR', 'NOTIFICATION_REJECTED']
const GOOD = ['TASK_CREATED', 'INVOICE_CREATED', 'REVIEW_RESOLVED', 'EXCEPTION_RESOLVED', 'SUBSCRIBED', 'RENEWED']
function detailText(d = {}) {
  const keys = ['reason', 'summary', 'kind', 'task_code', 'invoice_number', 'error', 'note', 'category', 'source', 'version']
  const parts = keys.filter(k => d[k] != null && d[k] !== '').map(k => String(d[k]))
  return parts.join(' · ').slice(0, 160)
}

export function AuditLog({ lookups }) {
  const [events, setEvents] = useState(null)
  const [group, setGroup] = useState('')
  const [q, setQ] = useState('')
  const people = useMemo(() => Object.fromEntries(lookups.people.map(p => [p.id, p.full_name])), [lookups.people])
  useEffect(() => { listEvents({ limit: 500 }).then(setEvents).catch(() => setEvents([])) }, [])
  const ql = q.trim().toLowerCase()
  const rows = (events || []).filter(e => (!group || EVENT_GROUPS[group].includes(e.event))
    && (!ql || `${EVENT_LABELS[e.event] || e.event} ${detailText(e.detail)}`.toLowerCase().includes(ql)))
  return (
    <div className="table-wrap">
      <div className="gl-bar">
        <Search value={q} onChange={setQ} placeholder="Event or detail…" />
        <div className="gl-seg">{[['', 'All'], ['intake', 'Intake'], ['outcomes', 'Outcomes'], ['connection', 'Connection']].map(([k, l]) => <button key={k} type="button" className={group === k ? 'on' : ''} onClick={() => setGroup(k)}>{l}</button>)}</div>
        <div className="gl-grow" /><span className="gl-meta">{events ? `${rows.length} event${rows.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
        <table className="gl-table eic-list">
          <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 210 }}>Event</th><th>Detail</th><th style={{ width: 170 }}>By</th></tr></thead>
          <tbody>
            {events === null && <tr><td colSpan={4} className="gl-st-empty">Loading…</td></tr>}
            {events && !rows.length && <tr><td colSpan={4}><EmptyState icon={Inbox} title="No activity matches." /></td></tr>}
            {rows.map(e => (
              <tr key={e.id}>
                <td className="gl-meta nowrap" title={fullTime(e.created_at)}>{fullTime(e.created_at)}</td>
                <td><span className={`eic-ev ${BAD.includes(e.event) ? 'bad' : GOOD.includes(e.event) ? 'good' : ''}`}>{EVENT_LABELS[e.event] || e.event}</span></td>
                <td className="gl-meta"><div className="eic-clip">{detailText(e.detail) || '—'}</div></td>
                <td>{e.actor_id ? (people[e.actor_id] || 'User') : <span className="eic-bot"><Bot size={12} /> Automation</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

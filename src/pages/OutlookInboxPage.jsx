import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Search } from '../components/golive/shared'
import { CreateTaskModal } from '../components/outlook/EmailActivity'
import {
  categoryLabel, MESSAGE_STATUSES, listMessages, listInboxMailboxes, listNotes, addNote, deleteNote, noteCounts, loadLookups, tasksByIds, retryMessage,
} from '../lib/outlookEmail'
import { ArrowLeft, ExternalLink, Lock, PlusCircle, RotateCcw, Send, Trash2, MessageSquare, Inbox } from 'lucide-react'

const FILTERS = [['', 'All'], ['REVIEW', 'Needs review'], ['TASK_CREATED', 'Task created'], ['IGNORED', 'Ignored']]
const STATUS_GROUP = { IGNORED: ['IGNORED', 'DISMISSED'], REVIEW: ['REVIEW'], TASK_CREATED: ['TASK_CREATED'] }
const initials = n => (n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
function when(t) {
  if (!t) return ''
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
const full = t => (t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '')

// Outlook Email (STEP262): every email that reaches a connected mailbox,
// with an internal, team-only reply thread per email. Nothing written here
// is sent to the customer.
export default function OutlookInboxPage() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const selId = params.get('id')
  const [rows, setRows] = useState(null)
  const [mailboxes, setMailboxes] = useState([])
  const [counts, setCounts] = useState({})
  const [tasks, setTasks] = useState({})
  const [lookups, setLookups] = useState({ projects: [], people: [] })
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState('')
  const reloadRef = useRef(null)
  const isManager = ['admin', 'ceo', 'manager', 'department_head'].includes(profile?.role)

  async function load() {
    try {
      const list = (await listMessages({ search: q, limit: 300 })).filter(r => r.status !== 'PENDING' && r.status !== 'PROCESSING' || r.subject)
      setRows(list)
      const ids = list.map(r => r.id)
      const [c, t] = await Promise.all([noteCounts(ids), tasksByIds(list.map(r => r.task_id))])
      setCounts(c); setTasks(t); setErr('')
    } catch (e) { setErr(e.message); setRows([]) }
  }
  reloadRef.current = load
  useEffect(() => {
    listInboxMailboxes().then(setMailboxes).catch(() => {})
    loadLookups().then(setLookups).catch(() => {})
  }, [])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  // live: new / updated emails and replies
  useEffect(() => {
    let timer
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => reloadRef.current?.(), 400) }
    const ch = supabase.channel('outlook-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlook_email_messages' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlook_email_notes' }, bump)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(ch) }
  }, [])

  const people = useMemo(() => Object.fromEntries(lookups.people.map(p => [p.id, p.full_name])), [lookups.people])
  const shown = (rows || []).filter(r => !filter || (STATUS_GROUP[filter] || [filter]).includes(r.status))
  const sel = (rows || []).find(r => r.id === selId) || null
  const open = id => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('id', id); else n.delete('id'); return n })
  const noSchema = /outlook_|schema cache|does not exist/i.test(err)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Outlook Email</div>
          <div className="page-subtitle">
            Customer emails as they arrive{mailboxes.length ? <> in {mailboxes.map(m => m.display_name || m.mailbox_address).join(', ')}</> : null} — discuss them with your team; replies here stay internal
          </div>
        </div>
      </div>

      {noSchema ? (
        <div className="card" style={{ padding: 20 }}>The Outlook Email tables aren't installed yet. Run <code>sql/STEP261_outlook_email_automation.sql</code> and <code>sql/STEP262_outlook_inbox_internal_replies.sql</code>, then reload.</div>
      ) : (
        <div className={`oib${sel ? ' has-sel' : ''}`}>
          <aside className="oib-list card">
            <div className="oib-list-head">
              <Search value={q} onChange={setQ} placeholder="Subject or sender…" />
              <div className="gl-seg oib-filters">
                {FILTERS.map(([k, l]) => <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
              </div>
            </div>
            {err && <div className="olk-msg error" style={{ margin: 10 }}>{err}</div>}
            <div className="oib-items">
              {rows === null && <div className="oib-empty">Loading…</div>}
              {rows && !shown.length && (
                <div className="oib-empty"><Inbox size={22} /><div>{rows.length ? 'No emails match.' : mailboxes.length ? 'No emails yet — new mail shows up here as it arrives.' : 'No mailbox is connected yet. An admin can connect one in Settings → Outlook Email.'}</div></div>
              )}
              {shown.map(r => {
                const st = MESSAGE_STATUSES[r.status] || { label: r.status, tone: 'gray' }
                return (
                  <button key={r.id} type="button" className={`oib-item${r.id === selId ? ' on' : ''}`} onClick={() => open(r.id)}>
                    <span className="gl-st-av">{initials(r.sender_name || r.sender_email)}</span>
                    <span className="oib-item-main">
                      <span className="oib-item-top"><b>{r.sender_name || r.sender_email || 'Unknown sender'}</b><time>{when(r.received_at || r.created_at)}</time></span>
                      <span className="oib-item-subj">{r.source === 'MANUAL' && !r.subject?.startsWith('[Sample]') ? '[Sample] ' : ''}{r.subject || '(no subject)'}</span>
                      <span className="oib-item-prev">{(r.body_excerpt || '').replace(/\s+/g, ' ').slice(0, 110)}</span>
                      <span className="oib-item-tags">
                        <span className={`gl-pill ${st.tone}`}>{st.label}</span>
                        {r.task_id && tasks[r.task_id] && <span className="gl-tag">{tasks[r.task_id].task_id}</span>}
                        {counts[r.id] > 0 && <span className="oib-count"><MessageSquare size={11} /> {counts[r.id]}</span>}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="oib-read card">
            {sel ? <EmailView key={sel.id} r={sel} task={tasks[sel.task_id]} project={lookups.projects.find(p => p.id === sel.matched_project_id)}
              people={people} me={profile} isManager={isManager} lookups={lookups} onBack={() => open(null)} onChanged={load} />
              : <div className="oib-empty oib-pick"><MessageSquare size={26} /><div>Select an email to read it and reply internally.</div></div>}
          </section>
        </div>
      )}
    </div>
  )
}

function EmailView({ r, task, project, people, me, isManager, lookups, onBack, onChanged }) {
  const [notes, setNotes] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const endRef = useRef(null)
  const st = MESSAGE_STATUSES[r.status] || { label: r.status, tone: 'gray' }

  const loadNotes = () => listNotes(r.id).then(setNotes).catch(e => { setErr(e.message); setNotes([]) })
  useEffect(() => { loadNotes() }, [r.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // pick up replies from others (the page reloads the list on realtime events)
  useEffect(() => {
    const ch = supabase.channel(`outlook-notes-${r.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlook_email_notes', filter: `message_id=eq.${r.id}` }, () => loadNotes())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [r.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [notes?.length])

  async function send() {
    const body = text.trim()
    if (!body) return
    setSending(true); setErr('')
    try { await addNote(r.id, body); setText(''); await loadNotes(); onChanged?.() } catch (e) { setErr(e.message) }
    setSending(false)
  }

  return (
    <div className="oib-view">
      <div className="oib-view-head">
        <button type="button" className="btn btn-ghost btn-sm oib-back" onClick={onBack}><ArrowLeft size={14} /> Inbox</button>
        <h2>{r.subject || '(no subject)'}</h2>
        <div className="oib-meta">
          <span className="gl-st-av">{initials(r.sender_name || r.sender_email)}</span>
          <div style={{ minWidth: 0 }}>
            <div><b>{r.sender_name || r.sender_email}</b>{r.sender_name && <span className="gl-meta"> &lt;{r.sender_email}&gt;</span>}</div>
            <div className="gl-meta">{full(r.received_at || r.created_at)}</div>
          </div>
        </div>
        <div className="oib-tags">
          <span className={`gl-pill ${st.tone}`}>{st.label}</span>
          {r.category && <span className="gl-tag">{categoryLabel(r.category)}</span>}{r.intents?.secondary?.map(c => <span key={c} className="gl-tag">{categoryLabel(c)}</span>)}
          {project && <span className="gl-tag">{project.code} · {project.name}</span>}
          {r.task_id && <Link className="gl-st-link" to={`/tasks?taskId=${r.task_id}`}>{task?.task_id || 'Open task'}</Link>}
          <span style={{ flex: 1 }} />
          {r.web_link && <a className="btn btn-ghost btn-sm" href={r.web_link} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Open in Outlook</a>}
          {isManager && !r.task_id && ['REVIEW', 'FAILED', 'DEAD', 'IGNORED'].includes(r.status) && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><PlusCircle size={13} /> Create action item</button>}
          {isManager && !r.task_id && ['FAILED', 'DEAD'].includes(r.status) && <button className="btn btn-ghost btn-sm" onClick={async () => { try { await retryMessage(r.id); onChanged?.() } catch (e) { setErr(e.message) } }}><RotateCcw size={13} /> Retry</button>}
        </div>
        {r.decision_reason && <div className="olk-reason" style={{ marginTop: 10 }}><b>Automation</b> {r.decision_reason}</div>}
      </div>

      <pre className="oib-body">{r.body_excerpt || (r.status === 'PENDING' || r.status === 'PROCESSING' ? 'Fetching the email…' : 'The email text is no longer stored (retention period passed). Open it in Outlook.')}</pre>

      <div className="oib-thread">
        <div className="gl-st-h"><Lock size={12} /> Internal replies <span className="gl-st-n">{notes?.length ?? ''}</span></div>
        {notes?.length === 0 && <div className="gl-meta" style={{ margin: '4px 0 10px' }}>No internal replies yet. Start the discussion — only your team can see it.</div>}
        {notes?.map(n => {
          const mine = n.author_id === me?.id
          return (
            <div key={n.id} className={`oib-note${mine ? ' mine' : ''}`}>
              <span className="gl-st-av">{initials(people[n.author_id])}</span>
              <div className="oib-note-bubble">
                <div className="oib-note-head"><b>{mine ? 'You' : people[n.author_id] || 'Team member'}</b><time>{full(n.created_at)}{n.edited_at ? ' · edited' : ''}</time>
                  {(mine || ['admin', 'ceo'].includes(me?.role)) && <button type="button" className="oib-note-del" title="Delete" onClick={async () => { try { await deleteNote(n.id); await loadNotes(); onChanged?.() } catch (e) { setErr(e.message) } }}><Trash2 size={12} /></button>}
                </div>
                <div className="oib-note-body">{n.body}</div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
        {err && <div className="olk-msg error">{err}</div>}
        <div className="oib-compose">
          <textarea className="form-textarea" rows={3} maxLength={5000} value={text} placeholder="Write an internal reply… (Ctrl+Enter to send)"
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }} />
          <div className="oib-compose-bar">
            <span className="gl-meta"><Lock size={11} /> Internal — visible to your team only, never sent to the customer.</span>
            <button className="btn btn-primary btn-sm" disabled={sending || !text.trim()} onClick={send}><Send size={13} /> {sending ? 'Sending…' : 'Reply internally'}</button>
          </div>
        </div>
      </div>
      {creating && <CreateTaskModal r={r} lookups={lookups} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); onChanged?.() }} />}
    </div>
  )
}

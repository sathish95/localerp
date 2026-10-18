import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Loader, Alert, Empty } from '../components/ui'
import { dateFmt, timeFmt } from '../lib/supabase'
import { ArrowLeft, Send, Lock, AlertTriangle } from 'lucide-react'
import {
  getTicket, listMessages, postMessage, assignTicket, updateStatus, updatePriority,
  listCategories, listItAgents,
  isItAgent, IT_PRIORITIES, IT_STATUSES, IT_PRIORITY_COLORS, IT_STATUS_LABELS, isOverdue,
} from '../lib/itHelpdesk'

export default function ITHelpdeskTicketPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const agent = isItAgent(profile?.role)

  const [ticket, setTicket] = useState(null)
  const [messages, setMessages] = useState([])
  const [agents, setAgents] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)

  const catLabel = k => categories.find(c => c.key === k)?.label || k

  const load = useCallback(async () => {
    setErr('')
    try {
      const [t, m, c] = await Promise.all([getTicket(id), listMessages(id), listCategories({ activeOnly: false })])
      setTicket(t); setMessages(m); setCategories(c)
      if (agent) setAgents(await listItAgents().catch(() => []))
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [id, agent])

  useEffect(() => { load() }, [load])

  async function handleReply() {
    if (!reply.trim()) return
    setBusy(true); setErr('')
    try {
      await postMessage(id, reply.trim(), internal)
      setReply(''); setInternal(false)
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function act(fn) {
    setBusy(true); setErr('')
    try { await fn(); await load() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (loading) return <Loader />
  if (!ticket) return <Empty title="Ticket not found" desc="It may have been removed, or you don't have access to it." />

  const closedOut = ['resolved', 'closed'].includes(ticket.status)
  const responseOverdue = !closedOut && isOverdue(ticket.first_response_due_at, ticket.first_response_at)
  const resolutionOverdue = !closedOut && isOverdue(ticket.resolution_due_at, false)

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/it-helpdesk" style={{ fontSize: 13, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, textDecoration: 'none' }}>
            <ArrowLeft size={13} /> IT Helpdesk
          </Link>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {ticket.subject}
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>{IT_STATUS_LABELS[ticket.status] || ticket.status}</span>
          </div>
          <div className="page-subtitle">
            {ticket.ticket_number} · {catLabel(ticket.category)} ·{' '}
            <span style={{ color: IT_PRIORITY_COLORS[ticket.priority], fontWeight: 700, textTransform: 'uppercase' }}>{ticket.priority}</span>
            {' '}· by {ticket.requester?.full_name || 'Unknown'}
          </div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}
      {(responseOverdue || resolutionOverdue) && (
        <Alert type="error" message={`${resolutionOverdue ? 'Resolution' : 'First response'} SLA overdue — target was ${dateFmt(resolutionOverdue ? ticket.resolution_due_at : ticket.first_response_due_at)}.`} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: agent ? '1fr 280px' : '1fr', gap: 20 }} className="grid-2">
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Description</div>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{ticket.description}</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {messages.map(m => (
              <div key={m.id} className="card" style={{ padding: '12px 16px', background: m.is_internal ? '#fffbeb' : undefined, borderColor: m.is_internal ? '#fde68a' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>{m.author?.full_name || 'Unknown'}</strong>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{timeFmt(m.created_at)}</span>
                </div>
                {m.is_internal && (
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <Lock size={10} /> INTERNAL NOTE
                  </div>
                )}
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{m.body}</p>
              </div>
            ))}
            {messages.length === 0 && <Empty title="No replies yet" />}
          </div>

          {!closedOut || agent ? (
            <div className="card" style={{ padding: 16 }}>
              <textarea className="form-input" rows={3} value={reply} onChange={e => setReply(e.target.value)}
                placeholder={internal ? 'Internal note — not shown to the requester' : 'Add a reply…'} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
                {agent ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-muted)' }}>
                    <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /> Internal note
                  </label>
                ) : <span />}
                <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={handleReply}>
                  <Send size={14} /> {internal ? 'Add Note' : 'Reply'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {agent && (
          <div>
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Manage</div>
              <label className="form-label">Status</label>
              <select className="form-input" style={{ marginBottom: 12 }} value={ticket.status} disabled={busy}
                onChange={e => act(() => updateStatus(id, e.target.value))}>
                {IT_STATUSES.map(s => <option key={s} value={s}>{IT_STATUS_LABELS[s]}</option>)}
              </select>
              <label className="form-label">Priority</label>
              <select className="form-input" style={{ marginBottom: 12 }} value={ticket.priority} disabled={busy}
                onChange={e => act(() => updatePriority(id, e.target.value))}>
                {IT_PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
              <label className="form-label">Assigned to</label>
              <select className="form-input" value={ticket.assigned_to || ''} disabled={busy}
                onChange={e => act(() => assignTicket(id, e.target.value || null))}>
                <option value="">Unassigned</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>SLA</div>
              <div style={{ fontSize: 12.5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                {responseOverdue && <AlertTriangle size={13} color="#dc2626" />}
                First response by {ticket.first_response_due_at ? dateFmt(ticket.first_response_due_at) : '—'}
                {ticket.first_response_at && <span style={{ color: '#15803d' }}> — met</span>}
              </div>
              <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                {resolutionOverdue && <AlertTriangle size={13} color="#dc2626" />}
                Resolution by {ticket.resolution_due_at ? dateFmt(ticket.resolution_due_at) : '—'}
                {ticket.resolved_at && <span style={{ color: '#15803d' }}> — done</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

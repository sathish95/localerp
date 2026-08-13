import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getTicket, listMessages, postMessage, assignTicket, updateTicketStatus, updateTicketPriority,
  listAgents, CATEGORIES, PRIORITIES, STATUSES,
} from '../lib/supportDesk'
import { Loader, Alert, StatusBadge, Empty } from '../components/ui'
import { dateFmt, timeFmt } from '../lib/supabase'
import { ArrowLeft, Send, Lock, AlertTriangle } from 'lucide-react'

const CATEGORY_LABELS = { billing: 'Billing', technical: 'Technical', feature_request: 'Feature Request', account: 'Account', onboarding: 'Onboarding', general: 'General' }
const PRIORITY_COLORS = { low: '#64748b', medium: '#0ea5e9', high: '#f59e0b', urgent: '#dc2626' }

function isOverdue(dueAt, resolvedOrClosed) {
  return dueAt && !resolvedOrClosed && new Date(dueAt) < new Date()
}

export default function SupportTicketDetailPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const isAgentView = !!profile?.is_super_admin

  const [ticket, setTicket] = useState(null)
  const [messages, setMessages] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [reply, setReply] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const [t, m] = await Promise.all([getTicket(id), listMessages(id)])
      setTicket(t); setMessages(m)
      if (isAgentView) setAgents(await listAgents())
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [id, isAgentView])

  useEffect(() => { load() }, [load])

  async function handleReply() {
    if (!reply.trim()) return
    setBusy(true); setErr('')
    try {
      await postMessage(id, reply.trim(), internalNote)
      setReply(''); setInternalNote(false)
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleStatus(status) {
    setBusy(true); setErr('')
    try { await updateTicketStatus(id, status); await load() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handlePriority(priority) {
    setBusy(true); setErr('')
    try { await updateTicketPriority(id, priority); await load() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleAssign(agentId) {
    setBusy(true); setErr('')
    try { await assignTicket(id, agentId || null); await load() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (loading) return <Loader />
  if (!ticket) return <Empty title="Ticket not found" desc="It may have been removed, or you don't have access to it." />

  const closedOut = ['resolved', 'closed'].includes(ticket.status)
  const responseOverdue = isOverdue(ticket.first_response_due_at, !!ticket.first_response_at)
  const resolutionOverdue = isOverdue(ticket.resolution_due_at, closedOut)

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={isAgentView ? '/super-admin/support' : '/support'} style={{ fontSize: 13, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, textDecoration: 'none' }}><ArrowLeft size={13} /> {isAgentView ? 'Support Desk' : 'My Tickets'}</Link>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{ticket.subject} <StatusBadge status={ticket.status} /></div>
          <div className="page-subtitle">{ticket.ticket_number} · {CATEGORY_LABELS[ticket.category] || ticket.category} · <span style={{ color: PRIORITY_COLORS[ticket.priority], fontWeight: 700, textTransform: 'uppercase' }}>{ticket.priority}</span>{ticket.project_name && <> · {ticket.project_name}</>}{isAgentView && ticket.org_name && <> · {ticket.org_name}</>}</div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      {(responseOverdue || resolutionOverdue) && (
        <Alert type="error" message={`${resolutionOverdue ? 'Resolution' : 'First response'} SLA breached — this ticket needed attention by ${dateFmt(resolutionOverdue ? ticket.resolution_due_at : ticket.first_response_due_at)}.`} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isAgentView ? '1fr 280px' : '1fr', gap: 20 }}>
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Description</div>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{ticket.description}</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {messages.map(m => (
              <div key={m.id} className="card" style={{ padding: '12px 16px', background: m.is_internal_note ? '#fffbeb' : undefined, borderColor: m.is_internal_note ? '#fde68a' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>{m.author_name || 'Unknown'}</strong>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{timeFmt(m.created_at)}</span>
                </div>
                {m.is_internal_note && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}><Lock size={10} /> INTERNAL NOTE</div>}
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{m.body}</p>
              </div>
            ))}
            {messages.length === 0 && <Empty title="No replies yet" />}
          </div>

          <div className="card" style={{ padding: 16 }}>
            <textarea className="form-input" rows={3} value={reply} onChange={e => setReply(e.target.value)} placeholder={isAgentView ? 'Reply to the customer…' : 'Add a reply…'} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              {isAgentView ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-muted)' }}>
                  <input type="checkbox" checked={internalNote} onChange={e => setInternalNote(e.target.checked)} /> Internal note (not visible to customer)
                </label>
              ) : <span />}
              <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={handleReply}><Send size={14} /> {internalNote ? 'Add Note' : 'Reply'}</button>
            </div>
          </div>
        </div>

        {isAgentView && (
          <div>
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Manage</div>
              <label className="form-label">Status</label>
              <select className="form-input" style={{ marginBottom: 12 }} value={ticket.status} disabled={busy} onChange={e => handleStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
              <label className="form-label">Priority</label>
              <select className="form-input" style={{ marginBottom: 12 }} value={ticket.priority} disabled={busy} onChange={e => handlePriority(e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="form-label">Assigned Agent</label>
              <select className="form-input" value={ticket.assigned_agent_id || ''} disabled={busy} onChange={e => handleAssign(e.target.value)}>
                <option value="">Unassigned</option>
                {agents.map(a => <option key={a.profile_id} value={a.profile_id}>{a.full_name}</option>)}
              </select>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>SLA</div>
              <div style={{ fontSize: 12.5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                {responseOverdue && <AlertTriangle size={13} color="#dc2626" />} First response by {dateFmt(ticket.first_response_due_at)}{ticket.first_response_at && <span style={{ color: '#15803d' }}> — met {dateFmt(ticket.first_response_at)}</span>}
              </div>
              <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                {resolutionOverdue && <AlertTriangle size={13} color="#dc2626" />} Resolution due by {dateFmt(ticket.resolution_due_at)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

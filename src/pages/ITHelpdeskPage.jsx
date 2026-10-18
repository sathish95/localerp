import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Loader, Alert, Empty, Modal, StatCard } from '../components/ui'
import { dateFmt } from '../lib/supabase'
import { Plus, Ticket, Settings, Inbox, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import {
  listTickets, createTicket, listCategories, ensureSeed, getStats,
  isItAgent, IT_PRIORITIES, IT_PRIORITY_COLORS, IT_STATUS_LABELS, isOverdue,
} from '../lib/itHelpdesk'

const STATUS_COLORS = {
  open: '#0ea5e9', in_progress: '#6366f1', waiting_on_requester: '#f59e0b',
  resolved: '#15803d', closed: '#64748b',
}

function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: c, background: `${c}18`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      {IT_STATUS_LABELS[status] || status}
    </span>
  )
}

const AGENT_TABS = [
  { id: 'all', label: 'All' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'mine', label: 'My requests' },
]

export default function ITHelpdeskPage() {
  const { profile } = useAuth()
  const agent = isItAgent(profile?.role)
  const isAdmin = ['admin', 'ceo'].includes(profile?.role)

  const [tab, setTab] = useState(agent ? 'all' : 'mine')
  const [tickets, setTickets] = useState([])
  const [categories, setCategories] = useState([])
  const [stats, setStats] = useState(null)
  const [statusFilter, setStatusFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ subject: '', description: '', category: '', priority: 'medium' })
  const [saving, setSaving] = useState(false)

  const catLabel = k => categories.find(c => c.key === k)?.label || k

  const load = useCallback(async () => {
    setErr('')
    try {
      // Idempotent (WHERE NOT EXISTS) default categories/SLA policies —
      // any role can trigger this now (STEP207), not just admin/ceo, so
      // the Category dropdown is never empty just because no admin has
      // opened this module yet. Logged (not silently swallowed) so a
      // real failure here — e.g. STEP207 not actually applied yet — is
      // visible instead of just leaving categories looking empty forever.
      await ensureSeed().catch(e => console.error('ensure_it_helpdesk_seed failed:', e))
      const [t, c] = await Promise.all([
        listTickets({ scope: agent ? tab : 'mine', userId: profile.id }),
        listCategories({ activeOnly: false }),
      ])
      setTickets(t); setCategories(c)
      if (agent) setStats(await getStats().catch(() => null))
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [agent, tab, isAdmin, profile?.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!createOpen) return
    const active = categories.filter(c => c.is_active)
    if (active.length && !form.category) setForm(f => ({ ...f, category: active[0].key }))
  }, [createOpen, categories]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!form.subject.trim() || !form.description.trim()) { setErr('Subject and description are required.'); return }
    setSaving(true); setErr('')
    try {
      await createTicket(form)
      setCreateOpen(false)
      setForm({ subject: '', description: '', category: '', priority: 'medium' })
      await load()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const shown = tickets.filter(t => {
    if (statusFilter === 'active') return !['resolved', 'closed'].includes(t.status)
    if (statusFilter === 'closed') return ['resolved', 'closed'].includes(t.status)
    return true
  })

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">IT Helpdesk</div>
          <div className="page-subtitle">
            {agent ? 'Raise and work internal IT requests' : 'Raise a request for hardware, software, access or network issues'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <Link to="/it-helpdesk/settings" className="btn btn-ghost btn-sm"><Settings size={14} /> Settings</Link>
          )}
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New Ticket</button>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      {agent && stats && (
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          <StatCard label="Open" value={stats.open_count ?? 0} icon={<Inbox size={16} />} accent="#0ea5e9" />
          <StatCard label="Unassigned" value={stats.unassigned_count ?? 0} icon={<Ticket size={16} />} accent="#f59e0b" />
          <StatCard label="SLA overdue" value={(stats.overdue_response ?? 0) + (stats.overdue_resolution ?? 0)} icon={<AlertTriangle size={16} />} accent="#dc2626" />
          <StatCard label="Resolved · 7d" value={stats.resolved_7d ?? 0} icon={<CheckCircle2 size={16} />} accent="#15803d" />
          <StatCard label="Avg resolve (h)" value={stats.avg_resolution_hours ?? '—'} icon={<Clock size={16} />} accent="#6366f1" />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        {agent && AGENT_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}>{t.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <select className="form-input" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="active">Active only</option>
          <option value="closed">Resolved / Closed</option>
          <option value="all">All statuses</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <Empty icon={<Ticket size={40} />} title="No tickets here"
          desc={agent ? 'Nothing matches this view yet.' : 'Raise a ticket when you need help from IT.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(t => {
            const overdue = !['resolved', 'closed'].includes(t.status) &&
              (isOverdue(t.first_response_due_at, t.first_response_at) || isOverdue(t.resolution_due_at, false))
            return (
              <Link key={t.id} to={`/it-helpdesk/${t.id}`} className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    {t.ticket_number} · {catLabel(t.category)}
                    {agent && <> · {t.requester?.full_name || 'Unknown'}</>}
                    {t.assignee?.full_name ? <> · {t.assignee.full_name}</> : <> · Unassigned</>}
                  </div>
                </div>
                {overdue && <AlertTriangle size={15} color="#dc2626" />}
                <span style={{ fontSize: 11, fontWeight: 700, color: IT_PRIORITY_COLORS[t.priority], textTransform: 'uppercase' }}>{t.priority}</span>
                <div className="hide-mobile" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(t.created_at)}</div>
                <StatusPill status={t.status} />
              </Link>
            )
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New IT Ticket" footer={
        <>
          <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleCreate}>{saving ? 'Submitting…' : 'Submit Ticket'}</button>
        </>
      }>
        <label className="form-label">Subject *</label>
        <input className="form-input" value={form.subject} autoFocus
          onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Short summary of the issue" />
        <label className="form-label" style={{ marginTop: 12 }}>Description *</label>
        <textarea className="form-input" rows={5} value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="What's happening, what you expected, anything you've already tried…" />
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Category</label>
            <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {categories.filter(c => c.is_active).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label">Priority</label>
            <select className="form-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {IT_PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  )
}

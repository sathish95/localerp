import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listAllTickets, STATUSES } from '../lib/supportDesk'
import { Loader, Alert, StatusBadge, StatCard, Empty, SearchBox } from '../components/ui'
import { dateFmt } from '../lib/supabase'
import { LifeBuoy, AlertTriangle, Clock, CheckCircle, Settings } from 'lucide-react'

const CATEGORY_LABELS = { billing: 'Billing', technical: 'Technical', feature_request: 'Feature Request', account: 'Account', onboarding: 'Onboarding', general: 'General' }
const PRIORITY_COLORS = { low: '#64748b', medium: '#0ea5e9', high: '#f59e0b', urgent: '#dc2626' }
const STATUS_FILTERS = ['all', ...STATUSES]

function isBreached(t) {
  const closedOut = ['resolved', 'closed'].includes(t.status)
  if (closedOut) return false
  const now = new Date()
  return (t.first_response_due_at && !t.first_response_at && new Date(t.first_response_due_at) < now)
    || (t.resolution_due_at && new Date(t.resolution_due_at) < now)
}

export default function SupportDeskPage() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [breachedOnly, setBreachedOnly] = useState(false)

  useEffect(() => {
    listAllTickets().then(setTickets).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Loader />

  const filtered = tickets.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (breachedOnly && !isBreached(t)) return false
    if (q && !t.subject.toLowerCase().includes(q.toLowerCase()) && !t.ticket_number.toLowerCase().includes(q.toLowerCase()) && !t.org_name?.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  const openCount = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length
  const breachedCount = tickets.filter(isBreached).length
  const resolvedCount = tickets.filter(t => t.status === 'resolved').length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Support Desk</div>
          <div className="page-subtitle">Every ticket raised across every organization</div>
        </div>
        <Link to="/super-admin/support/settings" className="btn btn-ghost"><Settings size={15} /> SLA & Agents</Link>
      </div>

      {err && <Alert type="error" message={err} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Tickets" value={tickets.length} icon={<LifeBuoy size={16} />} accent="#6366f1" />
        <StatCard label="Open" value={openCount} icon={<Clock size={16} />} accent="#f59e0b" />
        <StatCard label="SLA Breached" value={breachedCount} icon={<AlertTriangle size={16} />} accent="#dc2626" />
        <StatCard label="Resolved" value={resolvedCount} icon={<CheckCircle size={16} />} accent="#10b981" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ maxWidth: 300, flex: 1 }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search tickets or organizations…" />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(s => (
            <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
          <button className={`btn btn-sm ${breachedOnly ? 'btn-danger' : 'btn-ghost'}`} onClick={() => setBreachedOnly(b => !b)}><AlertTriangle size={12} /> SLA Breached</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon={<LifeBuoy size={40} />} title="No tickets found" desc="Try a different search or filter." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(t => (
            <Link key={t.id} to={`/support/${t.id}`} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', textDecoration: 'none', color: 'inherit' }}>
              {isBreached(t) && <AlertTriangle size={16} color="#dc2626" style={{ flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{t.ticket_number} · {t.org_name || 'Unknown org'} · {t.creator_name || 'Unknown'} · {CATEGORY_LABELS[t.category] || t.category}{t.project_name && <> · {t.project_name}</>}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: PRIORITY_COLORS[t.priority], textTransform: 'uppercase' }}>{t.priority}</span>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', minWidth: 90 }}>{t.agent_name || <em>Unassigned</em>}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(t.created_at)}</div>
              <StatusBadge status={t.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

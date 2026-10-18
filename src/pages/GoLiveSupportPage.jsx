import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import { listEngagements, engagementChips, loadLookups, loadMyWork, deviceLabel } from '../lib/goLive'
import { ENGAGEMENT_STATUSES, istToday, daysBetween } from '../lib/goLiveRules'
import { Loader, StatCard, Empty, Tabs } from '../components/ui'
import EngagementForm from '../components/golive/EngagementForm'
import EngagementActionModal from '../components/golive/EngagementActions'
import { EngagementStatusBadge, PriorityBadge, FlagBadge, Chip, ErrorLine, MANAGER_ROLES, errText } from '../components/golive/shared'
import { Plus, Radio, AlertTriangle, ClipboardCheck, Ticket, CalendarClock, Pencil, Trash2, RotateCcw } from 'lucide-react'

export default function GoLiveSupportPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('engagements')
  const [rows, setRows] = useState([])
  const [chips, setChips] = useState({})
  const [lookups, setLookups] = useState({ projects: [], departments: [], budgets: [], customers: [], people: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [action, setAction] = useState(null) // { kind, engagement }
  const [filters, setFilters] = useState({ project: '', customer: '', status: '', pm: '' })

  const canCreate = MANAGER_ROLES.includes(profile?.role)
  // Row actions: managers, or the engagement's own PM (the DB re-checks both).
  const canManageRow = r => canCreate || r.pm_user_id === profile?.id
  const stop = fn => e => { e.stopPropagation(); fn() }

  useEffect(() => { loadLookups().then(setLookups).catch(e => setError(errText(e))) }, [])
  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const list = await listEngagements()
      setRows(list)
      setChips(await engagementChips(list.map(r => r.id)))
    } catch (e) { setError(errText(e)) }
    setLoading(false)
  }

  const name = (list, id) => list.find(x => x.id === id)?.name || list.find(x => x.id === id)?.full_name || ''
  const shown = useMemo(() => rows.filter(r =>
    (!filters.project || r.project_id === filters.project) && (!filters.customer || r.customer_id === filters.customer)
    && (!filters.status || r.status === filters.status) && (!filters.pm || r.pm_user_id === filters.pm)
  ), [rows, filters])

  const totals = useMemo(() => {
    const active = rows.filter(r => r.status === 'ACTIVE')
    const sum = k => active.reduce((s, r) => s + (chips[r.id]?.[k] || 0), 0)
    return { active: active.length, devices: sum('devices'), open: sum('open'), p1: sum('p1') }
  }, [rows, chips])

  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Go-Live Support</div>
          <div className="page-subtitle">Hypercare from go-live to handover — device checks, incidents and exit readiness</div>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New Engagement</button>}
      </div>

      <div className="stats-grid">
        <StatCard label="Active engagements" value={totals.active} icon={<Radio size={16} />} />
        <StatCard label="Devices in hypercare" value={totals.devices} icon={<ClipboardCheck size={16} />} accent="#0891b2" />
        <StatCard label="Open incidents" value={totals.open} icon={<Ticket size={16} />} accent="#d97706" />
        <StatCard label="Critical open (P1)" value={totals.p1} icon={<AlertTriangle size={16} />} accent="#dc2626" />
      </div>

      <Tabs tabs={[{ id: 'engagements', label: 'Engagements', count: rows.length }, { id: 'mywork', label: 'My Work' }]} active={tab} onChange={setTab} />
      <ErrorLine error={error} />

      {tab === 'mywork' ? <MyWork userId={profile?.id} people={lookups.people} /> : (
        <>
          <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select className="form-select" style={{ fontSize: 12, width: 200 }} value={filters.project} onChange={e => setF('project', e.target.value)}>
              <option value="">All projects</option>{lookups.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="form-select" style={{ fontSize: 12, width: 180 }} value={filters.customer} onChange={e => setF('customer', e.target.value)}>
              <option value="">All customers</option>{lookups.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="form-select" style={{ fontSize: 12, width: 150 }} value={filters.status} onChange={e => setF('status', e.target.value)}>
              <option value="">All statuses</option>{ENGAGEMENT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select className="form-select" style={{ fontSize: 12, width: 180 }} value={filters.pm} onChange={e => setF('pm', e.target.value)}>
              <option value="">All PMs</option>{[...new Set(rows.map(r => r.pm_user_id).filter(Boolean))].map(id => <option key={id} value={id}>{name(lookups.people, id)}</option>)}
            </select>
          </div>

          {loading ? <Loader /> : !shown.length ? (
            <Empty icon={<Radio size={28} />} title="No go-live engagements" desc={canCreate ? 'Create one when a project goes live to start hypercare tracking.' : 'Engagements you are part of will appear here.'} />
          ) : (
            <div className="table-wrap">
              <table className="data-table" style={{ display: 'table', fontSize: 13 }}>
                <thead><tr><th>Engagement</th><th>Project / customer</th><th>Go-live</th><th>Hypercare</th><th>Status</th><th>Today</th><th /></tr></thead>
                <tbody>
                  {shown.map(r => {
                    const c = chips[r.id] || {}
                    const today = istToday()
                    const elapsed = r.hypercare_start ? Math.max(0, daysBetween(r.hypercare_start, today)) : 0
                    const total = r.hypercare_start && r.hypercare_planned_end ? daysBetween(r.hypercare_start, r.hypercare_planned_end) : 0
                    return (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/golive/${r.id}`)}>
                        <td><div style={{ fontWeight: 700 }}>{r.name}</div><div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.code} · PM {name(lookups.people, r.pm_user_id) || '—'}</div></td>
                        <td>{name(lookups.projects, r.project_id)}<div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{name(lookups.customers, r.customer_id)}</div></td>
                        <td>{dateFmt(r.go_live_date)}</td>
                        <td style={{ fontSize: 12 }}>{r.status === 'CLOSED' ? `Ended ${dateFmt(r.hypercare_actual_end)}` : r.status === 'ACTIVE' || r.status === 'EXIT_REVIEW' ? `Day ${elapsed} of ${total}` : '—'}</td>
                        <td><EngagementStatusBadge status={r.status} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <Chip title="Checks logged today / active devices">{c.checked || 0}/{c.devices || 0} checked</Chip>
                            {c.attention > 0 && <Chip tone="red">{c.attention} attention</Chip>}
                            {c.open > 0 && <Chip tone="amber">{c.open} open</Chip>}
                            {c.p1 > 0 && <Chip tone="red">{c.p1} P1</Chip>}
                            {c.overdue > 0 && <Chip tone="red">{c.overdue} overdue</Chip>}
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {canManageRow(r) && <>
                            <button className="btn btn-ghost btn-sm" title="Edit" onClick={stop(() => setEditing(r))}><Pencil size={12} /></button>
                            {['CLOSED', 'CANCELLED'].includes(r.status) && <button className="btn btn-ghost btn-sm" title="Reopen hypercare" onClick={stop(() => setAction({ kind: 'reopen', engagement: r }))}><RotateCcw size={12} /></button>}
                            <button className="btn btn-ghost btn-sm" title="Delete" style={{ color: 'var(--danger)' }} onClick={stop(() => setAction({ kind: 'delete', engagement: r }))}><Trash2 size={12} /></button>
                          </>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editing && <EngagementForm initial={editing} lookups={lookups} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {action && <EngagementActionModal kind={action.kind} engagement={action.engagement} onClose={() => setAction(null)} onDone={() => { setAction(null); load() }} />}
      {creating && (
        <EngagementForm lookups={lookups} onClose={() => setCreating(false)}
          onSaved={e => { setCreating(false); navigate(`/golive/${e.id}`) }} />
      )}
    </div>
  )
}

// §6.2 My Work — the user's pending checks, reviews and incidents across engagements.
function MyWork({ userId, people }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { if (userId) loadMyWork(userId).then(setData).catch(e => setError(errText(e))) }, [userId])
  if (error) return <ErrorLine error={error} />
  if (!data) return <Loader />
  const code = id => data.engagements.find(e => e.id === id)?.code || ''
  const empty = !data.pendingChecks.length && !data.pendingReviews.length && !data.incidents.length && !data.toVerify.length
  if (empty) return <Empty icon={<ClipboardCheck size={28} />} title="Nothing waiting on you" desc="Pending checks, reviews and incidents assigned to you show up here." />

  const Section = ({ title, count, children }) => (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">{title} <span style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>({count})</span></div></div>
      <div style={{ padding: 0 }}>{children}</div>
    </div>
  )
  const Row = ({ to, children }) => (
    <Link to={to} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid var(--border)', color: 'inherit', textDecoration: 'none', fontSize: 13, flexWrap: 'wrap' }}>{children}</Link>
  )
  return (
    <div>
      {data.pendingChecks.length > 0 && (
        <Section title="Today's checks" count={data.pendingChecks.length}>
          {data.pendingChecks.map(e => (
            <Row key={e.id} to={`/golive/${e.engagement_id}?tab=checks`}>
              <strong>{deviceLabel(e.device)}</strong><span style={{ color: 'var(--ink-muted)' }}>{e.site || ''}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)' }}>{code(e.engagement_id)}</span>
            </Row>
          ))}
        </Section>
      )}
      {data.pendingReviews.length > 0 && (
        <Section title="Pending reviews" count={data.pendingReviews.length}>
          {data.pendingReviews.map(e => (
            <Row key={`${e.id}-${e.section}`} to={`/golive/${e.engagement_id}?tab=checks`}>
              <strong>{deviceLabel(e.device)}</strong><Chip>{e.section === 'firmware' ? 'Firmware review' : 'Application review'}</Chip>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)' }}>{code(e.engagement_id)}</span>
            </Row>
          ))}
        </Section>
      )}
      {data.incidents.length > 0 && (
        <Section title="My incidents" count={data.incidents.length}>
          {data.incidents.map(i => (
            <Row key={i.id} to={`/golive/${i.engagement_id}?tab=incidents&incident=${i.id}`}>
              <strong>{i.number}</strong><PriorityBadge priority={i.priority} /><span>{i.title}</span><FlagBadge flag={i.follow_up_flag} />
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)', display: 'flex', gap: 4, alignItems: 'center' }}>
                {i.action_due_at && <><CalendarClock size={12} /> {new Date(i.action_due_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
              </span>
            </Row>
          ))}
        </Section>
      )}
      {data.toVerify.length > 0 && (
        <Section title="To verify & close" count={data.toVerify.length}>
          {data.toVerify.map(i => (
            <Row key={i.id} to={`/golive/${i.engagement_id}?tab=incidents&incident=${i.id}`}>
              <strong>{i.number}</strong><span>{i.title}</span><span style={{ color: 'var(--ink-muted)' }}>owner {people.find(p => p.id === i.assigned_owner_user_id)?.full_name || '—'}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)' }}>{code(i.engagement_id)}</span>
            </Row>
          ))}
        </Section>
      )}
    </div>
  )
}

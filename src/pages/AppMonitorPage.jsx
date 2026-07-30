import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Loader, Empty } from '../components/ui'
import { RefreshCw, Users, Eye, AlertTriangle, TrendingUp, Sparkles, ArrowRight } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function Kpi({ label, value, icon, color = '#6366f1', sub }) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff', borderRadius: 16, padding: '16px 18px', border: `1.5px solid ${color}18`, borderTop: `4px solid ${color}`,
        boxShadow: hover ? '0 10px 24px rgba(0,0,0,.09)' : '0 1px 6px rgba(0,0,0,.05)', height: '100%', minWidth: 0,
        transform: hover ? 'translateY(-3px)' : 'none', transition: 'transform .18s, box-shadow .18s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 'clamp(16px,3vw,24px)', fontWeight: 800, color, lineHeight: 1.2, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ChartCard({ title, sub, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

function HBar({ label, value, max, color = '#6366f1' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{label}</span>
        <span style={{ color: '#94a3b8', fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: color, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

export default function AppMonitorPage() {
  const { profile } = useAuth()
  const role = profile?.role
  const allowed = ['admin', 'ceo'].includes(role)

  const [events,     setEvents]     = useState([])
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [range,      setRange]      = useState('today') // today | 7d | 30d

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setRefreshing(true)

    const now    = new Date()
    const cutoff = new Date(now)
    if (range === 'today')  cutoff.setHours(0, 0, 0, 0)
    else if (range === '7d') cutoff.setDate(now.getDate() - 7)
    else                    cutoff.setDate(now.getDate() - 30)

    const [evtRes, userRes] = await Promise.all([
      supabase.from('app_events').select('*').gte('created_at', cutoff.toISOString()).order('created_at', { ascending: false }).limit(2000),
      supabase.from('profiles').select('id,full_name,role,last_sign_in_at'),
    ])

    setEvents(evtRes.data || [])
    setUsers(userRes.data || [])
    setLoading(false)
    setRefreshing(false)
  }, [allowed, range])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => {
    const pageViews   = events.filter(e => e.event_type === 'page_view')
    const uniqueUsers = new Set(events.filter(e => e.user_id).map(e => e.user_id)).size

    const pageCounts = {}
    pageViews.forEach(e => { pageCounts[e.path] = (pageCounts[e.path] || 0) + 1 })
    const topPages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label: label || '/', count }))

    const byTimeBuckets = {}
    pageViews.forEach(e => {
      const d = new Date(e.created_at)
      const key = range === 'today'
        ? d.getHours().toString().padStart(2, '0') + ':00'
        : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      byTimeBuckets[key] = (byTimeBuckets[key] || 0) + 1
    })
    const pvChart = Object.entries(byTimeBuckets).sort((a, b) => a[0].localeCompare(b[0])).slice(-24).map(([bucket, count]) => ({ bucket, count }))

    const errorTypes = {}
    events.filter(e => e.event_type === 'error').forEach(e => {
      const t = e.metadata?.error_type || 'Unknown'
      errorTypes[t] = (errorTypes[t] || 0) + 1
    })

    const userActivity = {}
    events.filter(e => e.user_id).forEach(e => { userActivity[e.user_id] = (userActivity[e.user_id] || 0) + 1 })
    const topUsers = Object.entries(userActivity).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([uid, count]) => {
      const u = users.find(x => x.id === uid)
      return { label: u?.full_name || uid.slice(0, 8), count }
    })

    return { pageViews, uniqueUsers, topPages, pvChart, errorTypes, topUsers }
  }, [events, users, range])

  if (loading) return <Loader />

  if (!allowed) {
    return (
      <div>
        <div className="page-header"><div><div className="page-title">Application Monitor</div><div className="page-subtitle">Restricted to Admin & CEO</div></div></div>
        <Empty icon={<AlertTriangle size={44} />} title="No access" desc="App Monitor is available for Admin / CEO only" />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Application Monitor</div>
          <div className="page-subtitle">Real-time page-view &amp; usage analytics</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[{ id: 'today', label: 'Today' }, { id: '7d', label: '7 Days' }, { id: '30d', label: '30 Days' }].map(r => (
            <button key={r.id} onClick={() => setRange(r.id)} className={r.id === range ? 'btn btn-primary' : 'btn btn-outline'} style={{ padding: '7px 14px', fontSize: 12.5 }}>
              {r.label}
            </button>
          ))}
          <button onClick={load} className="btn btn-outline" title="Refresh">
            <RefreshCw size={14} style={{ marginRight: 6, animation: refreshing ? 'spin .7s linear infinite' : 'none' }} /> Refresh
          </button>
        </div>
      </div>

      <Link to="/llm-monitor" className="hover-lift" style={{
        display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none',
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', borderRadius: 14, padding: '14px 18px', marginBottom: 20, color: '#fff',
      }}>
        <Sparkles size={18} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Looking for chatbot / AI token usage?</div>
          <div style={{ fontSize: 11.5, opacity: .9 }}>Requests, tokens consumed, latency and errors have their own dedicated monitor.</div>
        </div>
        <ArrowRight size={16} />
      </Link>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Page Views" value={stats.pageViews.length} color="#6366f1" icon={<Eye size={18} />} sub={range === 'today' ? 'today' : range} />
        <Kpi label="Unique Users" value={stats.uniqueUsers} color="#10b981" icon={<Users size={18} />} sub="from page views" />
        <Kpi label="Registered Users" value={users.length} color="#06b6d4" icon={<TrendingUp size={18} />} sub="total profiles" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))', gap: 20, marginBottom: 20 }}>
        <ChartCard title="📈 Page Views Over Time">
          {stats.pvChart.length === 0 ? (
            <Empty icon={<Eye size={32} />} title="No data" desc="No page views logged for this period" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.pvChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" name="Page Views" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="📄 Top Pages">
          {stats.topPages.length === 0 ? (
            <Empty icon={<Eye size={32} />} title="No data" desc="No page views logged for this period" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.topPages} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Views" fill="#6366f1" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 20, marginBottom: 20 }}>
        <ChartCard title="👤 Most Active Users">
          {stats.topUsers.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 12 }}>No activity recorded</div>
          ) : (
            stats.topUsers.map(u => <HBar key={u.label} label={u.label} value={u.count} max={stats.topUsers[0]?.count || 1} color="#10b981" />)
          )}
        </ChartCard>

        <ChartCard title="⚠️ Error Types">
          {Object.entries(stats.errorTypes).length === 0 ? (
            <Empty icon={<AlertTriangle size={32} />} title="No errors logged" desc="Nothing to see here — great!" />
          ) : (
            Object.entries(stats.errorTypes).sort((a, b) => b[1] - a[1]).map(([t, c]) => (
              <HBar key={t} label={t} value={c} max={Math.max(...Object.values(stats.errorTypes))} color="#e11d48" />
            ))
          )}
        </ChartCard>
      </div>

      <div className="table-wrap hover-lift">
        <div className="table-toolbar">
          <span style={{ fontWeight: 700, fontSize: 14 }}>Recent Events</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{events.length} events</span>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
              <tr><th>Time</th><th>Type</th><th>Path</th><th>User</th><th>Session</th><th>Meta</th></tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>No events in this period</td></tr>
              )}
              {events.slice(0, 300).map(e => {
                const u = users.find(x => x.id === e.user_id)
                const typeColor = { page_view: '#06b6d4', session_start: '#10b981', session_end: '#8b5cf6', error: '#e11d48', api_call: '#f59e0b' }[e.event_type] || 'var(--text-muted)'
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(e.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    </td>
                    <td><span style={{ fontSize: 10, fontWeight: 700, color: typeColor, textTransform: 'uppercase', letterSpacing: .5 }}>{e.event_type}</span></td>
                    <td style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.path || '—'}</td>
                    <td style={{ fontSize: 11 }}>{u?.full_name || (e.user_id ? e.user_id.slice(0, 8) + '…' : '—')}</td>
                    <td style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{e.session_id ? e.session_id.slice(0, 10) + '…' : '—'}</td>
                    <td style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.metadata && Object.keys(e.metadata).length > 0 ? JSON.stringify(e.metadata).slice(0, 60) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

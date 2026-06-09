import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Loader } from '../components/ui'
import { RefreshCw, Users, Eye, Zap, AlertTriangle, TrendingUp, Activity } from 'lucide-react'

/* ─── KPI card ─────────────────────────────────────── */
function KPI({ icon: Icon, label, value, sub, color='var(--c1)' }) {
  return (
    <div className="stat-card" style={{ display:'flex', gap:14, alignItems:'center' }}>
      <div style={{ width:44, height:44, borderRadius:12, background:`${color}22`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <Icon size={20} style={{ color }}/>
      </div>
      <div>
        <div style={{ fontSize:22, fontWeight:800, lineHeight:1 }}>{value}</div>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', marginTop:2 }}>{label}</div>
        {sub && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>{sub}</div>}
      </div>
    </div>
  )
}

/* ─── Simple bar chart ────────────────────────────── */
function BarChart({ data = [], valueKey = 'count', labelKey = 'label', color = 'var(--c1)', height = 100 }) {
  const max = Math.max(...data.map(d => d[valueKey]), 1)
  return (
    <div style={{ display:'flex', gap:3, alignItems:'flex-end', height, paddingBottom:18, position:'relative' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', gap:3, height:'100%' }}>
          <div style={{ fontSize:9, color:'var(--text-muted)', marginBottom:2 }}>{d[valueKey]}</div>
          <div style={{ width:'100%', borderRadius:'4px 4px 0 0', background:color, height:`${(d[valueKey]/max)*80}%`, minHeight:d[valueKey]?3:0, transition:'height .3s' }}/>
          <div style={{ fontSize:9, color:'var(--text-muted)', textAlign:'center', width:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d[labelKey]}</div>
        </div>
      ))}
    </div>
  )
}

/* ─── Horizontal bar ───────────────────────────────── */
function HBar({ label, value, max, color='var(--c1)' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:4 }}>
        <span style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'70%' }}>{label}</span>
        <span style={{ color:'var(--text-muted)', fontWeight:700 }}>{value}</span>
      </div>
      <div style={{ height:6, borderRadius:3, background:'var(--surface-2)', overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, borderRadius:3, background:color, transition:'width .4s' }}/>
      </div>
    </div>
  )
}

/* ══ MAIN ════════════════════════════════════════════ */
export default function AppMonitorPage() {
  const { profile } = useAuth()
  const role = profile?.role
  const allowed = ['admin','ceo'].includes(role)

  const [events,      setEvents]      = useState([])
  const [users,       setUsers]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [range,       setRange]       = useState('today')    // today | 7d | 30d

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setRefreshing(true)

    const now    = new Date()
    const cutoff = new Date(now)
    if (range === 'today')  cutoff.setHours(0,0,0,0)
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

  /* ── Derived stats ─────────────────────────────── */
  const stats = useMemo(() => {
    const pageViews   = events.filter(e => e.event_type === 'page_view')
    const sessions    = events.filter(e => e.event_type === 'session_start')
    const errors      = events.filter(e => e.event_type === 'error')
    const apiCalls    = events.filter(e => e.event_type === 'api_call')
    const uniqueUsers = new Set(events.filter(e => e.user_id).map(e => e.user_id)).size

    // Page counts
    const pageCounts = {}
    pageViews.forEach(e => { pageCounts[e.path] = (pageCounts[e.path] || 0) + 1 })
    const topPages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label: label || '/', count }))

    // Page views by hour (today) or by day (7d/30d)
    const byTimeBuckets = {}
    pageViews.forEach(e => {
      const d = new Date(e.created_at)
      const key = range === 'today'
        ? d.getHours().toString().padStart(2,'0') + ':00'
        : d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' })
      byTimeBuckets[key] = (byTimeBuckets[key] || 0) + 1
    })
    const pvChart = Object.entries(byTimeBuckets).sort((a,b)=>a[0].localeCompare(b[0])).slice(-24).map(([label,count])=>({label,count}))

    // Error types
    const errorTypes = {}
    errors.forEach(e => {
      const t = e.metadata?.error_type || 'Unknown'
      errorTypes[t] = (errorTypes[t] || 0) + 1
    })

    // User activity
    const userActivity = {}
    events.filter(e => e.user_id).forEach(e => { userActivity[e.user_id] = (userActivity[e.user_id] || 0) + 1 })
    const topUsers = Object.entries(userActivity).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([uid, count]) => {
      const u = users.find(x => x.id === uid)
      return { label: u?.full_name || uid.slice(0,8), count }
    })

    return { pageViews, sessions, errors, apiCalls, uniqueUsers, topPages, pvChart, errorTypes, topUsers }
  }, [events, users, range])

  if (loading) return <Loader/>

  if (!allowed) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'60vh', gap:12, color:'var(--text-muted)' }}>
        <AlertTriangle size={48} style={{ opacity:.3 }}/>
        <div style={{ fontWeight:700, fontSize:16 }}>Access restricted</div>
        <div style={{ fontSize:13 }}>App Monitor is available for Admin / CEO only.</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Application Monitor</div>
          <div className="page-subtitle">Real-time usage analytics — CEO/Admin view</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {/* Range selector */}
          {[{id:'today',label:'Today'},{id:'7d',label:'Last 7 days'},{id:'30d',label:'Last 30 days'}].map(r => (
            <button key={r.id} onClick={() => setRange(r.id)}
              className={range === r.id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
              {r.label}
            </button>
          ))}
          <button onClick={load} className="btn btn-ghost btn-sm btn-icon" title="Refresh" style={{ marginLeft:4 }}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}/>
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:24 }}>
        <KPI icon={Eye}           label="Page Views"     value={stats.pageViews.length}   sub={`${range==='today'?'today':range}`}   color="var(--c1)"/>
        <KPI icon={Users}         label="Unique Users"   value={stats.uniqueUsers}          sub="from page views"                      color="#10b981"/>
        <KPI icon={Activity}      label="Sessions"       value={stats.sessions.length}      sub="session starts"                       color="#8b5cf6"/>
        <KPI icon={Zap}           label="API Calls"      value={stats.apiCalls.length}      sub="tracked client calls"                 color="#f59e0b"/>
        <KPI icon={AlertTriangle} label="Errors"         value={stats.errors.length}        sub="logged errors"                        color={stats.errors.length>0?'#e11d48':'#64748b'}/>
        <KPI icon={TrendingUp}    label="Registered Users" value={users.length}             sub="total profiles"                       color="#06b6d4"/>
      </div>

      {/* Charts row */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:20 }}>
        {/* Page views over time */}
        <div className="card">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <div style={{ fontWeight:700, fontSize:14 }}>Page Views Over Time</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>{stats.pvChart.length} buckets</div>
          </div>
          {stats.pvChart.length === 0
            ? <div style={{ height:120, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', fontSize:12 }}>No data for this period</div>
            : <BarChart data={stats.pvChart} color="var(--c1)" height={120}/>
          }
        </div>

        {/* Top pages */}
        <div className="card">
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Top Pages</div>
          {stats.topPages.length === 0
            ? <div style={{ color:'var(--text-muted)', fontSize:12 }}>No page views logged</div>
            : stats.topPages.map(p => (
              <HBar key={p.label} label={p.label} value={p.count} max={stats.topPages[0]?.count || 1} color="var(--c1)"/>
            ))
          }
        </div>
      </div>

      {/* Second row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
        {/* Most active users */}
        <div className="card">
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Most Active Users</div>
          {stats.topUsers.length === 0
            ? <div style={{ color:'var(--text-muted)', fontSize:12 }}>No activity recorded</div>
            : stats.topUsers.map(u => (
              <HBar key={u.label} label={u.label} value={u.count} max={stats.topUsers[0]?.count || 1} color="#10b981"/>
            ))
          }
        </div>

        {/* Error breakdown */}
        <div className="card">
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Error Types</div>
          {Object.entries(stats.errorTypes).length === 0
            ? <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'24px 0', gap:8, color:'var(--text-muted)' }}>
                <AlertTriangle size={28} style={{ opacity:.2 }}/>
                <div style={{ fontSize:12 }}>No errors logged — great!</div>
              </div>
            : Object.entries(stats.errorTypes).sort((a,b)=>b[1]-a[1]).map(([t,c]) => (
                <HBar key={t} label={t} value={c} max={Math.max(...Object.values(stats.errorTypes))} color="#e11d48"/>
              ))
          }
        </div>
      </div>

      {/* Event log table */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <span style={{ fontWeight:700, fontSize:14 }}>Recent Events</span>
          <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)' }}>{events.length} events</span>
        </div>
        <div style={{ maxHeight:360, overflowY:'auto' }}>
          <table>
            <thead style={{ position:'sticky', top:0, background:'var(--surface)' }}>
              <tr><th>Time</th><th>Type</th><th>Path</th><th>User</th><th>Session</th><th>Meta</th></tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr><td colSpan={6} style={{ padding:'30px', textAlign:'center', color:'var(--text-muted)' }}>No events in this period</td></tr>
              )}
              {events.slice(0, 300).map(e => {
                const u = users.find(x => x.id === e.user_id)
                const typeColor = { page_view:'#06b6d4', session_start:'#10b981', session_end:'#8b5cf6', error:'#e11d48', api_call:'#f59e0b' }[e.event_type] || 'var(--text-muted)'
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                      {new Date(e.created_at).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })}
                    </td>
                    <td><span style={{ fontSize:10, fontWeight:700, color:typeColor, textTransform:'uppercase', letterSpacing:.5 }}>{e.event_type}</span></td>
                    <td style={{ fontSize:11, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.path || '—'}</td>
                    <td style={{ fontSize:11 }}>{u?.full_name || (e.user_id ? e.user_id.slice(0,8)+'…' : '—')}</td>
                    <td style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'monospace' }}>{e.session_id ? e.session_id.slice(0,10)+'…' : '—'}</td>
                    <td style={{ fontSize:10, color:'var(--text-muted)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
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

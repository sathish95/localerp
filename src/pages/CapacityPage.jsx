import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import {
  recomputeAllActive, getBenchBurnoutThresholds, saveBenchBurnoutThresholds,
  getSnapshotsForEmployee, getSnapshotsForWeek, weekStartOf,
} from '../lib/capacity'
import { Loader, Empty, SearchBox } from '../components/ui'
import AllocationGantt from '../components/AllocationGantt'
import { RefreshCw, AlertTriangle, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const Kpi = ({ label, value, color }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, borderTop: `2px solid ${color}`, padding: '10px 14px' }}>
    <div style={{ fontWeight: 800, fontSize: 22, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{label}</div>
  </div>
)

function fmtWeek(d) { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }

export default function CapacityPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canManage = ['admin', 'ceo', 'hr', 'manager', 'department_head'].includes(role)

  const [tab, setTab] = useState('my')
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)

  const [mySnaps, setMySnaps] = useState([])
  const [myAllocs, setMyAllocs] = useState([])
  const [myGanttWindow, setMyGanttWindow] = useState(() => new Date())

  const [profiles, setProfiles] = useState([])
  const [departments, setDepartments] = useState([])
  const [skills, setSkills] = useState([])
  const [employeeSkills, setEmployeeSkills] = useState([])
  const [thresholds, setThresholds] = useState({ benchPct: 30, burnoutPct: 100 })

  const [weekOffset, setWeekOffset] = useState(0)
  const [weekSnaps, setWeekSnaps] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [search, setSearch] = useState('')
  const [drillEmployee, setDrillEmployee] = useState(null)
  const [drillAllocs, setDrillAllocs] = useState([])
  const [drillGanttWindow, setDrillGanttWindow] = useState(() => new Date())

  useEffect(() => { if (profile?.id) init() }, [profile?.id])

  async function init() {
    setLoading(true)
    setRecomputing(true)
    await recomputeAllActive()
    setRecomputing(false)
    await loadStatic()
    setLoading(false)
  }

  async function loadStatic() {
    const [snaps, allocR, profR, deptR, skR, esR, th] = await Promise.all([
      getSnapshotsForEmployee(profile.id),
      supabase.from('allocations').select('*,project:projects(name)').eq('employee_id', profile.id),
      supabase.from('profiles').select('id,full_name,department_id').eq('is_active', true),
      supabase.from('departments').select('id,name'),
      supabase.from('skills').select('*').order('skill_name'),
      supabase.from('employee_skills').select('employee_id,skill_id'),
      getBenchBurnoutThresholds(),
    ])
    setMySnaps(snaps)
    setMyAllocs(allocR.data || [])
    setProfiles(profR.data || [])
    setDepartments(deptR.data || [])
    setSkills(skR.data || [])
    setEmployeeSkills(esR.data || [])
    setThresholds(th)
  }

  useEffect(() => {
    (async () => {
      const d = new Date(); d.setDate(d.getDate() + weekOffset * 7)
      const rows = await getSnapshotsForWeek(d)
      setWeekSnaps(rows)
    })()
  }, [weekOffset, mySnaps])

  async function recomputeNow() {
    setRecomputing(true)
    await recomputeAllActive()
    setRecomputing(false)
    loadStatic()
    setWeekOffset(w => w) // trigger week-snap refetch via effect dependency churn
    const d = new Date(); d.setDate(d.getDate() + weekOffset * 7)
    setWeekSnaps(await getSnapshotsForWeek(d))
  }

  async function saveThresholds() {
    await saveBenchBurnoutThresholds(thresholds.benchPct, thresholds.burnoutPct, profile.id)
  }

  async function openDrill(employeeId) {
    setDrillEmployee(employeeId)
    const { data } = await supabase.from('allocations').select('*,project:projects(name)').eq('employee_id', employeeId)
    setDrillAllocs(data || [])
    setDrillGanttWindow(new Date())
  }

  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))
  const deptMap = Object.fromEntries(departments.map(d => [d.id, d.name]))
  const skillEmployeeIds = skillFilter ? new Set(employeeSkills.filter(es => es.skill_id === skillFilter).map(es => es.employee_id)) : null

  const benchRows = weekSnaps
    .map(s => ({ ...s, employee: profileMap[s.employee_id] }))
    .filter(s => s.employee)
    .filter(s => !deptFilter || s.employee.department_id === deptFilter)
    .filter(s => !skillEmployeeIds || skillEmployeeIds.has(s.employee_id))
    .filter(s => !search || s.employee.full_name?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.utilization_percent - b.utilization_percent)

  const benchCount = benchRows.filter(r => r.utilization_percent < thresholds.benchPct).length
  const burnoutCount = benchRows.filter(r => r.utilization_percent > thresholds.burnoutPct).length

  const deptAgg = departments.map(d => {
    const rows = weekSnaps.filter(s => profileMap[s.employee_id]?.department_id === d.id)
    const avg = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + Number(r.utilization_percent), 0) / rows.length) : 0
    return { name: d.name, utilization: avg, count: rows.length }
  }).filter(d => d.count > 0)

  const myGanttRows = [{
    id: 'me', label: profile?.full_name || 'Me',
    segments: myAllocs.map(a => ({ start: a.start_date, end: a.end_date, color: '#6366f1', label: `${a.project?.name || 'Project'} ${a.allocation_percent}%` })),
  }]
  const drillGanttRows = [{
    id: 'drill', label: profileMap[drillEmployee]?.full_name || '',
    segments: drillAllocs.map(a => ({ start: a.start_date, end: a.end_date, color: '#6366f1', label: `${a.project?.name || 'Project'} ${a.allocation_percent}%` })),
  }]

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Capacity</div>
          <div className="page-subtitle">Utilization trends, bench risk & burnout alerts</div>
        </div>
        <button className="btn btn-outline" onClick={recomputeNow} disabled={recomputing}>
          <RefreshCw size={14} style={{ animation: recomputing ? 'spin 1s linear infinite' : 'none' }} /> {recomputing ? 'Recomputing…' : 'Recompute Now'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {[
          { id: 'my', label: 'My Utilization' },
          ...(canManage ? [{ id: 'department', label: 'Department Aggregate' }] : []),
          ...(canManage ? [{ id: 'bench', label: `Bench Report${benchCount > 0 ? ` (${benchCount})` : ''}` }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '10px 16px', border: 'none', borderBottom: `2px solid ${tab === t.id ? 'var(--c1)' : 'transparent'}`, background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: tab === t.id ? 'var(--c1)' : 'var(--text-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'my' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Utilization Trend</div>
            {mySnaps.length === 0 ? <Empty icon="📊" title="No data yet" desc="Snapshots populate once you have allocations or leave on record" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={mySnaps.map(s => ({ week: fmtWeek(s.week_start_date), pct: s.utilization_percent }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => [`${v}%`, 'Utilization']} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                  <Line type="monotone" dataKey="pct" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <AllocationGantt rows={myGanttRows} windowStart={myGanttWindow} weeks={10}
            onShiftWindow={delta => setMyGanttWindow(w => { const n = new Date(w); n.setDate(n.getDate() + delta * 7); return n })} />
        </div>
      )}

      {tab === 'department' && canManage && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setWeekOffset(w => w - 1)}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)' }}>Week of {fmtWeek(weekStartOf(new Date(new Date().setDate(new Date().getDate() + weekOffset * 7))))}</span>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setWeekOffset(w => w + 1)}><ChevronRight size={14} /></button>
          </div>
          {deptAgg.length === 0 ? <Empty icon="🏢" title="No data for this week" desc="Try Recompute Now, or check another week" /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={deptAgg} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip formatter={(v, n, p) => [`${v}% (${p.payload.count} people)`, 'Avg. Utilization']} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="utilization" radius={[6, 6, 0, 0]}>
                  {deptAgg.map((d, i) => <Cell key={i} fill={d.utilization > thresholds.burnoutPct ? '#ef4444' : d.utilization < thresholds.benchPct ? '#f59e0b' : '#6366f1'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {tab === 'bench' && canManage && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 16 }}>
            <Kpi label="Bench Risk" value={benchCount} color="#f59e0b" />
            <Kpi label="Burnout Risk" value={burnoutCount} color="#ef4444" />
            <Kpi label="Total Tracked" value={benchRows.length} color="#6366f1" />
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Bench threshold (%)</label>
              <input className="form-input" type="number" min={0} max={100} value={thresholds.benchPct} onChange={e => setThresholds(t => ({ ...t, benchPct: Number(e.target.value) }))} style={{ width: 100 }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Burnout threshold (%)</label>
              <input className="form-input" type="number" min={0} value={thresholds.burnoutPct} onChange={e => setThresholds(t => ({ ...t, burnoutPct: Number(e.target.value) }))} style={{ width: 100 }} />
            </div>
            <button className="btn btn-outline btn-sm" onClick={saveThresholds}>Save Thresholds</button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <SearchBox value={search} onChange={setSearch} placeholder="Search employee…" />
              <select className="form-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All Departments</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select className="form-select" value={skillFilter} onChange={e => setSkillFilter(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All Skills</option>
                {skills.map(s => <option key={s.id} value={s.id}>{s.skill_name}</option>)}
              </select>
            </div>
          </div>

          {benchRows.length === 0 ? <Empty icon="🧑‍💻" title="No matching employees" desc="Try adjusting the filters, or Recompute Now if this looks stale" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Department</th><th>Available</th><th>Allocated</th><th>Leave</th><th>Utilization</th><th></th></tr></thead>
                <tbody>
                  {benchRows.map(r => {
                    const isBench = r.utilization_percent < thresholds.benchPct
                    const isBurnout = r.utilization_percent > thresholds.burnoutPct
                    return (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openDrill(r.employee_id)}>
                        <td className="td-bold">{r.employee?.full_name}</td>
                        <td>{deptMap[r.employee?.department_id] || '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{r.available_hours}h</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{r.allocated_hours}h</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{r.leave_hours}h</td>
                        <td style={{ fontWeight: 700, color: isBurnout ? '#ef4444' : isBench ? '#f59e0b' : '#10b981' }}>{r.utilization_percent}%</td>
                        <td>
                          {isBurnout && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#ef4444' }}><AlertTriangle size={12} /> Burnout</span>}
                          {isBench && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#f59e0b' }}><TrendingDown size={12} /> Bench</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {drillEmployee && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{profileMap[drillEmployee]?.full_name}'s Allocation Timeline</div>
              <AllocationGantt rows={drillGanttRows} windowStart={drillGanttWindow} weeks={10}
                onShiftWindow={delta => setDrillGanttWindow(w => { const n = new Date(w); n.setDate(n.getDate() + delta * 7); return n })} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { listCycles, getDashboardRows, summarizeImprovementThemes, RATING_BANDS } from '../lib/performance'
import { Loader, Empty, Tabs, StatCard, SearchBox } from '../components/ui'
import { LineChart as LineChartIcon, Users, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'

const RATING_COLOR = {
  'Unsatisfactory': '#dc2626', 'Needs Improvement': '#f59e0b', 'Meets Expectations': '#0ea5e9', 'Exceeds Expectations': '#15803d',
}
const RatingPill = ({ rating }) => rating
  ? <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${RATING_COLOR[rating]}18`, color: RATING_COLOR[rating] }}>{rating}</span>
  : <span style={{ fontSize: 11, color: '#94a3b8' }}>Not rated</span>

export default function PerformanceDashboardPage() {
  const [cycles, setCycles] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [filters, setFilters] = useState({ cycleId: '', departmentId: '', projectId: '', designation: '', ratingBand: '', tenureMaxYears: '' })
  const [rows, setRows] = useState([])
  const [devPlans, setDevPlans] = useState([])
  const [view, setView] = useState('department')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)

  useEffect(() => {
    (async () => {
      const [cs, { data: depts }, { data: projs }] = await Promise.all([
        listCycles(), supabase.from('departments').select('id,name').order('name'), supabase.from('projects').select('id,name').order('name'),
      ])
      setCycles(cs); setDepartments(depts || []); setProjects(projs || [])
      const active = cs.find(c => c.status !== 'Planning') || cs[0]
      setFilters(f => ({ ...f, cycleId: active?.id || '' }))
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!filters.cycleId) return
    (async () => {
      setLoadingRows(true)
      const data = await getDashboardRows({
        cycleId: filters.cycleId, departmentId: filters.departmentId || undefined, projectId: filters.projectId || undefined,
        designation: filters.designation || undefined, ratingBand: filters.ratingBand || undefined,
        tenureMaxYears: filters.tenureMaxYears ? Number(filters.tenureMaxYears) : undefined,
      })
      setRows(data)
      const ids = data.map(r => r.employee_id)
      const { data: plans } = ids.length
        ? await supabase.from('development_plans').select('*').eq('cycle_id', filters.cycleId).in('employee_id', ids)
        : { data: [] }
      setDevPlans(plans || [])
      setLoadingRows(false)
    })()
  }, [filters])

  const designations = useMemo(() => [...new Set(rows.map(r => r.employee?.designation).filter(Boolean))], [rows])
  const searchedRows = useMemo(() => search ? rows.filter(r => r.employee?.full_name?.toLowerCase().includes(search.toLowerCase())) : rows, [rows, search])

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#0891b2,#155e75)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <LineChartIcon size={19} />
            </span>
            Performance Dashboard
          </div>
          <div className="page-subtitle">Department-wise and employee-wise, filtered every way that matters</div>
        </div>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-select" style={{ width: 200 }} value={filters.cycleId} onChange={e => setFilters(f => ({ ...f, cycleId: e.target.value }))}>
          <option value="">Select cycle…</option>{cycles.map(c => <option key={c.id} value={c.id}>{c.cycle_name}</option>)}
        </select>
        <select className="form-select" style={{ width: 170 }} value={filters.departmentId} onChange={e => setFilters(f => ({ ...f, departmentId: e.target.value }))}>
          <option value="">All Departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 170 }} value={filters.projectId} onChange={e => setFilters(f => ({ ...f, projectId: e.target.value }))}>
          <option value="">All Projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 160 }} value={filters.designation} onChange={e => setFilters(f => ({ ...f, designation: e.target.value }))}>
          <option value="">All Designations</option>{designations.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="form-select" style={{ width: 170 }} value={filters.ratingBand} onChange={e => setFilters(f => ({ ...f, ratingBand: e.target.value }))}>
          <option value="">All Rating Bands</option>{RATING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="form-select" style={{ width: 170 }} value={filters.tenureMaxYears} onChange={e => setFilters(f => ({ ...f, tenureMaxYears: e.target.value }))}>
          <option value="">Any Tenure</option>
          <option value="1">First year</option>
          <option value="2">First 2 years</option>
          <option value="5">First 5 years</option>
        </select>
      </div>

      {!filters.cycleId ? (
        <Empty icon={<LineChartIcon size={40} />} title="Select a cycle" desc="Pick a cycle above to see the dashboard" />
      ) : loadingRows ? <Loader /> : rows.length === 0 ? (
        <Empty icon={<Users size={40} />} title="No scored employees match these filters" desc="Scores are computed once a manager review is submitted or a final rating is set." />
      ) : (
        <>
          <Tabs tabs={[{ id: 'department', label: 'Department-wise' }, { id: 'employee', label: 'Employee-wise' }]} active={view} onChange={setView} />
          {view === 'department'
            ? <DepartmentView rows={rows} devPlans={devPlans} />
            : <EmployeeView rows={searchedRows} search={search} setSearch={setSearch} />}
        </>
      )}
    </div>
  )
}

function DepartmentView({ rows, devPlans }) {
  const byDept = useMemo(() => {
    const map = new Map()
    rows.forEach(r => {
      const key = r.employee?.dept?.name || 'Unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    })
    return [...map.entries()].map(([name, group]) => ({
      name,
      avgComposite: Math.round((group.reduce((s, r) => s + (Number(r.composite_score) || 0), 0) / group.length) * 10) / 10,
      avgUtilization: Math.round((group.reduce((s, r) => s + (Number(r.utilization_percent) || 0), 0) / group.length) * 10) / 10,
      count: group.length,
      needsImprovement: group.filter(r => ['Unsatisfactory', 'Needs Improvement'].includes(r.final_rating)).length,
      ratingCounts: RATING_BANDS.map(b => ({ band: b, count: group.filter(r => r.final_rating === b).length })),
    }))
  }, [rows])

  const topPerformers = [...rows].sort((a, b) => b.composite_score - a.composite_score).slice(0, 5)
  const needsImprovement = rows.filter(r => ['Unsatisfactory', 'Needs Improvement'].includes(r.final_rating)).sort((a, b) => a.composite_score - b.composite_score)
  const themes = summarizeImprovementThemes(devPlans).slice(0, 8)
  const lowUtilLowScore = byDept.filter(d => d.avgUtilization < 60 && d.avgComposite < 60)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Employees Scored" value={rows.length} icon={<Users size={17} />} accent="#0891b2" />
        <StatCard label="Avg Composite Score" value={Math.round((rows.reduce((s, r) => s + (Number(r.composite_score) || 0), 0) / rows.length) * 10) / 10} icon={<TrendingUp size={17} />} accent="#15803d" />
        <StatCard label="Needs Improvement" value={needsImprovement.length} icon={<TrendingDown size={17} />} accent="#dc2626" />
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Average Composite Score by Department</div>
      <div style={{ height: 240, marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byDept} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 100]} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="avgComposite" name="Avg Composite Score" fill="#0891b2" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {lowUtilLowScore.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', marginBottom: 20, fontSize: 12, color: '#92400e' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div><strong>{lowUtilLowScore.map(d => d.name).join(', ')}</strong> {lowUtilLowScore.length > 1 ? 'have' : 'has'} both low average utilization and low performance scores — worth checking whether resourcing (not just individual performance) is the underlying issue.</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Top Performers</div>
          <div className="table-wrap">
            <table><tbody>
              {topPerformers.map(r => (
                <tr key={r.id}><td className="td-bold" style={{ fontSize: 12 }}>{r.employee?.full_name}</td><td style={{ fontSize: 12 }}>{r.employee?.dept?.name}</td><td style={{ fontSize: 12, fontWeight: 700 }}>{r.composite_score}</td></tr>
              ))}
            </tbody></table>
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Needs Improvement</div>
          {needsImprovement.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>None flagged.</div> : (
            <div className="table-wrap">
              <table><tbody>
                {needsImprovement.slice(0, 8).map(r => (
                  <tr key={r.id}><td className="td-bold" style={{ fontSize: 12 }}>{r.employee?.full_name}</td><td><RatingPill rating={r.final_rating} /></td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
      </div>

      {themes.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Aggregated Improvement Themes</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {themes.map(t => <span key={t.theme} className="badge">{t.theme} · {t.count}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

function EmployeeView({ rows, search, setSearch }) {
  return (
    <div>
      <div style={{ marginBottom: 14, maxWidth: 320 }}><SearchBox value={search} onChange={setSearch} placeholder="Search employee…" /></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Department</th><th>Designation</th><th>Goal Achievement</th><th>Utilization %</th><th>Final Rating</th><th>Composite Score</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="td-bold" style={{ fontSize: 12 }}>{r.employee?.full_name}</td>
                <td style={{ fontSize: 12 }}>{r.employee?.dept?.name || '—'}</td>
                <td style={{ fontSize: 12 }}>{r.employee?.designation || '—'}</td>
                <td style={{ fontSize: 12 }}>{r.goal_achievement_score}</td>
                <td style={{ fontSize: 12 }}>{r.utilization_percent}%</td>
                <td><RatingPill rating={r.final_rating} /></td>
                <td style={{ fontSize: 12, fontWeight: 700 }}>{r.composite_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, rupee } from '../lib/supabase'
import {
  recomputeAllActive, getBenchBurnoutThresholds, saveBenchBurnoutThresholds,
  getSnapshotsForEmployee, getSnapshotsForWeek, weekStartOf,
} from '../lib/capacity'
import {
  getWorkingDays, saveWorkingDays, getEmployeeDaysMap, saveEmployeeDays, suggestLeaveTaken,
  getProjectAllocDaysMap, saveProjectAllocDays, getRatesData, dailyRateFor, getBudgetsByProject,
} from '../lib/capacityGrid'
import { exportAllocationChartExcel } from '../lib/capacityGridExport'
import { Loader, Empty, SearchBox, Modal } from '../components/ui'
import AllocationGantt from '../components/AllocationGantt'
import { RefreshCw, AlertTriangle, TrendingDown, ChevronLeft, ChevronRight, X, Wand2, FileSpreadsheet } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const cellInputStyle = { width: 60, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '4px 2px', border: '1px solid var(--border)', borderRadius: 6 }

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

  // ── Allocation Chart (monthly days grid) ──
  const today0 = new Date()
  const [gridYear, setGridYear] = useState(today0.getFullYear())
  const [gridMonth, setGridMonth] = useState(today0.getMonth() + 1)
  const [gridLoading, setGridLoading] = useState(false)
  const [gridSearch, setGridSearch] = useState('')
  const [workingDays, setWorkingDays] = useState(22)
  const [employeeDays, setEmployeeDays] = useState({}) // employee_id -> { leaveTaken, availableDays, overridden }
  const [projectAlloc, setProjectAlloc] = useState({}) // "empId:projId" -> { id, days }
  const [allProjects, setAllProjects] = useState([])
  const [pinnedProjectIds, setPinnedProjectIds] = useState([])
  const [rates, setRates] = useState({ roleRates: [], resourceRates: [] })
  const [budgetsByProject, setBudgetsByProject] = useState({})
  const [gridProjectFilter, setGridProjectFilter] = useState('')
  const [gridViewMode, setGridViewMode] = useState('resource') // resource | project
  const [exporting, setExporting] = useState(false)
  const [overrideModal, setOverrideModal] = useState(null) // { empId, projId, key, days, prevDays, empName, projName, availableDays, newTotal }
  const [overrideNote, setOverrideNote] = useState('')
  const prevProjectDaysRef = useRef({})

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
      supabase.from('profiles').select('id,full_name,department_id,designation').eq('is_active', true),
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

  useEffect(() => { if (tab === 'grid' && profiles.length) loadGrid() }, [tab, gridYear, gridMonth, profiles.length])

  // Budgets don't change per month, so fetch once whenever the visible
  // project list grows (not on every month/year switch).
  useEffect(() => {
    if (allProjects.length) getBudgetsByProject(allProjects.map(p => p.id)).then(setBudgetsByProject)
  }, [allProjects])

  async function loadGrid() {
    setGridLoading(true)
    const employeeIds = profiles.map(p => p.id)
    const designations = [...new Set(profiles.map(p => p.designation).filter(Boolean))]
    const [wd, edMap, paMap, ratesData, projRes] = await Promise.all([
      getWorkingDays(gridYear, gridMonth),
      getEmployeeDaysMap(gridYear, gridMonth),
      getProjectAllocDaysMap(gridYear, gridMonth, employeeIds),
      getRatesData(employeeIds, designations),
      allProjects.length ? Promise.resolve(null) : supabase.from('projects').select('id,name').order('name'),
    ])
    setWorkingDays(wd)
    const edState = {}
    for (const p of profiles) {
      const saved = edMap[p.id]
      if (saved) {
        const formulaAvail = wd - Number(saved.leave_taken)
        edState[p.id] = { leaveTaken: Number(saved.leave_taken), availableDays: Number(saved.available_days), overridden: Math.abs(Number(saved.available_days) - formulaAvail) > 0.001 }
      } else {
        edState[p.id] = { leaveTaken: 0, availableDays: wd, overridden: false }
      }
    }
    setEmployeeDays(edState)
    setProjectAlloc(paMap)
    setRates(ratesData)
    if (projRes?.data) setAllProjects(projRes.data)
    setGridLoading(false)
  }

  function handleWorkingDaysChange(val) {
    const wd = Number(val) || 0
    setWorkingDays(wd)
    setEmployeeDays(prev => {
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        if (!next[id].overridden) next[id] = { ...next[id], availableDays: Math.max(0, wd - Number(next[id].leaveTaken || 0)) }
      }
      return next
    })
  }

  async function handleWorkingDaysBlur() {
    await saveWorkingDays(gridYear, gridMonth, workingDays, profile.id)
    await Promise.all(Object.entries(employeeDays).filter(([, d]) => !d.overridden)
      .map(([id, d]) => saveEmployeeDays(id, gridYear, gridMonth, { leaveTaken: d.leaveTaken, availableDays: d.availableDays }, profile.id)))
  }

  function updateLeaveTaken(empId, val) {
    setEmployeeDays(prev => {
      const cur = prev[empId] || { leaveTaken: 0, availableDays: workingDays, overridden: false }
      const leaveTaken = val
      const availableDays = cur.overridden ? cur.availableDays : Math.max(0, workingDays - Number(val || 0))
      return { ...prev, [empId]: { ...cur, leaveTaken, availableDays } }
    })
  }

  function updateAvailableDays(empId, val) {
    setEmployeeDays(prev => ({ ...prev, [empId]: { ...(prev[empId] || { leaveTaken: 0 }), availableDays: val, overridden: true } }))
  }

  async function blurEmployeeDays(empId) {
    const d = employeeDays[empId]
    if (!d) return
    await saveEmployeeDays(empId, gridYear, gridMonth, { leaveTaken: Number(d.leaveTaken) || 0, availableDays: Number(d.availableDays) || 0 }, profile.id)
  }

  async function autofillLeave(empId) {
    const days = await suggestLeaveTaken(empId, gridYear, gridMonth)
    const availableDays = Math.max(0, workingDays - days)
    setEmployeeDays(prev => ({ ...prev, [empId]: { leaveTaken: days, availableDays, overridden: false } }))
    await saveEmployeeDays(empId, gridYear, gridMonth, { leaveTaken: days, availableDays }, profile.id)
  }

  function updateProjectDays(empId, projId, val) {
    const key = `${empId}:${projId}`
    if (!(key in prevProjectDaysRef.current)) prevProjectDaysRef.current[key] = Number(projectAlloc[key]?.days) || 0
    setProjectAlloc(prev => ({ ...prev, [key]: { ...(prev[key] || {}), days: val } }))
  }

  async function commitProjectDays(empId, projId, key, days, existingRowId, note) {
    const newId = await saveProjectAllocDays({ existingRowId: existingRowId || null, employeeId: empId, projectId: projId, year: gridYear, month: gridMonth, days, userId: profile.id, note })
    setProjectAlloc(prev => ({ ...prev, [key]: { id: newId, days } }))
  }

  // Allocating this project's days would push the resource's Total above
  // their Available Days for the month — allowed, but only with a
  // justification note (stored on the project_resource_alloc row itself),
  // so a manager reviewing the grid later can see WHY someone's over-booked
  // instead of just seeing a red Variance number with no context.
  async function blurProjectDays(empId, projId) {
    const key = `${empId}:${projId}`
    const cell = projectAlloc[key]
    const days = Number(cell?.days) || 0
    const prevDays = key in prevProjectDaysRef.current ? prevProjectDaysRef.current[key] : days
    delete prevProjectDaysRef.current[key]
    if (days === prevDays) return

    const availableDays = Number(employeeDays[empId]?.availableDays) || 0
    const newTotal = visibleProjectIds.reduce((s, pid) => {
      const k = `${empId}:${pid}`
      return s + (k === key ? days : Number(projectAlloc[k]?.days) || 0)
    }, 0)

    if (newTotal > availableDays) {
      const emp = profiles.find(p => p.id === empId)
      setOverrideNote('')
      setOverrideModal({ empId, projId, key, days, prevDays, existingRowId: cell?.id || null, availableDays, newTotal, empName: emp?.full_name || '', projName: projectMap[projId]?.name || '' })
      return
    }
    await commitProjectDays(empId, projId, key, days, cell?.id)
  }

  async function confirmOverride() {
    if (!overrideModal || !overrideNote.trim()) return
    const { empId, projId, key, days, existingRowId } = overrideModal
    await commitProjectDays(empId, projId, key, days, existingRowId, overrideNote.trim())
    setOverrideModal(null); setOverrideNote('')
  }

  function cancelOverride() {
    if (!overrideModal) return
    const { key, prevDays } = overrideModal
    setProjectAlloc(prev => ({ ...prev, [key]: { ...(prev[key] || {}), days: prevDays } }))
    setOverrideModal(null); setOverrideNote('')
  }

  function addProjectColumn(projId) {
    if (!projId || pinnedProjectIds.includes(projId)) return
    setPinnedProjectIds(prev => [...prev, projId])
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

  const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]))
  const idsWithGridData = new Set(Object.keys(projectAlloc).filter(k => Number(projectAlloc[k]?.days) > 0).map(k => k.split(':')[1]))
  const visibleProjectIds = [...new Set([...idsWithGridData, ...pinnedProjectIds])]
  const addableProjects = allProjects.filter(p => !visibleProjectIds.includes(p.id))

  const gridEmployees = profiles
    .filter(p => !gridSearch || p.full_name?.toLowerCase().includes(gridSearch.toLowerCase()))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))

  function gridRowFor(emp) {
    const d = employeeDays[emp.id] || { leaveTaken: 0, availableDays: workingDays, overridden: false }
    const projectDays = visibleProjectIds.map(pid => Number(projectAlloc[`${emp.id}:${pid}`]?.days) || 0)
    const total = projectDays.reduce((s, n) => s + n, 0)
    const availableDays = Number(d.availableDays) || 0
    const variance = Math.round((total - availableDays) * 100) / 100
    const dailyRate = dailyRateFor(emp, rates.roleRates, rates.resourceRates)
    const projectCosts = projectDays.map(days => Math.round(days * dailyRate * 100) / 100)
    const cost = Math.round(total * dailyRate * 100) / 100
    // Utilized % = how much of this person's available days this month are
    // actually booked to a project; Available % is the free capacity left
    // (0 once they're fully booked or over-allocated, never negative).
    const utilizedPct = availableDays > 0 ? Math.round((total / availableDays) * 10000) / 100 : (total > 0 ? 100 : 0)
    const availablePct = Math.max(0, Math.round((100 - utilizedPct) * 100) / 100)
    return { emp, leaveTaken: d.leaveTaken, availableDays: d.availableDays, projectDays, projectCosts, total, variance, cost, dailyRate, utilizedPct, availablePct }
  }

  const gridRows = gridEmployees.map(gridRowFor)
  const gridTotals = gridRows.reduce((acc, r) => {
    acc.leaveTaken += Number(r.leaveTaken) || 0
    acc.availableDays += Number(r.availableDays) || 0
    acc.projectDays = acc.projectDays.length ? acc.projectDays.map((v, i) => v + r.projectDays[i]) : [...r.projectDays]
    acc.total += r.total
    acc.variance += r.variance
    acc.cost += r.cost
    return acc
  }, { leaveTaken: 0, availableDays: 0, projectDays: [], total: 0, variance: 0, cost: 0 })

  // PMO/client-facing rollup — one row per project instead of per resource.
  const projectSummaryRows = visibleProjectIds.map((pid, i) => {
    const onProject = gridRows.filter(r => r.projectDays[i] > 0)
    const totalDays = Math.round(onProject.reduce((s, r) => s + r.projectDays[i], 0) * 100) / 100
    const cost = Math.round(onProject.reduce((s, r) => s + r.projectCosts[i], 0) * 100) / 100
    const budget = budgetsByProject[pid] || 0
    return { id: pid, name: projectMap[pid]?.name || '—', headcount: onProject.length, totalDays, cost, budget, pctUsed: budget > 0 ? Math.round((cost / budget) * 10000) / 100 : null }
  })

  const orgKpis = {
    headcount: gridRows.length,
    totalDays: Math.round(gridTotals.total * 100) / 100,
    availableDays: Math.round(gridTotals.availableDays * 100) / 100,
    utilization: gridTotals.availableDays > 0 ? Math.round((gridTotals.total / gridTotals.availableDays) * 10000) / 100 : 0,
    cost: Math.round(gridTotals.cost * 100) / 100,
  }
  const filteredProjectKpi = gridProjectFilter ? projectSummaryRows.find(p => p.id === gridProjectFilter) : null
  const monthLabel = `${MONTH_NAMES[gridMonth - 1]} ${gridYear}`

  async function handleExportExcel() {
    setExporting(true)
    try {
      await exportAllocationChartExcel({ monthLabel, workingDays, gridRows, visibleProjectIds, projectMap, projectSummaryRows, orgKpis })
    } catch (e) { alert(e.message) }
    finally { setExporting(false) }
  }

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
          ...(canManage ? [{ id: 'grid', label: 'Allocation Chart' }] : []),
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

      {tab === 'grid' && canManage && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Month</label>
              <select className="form-select" value={gridMonth} onChange={e => setGridMonth(Number(e.target.value))} style={{ width: 'auto' }}>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Year</label>
              <input className="form-input" type="number" value={gridYear} onChange={e => setGridYear(Number(e.target.value))} style={{ width: 90 }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Working Days</label>
              <input className="form-input" type="number" min={0} max={31} value={workingDays}
                onChange={e => handleWorkingDaysChange(e.target.value)} onBlur={handleWorkingDaysBlur} style={{ width: 90 }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Cost KPI for</label>
              <select className="form-select" value={gridProjectFilter} onChange={e => setGridProjectFilter(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All Projects</option>
                {visibleProjectIds.map(pid => <option key={pid} value={pid}>{projectMap[pid]?.name || '—'}</option>)}
              </select>
            </div>
            <button className="btn btn-outline" onClick={handleExportExcel} disabled={exporting || gridRows.length === 0} style={{ marginLeft: 'auto' }}>
              <FileSpreadsheet size={14} /> {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 16 }}>
            {filteredProjectKpi ? (
              <>
                <Kpi label={`${filteredProjectKpi.name} — Resources`} value={filteredProjectKpi.headcount} color="#6366f1" />
                <Kpi label="Days Allocated" value={filteredProjectKpi.totalDays} color="#3b82f6" />
                <Kpi label="Cost This Month" value={rupee(filteredProjectKpi.cost)} color="#f59e0b" />
                {filteredProjectKpi.budget > 0
                  ? <Kpi label="% of Project Budget" value={`${filteredProjectKpi.pctUsed}%`} color={filteredProjectKpi.pctUsed > 100 ? '#ef4444' : '#10b981'} />
                  : <Kpi label="Budget" value="Not set" color="#94a3b8" />}
              </>
            ) : (
              <>
                <Kpi label="Resources Allocated" value={orgKpis.headcount} color="#6366f1" />
                <Kpi label="Total Days Allocated" value={orgKpis.totalDays} color="#3b82f6" />
                <Kpi label="Utilization" value={`${orgKpis.utilization}%`} color={orgKpis.utilization > 100 ? '#ef4444' : '#10b981'} />
                <Kpi label="Total Cost This Month" value={rupee(orgKpis.cost)} color="#f59e0b" />
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[{ id: 'resource', label: 'By Resource' }, { id: 'project', label: 'Project Summary (PMO View)' }].map(v => (
              <button key={v.id} className={`btn btn-sm ${gridViewMode === v.id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setGridViewMode(v.id)}>{v.label}</button>
            ))}
            {gridViewMode === 'resource' && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <SearchBox value={gridSearch} onChange={setGridSearch} placeholder="Search resource…" />
                {addableProjects.length > 0 && (
                  <select className="form-select" value="" onChange={e => addProjectColumn(e.target.value)} style={{ width: 'auto' }}>
                    <option value="">+ Add project column…</option>
                    {addableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>

          {gridLoading ? <Loader /> : gridViewMode === 'project' ? (
            projectSummaryRows.length === 0 ? <Empty icon="📊" title="No project allocations yet" desc="Enter days in the By Resource view first" /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Resources</th><th>Total Days</th><th>Cost</th><th>Budget</th><th>% Budget Used</th></tr></thead>
                  <tbody>
                    {projectSummaryRows.map(p => (
                      <tr key={p.id}>
                        <td className="td-bold">{p.name}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{p.headcount}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{p.totalDays}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{rupee(p.cost)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{p.budget > 0 ? rupee(p.budget) : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: p.pctUsed == null ? 'var(--text-muted)' : p.pctUsed > 100 ? '#ef4444' : p.pctUsed > 80 ? '#f59e0b' : '#10b981' }}>
                          {p.pctUsed == null ? '—' : `${p.pctUsed}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 800, borderTop: '2px solid var(--border)' }}>
                      <td>Total</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{orgKpis.headcount}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{orgKpis.totalDays}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{rupee(orgKpis.cost)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          ) : gridRows.length === 0 ? (
            <Empty icon="🗓️" title="No resources" desc="No active employees match this search" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Leave Taken</th>
                    <th>Available Days</th>
                    {visibleProjectIds.map(pid => (
                      <th key={pid} style={{ textAlign: 'center' }}>
                        {projectMap[pid]?.name || '—'}
                        {pinnedProjectIds.includes(pid) && !idsWithGridData.has(pid) && (
                          <button type="button" title="Remove empty column" onClick={() => setPinnedProjectIds(prev => prev.filter(id => id !== pid))}
                            style={{ marginLeft: 4, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={11} /></button>
                        )}
                      </th>
                    ))}
                    <th>Total</th>
                    <th>Variance</th>
                    <th title="Booked days ÷ Available Days — how effectively this resource is being used">Utilized %</th>
                    <th title="Free capacity left this month (0 once fully booked or over-allocated)">Available %</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {gridRows.map(r => {
                    const utilColor = r.utilizedPct > thresholds.burnoutPct ? '#ef4444' : r.utilizedPct < thresholds.benchPct ? '#f59e0b' : '#10b981'
                    return (
                    <tr key={r.emp.id}>
                      <td className="td-bold">{r.emp.full_name}</td>
                      <td style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" style={cellInputStyle} value={r.leaveTaken}
                          onChange={e => updateLeaveTaken(r.emp.id, e.target.value)} onBlur={() => blurEmployeeDays(r.emp.id)} />
                        <button type="button" title="Suggest from approved leave records" onClick={() => autofillLeave(r.emp.id)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--c1)' }}><Wand2 size={13} /></button>
                      </td>
                      <td>
                        <input type="number" style={cellInputStyle} value={r.availableDays}
                          onChange={e => updateAvailableDays(r.emp.id, e.target.value)} onBlur={() => blurEmployeeDays(r.emp.id)} />
                      </td>
                      {visibleProjectIds.map((pid, i) => (
                        <td key={pid}>
                          <input type="number" style={cellInputStyle} value={r.projectDays[i]}
                            onChange={e => updateProjectDays(r.emp.id, pid, e.target.value)} onBlur={() => blurProjectDays(r.emp.id, pid)} />
                        </td>
                      ))}
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.total}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.variance < 0 ? '#ef4444' : r.variance > 0 ? '#f59e0b' : '#10b981' }}>{r.variance}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: utilColor }}>{r.utilizedPct}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: r.availablePct > 0 ? '#10b981' : 'var(--text-muted)' }}>{r.availablePct}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{rupee(r.cost)}</td>
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 800, borderTop: '2px solid var(--border)' }}>
                    <td>Total</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(gridTotals.leaveTaken * 100) / 100}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(gridTotals.availableDays * 100) / 100}</td>
                    {gridTotals.projectDays.map((v, i) => <td key={i} style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(v * 100) / 100}</td>)}
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(gridTotals.total * 100) / 100}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(gridTotals.variance * 100) / 100}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{orgKpis.utilization}%</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{Math.max(0, Math.round((100 - orgKpis.utilization) * 100) / 100)}%</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{rupee(gridTotals.cost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal open={!!overrideModal} onClose={cancelOverride} title="Over-allocation — justification required"
        footer={<>
          <button className="btn btn-ghost" onClick={cancelOverride}>Cancel</button>
          <button className="btn btn-primary" disabled={!overrideNote.trim()} onClick={confirmOverride}>Save Anyway</button>
        </>}>
        {overrideModal && (
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ marginBottom: 12 }}>
              Setting <strong>{overrideModal.projName}</strong> to <strong>{overrideModal.days}</strong> day(s) for <strong>{overrideModal.empName}</strong> brings
              their total to <strong>{overrideModal.newTotal}</strong> days, above their <strong>{overrideModal.availableDays}</strong> Available Days this month.
            </div>
            <div className="form-group">
              <label className="form-label">Reason for over-allocating *</label>
              <textarea className="form-textarea" value={overrideNote} onChange={e => setOverrideNote(e.target.value)} style={{ minHeight: 70 }} placeholder="e.g. temporary crunch, approved overtime…" autoFocus />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

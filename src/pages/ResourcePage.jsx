import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Modal, Loader, Empty, SearchBox, StatCard } from '../components/ui'
import { Clock, LogIn, LogOut, Plus, Edit2, Users, Briefcase, DollarSign, AlertCircle, BarChart2, Download, CalendarCheck, Timer, AlarmClock, UserCheck, ArrowUpDown } from 'lucide-react'
import { exportCheckinReportExcel } from '../lib/checkinReportExport'
import { computeCheckinKpis, fmtMinutes } from '../lib/checkinKpi'
import { getWorkPlan, nextWorkingDay, PLAN_STATUS } from '../lib/resourcePlanning'
import { useNavigate } from 'react-router-dom'

const YEAR = new Date().getFullYear()
const MONTH = new Date().getMonth() + 1
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const TODAY = new Date().toISOString().split('T')[0]
const LOCAL_TODAY = (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date())

function timeDiff(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const diff = (new Date(checkOut) - new Date(checkIn)) / 3600000
  return Math.round(diff * 100) / 100
}

function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function ResourcePage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isManager = ['admin','ceo','manager','hr','department_head','finance'].includes(role)

  const [tab, setTab] = useState('checkin')
  const [timelogs, setTimelogs] = useState([])
  const [allLogs, setAllLogs] = useState([])
  const [projects, setProjects] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [rates, setRates] = useState([])
  const [leaveData, setLeaveData] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeLog, setActiveLog] = useState(null) // currently checked-in log
  const [checkInForm, setCheckInForm] = useState({ project_id: '', comment: '' })
  const [checkOutComment, setCheckOutComment] = useState('')
  const [showRateModal, setShowRateModal] = useState(false)
  const [rateForm, setRateForm] = useState({ employee_id: '', monthly_salary: '', hourly_rate: '' })
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState(MONTH)
  const [submitting, setSub] = useState(false)
  const [err, setErr] = useState('')

  // ── Check-In Report (date-range attendance report, Resource Management) ──
  const [reportFrom, setReportFrom] = useState(TODAY)
  const [reportTo, setReportTo] = useState(TODAY)
  const [reportDept, setReportDept] = useState('') // '' = all departments
  const [reportEmp, setReportEmp] = useState('')   // '' = all resources
  const [reportStatus, setReportStatus] = useState('') // '' = all, 'in' = still checked in, 'out' = checked out
  const [reportLogs, setReportLogs] = useState([])
  const [reportLeaves, setReportLeaves] = useState([])
  const [reportView, setReportView] = useState('kpi') // 'kpi' = per-resource KPIs, 'logs' = raw entries
  const [lateAfter, setLateAfter] = useState('10:00')
  const [targetHours, setTargetHours] = useState(8)
  const [kpiSort, setKpiSort] = useState({ key: 'attendancePct', dir: 'desc' })
  const [reportLoading, setReportLoading] = useState(false)

  // ── Work Planning (who has nothing scheduled for a given day) ──
  const navigate = useNavigate()
  const [planDay, setPlanDay] = useState(nextWorkingDay())
  const [planDept, setPlanDept] = useState('')
  const [planFilter, setPlanFilter] = useState('attention') // 'attention' | 'all'
  const [planTarget, setPlanTarget] = useState(8)
  const [plan, setPlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planOpen, setPlanOpen] = useState(null) // expanded resource id
  const [exporting, setExporting] = useState(false)

  useEffect(() => { loadAll() }, [role])

  async function loadAll() {
    setLoading(true)
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(filterMonth).padStart(2,'0')}-01`
    const monthEnd = new Date(now.getFullYear(), filterMonth, 0).toISOString().split('T')[0]

    const queries = [
      supabase.from('time_logs').select('*, project:projects(name,code), employee:profiles!employee_id(full_name, role)').eq('employee_id', profile.id).order('check_in', { ascending: false }),
      supabase.from('projects').select('id, name, code').eq('status', 'active').order('name'),
    ]

    if (isManager) {
      queries.push(
        supabase.from('time_logs').select('*, project:projects(name,code), employee:profiles!employee_id(full_name, role, email, department_id)').gte('work_date', monthStart).lte('work_date', monthEnd).order('check_in', { ascending: false }),
        supabase.from('profiles').select('id, full_name, role, email, department_id, is_active').order('full_name'),
        supabase.from('resource_rates').select('*, employee:profiles!employee_id(full_name)'),
        supabase.from('leave_requests').select('employee_id, leave_type, from_date, to_date, permission_hours, status').eq('status', 'approved').gte('from_date', monthStart).lte('to_date', monthEnd),
        supabase.from('departments').select('id, name').order('name'),
      )
    }

    const res = await Promise.all(queries)
    const myLogs = res[0].data || []
    setTimelogs(myLogs)
    setProjects(res[1].data || [])

    // Find active (checked-in but not checked-out) log
    const active = myLogs.find(l => !l.check_out)
    setActiveLog(active || null)

    if (isManager) {
      setAllLogs(res[2].data || [])
      setEmployees(res[3].data || [])
      setRates(res[4].data || [])
      setLeaveData(res[5].data || [])
      setDepartments(res[6].data || [])
    }
    setLoading(false)
  }

  // ── Check-In Report — its own date-range fetch, independent of the
  // month picker the other manager tabs use, since this report is meant
  // to be pulled for any arbitrary day or range (e.g. "yesterday morning
  // to this morning"), not just the current calendar month.
  async function loadCheckinReport() {
    if (!isManager) return
    setReportLoading(true)
    const [{ data, error }, { data: leaves }] = await Promise.all([
      supabase.from('time_logs')
        .select('*, project:projects(name,code), employee:profiles!employee_id(full_name, role, department_id)')
        .gte('work_date', reportFrom).lte('work_date', reportTo)
        .order('work_date', { ascending: false }).order('check_in', { ascending: true }),
      // Approved leave overlapping the range — excluded from expected attendance days.
      supabase.from('leave_requests').select('employee_id, leave_type, from_date, to_date')
        .eq('status', 'approved').lte('from_date', reportTo)
        .or(`to_date.gte.${reportFrom},and(to_date.is.null,from_date.gte.${reportFrom})`),
    ])
    if (error) alert(error.message)
    setReportLogs(data || [])
    setReportLeaves(leaves || [])
    setReportLoading(false)
  }

  useEffect(() => { if (tab === 'checkin-report' && isManager) loadCheckinReport() }, [tab, reportFrom, reportTo])

  const filteredReportLogs = reportLogs.filter(l => {
    if (reportDept && l.employee?.department_id !== reportDept) return false
    if (reportEmp && l.employee_id !== reportEmp) return false
    if (reportStatus === 'in' && l.check_out) return false
    if (reportStatus === 'out' && !l.check_out) return false
    return true
  })

  async function loadWorkPlan() {
    if (!isManager) return
    setPlanLoading(true)
    try {
      setPlan(await getWorkPlan({
        organizationId: profile.organization_id, day: planDay,
        employees: employees.filter(e => e.is_active !== false),
        targetHours: Number(planTarget) || 8,
      }))
    } catch (e) { alert(e.message) }
    finally { setPlanLoading(false) }
  }
  useEffect(() => { if (tab === 'planning' && isManager && employees.length) loadWorkPlan() }, [tab, planDay, planTarget, employees])

  const planRows = (plan?.rows || []).filter(r =>
    (!planDept || r.department_id === planDept) &&
    (planFilter === 'all' || ['none', 'carryover', 'under'].includes(r.status)))
    .sort((a, b) => ['none', 'carryover', 'under', 'planned', 'leave'].indexOf(a.status) - ['none', 'carryover', 'under', 'planned', 'leave'].indexOf(b.status) || (a.name || '').localeCompare(b.name || ''))
  const planSummary = (() => {
    const rows = (plan?.rows || []).filter(r => !planDept || r.department_id === planDept)
    const c = s => rows.filter(r => r.status === s).length
    return { resources: rows.length, none: c('none'), carryover: c('carryover'), under: c('under'), planned: c('planned'), leave: c('leave') }
  })()
  const planDayLabel = planDay === LOCAL_TODAY ? 'Today' : planDay === nextWorkingDay() ? 'Next working day' : dateFmt(planDay)

  // ── Per-resource KPIs — every active resource matching the dept/resource
  // filters, including ones with zero check-ins (they're the absentees).
  // The status filter only applies to the raw log view.
  const kpiEmployees = employees.filter(e =>
    e.is_active !== false &&
    (!reportDept || e.department_id === reportDept) &&
    (!reportEmp || e.id === reportEmp))
  const kpiEmpIds = new Set(kpiEmployees.map(e => e.id))
  const kpi = computeCheckinKpis({
    logs: reportLogs.filter(l => kpiEmpIds.has(l.employee_id)),
    employees: kpiEmployees, leaves: reportLeaves,
    fromDate: reportFrom, toDate: reportTo, lateAfter, targetHours: Number(targetHours) || 8,
  })
  const kpiRows = [...kpi.rows].sort((a, b) => {
    const av = a[kpiSort.key], bv = b[kpiSort.key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return kpiSort.dir === 'asc' ? cmp : -cmp
  })
  const toggleSort = key => setKpiSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))

  async function handleExportCheckinReport() {
    setExporting(true)
    try { await exportCheckinReportExcel({ logs: filteredReportLogs, departments, fromDate: reportFrom, toDate: reportTo, kpiRows, lateAfter, targetHours: Number(targetHours) || 8 }) }
    catch (e) { alert(e.message) }
    finally { setExporting(false) }
  }

  async function handleCheckIn(e) {
    e.preventDefault(); setSub(true); setErr('')
    try {
      if (activeLog) throw new Error('You already have an active check-in. Please check out first.')
      const { error } = await supabase.from('time_logs').insert({
        employee_id: profile.id,
        project_id: checkInForm.project_id || null,
        check_in: new Date().toISOString(),
        work_date: TODAY,
        comment: checkInForm.comment || null,
      })
      if (error) throw error
      setCheckInForm({ project_id: '', comment: '' })
      loadAll()
    } catch (e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function handleCheckOut() {
    if (!activeLog) return
    setSub(true)
    try {
      const now = new Date().toISOString()
      const hrs = timeDiff(activeLog.check_in, now)
      const { error } = await supabase.from('time_logs').update({
        check_out: now, hours_worked: hrs,
        comment: checkOutComment || activeLog.comment,
      }).eq('id', activeLog.id)
      if (error) throw error
      setCheckOutComment(''); loadAll()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  async function saveRate(e) {
    e.preventDefault(); setSub(true)
    try {
      const payload = {
        employee_id: rateForm.employee_id,
        monthly_salary: parseFloat(rateForm.monthly_salary) || 0,
        hourly_rate: rateForm.hourly_rate ? parseFloat(rateForm.hourly_rate) : parseFloat(rateForm.monthly_salary) / (22 * 8) || 0,
        created_by: profile.id,
      }
      const { error } = await supabase.from('resource_rates').upsert(payload, { onConflict: 'employee_id' })
      if (error) throw error
      setShowRateModal(false); loadAll()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  // Calculate payroll for a month
  function calcPayroll(empId) {
    const rate = rates.find(r => r.employee_id === empId)
    if (!rate) return null
    const monthlyHours = 22 * 8  // working hours in month
    const hrRate = rate.hourly_rate || (rate.monthly_salary / monthlyHours)

    // Hours worked
    const empLogs = allLogs.filter(l => l.employee_id === empId)
    const hoursWorked = empLogs.reduce((s, l) => s + (l.hours_worked || 0), 0)

    // Leave deductions
    const empLeaves = leaveData.filter(l => l.employee_id === empId)
    const leaveDays = empLeaves.reduce((s, l) => {
      if (l.leave_type === 'permission') return s  // hours handled separately
      const d = Math.ceil((new Date(l.to_date || l.from_date) - new Date(l.from_date)) / 86400000) + 1
      return s + d
    }, 0)
    const leaveHours = empLeaves.reduce((s, l) => s + (l.permission_hours || 0), 0)
    const totalLeaveHours = leaveDays * 8 + leaveHours

    // Salary calc
    const earnedSalary = Math.min(hoursWorked, monthlyHours - totalLeaveHours) * hrRate
    const leaveDed = totalLeaveHours * hrRate
    const netSalary = rate.monthly_salary - leaveDed

    return { hoursWorked, leaveDays, leaveHours: totalLeaveHours, hrRate, earnedSalary: Math.max(0, netSalary), leaveDed }
  }

  // Employee summary for manager view
  const empSummary = isManager ? employees.map(emp => {
    const empLogs = allLogs.filter(l => l.employee_id === emp.id)
    const totalHours = empLogs.reduce((s, l) => s + (l.hours_worked || 0), 0)
    const isCheckedIn = allLogs.find(l => l.employee_id === emp.id && !l.check_out)
    const payroll = calcPayroll(emp.id)
    const rate = rates.find(r => r.employee_id === emp.id)
    return { ...emp, totalHours, isCheckedIn: !!isCheckedIn, payroll, monthlyRate: rate?.monthly_salary }
  }) : []

  const filteredLogs = allLogs.filter(l =>
    !search || l.employee?.full_name?.toLowerCase().includes(search.toLowerCase()) || l.project?.name?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <Loader />

  // Active check-in banner
  const ActiveBanner = () => activeLog ? (
    <div style={{ background: 'linear-gradient(135deg,#059669,#34d399)', borderRadius: 14, padding: '16px 20px', marginBottom: 20, color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>🟢 Checked In</div>
          <div style={{ opacity: .85, fontSize: 13 }}>
            Since {fmtTime(activeLog.check_in)} · {activeLog.project?.name || 'No project'}
          </div>
          {activeLog.comment && <div style={{ opacity: .75, fontSize: 12, marginTop: 2 }}>"{activeLog.comment}"</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={checkOutComment} onChange={e => setCheckOutComment(e.target.value)}
            placeholder="What did you do? (optional)" style={{ padding: '8px 12px', borderRadius: 8, border: 'none', fontSize: 13, width: 220, outline: 'none' }} />
          <button onClick={handleCheckOut} disabled={submitting}
            style={{ padding: '8px 18px', borderRadius: 10, background: '#fff', color: '#059669', fontWeight: 800, border: 'none', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <LogOut size={14} /> Check Out
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Resource Management</div>
          <div className="page-subtitle">Time tracking, attendance and payroll overview</div>
        </div>
        {isManager && (
          <button className="btn btn-primary" onClick={() => setShowRateModal(true)}>
            <DollarSign size={14} /> Set Resource Rate
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'checkin', label: '⏱ My Time Log' },
          ...(isManager ? [
            { id: 'team', label: '👥 Team Overview' },
            { id: 'checkin-report', label: '📅 Check-In Report' },
            { id: 'planning', label: '🗓 Work Planning' },
            { id: 'logs', label: '📋 All Logs' },
            { id: 'payroll', label: '💰 Payroll Summary' },
          ] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
              background: tab === t.id ? '#6366f1' : '#f1f5f9', color: tab === t.id ? '#fff' : '#475569' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── MY TIME LOG ── */}
      {tab === 'checkin' && (
        <div>
          <ActiveBanner />

          {/* Check-in form */}
          {!activeLog && (
            <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', padding: '20px', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <LogIn size={18} style={{ color: '#6366f1' }} /> Check In
              </div>
              {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Project (optional)</label>
                  <select className="form-select" value={checkInForm.project_id} onChange={e => setCheckInForm(f => ({ ...f, project_id: e.target.value }))}>
                    <option value="">No specific project</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">What will you work on?</label>
                  <input className="form-input" value={checkInForm.comment} onChange={e => setCheckInForm(f => ({ ...f, comment: e.target.value }))} placeholder="Brief description of today's task…" />
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleCheckIn} disabled={submitting} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <LogIn size={15} /> {submitting ? 'Checking in…' : 'Check In Now'}
              </button>
            </div>
          )}

          {/* My log table */}
          <div className="table-wrap">
            <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>My Time Logs</span></div>
            <table>
              <thead><tr><th>Date</th><th>Project</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Work Done</th></tr></thead>
              <tbody>
                {timelogs.length === 0
                  ? <tr><td colSpan={6}><Empty icon="⏱" title="No logs yet" desc="Start by checking in" /></td></tr>
                  : timelogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontSize: 12 }}>{dateFmt(log.work_date)}</td>
                      <td>
                        {log.project ? (
                          <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#ede9fe', color: '#6d28d9' }}>
                            {log.project.name}
                          </span>
                        ) : <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, color: '#059669', fontWeight: 700 }}>{fmtTime(log.check_in)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, color: log.check_out ? '#dc2626' : '#f59e0b', fontWeight: 700 }}>
                        {log.check_out ? fmtTime(log.check_out) : <span style={{ color: '#059669', fontSize: 11, fontWeight: 700 }}>🟢 Active</span>}
                      </td>
                      <td style={{ fontWeight: 800, color: '#6366f1' }}>{log.hours_worked != null ? `${log.hours_worked}h` : '—'}</td>
                      <td style={{ fontSize: 12, color: '#64748b', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.comment || '—'}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TEAM OVERVIEW ── */}
      {tab === 'team' && isManager && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {empSummary.map(emp => (
              <div key={emp.id} style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16 }}>
                      {emp.full_name?.[0]}
                    </div>
                    {emp.isCheckedIn && <div style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: '50%', background: '#10b981', border: '2px solid #fff' }} />}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.full_name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{emp.role}</div>
                  </div>
                  {emp.isCheckedIn && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: '#dcfce7', color: '#15803d' }}>LIVE</span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f8fafc' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>Hours (Month)</div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: '#6366f1' }}>{emp.totalHours.toFixed(1)}h</div>
                  </div>
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f8fafc' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>Monthly Rate</div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: '#10b981' }}>{emp.monthlyRate ? rupee(emp.monthlyRate) : '—'}</div>
                  </div>
                </div>
                {emp.payroll && (
                  <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 10, color: '#15803d', fontWeight: 700, marginBottom: 2 }}>Est. Net Salary This Month</div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: '#15803d' }}>{rupee(emp.payroll.earnedSalary)}</div>
                    {emp.payroll.leaveDays > 0 && <div style={{ fontSize: 10, color: '#64748b' }}>Leave deduction: {rupee(emp.payroll.leaveDed)}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CHECK-IN REPORT ── */}
      {tab === 'checkin-report' && isManager && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">From</label>
              <input type="date" className="form-input" value={reportFrom} max={reportTo} onChange={e => setReportFrom(e.target.value)} style={{ width: 150 }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">To</label>
              <input type="date" className="form-input" value={reportTo} min={reportFrom} onChange={e => setReportTo(e.target.value)} style={{ width: 150 }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Department</label>
              <select className="form-select" value={reportDept} onChange={e => setReportDept(e.target.value)} style={{ width: 170 }}>
                <option value="">All Departments</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Resource</label>
              <select className="form-select" value={reportEmp} onChange={e => setReportEmp(e.target.value)} style={{ width: 170 }}>
                <option value="">All Resources</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            {reportView === 'logs' ? (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Status</label>
                <select className="form-select" value={reportStatus} onChange={e => setReportStatus(e.target.value)} style={{ width: 160 }}>
                  <option value="">All</option>
                  <option value="in">Checked In (active)</option>
                  <option value="out">Checked Out</option>
                </select>
              </div>
            ) : (
              <>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Late after</label>
                  <input type="time" className="form-input" value={lateAfter} onChange={e => setLateAfter(e.target.value || '10:00')} style={{ width: 120 }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Full day (hrs)</label>
                  <input type="number" min="1" max="24" step="0.5" className="form-input" value={targetHours} onChange={e => setTargetHours(e.target.value)} style={{ width: 100 }} />
                </div>
              </>
            )}
            <button className="btn btn-outline" onClick={handleExportCheckinReport} disabled={exporting || (filteredReportLogs.length === 0 && kpiRows.length === 0)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={14} /> {exporting ? 'Exporting…' : 'Export'}
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b', alignSelf: 'center' }}>
              {reportView === 'kpi' ? `${kpiRows.length} resources · ${kpi.summary.workingDays} working days` : `${filteredReportLogs.length} entries`}
            </span>
          </div>

          <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, background: '#f1f5f9', marginBottom: 14 }}>
            {[{ id: 'kpi', label: 'Resource KPIs' }, { id: 'logs', label: 'Detailed Logs' }].map(v => (
              <button key={v.id} onClick={() => setReportView(v.id)}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12,
                  background: reportView === v.id ? '#fff' : 'transparent', color: reportView === v.id ? '#0f172a' : '#64748b',
                  boxShadow: reportView === v.id ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>
                {v.label}
              </button>
            ))}
          </div>

          {reportLoading ? <Loader /> : reportView === 'kpi' ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
                <StatCard label={`Resources checked in (of ${kpi.summary.resources})`} value={kpi.summary.activeResources} icon={<UserCheck size={16} />} />
                <StatCard label="Avg attendance" value={kpi.summary.attendancePct != null ? `${kpi.summary.attendancePct.toFixed(0)}%` : '—'} icon={<CalendarCheck size={16} />} accent="#059669" />
                <StatCard label="Total hours" value={`${kpi.summary.totalHours.toFixed(1)}h`} icon={<Clock size={16} />} />
                <StatCard label="Avg hours / day present" value={kpi.summary.avgHoursPerDay != null ? `${kpi.summary.avgHoursPerDay.toFixed(1)}h` : '—'} icon={<Timer size={16} />} />
                <StatCard label={`Late arrivals (after ${lateAfter})`} value={kpi.summary.lateDays} icon={<AlarmClock size={16} />} accent="#d97706" />
                <StatCard label="Missed check-outs" value={kpi.summary.missedCheckouts} icon={<AlertCircle size={16} />} accent="#dc2626" />
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr>
                    {[
                      ['name', 'Resource'], ['attendancePct', 'Attendance'], ['absentDays', 'Absent'], ['leaveDays', 'Leave'],
                      ['totalHours', 'Total Hrs'], ['avgHoursPerDay', 'Avg Hrs/Day'], ['avgFirstIn', 'Avg In'], ['avgLastOut', 'Avg Out'],
                      ['lateDays', 'Late'], ['shortDays', `Short (<${Number(targetHours) || 8}h)`], ['missedCheckouts', 'Missed Out'], ['projectPct', 'On Project'],
                    ].map(([key, label]) => (
                      <th key={key} onClick={() => toggleSort(key)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {label} {kpiSort.key === key ? (kpiSort.dir === 'asc' ? '↑' : '↓') : <ArrowUpDown size={10} style={{ opacity: .35 }} />}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {kpiRows.length === 0
                      ? <tr><td colSpan={12}><Empty icon="📊" title="No resources" desc="No resources match this selection" /></td></tr>
                      : kpiRows.map(r => {
                        const pct = r.attendancePct
                        const pctColor = pct == null ? '#94a3b8' : pct >= 90 ? '#059669' : pct >= 75 ? '#d97706' : '#dc2626'
                        const deptName = departments.find(d => d.id === r.department_id)?.name
                        const warn = (n, c) => <span style={{ fontWeight: 700, color: n > 0 ? c : '#cbd5e1' }}>{n}</span>
                        return (
                          <tr key={r.id} onClick={() => { setReportEmp(r.id); setReportView('logs') }} style={{ cursor: 'pointer' }} title="View this resource's logs">
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {r.name}
                                {r.liveNow && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#dcfce7', color: '#15803d' }}>LIVE</span>}
                              </div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                <span style={{ textTransform: 'capitalize' }}>{r.role}</span>{deptName ? ` · ${deptName}` : ''}
                              </div>
                            </td>
                            <td style={{ minWidth: 120 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                                  <div style={{ width: `${pct || 0}%`, height: '100%', background: pctColor }} />
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 700, color: pctColor, minWidth: 34 }}>{pct != null ? `${pct.toFixed(0)}%` : '—'}</span>
                              </div>
                              <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.presentDays} / {r.expectedDays} days</div>
                            </td>
                            <td>{warn(r.absentDays, '#dc2626')}</td>
                            <td style={{ fontSize: 12, color: '#64748b' }}>{r.leaveDays || '—'}</td>
                            <td style={{ fontWeight: 800, color: '#6366f1' }}>{r.totalHours.toFixed(1)}h</td>
                            <td style={{ fontWeight: 600, color: r.avgHoursPerDay != null && r.avgHoursPerDay < (Number(targetHours) || 8) ? '#d97706' : '#0f172a' }}>
                              {r.avgHoursPerDay != null ? `${r.avgHoursPerDay.toFixed(1)}h` : '—'}
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#059669' }}>{fmtMinutes(r.avgFirstIn)}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#dc2626' }}>{fmtMinutes(r.avgLastOut)}</td>
                            <td>{warn(r.lateDays, '#d97706')}</td>
                            <td>{warn(r.shortDays, '#d97706')}</td>
                            <td>{warn(r.missedCheckouts, '#dc2626')}</td>
                            <td style={{ fontSize: 12, color: '#64748b' }}>{r.projectPct != null ? `${r.projectPct.toFixed(0)}%` : '—'}</td>
                          </tr>
                        )
                      })
                    }
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Project</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Work Done</th></tr></thead>
                <tbody>
                  {filteredReportLogs.length === 0
                    ? <tr><td colSpan={8}><Empty icon="📅" title="No check-ins" desc="No check-in/check-out records match this selection" /></td></tr>
                    : filteredReportLogs.map(log => (
                      <tr key={log.id}>
                        <td style={{ fontSize: 12 }}>{dateFmt(log.work_date)}</td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{log.employee?.full_name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{log.employee?.role}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>{departments.find(d => d.id === log.employee?.department_id)?.name || '—'}</td>
                        <td>{log.project ? <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#ede9fe', color: '#6d28d9' }}>{log.project.name}</span> : '—'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#059669', fontWeight: 700 }}>{fmtTime(log.check_in)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: log.check_out ? '#dc2626' : '#f59e0b', fontWeight: 700 }}>
                          {log.check_out ? fmtTime(log.check_out) : '🟢 Active'}
                        </td>
                        <td style={{ fontWeight: 800, color: '#6366f1' }}>{log.hours_worked != null ? `${log.hours_worked}h` : '—'}</td>
                        <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.comment || '—'}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── WORK PLANNING ── */}
      {tab === 'planning' && isManager && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Plan for</label>
              <input type="date" className="form-input" value={planDay} onChange={e => e.target.value && setPlanDay(e.target.value)} style={{ width: 150 }} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setPlanDay(LOCAL_TODAY)} style={{ fontWeight: planDay === LOCAL_TODAY ? 700 : 500 }}>Today</button>
              <button className="btn btn-outline btn-sm" onClick={() => setPlanDay(nextWorkingDay())} style={{ fontWeight: planDay === nextWorkingDay() ? 700 : 500 }}>Next working day</button>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Department</label>
              <select className="form-select" value={planDept} onChange={e => setPlanDept(e.target.value)} style={{ width: 170 }}>
                <option value="">All Departments</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Show</label>
              <select className="form-select" value={planFilter} onChange={e => setPlanFilter(e.target.value)} style={{ width: 170 }}>
                <option value="attention">Needs planning</option>
                <option value="all">All resources</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Full day (hrs)</label>
              <input type="number" min="1" max="24" step="0.5" className="form-input" value={planTarget} onChange={e => setPlanTarget(e.target.value)} style={{ width: 100 }} />
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/tasks')} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Assign Tasks
            </button>
          </div>

          {planLoading || !plan ? <Loader /> : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
                <StatCard label={`No work planned · ${planDayLabel}`} value={planSummary.none} icon={<AlertCircle size={16} />} accent="#dc2626" />
                <StatCard label="Only overdue work" value={planSummary.carryover} icon={<AlarmClock size={16} />} accent="#d97706" />
                <StatCard label={`Under-planned (<${(Number(planTarget) || 8) / 2}h)`} value={planSummary.under} icon={<Timer size={16} />} accent="#d97706" />
                <StatCard label={`Planned (of ${planSummary.resources})`} value={planSummary.planned} icon={<CalendarCheck size={16} />} accent="#059669" />
                <StatCard label="On leave" value={planSummary.leave} icon={<Users size={16} />} accent="#64748b" />
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Resource</th><th>Status</th><th>Planned for {planDayLabel.toLowerCase()}</th><th>Est. Load</th><th>Overdue</th><th>Unscheduled</th></tr></thead>
                  <tbody>
                    {planRows.length === 0
                      ? <tr><td colSpan={6}><Empty icon="✅" title={planFilter === 'attention' ? 'Everyone has work planned' : 'No resources'} desc={planFilter === 'attention' ? `Every resource has tasks scheduled for ${planDayLabel.toLowerCase()}` : 'No resources match this selection'} /></td></tr>
                      : planRows.map(r => {
                        const st = PLAN_STATUS[r.status]
                        const deptName = departments.find(d => d.id === r.department_id)?.name
                        const expanded = planOpen === r.id
                        const taskLine = t => (
                          <div key={t.id} style={{ fontSize: 12, padding: '3px 0', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                            <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{t.task_id || ''}</span>
                            <span style={{ fontWeight: 500 }}>{t.task_name}</span>
                            {t.project?.name && <span style={{ color: '#94a3b8' }}>· {t.project.name}</span>}
                            <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>· {String(t.status || '').replace(/_/g, ' ')}</span>
                            {t.planned_end_date && <span style={{ color: '#94a3b8' }}>· due {dateFmt(t.planned_end_date)}</span>}
                          </div>
                        )
                        return [
                          <tr key={r.id} onClick={() => setPlanOpen(expanded ? null : r.id)} style={{ cursor: 'pointer' }}>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}><span style={{ textTransform: 'capitalize' }}>{r.role}</span>{deptName ? ` · ${deptName}` : ''}</div>
                            </td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span></td>
                            <td style={{ fontSize: 12, maxWidth: 280 }}>
                              {r.planned.length === 0 ? <span style={{ color: '#94a3b8' }}>—</span> : (
                                <span>
                                  <b>{r.planned.length}</b> task{r.planned.length > 1 ? 's' : ''}
                                  <span style={{ color: '#64748b' }}> · {r.planned.slice(0, 2).map(t => t.task_name).join(', ')}{r.planned.length > 2 ? '…' : ''}</span>
                                </span>
                              )}
                            </td>
                            <td style={{ minWidth: 130 }}>
                              {r.planned.length === 0 ? <span style={{ color: '#cbd5e1' }}>0h</span> : (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                                      <div style={{ width: `${Math.min(100, r.loadPct || 0)}%`, height: '100%', background: r.loadPct > 100 ? '#dc2626' : '#6366f1' }} />
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 700, minWidth: 36 }}>{r.plannedHours.toFixed(1)}h</span>
                                  </div>
                                  {r.hasUnestimated && <div style={{ fontSize: 10, color: '#94a3b8' }}>+ tasks with no estimate</div>}
                                </div>
                              )}
                            </td>
                            <td><span style={{ fontWeight: 700, color: r.carryover.length ? '#d97706' : '#cbd5e1' }}>{r.carryover.length}</span></td>
                            <td><span style={{ fontWeight: 700, color: r.unscheduled.length ? '#6366f1' : '#cbd5e1' }} title="Open tasks with no planned dates — ready to schedule">{r.unscheduled.length}</span></td>
                          </tr>,
                          expanded && (
                            <tr key={`${r.id}-detail`}>
                              <td colSpan={6} style={{ background: '#f8fafc', padding: '12px 18px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                                  {[['Planned', r.planned, 'Nothing scheduled for this day'], ['Overdue (still open)', r.carryover, 'No overdue tasks'], ['Unscheduled — ready to plan', r.unscheduled, 'No unscheduled tasks']].map(([title, list, empty]) => (
                                    <div key={title}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{title} ({list.length})</div>
                                      {list.length ? list.slice(0, 8).map(taskLine) : <div style={{ fontSize: 12, color: '#94a3b8' }}>{empty}</div>}
                                      {list.length > 8 && <div style={{ fontSize: 11, color: '#94a3b8' }}>+{list.length - 8} more</div>}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ),
                        ]
                      })
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ALL LOGS ── */}
      {tab === 'logs' && isManager && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Search employee or project…" />
            <select className="form-select" value={filterMonth} onChange={e => { setFilterMonth(parseInt(e.target.value)); loadAll() }} style={{ width: 140 }}>
              {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m} {YEAR}</option>)}
            </select>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filteredLogs.length} logs</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Date</th><th>Project</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Work Done</th></tr></thead>
              <tbody>
                {filteredLogs.length === 0
                  ? <tr><td colSpan={7}><Empty icon="📋" title="No logs" desc="No time logs for this period" /></td></tr>
                  : filteredLogs.map(log => (
                    <tr key={log.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{log.employee?.full_name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{log.employee?.role}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{dateFmt(log.work_date)}</td>
                      <td>{log.project ? <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#ede9fe', color: '#6d28d9' }}>{log.project.name}</span> : '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#059669', fontWeight: 700 }}>{fmtTime(log.check_in)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: log.check_out ? '#dc2626' : '#f59e0b', fontWeight: 700 }}>
                        {log.check_out ? fmtTime(log.check_out) : '🟢 Active'}
                      </td>
                      <td style={{ fontWeight: 800, color: '#6366f1' }}>{log.hours_worked != null ? `${log.hours_worked}h` : '—'}</td>
                      <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.comment || '—'}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PAYROLL SUMMARY ── */}
      {tab === 'payroll' && isManager && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <select className="form-select" value={filterMonth} onChange={e => setFilterMonth(parseInt(e.target.value))} style={{ width: 160 }}>
              {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m} {YEAR}</option>)}
            </select>
            <div style={{ fontSize: 13, color: '#64748b' }}>Salary calculation based on time logs and approved leaves</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th><th>Monthly Salary</th><th>Hourly Rate</th>
                  <th>Hours Worked</th><th>Leave Days</th><th>Leave Hrs</th>
                  <th>Leave Deduction</th><th>Net Salary</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {empSummary.length === 0
                  ? <tr><td colSpan={9}><Empty icon="💰" title="No employees" desc="Add employees and set resource rates" /></td></tr>
                  : empSummary.map(emp => {
                    const p = emp.payroll
                    const rate = rates.find(r => r.employee_id === emp.id)
                    return (
                      <tr key={emp.id}>
                        <td>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{emp.full_name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{emp.role}</div>
                        </td>
                        <td style={{ fontWeight: 700 }}>{rate ? rupee(rate.monthly_salary) : <span style={{ color: '#f59e0b', fontSize: 12 }}>Not set</span>}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{rate ? `₹${rate.hourly_rate?.toFixed(0)}/hr` : '—'}</td>
                        <td style={{ fontWeight: 700, color: '#6366f1' }}>{p ? `${p.hoursWorked.toFixed(1)}h` : '—'}</td>
                        <td>{p ? p.leaveDays : '—'}</td>
                        <td>{p ? `${p.leaveHours.toFixed(1)}h` : '—'}</td>
                        <td style={{ color: '#ef4444', fontWeight: 600 }}>{p ? rupee(p.leaveDed) : '—'}</td>
                        <td style={{ fontWeight: 800, fontSize: 15, color: '#10b981' }}>{p ? rupee(p.earnedSalary) : <span style={{ color: '#f59e0b', fontSize: 12 }}>Rate needed</span>}</td>
                        <td>
                          {!rate
                            ? <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: '#fef3c7', color: '#b45309', fontWeight: 700 }}>⚠ No Rate</span>
                            : <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: '#dcfce7', color: '#15803d', fontWeight: 700 }}>✓ Ready</span>
                          }
                        </td>
                      </tr>
                    )
                  })
                }
              </tbody>
            </table>
          </div>

          {/* Total */}
          {empSummary.length > 0 && (
            <div style={{ background: 'linear-gradient(135deg,#1e293b,#334155)', borderRadius: 14, padding: '20px 24px', marginTop: 16, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, opacity: .7, marginBottom: 4 }}>TOTAL PAYROLL — {MONTHS[filterMonth-1]} {YEAR}</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>
                  {rupee(empSummary.reduce((s, e) => s + (e.payroll?.earnedSalary || 0), 0))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 24 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, opacity: .6 }}>Employees</div>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>{empSummary.length}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, opacity: .6 }}>Total Hours</div>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>{empSummary.reduce((s,e) => s + e.totalHours, 0).toFixed(0)}h</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, opacity: .6 }}>Rates Set</div>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>{rates.length}/{empSummary.length}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Set Rate Modal */}
      <Modal open={showRateModal} onClose={() => setShowRateModal(false)} title="Set Resource Rate"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowRateModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveRate} disabled={submitting}>{submitting ? 'Saving…' : 'Save Rate'}</button>
        </>}>
        <div className="form-group">
          <label className="form-label">Employee *</label>
          <select className="form-select" value={rateForm.employee_id} onChange={e => {
            const existing = rates.find(r => r.employee_id === e.target.value)
            setRateForm(f => ({ ...f, employee_id: e.target.value, monthly_salary: existing?.monthly_salary || '', hourly_rate: existing?.hourly_rate || '' }))
          }} required>
            <option value="">Select employee…</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.role})</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Monthly Salary (₹) *</label>
          <input className="form-input" type="number" value={rateForm.monthly_salary}
            onChange={e => {
              const ms = parseFloat(e.target.value) || 0
              setRateForm(f => ({ ...f, monthly_salary: e.target.value, hourly_rate: (ms / (22*8)).toFixed(2) }))
            }} placeholder="e.g. 50000" required />
        </div>
        <div className="form-group">
          <label className="form-label">Hourly Rate (₹) — auto-calculated</label>
          <input className="form-input" type="number" value={rateForm.hourly_rate}
            onChange={e => setRateForm(f => ({ ...f, hourly_rate: e.target.value }))} placeholder="Auto from salary ÷ 176hrs" />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Based on 22 working days × 8 hours = 176 hrs/month</div>
        </div>
      </Modal>
    </div>
  )
}

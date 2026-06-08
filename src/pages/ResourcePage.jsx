import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Modal, Loader, Empty, SearchBox } from '../components/ui'
import { Clock, LogIn, LogOut, Plus, Edit2, Users, Briefcase, DollarSign, AlertCircle, BarChart2 } from 'lucide-react'

const YEAR = new Date().getFullYear()
const MONTH = new Date().getMonth() + 1
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const TODAY = new Date().toISOString().split('T')[0]

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
        supabase.from('time_logs').select('*, project:projects(name,code), employee:profiles!employee_id(full_name, role, email)').gte('work_date', monthStart).lte('work_date', monthEnd).order('check_in', { ascending: false }),
        supabase.from('profiles').select('id, full_name, role, email').order('full_name'),
        supabase.from('resource_rates').select('*, employee:profiles!employee_id(full_name)'),
        supabase.from('leave_requests').select('employee_id, leave_type, from_date, to_date, permission_hours, status').eq('status', 'approved').gte('from_date', monthStart).lte('to_date', monthEnd),
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
    }
    setLoading(false)
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
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
                    <div style={{ fontWeight: 800, fontSize: 18, color: '#6366f1' }}>{emp.totalHours.toFixed(1)}h</div>
                  </div>
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f8fafc' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>Monthly Rate</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#10b981' }}>{emp.monthlyRate ? rupee(emp.monthlyRate) : '—'}</div>
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

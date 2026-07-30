import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, nextNum } from '../lib/supabase'
import { countWorkingDays, recomputeForEmployeeRange } from '../lib/capacity'
import { Modal, StatusBadge, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Calendar, Clock, CheckCircle, XCircle, Eye, Trash2, Users } from 'lucide-react'

const LEAVE_COLORS = {
  sick:       { bg: '#fee2e2', color: '#dc2626', label: 'Sick Leave', icon: '🤒' },
  casual:     { bg: '#dbeafe', color: '#1d4ed8', label: 'Casual Leave', icon: '🏖️' },
  personal:   { bg: '#ede9fe', color: '#6d28d9', label: 'Personal Leave', icon: '👤' },
  permission: { bg: '#fef3c7', color: '#b45309', label: 'Permission (Hours)', icon: '⏰' },
}

const STATUS_COLORS = {
  pending:   { bg: '#fef3c7', color: '#b45309' },
  approved:  { bg: '#dcfce7', color: '#15803d' },
  rejected:  { bg: '#fee2e2', color: '#dc2626' },
  cancelled: { bg: '#f1f5f9', color: '#475569' },
}

// Local-calendar-date ISO string — NOT toISOString(), which converts to UTC and
// rolls back a day for positive-UTC-offset timezones (e.g. IST) during the early
// hours of the local day.
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const YEAR = new Date().getFullYear()
const initLeaveForm = () => ({
  leave_type: 'casual', from_date: '', to_date: '',
  permission_date: '', from_time: '09:00', to_time: '11:00',
  reason: ''
})

export default function LeavePage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isHR = role === 'hr' || role === 'admin' || role === 'ceo'
  const isManager = ['admin','ceo','manager','department_head','hr'].includes(role)
  const isEmployee = !isManager || role === 'employee'

  const [tab, setTab] = useState(isManager && !isEmployee ? 'approvals' : 'my')
  const [myLeaves, setMyLeaves] = useState([])
  const [allLeaves, setAllLeaves] = useState([])
  const [policies, setPolicies] = useState([])
  const [balances, setBalances] = useState(null)
  const [employees, setEmployees] = useState([])
  const [leaveTypes, setLeaveTypes] = useState([])
  const [holidays, setHolidays] = useState([])
  const [calendarLeaves, setCalendarLeaves] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showPolicy, setShowPolicy] = useState(false)
  const [form, setForm] = useState(initLeaveForm())
  const [policyForm, setPolicyForm] = useState({ employee_id: '', sick_days: 12, casual_days: 12, personal_days: 6, permission_hours: 24 })
  const [holidayForm, setHolidayForm] = useState({ holiday_date: '', name: '' })
  const [calFrom, setCalFrom] = useState(() => isoLocal(new Date()))
  const [calTo, setCalTo] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 14); return isoLocal(d) })
  const [submitting, setSub] = useState(false)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')
  const [deleteId, setDeleteId] = useState(null)

  const holidaysSet = new Set(holidays.map(h => h.holiday_date))
  // leave_types (Phase 2) is the source of truth once populated; falls back to the
  // original hardcoded LEAVE_COLORS so nothing breaks before STEP30 has been run.
  const typeColors = leaveTypes.length > 0
    ? Object.fromEntries(leaveTypes.map(t => [t.code, { bg: t.color_bg, color: t.color_hex, label: t.name, icon: t.icon }]))
    : LEAVE_COLORS

  useEffect(() => { loadAll() }, [role])

  async function loadAll() {
    setLoading(true)
    const promises = [
      supabase.from('leave_requests').select('*, employee:profiles!employee_id(full_name, role, email)').eq('employee_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('leave_balances').select('*').eq('employee_id', profile.id).eq('fiscal_year', YEAR).maybeSingle(),
      supabase.from('leave_policies').select('*').eq('employee_id', profile.id).eq('fiscal_year', YEAR).maybeSingle(),
      supabase.from('leave_types').select('*').eq('is_active', true).order('name'),
      supabase.from('holidays').select('*').order('holiday_date'),
      supabase.from('leave_requests').select('leave_type,from_date,to_date,permission_date,status,employee:profiles!employee_id(full_name)').eq('status', 'approved'),
    ]
    if (isManager) promises.push(
      supabase.from('leave_requests').select('*, employee:profiles!employee_id(full_name, role, department_id, email)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role, email').order('full_name'),
    )

    const results = await Promise.all(promises)
    setMyLeaves(results[0].data || [])
    setBalances(results[1].data)
    setPolicies(results[2].data ? [results[2].data] : [])
    setLeaveTypes(results[3].data || [])
    setHolidays(results[4].data || [])
    setCalendarLeaves(results[5].data || [])
    if (isManager) {
      setAllLeaves(results[6].data || [])
      setEmployees(results[7].data || [])
    }
    setLoading(false)
  }

  async function submitLeave(e) {
    e.preventDefault(); setSub(true); setErr('')
    try {
      const num = await nextNum('leave')
      const isPermission = form.leave_type === 'permission'
      let permHours = null
      if (isPermission && form.from_time && form.to_time) {
        const [fh, fm] = form.from_time.split(':').map(Number)
        const [th, tm] = form.to_time.split(':').map(Number)
        permHours = Math.max(0, (th * 60 + tm - fh * 60 - fm) / 60)
      }
      const typeDef = leaveTypes.find(t => t.code === form.leave_type)
      const autoApprove = typeDef && typeDef.requires_approval === false
      const { data, error } = await supabase.from('leave_requests').insert({
        request_number: num,
        employee_id: profile.id,
        leave_type: form.leave_type,
        from_date: isPermission ? null : form.from_date,
        to_date: isPermission ? null : (form.to_date || form.from_date),
        permission_date: isPermission ? form.permission_date : null,
        from_time: isPermission ? form.from_time : null,
        to_time: isPermission ? form.to_time : null,
        permission_hours: permHours,
        reason: form.reason,
        status: autoApprove ? 'approved' : 'pending',
        ...(autoApprove ? { approved_by: profile.id, approved_at: new Date().toISOString() } : {}),
      }).select().single()
      if (error) throw error
      if (autoApprove) await applyBalanceAndRecompute(data)
      setShowCreate(false); setForm(initLeaveForm()); loadAll()
    } catch (e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function applyBalanceAndRecompute(req) {
    const isPermission = req.leave_type === 'permission'
    const days = isPermission ? null : countWorkingDays(req.from_date, req.to_date || req.from_date, holidaysSet)

    const balUpdate = {}
    if (req.leave_type === 'sick') balUpdate.sick_used = (balances?.sick_used || 0) + (days || 0)
    if (req.leave_type === 'casual') balUpdate.casual_used = (balances?.casual_used || 0) + (days || 0)
    if (req.leave_type === 'personal') balUpdate.personal_used = (balances?.personal_used || 0) + (days || 0)
    if (req.leave_type === 'permission') balUpdate.permission_hours_used = (balances?.permission_hours_used || 0) + (req.permission_hours || 0)

    await supabase.from('leave_balances').upsert({
      employee_id: req.employee_id, fiscal_year: YEAR, ...balUpdate
    }, { onConflict: 'employee_id,fiscal_year' })

    const rangeStart = isPermission ? req.permission_date : req.from_date
    const rangeEnd = isPermission ? req.permission_date : (req.to_date || req.from_date)
    await recomputeForEmployeeRange(req.employee_id, rangeStart, rangeEnd)
  }

  async function handleApprove(req, action) {
    setSub(true)
    try {
      const status = action === 'approve' ? 'approved' : 'rejected'
      const { error } = await supabase.from('leave_requests').update({
        status, approved_by: profile.id, approved_at: new Date().toISOString()
      }).eq('id', req.id)
      if (error) throw error

      if (status === 'approved') await applyBalanceAndRecompute(req)

      setShowDetail(null); loadAll()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  async function saveHoliday(e) {
    e.preventDefault(); setSub(true)
    try {
      const { error } = await supabase.from('holidays').insert({ holiday_date: holidayForm.holiday_date, name: holidayForm.name, created_by: profile.id })
      if (error) throw error
      setHolidayForm({ holiday_date: '', name: '' })
      loadAll()
    } catch (e) { alert(e.message) } finally { setSub(false) }
  }

  async function deleteHoliday(id) {
    await supabase.from('holidays').delete().eq('id', id)
    loadAll()
  }

  async function savePolicy(e) {
    e.preventDefault(); setSub(true)
    try {
      const { error } = await supabase.from('leave_policies').upsert({
        employee_id: policyForm.employee_id,
        fiscal_year: YEAR,
        sick_days: parseFloat(policyForm.sick_days),
        casual_days: parseFloat(policyForm.casual_days),
        personal_days: parseFloat(policyForm.personal_days),
        permission_hours: parseFloat(policyForm.permission_hours),
        created_by: profile.id,
      }, { onConflict: 'employee_id,fiscal_year' })
      if (error) throw error
      setShowPolicy(false); loadAll()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  async function deleteLeave(id) {
    await supabase.from('leave_requests').delete().eq('id', id)
    setDeleteId(null); loadAll()
  }

  const myPolicy = policies[0]
  const displayLeaves = tab === 'my' ? myLeaves : allLeaves.filter(l =>
    !search || l.employee?.full_name?.toLowerCase().includes(search.toLowerCase()) || l.request_number?.toLowerCase().includes(search.toLowerCase())
  )

  const pendingCount = allLeaves.filter(l => l.status === 'pending').length

  // Balance bar
  function BalanceBar({ label, used, total, color }) {
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          <span style={{ color: '#475569' }}>{label}</span>
          <span style={{ color }}>{used}/{total}</span>
        </div>
        <div style={{ height: 8, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .3s' }} />
        </div>
      </div>
    )
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Leave Management</div>
          <div className="page-subtitle">Apply, track and approve leave requests</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isHR && (
            <button className="btn btn-outline" onClick={() => setShowPolicy(true)}>
              <Users size={14} /> Set Leave Policy
            </button>
          )}
          <button className="btn btn-primary" onClick={() => { setErr(''); setShowCreate(true) }}>
            <Plus size={14} /> Apply Leave
          </button>
        </div>
      </div>

      {/* My Balance Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { type: 'sick', used: balances?.sick_used || 0, total: myPolicy?.sick_days || 12, color: '#dc2626' },
          { type: 'casual', used: balances?.casual_used || 0, total: myPolicy?.casual_days || 12, color: '#1d4ed8' },
          { type: 'personal', used: balances?.personal_used || 0, total: myPolicy?.personal_days || 6, color: '#6d28d9' },
          { type: 'permission', used: balances?.permission_hours_used || 0, total: myPolicy?.permission_hours || 24, color: '#b45309', unit: 'hrs' },
        ].map(b => {
          const lc = LEAVE_COLORS[b.type]
          const rem = b.total - b.used
          return (
            <div key={b.type} style={{ background: '#fff', borderRadius: 14, padding: 16, border: `1.5px solid ${lc.color}20`, borderTop: `4px solid ${lc.color}`, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              <div style={{ fontSize: 18, marginBottom: 6 }}>{lc.icon}</div>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#1e293b', marginBottom: 2 }}>{lc.label}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: lc.color, lineHeight: 1 }}>{rem}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>of {b.total} {b.unit || 'days'}</div>
              </div>
              <div style={{ height: 5, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (b.used/b.total)*100)}%`, height: '100%', background: lc.color, borderRadius: 99 }} />
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{b.used} used · {rem} remaining</div>
            </div>
          )
        })}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'my', label: 'My Leaves' },
          ...(isManager ? [{ id: 'approvals', label: `Team Approvals${pendingCount > 0 ? ` (${pendingCount})` : ''}` }] : []),
          { id: 'calendar', label: 'Team Calendar' },
          ...(isHR ? [{ id: 'holidays', label: 'Holidays' }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '7px 18px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
              background: tab === t.id ? '#6366f1' : '#f1f5f9', color: tab === t.id ? '#fff' : '#475569' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Leave Table */}
      {(tab === 'my' || tab === 'approvals') && (
      <div className="table-wrap">
        <div className="table-toolbar">
          {tab === 'approvals'
            ? <SearchBox value={search} onChange={setSearch} placeholder="Search employee or request #…" />
            : <span style={{ fontWeight: 700, fontSize: 14 }}>My Leave Requests</span>
          }
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{displayLeaves.length} records</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Request #</th>
              {tab === 'approvals' && <th>Employee</th>}
              <th>Type</th><th>Date / Period</th><th>Duration</th><th>Reason</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayLeaves.length === 0
              ? <tr><td colSpan={8}><Empty icon="📅" title="No leave requests" desc={tab === 'my' ? 'Apply for leave using the button above' : 'No pending team requests'} /></td></tr>
              : displayLeaves.map(req => {
                const lc = typeColors[req.leave_type] || LEAVE_COLORS.casual
                const sc = STATUS_COLORS[req.status] || STATUS_COLORS.pending
                const isPerm = req.leave_type === 'permission'
                const days = isPerm ? null : req.from_date ? countWorkingDays(req.from_date, req.to_date || req.from_date, holidaysSet) : 1
                return (
                  <tr key={req.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#6366f1' }}>{req.request_number}</td>
                    {tab === 'approvals' && (
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{req.employee?.full_name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{req.employee?.email}</div>
                      </td>
                    )}
                    <td>
                      <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: lc.bg, color: lc.color }}>
                        {lc.icon} {lc.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {isPerm
                        ? <><div>{dateFmt(req.permission_date)}</div><div style={{ color: '#94a3b8' }}>{req.from_time} – {req.to_time}</div></>
                        : <><div>{dateFmt(req.from_date)}</div>{req.to_date && req.to_date !== req.from_date && <div style={{ color: '#94a3b8' }}>→ {dateFmt(req.to_date)}</div>}</>
                      }
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {isPerm ? `${req.permission_hours?.toFixed(1) || '—'} hrs` : `${days} day${days !== 1 ? 's' : ''}`}
                    </td>
                    <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.reason || '—'}</td>
                    <td>
                      <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.color, textTransform: 'capitalize' }}>
                        {req.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowDetail(req)}><Eye size={13} /></button>
                        {isManager && req.status === 'pending' && (
                          <>
                            <button className="btn btn-success btn-sm btn-icon" onClick={() => handleApprove(req, 'approve')} title="Approve"><CheckCircle size={13} /></button>
                            <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleApprove(req, 'reject')} title="Reject"><XCircle size={13} /></button>
                          </>
                        )}
                        {req.employee_id === profile.id && req.status === 'pending' && (
                          <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteId(req.id)}><Trash2 size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>
      )}

      {/* Team Calendar — who's out, grouped by date, for a selected range */}
      {tab === 'calendar' && (
        <TeamCalendar allLeaves={calendarLeaves} typeColors={typeColors}
          calFrom={calFrom} calTo={calTo} setCalFrom={setCalFrom} setCalTo={setCalTo} />
      )}

      {/* Holidays CRUD (HR/admin only) */}
      {tab === 'holidays' && isHR && (
        <div>
          <form onSubmit={saveHoliday} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={holidayForm.holiday_date} onChange={e => setHolidayForm(f => ({ ...f, holiday_date: e.target.value }))} required />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
              <label className="form-label">Name *</label>
              <input className="form-input" value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Diwali" required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}><Plus size={13} /> Add Holiday</button>
          </form>
          {holidays.length === 0 ? <Empty icon="🏖️" title="No holidays configured" desc="Add company holidays so leave duration and capacity calculations skip them" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Name</th><th>Scope</th><th></th></tr></thead>
                <tbody>
                  {holidays.map(h => (
                    <tr key={h.id}>
                      <td>{dateFmt(h.holiday_date)}</td>
                      <td className="td-bold">{h.name}</td>
                      <td style={{ textTransform: 'capitalize' }}>{h.scope}</td>
                      <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => deleteHoliday(h.id)}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Apply Leave Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Apply for Leave" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitLeave} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Request'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{err}</div>}

        {/* Leave type selector */}
        <div className="form-group">
          <label className="form-label">Leave Type *</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
            {Object.entries(typeColors).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setForm(f => ({ ...f, leave_type: k }))}
                style={{ padding: '10px 14px', borderRadius: 12, border: `2px solid ${form.leave_type === k ? v.color : '#e2e8f0'}`, background: form.leave_type === k ? v.bg : '#fff', color: form.leave_type === k ? v.color : '#475569', fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{v.icon}</span> {v.label}
              </button>
            ))}
          </div>
        </div>

        {form.leave_type === 'permission' ? (
          <>
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={form.permission_date} onChange={e => setForm(f => ({ ...f, permission_date: e.target.value }))} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">From Time *</label>
                <input className="form-input" type="time" value={form.from_time} onChange={e => setForm(f => ({ ...f, from_time: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">To Time *</label>
                <input className="form-input" type="time" value={form.to_time} onChange={e => setForm(f => ({ ...f, to_time: e.target.value }))} />
              </div>
            </div>
            {form.from_time && form.to_time && (() => {
              const [fh,fm] = form.from_time.split(':').map(Number)
              const [th,tm] = form.to_time.split(':').map(Number)
              const hrs = Math.max(0, (th*60+tm - fh*60-fm)/60)
              return <div style={{ padding: '8px 12px', background: '#fef3c7', borderRadius: 8, fontSize: 12, color: '#b45309', fontWeight: 600 }}>Duration: {hrs.toFixed(1)} hours</div>
            })()}
          </>
        ) : (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">From Date *</label>
              <input className="form-input" type="date" value={form.from_date} onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">To Date</label>
              <input className="form-input" type="date" value={form.to_date} min={form.from_date} onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} />
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-textarea" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Brief reason for leave…" required />
        </div>
      </Modal>

      {/* HR: Set Policy Modal */}
      {isHR && (
        <Modal open={showPolicy} onClose={() => setShowPolicy(false)} title="Set Leave Policy" size="lg"
          footer={<>
            <button className="btn btn-ghost" onClick={() => setShowPolicy(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={savePolicy} disabled={submitting}>{submitting ? 'Saving…' : 'Save Policy'}</button>
          </>}>
          <div className="form-group">
            <label className="form-label">Employee *</label>
            <select className="form-select" value={policyForm.employee_id} onChange={e => setPolicyForm(f => ({ ...f, employee_id: e.target.value }))} required>
              <option value="">Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.role})</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['sick_days', 'Sick Leave Days'],
              ['casual_days', 'Casual Leave Days'],
              ['personal_days', 'Personal Leave Days'],
              ['permission_hours', 'Permission Hours'],
            ].map(([k, label]) => (
              <div key={k} className="form-group">
                <label className="form-label">{label}</label>
                <input className="form-input" type="number" step="0.5" value={policyForm[k]} onChange={e => setPolicyForm(f => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <Modal open title={`Leave — ${showDetail.request_number}`} onClose={() => setShowDetail(null)}
          footer={<>
            {isManager && showDetail.status === 'pending' && (
              <>
                <button className="btn btn-danger" onClick={() => { handleApprove(showDetail, 'reject'); setShowDetail(null) }}>Reject</button>
                <button className="btn btn-success" onClick={() => { handleApprove(showDetail, 'approve'); setShowDetail(null) }}>Approve</button>
              </>
            )}
            <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
          </>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['Employee', showDetail.employee?.full_name],
              ['Type', typeColors[showDetail.leave_type]?.label],
              ['Status', showDetail.status],
              ['Reason', showDetail.reason],
              showDetail.leave_type === 'permission'
                ? ['Duration', `${showDetail.permission_hours?.toFixed(1)} hrs (${showDetail.from_time} – ${showDetail.to_time})`]
                : ['Period', `${dateFmt(showDetail.from_date)}${showDetail.to_date ? ' → ' + dateFmt(showDetail.to_date) : ''}`],
              ['Submitted', dateFmt(showDetail.created_at)],
            ].filter(Boolean).map(([k,v]) => (
              <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: '#f8fafc' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 3 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{v || '—'}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      <Confirm open={!!deleteId} message="Cancel this leave request?" danger onConfirm={() => deleteLeave(deleteId)} onCancel={() => setDeleteId(null)} />
    </div>
  )
}

/* ─── Team Calendar — who's out, grouped by date, for a selected range ─── */
function TeamCalendar({ allLeaves, typeColors, calFrom, calTo, setCalFrom, setCalTo }) {
  const byDate = {}
  allLeaves.filter(l => l.status === 'approved').forEach(l => {
    if (l.leave_type === 'permission') {
      if (l.permission_date && l.permission_date >= calFrom && l.permission_date <= calTo) {
        (byDate[l.permission_date] ||= []).push(l)
      }
    } else if (l.from_date) {
      const to = l.to_date || l.from_date
      if (l.from_date <= calTo && to >= calFrom) {
        const start = l.from_date > calFrom ? l.from_date : calFrom
        const end = to < calTo ? to : calTo
        for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
          const iso = isoLocal(d)
          const day = d.getDay()
          if (day === 0 || day === 6) continue
          (byDate[iso] ||= []).push(l)
        }
      }
    }
  })
  const dates = Object.keys(byDate).sort()

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">From</label>
          <input className="form-input" type="date" value={calFrom} onChange={e => setCalFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">To</label>
          <input className="form-input" type="date" value={calTo} min={calFrom} onChange={e => setCalTo(e.target.value)} />
        </div>
      </div>
      {dates.length === 0 ? (
        <Empty icon="🗓️" title="No one is out" desc="No approved leave in this date range" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {dates.map(date => (
            <div key={date} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <div style={{ width: 100, flexShrink: 0, fontWeight: 700, fontSize: 12.5, color: '#334155' }}>{dateFmt(date)}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {byDate[date].map((l, i) => {
                  const lc = typeColors[l.leave_type] || { bg: '#f1f5f9', color: '#475569', icon: '📅' }
                  return (
                    <span key={i} style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: lc.bg, color: lc.color, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {lc.icon} {l.employee?.full_name}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { useProjects, ProjectSelect } from '../lib/useProjects'
import { sendNotif } from '../lib/notifications'
import { Modal, Loader, Empty, Alert, StatusBadge, SearchBox } from '../components/ui'
import { CalendarRange, Plus, Check, X, AlertTriangle } from 'lucide-react'

const initForm = () => ({ employee_id: '', project_id: '', allocation_percent: 50, role_on_project: '', start_date: '', end_date: '', override: false, override_justification: '' })

const Kpi = ({ label, value, color }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, borderTop: `2px solid ${color}`, padding: '10px 14px' }}>
    <div style={{ fontWeight: 800, fontSize: 22, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{label}</div>
  </div>
)

export default function AllocationsPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const { projects } = useProjects()
  const canRequest = ['admin', 'ceo', 'pm', 'manager', 'department_head'].includes(role)
  const isViewAll = ['admin', 'ceo', 'hr', 'cto'].includes(role)

  const [tab, setTab] = useState('my')
  const [users, setUsers] = useState([])
  const [subordinates, setSubordinates] = useState([])
  const [myAllocations, setMyAllocations] = useState([])
  const [allAllocations, setAllAllocations] = useState([])
  const [pendingApprovals, setPendingApprovals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(initForm())
  const [conflict, setConflict] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const hasDirectReports = subordinates.length > 0

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    setLoading(true)
    const [uR, subR, myR] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role,reporting_manager_id,default_weekly_capacity_hours').order('full_name'),
      supabase.from('profiles').select('id,full_name').eq('reporting_manager_id', profile.id),
      supabase.from('allocations').select('*,project:projects(name),employee:profiles!employee_id(full_name)').eq('employee_id', profile.id).order('created_at', { ascending: false }),
    ])
    setUsers(uR.data || [])
    setSubordinates(subR.data || [])
    setMyAllocations(myR.data || [])

    if (isViewAll || canRequest) {
      const { data } = await supabase.from('allocations').select('*,project:projects(name),employee:profiles!employee_id(full_name),requester:profiles!requested_by(full_name)').order('created_at', { ascending: false })
      setAllAllocations(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (subordinates.length === 0) { setPendingApprovals([]); return }
    (async () => {
      const { data } = await supabase.from('allocations')
        .select('*,project:projects(name),employee:profiles!employee_id(full_name,reporting_manager_id),requester:profiles!requested_by(full_name)')
        .eq('status', 'requested')
      setPendingApprovals((data || []).filter(a => a.employee?.reporting_manager_id === profile.id))
    })()
  }, [subordinates, myAllocations, allAllocations])

  // Overlap-based over-allocation conflict check
  async function checkConflict(employeeId, newPercent, start, end, excludeId) {
    if (!employeeId || !start || !newPercent) return null
    const { data } = await supabase.from('allocations')
      .select('*,project:projects(name)')
      .eq('employee_id', employeeId).in('status', ['requested', 'approved', 'active'])
    const rows = (data || []).filter(a => a.id !== excludeId)
    const reqStart = new Date(start).getTime()
    const reqEnd = end ? new Date(end).getTime() : new Date('9999-12-31').getTime()
    const overlapping = rows.filter(a => {
      const exStart = new Date(a.start_date).getTime()
      const exEnd = a.end_date ? new Date(a.end_date).getTime() : new Date('9999-12-31').getTime()
      return exStart <= reqEnd && exEnd >= reqStart
    })
    const committedPct = overlapping.reduce((s, a) => s + Number(a.allocation_percent || 0), 0)
    const projectedTotal = committedPct + Number(newPercent || 0)
    if (projectedTotal > 100) return { overlapping, committedPct, projectedTotal }
    return null
  }

  useEffect(() => {
    (async () => {
      if (form.employee_id && form.start_date && form.allocation_percent) {
        const c = await checkConflict(form.employee_id, form.allocation_percent, form.start_date, form.end_date)
        setConflict(c)
      } else setConflict(null)
    })()
  }, [form.employee_id, form.start_date, form.end_date, form.allocation_percent])

  async function submitRequest(e) {
    e.preventDefault()
    if (conflict && !form.override) { alert('Resolve the over-allocation warning first — check the override box to proceed.'); return }
    setSubmitting(true)
    try {
      const employee = users.find(u => u.id === form.employee_id)
      const hours = Math.round((Number(form.allocation_percent) / 100) * Number(employee?.default_weekly_capacity_hours || 40) * 100) / 100
      const { error } = await supabase.from('allocations').insert({
        employee_id: form.employee_id, project_id: form.project_id,
        allocation_percent: form.allocation_percent, allocation_hours_per_week: hours,
        role_on_project: form.role_on_project || null,
        start_date: form.start_date, end_date: form.end_date || null,
        requested_by: profile.id,
        override_flag: !!conflict, override_justification: conflict ? form.override_justification : null,
      })
      if (error) throw error
      if (employee?.reporting_manager_id) {
        sendNotif(employee.reporting_manager_id, { type: 'allocation_request', title: '📋 New allocation request', body: `${employee.full_name} → ${projects.find(p => p.id === form.project_id)?.name || 'project'} (${form.allocation_percent}%)`, link: '/allocations', senderId: profile.id })
      }
      setForm(initForm()); setConflict(null); load()
      alert(employee?.reporting_manager_id ? 'Request submitted for approval.' : 'Request saved — but this employee has no reporting manager set, so it cannot be approved until one is assigned on the Users page.')
    } catch (e) { alert(e.message) } finally { setSubmitting(false) }
  }

  async function approve(a) {
    const c = await checkConflict(a.employee_id, a.allocation_percent, a.start_date, a.end_date, a.id)
    if (c && !confirm(`This would put ${a.employee?.full_name} at ${c.projectedTotal}% allocated for overlapping dates. Approve anyway?`)) return
    await supabase.from('allocations').update({ status: 'approved', approved_by: profile.id, approved_at: new Date().toISOString(), override_flag: !!c || a.override_flag }).eq('id', a.id)
    sendNotif(a.requested_by, { type: 'allocation_approved', title: '✅ Allocation approved', body: `${a.employee?.full_name} → ${a.project?.name}`, link: '/allocations', senderId: profile.id })
    load()
  }

  async function reject() {
    if (!rejectReason.trim()) return
    await supabase.from('allocations').update({ status: 'rejected', approved_by: profile.id, approved_at: new Date().toISOString(), rejection_reason: rejectReason.trim() }).eq('id', rejectTarget.id)
    sendNotif(rejectTarget.requested_by, { type: 'allocation_rejected', title: '❌ Allocation rejected', body: `${rejectTarget.employee?.full_name} → ${rejectTarget.project?.name}: ${rejectReason.trim()}`, link: '/allocations', senderId: profile.id })
    setRejectTarget(null); setRejectReason(''); load()
  }

  const source = tab === 'all' ? allAllocations : myAllocations
  const filtered = source.filter(a => !search || a.employee?.full_name?.toLowerCase().includes(search.toLowerCase()) || a.project?.name?.toLowerCase().includes(search.toLowerCase()))
  const kpiSource = isViewAll ? allAllocations : myAllocations
  const kpis = {
    total: kpiSource.length,
    pending: kpiSource.filter(a => a.status === 'requested').length,
    active: kpiSource.filter(a => ['approved', 'active'].includes(a.status)).length,
    closed: kpiSource.filter(a => ['rejected', 'cancelled'].includes(a.status)).length,
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Allocations</div>
          <div className="page-subtitle">Project staffing requests, approvals & capacity commitments</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, marginBottom: 20 }}>
        <Kpi label="Total" value={kpis.total} color="#6366f1" />
        <Kpi label="Pending" value={kpis.pending} color="#f59e0b" />
        <Kpi label="Active" value={kpis.active} color="#10b981" />
        <Kpi label="Closed" value={kpis.closed} color="#94a3b8" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {[
          { id: 'my', label: 'My Allocations' },
          ...(canRequest ? [{ id: 'request', label: 'Request' }] : []),
          ...(hasDirectReports ? [{ id: 'approvals', label: `Approvals (${pendingApprovals.length})` }] : []),
          ...(isViewAll || canRequest ? [{ id: 'all', label: 'All Allocations' }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '10px 16px', border: 'none', borderBottom: `2px solid ${tab === t.id ? 'var(--c1)' : 'transparent'}`, background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: tab === t.id ? 'var(--c1)' : 'var(--text-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {(tab === 'my' || tab === 'all') && (
        <>
          <div style={{ marginBottom: 14 }}><SearchBox value={search} onChange={setSearch} placeholder="Search by employee or project…" /></div>
          {filtered.length === 0 ? <Empty icon={<CalendarRange size={44} />} title="No allocations" desc="Nothing to show yet" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Project</th>{tab === 'all' && <th>Employee</th>}<th>%</th><th>Hrs/Wk</th><th>Role</th><th>Start</th><th>End</th><th>Status</th><th>Requested By</th></tr></thead>
                <tbody>
                  {filtered.map(a => (
                    <tr key={a.id}>
                      <td className="td-bold">{a.project?.name || '—'}</td>
                      {tab === 'all' && <td>{a.employee?.full_name || '—'}</td>}
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.allocation_percent}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.allocation_hours_per_week ?? '—'}</td>
                      <td>{a.role_on_project || '—'}</td>
                      <td>{dateFmt(a.start_date)}</td>
                      <td>{a.end_date ? dateFmt(a.end_date) : 'Ongoing'}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td>{a.requester?.full_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'request' && canRequest && (
        <form onSubmit={submitRequest} style={{ maxWidth: 520 }}>
          <div className="form-group">
            <label className="form-label">Employee *</label>
            <select className="form-select" value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} required>
              <option value="">Select employee…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
            </select>
            {form.employee_id && !users.find(u => u.id === form.employee_id)?.reporting_manager_id && (
              <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 4 }}>This employee has no reporting manager set — the request can't be approved until one is assigned on the Users page.</div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Project *</label>
            <ProjectSelect value={form.project_id} onChange={v => setForm(f => ({ ...f, project_id: v }))} projects={projects} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Allocation % *</label>
              <input className="form-input" type="number" min={1} max={100} value={form.allocation_percent} onChange={e => setForm(f => ({ ...f, allocation_percent: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">Role on Project</label>
              <input className="form-input" value={form.role_on_project} onChange={e => setForm(f => ({ ...f, role_on_project: e.target.value }))} placeholder="e.g. Firmware Engineer" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Date *</label>
              <input className="form-input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">End Date</label>
              <input className="form-input" type="date" value={form.end_date} min={form.start_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Leave blank for an open-ended allocation</div>
            </div>
          </div>

          {conflict && (
            <div style={{ marginBottom: 14 }}>
              <Alert type="warning" message={
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6 }}><AlertTriangle size={14} /> Over-allocation warning</div>
                  <div style={{ fontSize: 12.5, marginBottom: 6 }}>Already committed {conflict.committedPct}% for overlapping dates — this request would bring total to <strong>{conflict.projectedTotal}%</strong>:</div>
                  <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12 }}>
                    {conflict.overlapping.map(o => <li key={o.id}>{o.project?.name} — {o.allocation_percent}% ({dateFmt(o.start_date)} → {o.end_date ? dateFmt(o.end_date) : 'ongoing'})</li>)}
                  </ul>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                    <input type="checkbox" checked={form.override} onChange={e => setForm(f => ({ ...f, override: e.target.checked }))} />
                    Override and proceed anyway
                  </label>
                  {form.override && (
                    <textarea className="form-textarea" placeholder="Justification for override…" value={form.override_justification} onChange={e => setForm(f => ({ ...f, override_justification: e.target.value }))} style={{ minHeight: 50, fontSize: 12.5 }} required />
                  )}
                </div>
              } />
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={submitting || (conflict && (!form.override || !form.override_justification.trim()))}>
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      )}

      {tab === 'approvals' && hasDirectReports && (
        pendingApprovals.length === 0 ? <Empty icon={<Check size={44} />} title="All caught up" desc="No pending allocation requests" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pendingApprovals.map(a => (
              <div key={a.id} style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.employee?.full_name} → {a.project?.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{a.allocation_percent}% · {a.allocation_hours_per_week}h/wk{a.role_on_project ? ` · ${a.role_on_project}` : ''} · {dateFmt(a.start_date)} → {a.end_date ? dateFmt(a.end_date) : 'ongoing'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Requested by {a.requester?.full_name}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => approve(a)}><Check size={13} /> Approve</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => setRejectTarget(a)}><X size={13} /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <Modal open={!!rejectTarget} onClose={() => { setRejectTarget(null); setRejectReason('') }} title="Reject Allocation Request"
        footer={<><button className="btn btn-ghost" onClick={() => { setRejectTarget(null); setRejectReason('') }}>Cancel</button><button className="btn btn-primary" style={{ background: '#ef4444' }} disabled={!rejectReason.trim()} onClick={reject}>Reject</button></>}>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-textarea" value={rejectReason} onChange={e => setRejectReason(e.target.value)} style={{ minHeight: 80 }} placeholder="Explain why this request is being rejected…" />
        </div>
      </Modal>
    </div>
  )
}

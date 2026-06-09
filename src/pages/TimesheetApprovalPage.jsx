import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { Modal, Loader, Empty } from '../components/ui'
import { Check, X, Send, Clock, Users, AlertCircle, CheckCircle } from 'lucide-react'
import { sendNotif, notifyManagers } from '../lib/notifications'

/* ─── Constants ─────────────────────────────────────────── */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const SC = {
  draft:           { label:'Draft',            color:'#64748b', bg:'#f1f5f9' },
  pending_manager: { label:'Pending Manager',  color:'#d97706', bg:'#fef3c7' },
  pending_hr:      { label:'Pending HR',       color:'#7c3aed', bg:'#ede9fe' },
  pending_finance: { label:'Pending Finance',  color:'#1d4ed8', bg:'#dbeafe' },
  approved:        { label:'Approved',         color:'#15803d', bg:'#dcfce7' },
  rejected:        { label:'Rejected',         color:'#dc2626', bg:'#fee2e2' },
}

/* ─── Helpers ────────────────────────────────────────────── */
const Badge = ({ status }) => {
  const c = SC[status] || SC.draft
  return (
    <span style={{ padding:'2px 10px', borderRadius:5, fontSize:11, fontWeight:700, background:c.bg, color:c.color, whiteSpace:'nowrap' }}>
      {c.label}
    </span>
  )
}

const Kpi = ({ label, value, color }) => (
  <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, borderTop:`2px solid ${color}`, padding:'10px 14px' }}>
    <div style={{ fontWeight:800, fontSize:22, color, lineHeight:1 }}>{value}</div>
    <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginTop:4 }}>{label}</div>
  </div>
)

/* ─── Approval Timeline ──────────────────────────────────── */
function ApprovalTimeline({ approval }) {
  const steps = [
    { label:'Submitted',     done:!!approval?.submitted_at,       ts:approval?.submitted_at,       who:null },
    { label:'Manager',       done:!!approval?.manager_approved_at, ts:approval?.manager_approved_at, who:approval?.manager?.full_name },
    { label:'HR',            done:!!approval?.hr_approved_at,      ts:approval?.hr_approved_at,      who:approval?.hr?.full_name },
    { label:'Finance / CEO', done:!!approval?.finance_approved_at, ts:approval?.finance_approved_at, who:approval?.finance_approver?.full_name },
  ]
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:0, flexWrap:'wrap' }}>
      {steps.map((step, i) => (
        <div key={step.label} style={{ display:'flex', alignItems:'center', gap:0 }}>
          {i > 0 && (
            <div style={{ width:28, height:2, background:step.done ? '#10b981' : 'var(--border)', flexShrink:0, marginTop:-16 }} />
          )}
          <div style={{ textAlign:'center', minWidth:84 }}>
            <div style={{ width:30, height:30, borderRadius:'50%', background:step.done ? '#10b981' : 'var(--surface-2)', border:`2px solid ${step.done ? '#10b981' : 'var(--border)'}`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 5px', transition:'all .2s' }}>
              {step.done
                ? <Check size={14} color="#fff" strokeWidth={3}/>
                : <span style={{ color:'var(--text-muted)', fontSize:11, fontWeight:700 }}>{i + 1}</span>}
            </div>
            <div style={{ fontSize:10, fontWeight:700, color:step.done ? '#15803d' : 'var(--text-muted)' }}>{step.label}</div>
            {step.who && <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:1 }}>{step.who}</div>}
            {step.ts && <div style={{ fontSize:9, color:'var(--text-muted)' }}>{dateFmt(step.ts)}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── Pending Approval List (shared by Manager / HR / Finance tabs) */
function PendingList({ approvals, onApprove, onReject, emptyMsg }) {
  if (approvals.length === 0)
    return (
      <div style={{ textAlign:'center', padding:'48px 20px', background:'var(--surface)', borderRadius:12, border:'1px solid var(--border)' }}>
        <CheckCircle size={40} style={{ color:'#10b981', marginBottom:8 }} />
        <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>All clear!</div>
        <div style={{ fontSize:12, color:'var(--text-muted)' }}>{emptyMsg || 'No pending approvals'}</div>
      </div>
    )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {approvals.map(a => (
        <div key={a.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 18px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
          <div style={{ width:40, height:40, borderRadius:12, background:'linear-gradient(135deg,var(--c1),#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:16, flexShrink:0 }}>
            {(a.employee?.full_name || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:140 }}>
            <div style={{ fontWeight:700, fontSize:14 }}>{a.employee?.full_name}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', textTransform:'capitalize' }}>{a.employee?.role}</div>
          </div>
          <div style={{ display:'flex', gap:18 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontWeight:800, fontSize:18, color:'var(--c1)' }}>{Number(a.total_hours || 0).toFixed(1)}h</div>
              <div style={{ fontSize:10, color:'var(--text-muted)' }}>Hours</div>
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontWeight:800, fontSize:18, color:'#10b981' }}>{a.total_days || 0}</div>
              <div style={{ fontSize:10, color:'var(--text-muted)' }}>Days</div>
            </div>
          </div>
          <Badge status={a.status} />
          {a.submission_note && (
            <div style={{ fontSize:11, color:'var(--text-muted)', fontStyle:'italic', flex:'1 1 100%', marginTop:4 }}>
              "{a.submission_note}"
            </div>
          )}
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            <button className="btn btn-primary btn-sm" style={{ display:'flex', alignItems:'center', gap:5 }} onClick={() => onApprove(a)}>
              <Check size={12}/> Approve
            </button>
            <button className="btn btn-ghost btn-sm" style={{ color:'var(--rose)', display:'flex', alignItems:'center', gap:5 }} onClick={() => onReject(a)}>
              <X size={12}/> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ══ MAIN PAGE ═══════════════════════════════════════════════ */
export default function TimesheetApprovalPage() {
  const { profile } = useAuth()
  const role    = profile?.role || 'employee'
  const isMgr   = ['admin','ceo','manager','department_head'].includes(role)
  const isHR    = ['admin','ceo','hr'].includes(role)
  const isFinance = ['admin','ceo','finance'].includes(role)
  const isAdmin   = ['admin','ceo'].includes(role)

  const now = new Date()
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1) // 1-12
  const [selYear,  setSelYear]  = useState(now.getFullYear())
  const [tab,      setTab]      = useState('my')

  // Data
  const [myApproval,   setMyApproval]   = useState(null)
  const [myLogs,       setMyLogs]       = useState([])
  const [allApprovals, setAllApprovals] = useState([])
  const [allUsers,     setAllUsers]     = useState([])
  const [loading,      setLoading]      = useState(true)

  // Submit modal
  const [showSubmit,  setShowSubmit]  = useState(false)
  const [submitNote,  setSubmitNote]  = useState('')
  const [submitting,  setSubmitting]  = useState(false)

  // Approve/Reject modal
  const [actionTarget,  setActionTarget]  = useState(null) // { approval, action }
  const [actionComment, setActionComment] = useState('')

  useEffect(() => { loadAll() }, [selMonth, selYear, profile?.id])

  async function loadAll() {
    if (!profile?.id) return
    setLoading(true)
    const monthStart = `${selYear}-${String(selMonth).padStart(2,'0')}-01`
    const monthEnd   = new Date(selYear, selMonth, 0).toISOString().split('T')[0]

    const [myAppRes, myLogsRes] = await Promise.all([
      supabase.from('timesheet_approvals')
        .select('*, employee:profiles!employee_id(id,full_name,role), manager:profiles!manager_id(id,full_name), hr:profiles!hr_id(id,full_name), finance_approver:profiles!finance_id(id,full_name), rejecter:profiles!rejected_by(id,full_name)')
        .eq('employee_id', profile.id)
        .eq('period_month', selMonth)
        .eq('period_year', selYear)
        .maybeSingle(),
      supabase.from('time_logs')
        .select('*, project:projects(id,name,code)')
        .eq('employee_id', profile.id)
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd)
        .order('work_date', { ascending: true }),
    ])

    setMyApproval(myAppRes.data || null)
    setMyLogs(myLogsRes.data || [])

    if (isMgr || isHR || isFinance) {
      const [allAppRes, usersRes] = await Promise.all([
        supabase.from('timesheet_approvals')
          .select('*, employee:profiles!employee_id(id,full_name,role), manager:profiles!manager_id(id,full_name), hr:profiles!hr_id(id,full_name), finance_approver:profiles!finance_id(id,full_name)')
          .eq('period_month', selMonth)
          .eq('period_year', selYear)
          .order('submitted_at', { ascending: false }),
        supabase.from('profiles').select('id,full_name,role').order('full_name'),
      ])
      setAllApprovals(allAppRes.data || [])
      setAllUsers(usersRes.data || [])
    }

    setLoading(false)
  }

  async function submitTimesheet() {
    setSubmitting(true)
    try {
      const totalHours = myLogs.reduce((s, l) => s + (l.hours_worked || 0), 0)
      const totalDays  = new Set(myLogs.map(l => l.work_date)).size
      const payload = {
        employee_id: profile.id, period_month: selMonth, period_year: selYear,
        status: 'pending_manager', total_hours: totalHours, total_days: totalDays,
        submitted_at: new Date().toISOString(), submission_note: submitNote || null,
        // Clear any previous rejection data on re-submit
        rejected_by: null, rejected_at: null, rejection_reason: null, rejected_at_level: null,
        manager_id: null, manager_approved_at: null, manager_comment: null,
        hr_id: null, hr_approved_at: null, hr_comment: null,
        finance_id: null, finance_approved_at: null, finance_comment: null,
      }
      if (myApproval?.id) {
        await supabase.from('timesheet_approvals').update(payload).eq('id', myApproval.id)
      } else {
        await supabase.from('timesheet_approvals').insert(payload)
      }
      setShowSubmit(false); setSubmitNote('')
      // Notify managers about submission
      notifyManagers({
        type: 'timesheet_submitted',
        title: `📤 Timesheet submitted`,
        body: `${profile.full_name} submitted timesheet for ${MONTHS[selMonth-1]} ${selYear}`,
        link: '/timesheet-approvals',
        senderId: profile.id,
      })
      loadAll()
    } catch (e) { alert(e.message) }
    setSubmitting(false)
  }

  async function doAction() {
    if (!actionTarget) return
    setSubmitting(true)
    try {
      const { approval, action } = actionTarget
      let update = {}
      if (action === 'approve') {
        // Determine next status based on current approval level
        if (approval.status === 'pending_manager') {
          update = { status:'pending_hr', manager_id:profile.id, manager_approved_at:new Date().toISOString(), manager_comment:actionComment||null }
        } else if (approval.status === 'pending_hr') {
          update = { status:'pending_finance', hr_id:profile.id, hr_approved_at:new Date().toISOString(), hr_comment:actionComment||null }
        } else if (approval.status === 'pending_finance') {
          update = { status:'approved', finance_id:profile.id, finance_approved_at:new Date().toISOString(), finance_comment:actionComment||null }
        }
        // Admin/CEO can approve any level in one step (skip levels)
        if (isAdmin && approval.status === 'pending_manager') {
          update = {
            status:'approved',
            manager_id:profile.id, manager_approved_at:new Date().toISOString(), manager_comment:actionComment||null,
            hr_id:profile.id, hr_approved_at:new Date().toISOString(), hr_comment:'Auto-approved by admin',
            finance_id:profile.id, finance_approved_at:new Date().toISOString(), finance_comment:'Auto-approved by admin',
          }
        }
      } else {
        const level = approval.status === 'pending_manager' ? 'manager'
          : approval.status === 'pending_hr' ? 'hr' : 'finance'
        update = { status:'rejected', rejected_by:profile.id, rejected_at:new Date().toISOString(), rejection_reason:actionComment||null, rejected_at_level:level }
      }
      await supabase.from('timesheet_approvals').update(update).eq('id', approval.id)

      // Notify the employee
      if (action === 'approve') {
        const isFinal = update.status === 'approved'
        sendNotif(approval.employee_id, {
          type: isFinal ? 'timesheet_approved' : 'timesheet_submitted',
          title: isFinal ? `✅ Timesheet fully approved` : `✅ Timesheet approved — moving to next level`,
          body: actionComment || (isFinal ? 'Your timesheet has been approved by all levels.' : `Approved by ${profile.full_name}`),
          link: '/timesheet-approvals',
          senderId: profile.id,
        })
      } else {
        sendNotif(approval.employee_id, {
          type: 'timesheet_rejected',
          title: `❌ Timesheet rejected`,
          body: actionComment || `Rejected by ${profile.full_name}`,
          link: '/timesheet-approvals',
          senderId: profile.id,
        })
      }

      setActionTarget(null); setActionComment('')
      loadAll()
    } catch (e) { alert(e.message) }
    setSubmitting(false)
  }

  /* ── Derived state ───────────────────────────────────────── */
  const totalHrs  = myLogs.reduce((s, l) => s + (l.hours_worked || 0), 0)
  const totalDays = new Set(myLogs.map(l => l.work_date)).size
  const canSubmit = myLogs.length > 0 && (!myApproval || ['draft','rejected'].includes(myApproval.status))

  const pendingMgrList = allApprovals.filter(a => a.status === 'pending_manager')
  const pendingHRList  = allApprovals.filter(a => a.status === 'pending_hr')
  const pendingFinList = allApprovals.filter(a => a.status === 'pending_finance')

  const approvalsByEmployee = useMemo(() => {
    const map = {}
    allApprovals.forEach(a => { map[a.employee_id] = a })
    return map
  }, [allApprovals])

  /* ── Tabs ────────────────────────────────────────────────── */
  const tabs = [
    { id:'my',      label:'My Timesheet' },
    isMgr && { id:'manager', label:`Manager Approval${pendingMgrList.length > 0 ? ` (${pendingMgrList.length})` : ''}` },
    isHR   && { id:'hr',     label:`HR Dashboard${pendingHRList.length > 0 ? ` (${pendingHRList.length})` : ''}` },
    isFinance && { id:'finance', label:`Finance Approval${pendingFinList.length > 0 ? ` (${pendingFinList.length})` : ''}` },
  ].filter(Boolean)

  const activeTab = tabs.some(t => t.id === tab) ? tab : 'my'

  if (loading) return <Loader />

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">Timesheet Approvals</div>
          <div className="page-subtitle">
            Monthly submission · Multi-level approval · Role: <strong style={{ textTransform:'capitalize' }}>{role.replace(/_/g,' ')}</strong>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select className="form-select" value={selMonth} onChange={e => setSelMonth(parseInt(e.target.value))} style={{ width:'auto', fontSize:12 }}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-select" value={selYear} onChange={e => setSelYear(parseInt(e.target.value))} style={{ width:'auto', fontSize:12 }}>
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* ── KPI strip (managers / HR / finance) ─────────────── */}
      {(isMgr || isHR || isFinance) && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(115px,1fr))', gap:10, marginBottom:16 }}>
          <Kpi label="Submitted"       value={allApprovals.length}                                       color="#6366f1"/>
          <Kpi label="Pending Manager" value={pendingMgrList.length}                                     color="#d97706"/>
          <Kpi label="Pending HR"      value={pendingHRList.length}                                      color="#7c3aed"/>
          <Kpi label="Pending Finance" value={pendingFinList.length}                                     color="#1d4ed8"/>
          <Kpi label="Approved"        value={allApprovals.filter(a => a.status === 'approved').length}  color="#15803d"/>
          <Kpi label="Rejected"        value={allApprovals.filter(a => a.status === 'rejected').length}  color="#dc2626"/>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', marginBottom:16 }}>
        {tabs.map(t => {
          const active = activeTab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'9px 16px', border:'none', borderBottom:`2px solid ${active ? 'var(--c1)' : 'transparent'}`, cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:active ? 700 : 500, background:'transparent', color:active ? 'var(--c1)' : 'var(--text-muted)', marginBottom:-1, transition:'all .15s', whiteSpace:'nowrap' }}>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ════════════════════════════════════════════════════════
          MY TIMESHEET TAB
      ════════════════════════════════════════════════════════ */}
      {activeTab === 'my' && (
        <div>
          {/* Approval status timeline */}
          {myApproval && (
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 20px', marginBottom:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:8 }}>
                <div style={{ fontWeight:700, fontSize:14 }}>Approval Progress — {MONTHS[selMonth - 1]} {selYear}</div>
                <Badge status={myApproval.status}/>
              </div>
              <ApprovalTimeline approval={myApproval}/>
              {myApproval.status === 'rejected' && (
                <div style={{ marginTop:14, padding:'10px 14px', borderRadius:8, background:'#fee2e2', border:'1px solid #fecaca' }}>
                  <div style={{ fontWeight:700, fontSize:12, color:'#dc2626', marginBottom:3 }}>
                    ❌ Rejected at {myApproval.rejected_at_level} level
                    {myApproval.rejecter && ` by ${myApproval.rejecter.full_name}`}
                  </div>
                  {myApproval.rejection_reason && (
                    <div style={{ fontSize:12, color:'#991b1b' }}>{myApproval.rejection_reason}</div>
                  )}
                  <div style={{ fontSize:11, color:'#b91c1c', marginTop:4 }}>Correct your entries and resubmit.</div>
                </div>
              )}
            </div>
          )}

          {/* Summary + Submit */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, borderTop:'2px solid #6366f1', padding:'14px 16px' }}>
              <div style={{ fontWeight:800, fontSize:22, color:'#6366f1' }}>{totalHrs.toFixed(1)}h</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginTop:4 }}>Total Hours</div>
            </div>
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, borderTop:'2px solid #10b981', padding:'14px 16px' }}>
              <div style={{ fontWeight:800, fontSize:22, color:'#10b981' }}>{totalDays}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginTop:4 }}>Working Days</div>
            </div>
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, borderTop:'2px solid #f59e0b', padding:'14px 16px' }}>
              <div style={{ fontWeight:800, fontSize:22, color:'#f59e0b' }}>{myLogs.length}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginTop:4 }}>Log Entries</div>
            </div>
          </div>

          {/* Status banners */}
          {!myApproval && myLogs.length > 0 && (
            <div style={{ marginBottom:12, padding:'10px 14px', borderRadius:8, background:'#fef3c7', fontSize:12, color:'#92400e', fontWeight:600, border:'1px solid #fde68a', display:'flex', alignItems:'center', gap:8 }}>
              <AlertCircle size={14}/> Timesheet not submitted yet for {MONTHS[selMonth - 1]} {selYear}
            </div>
          )}
          {myApproval?.status === 'pending_manager'  && <div style={{ marginBottom:12, padding:'10px 14px', borderRadius:8, background:'#fef3c7', fontSize:12, color:'#92400e', fontWeight:600, border:'1px solid #fde68a' }}>⏳ Waiting for manager approval</div>}
          {myApproval?.status === 'pending_hr'        && <div style={{ marginBottom:12, padding:'10px 14px', borderRadius:8, background:'#ede9fe', fontSize:12, color:'#5b21b6', fontWeight:600, border:'1px solid #ddd6fe' }}>⏳ Manager approved — waiting for HR approval</div>}
          {myApproval?.status === 'pending_finance'   && <div style={{ marginBottom:12, padding:'10px 14px', borderRadius:8, background:'#dbeafe', fontSize:12, color:'#1e40af', fontWeight:600, border:'1px solid #bfdbfe' }}>⏳ HR approved — waiting for Finance / CEO approval</div>}
          {myApproval?.status === 'approved'          && <div style={{ marginBottom:12, padding:'10px 14px', borderRadius:8, background:'#dcfce7', fontSize:12, color:'#166534', fontWeight:600, border:'1px solid #bbf7d0' }}>✅ Fully approved for {MONTHS[selMonth - 1]} {selYear}</div>}

          {/* Submit button */}
          {canSubmit && (
            <div style={{ marginBottom:16 }}>
              <button className="btn btn-primary" style={{ display:'flex', alignItems:'center', gap:6 }} onClick={() => setShowSubmit(true)}>
                <Send size={13}/> Submit {MONTHS[selMonth - 1]} {selYear} for Approval
              </button>
            </div>
          )}

          {/* Daily log table */}
          {myLogs.length === 0 ? (
            <Empty icon="🕐" title="No time entries" desc={`No check-in records for ${MONTHS[selMonth - 1]} ${selYear}. Use the Check In button in the top bar to log your work.`}/>
          ) : (
            <div className="table-wrap">
              <div className="table-toolbar">
                <span style={{ fontWeight:700, fontSize:14 }}>Daily Log — {MONTHS[selMonth - 1]} {selYear}</span>
                <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)' }}>{myLogs.length} entries · {totalHrs.toFixed(1)}h total</span>
              </div>
              <table>
                <thead>
                  <tr><th>Date</th><th>Project</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {myLogs.map(l => (
                    <tr key={l.id}>
                      <td style={{ fontWeight:600, fontSize:13 }}>{dateFmt(l.work_date)}</td>
                      <td>
                        {l.project
                          ? <span style={{ padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background:'#ede9fe', color:'#6d28d9' }}>{l.project.name}</span>
                          : <span style={{ color:'var(--text-muted)', fontSize:11 }}>—</span>}
                      </td>
                      <td style={{ fontFamily:'monospace', fontSize:12, color:'#059669' }}>
                        {l.check_in ? new Date(l.check_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—'}
                      </td>
                      <td style={{ fontFamily:'monospace', fontSize:12, color:l.check_out?'#dc2626':'#f59e0b' }}>
                        {l.check_out ? new Date(l.check_out).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : l.hours_worked ? '—' : '🟢 Active'}
                      </td>
                      <td style={{ fontWeight:700, color:'#6366f1', fontFamily:'monospace' }}>
                        {l.hours_worked != null ? `${l.hours_worked}h` : <span style={{ color:'var(--text-muted)', fontSize:11 }}>—</span>}
                      </td>
                      <td style={{ fontSize:11, color:'var(--text-muted)', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {l.comment || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background:'var(--surface-2)' }}>
                    <td colSpan={4} style={{ fontWeight:700, fontSize:13, padding:'10px 14px' }}>Total</td>
                    <td style={{ fontWeight:800, fontSize:15, color:'#6366f1', fontFamily:'monospace' }}>{totalHrs.toFixed(1)}h</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MANAGER APPROVAL TAB
      ════════════════════════════════════════════════════════ */}
      {activeTab === 'manager' && (
        <div>
          <div style={{ fontWeight:700, fontSize:13, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>
            Pending Manager Approval — {MONTHS[selMonth - 1]} {selYear}
          </div>
          <PendingList
            approvals={isAdmin ? allApprovals.filter(a => ['pending_manager','pending_hr','pending_finance'].includes(a.status)) : pendingMgrList}
            onApprove={a => { setActionTarget({ approval:a, action:'approve' }); setActionComment('') }}
            onReject={a  => { setActionTarget({ approval:a, action:'reject'  }); setActionComment('') }}
            emptyMsg="No timesheets pending manager review this month."
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          HR DASHBOARD TAB
      ════════════════════════════════════════════════════════ */}
      {activeTab === 'hr' && (
        <div>
          {/* Pending HR approvals */}
          {pendingHRList.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontWeight:700, fontSize:13, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>
                Pending HR Approval ({pendingHRList.length})
              </div>
              <PendingList
                approvals={pendingHRList}
                onApprove={a => { setActionTarget({ approval:a, action:'approve' }); setActionComment('') }}
                onReject={a  => { setActionTarget({ approval:a, action:'reject'  }); setActionComment('') }}
              />
            </div>
          )}

          {/* Full employee status table */}
          <div style={{ fontWeight:700, fontSize:13, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12, marginTop: pendingHRList.length > 0 ? 0 : 0 }}>
            All Employees — {MONTHS[selMonth - 1]} {selYear}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th><th>Role</th><th>Hours</th><th>Days</th><th>Status</th>
                  <th>Submitted</th><th>Manager</th><th>HR</th><th>Finance</th>
                </tr>
              </thead>
              <tbody>
                {allUsers.map(u => {
                  const a = approvalsByEmployee[u.id]
                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight:600 }}>{u.full_name}</td>
                      <td><span style={{ fontSize:11, textTransform:'capitalize', color:'var(--text-muted)' }}>{u.role}</span></td>
                      <td style={{ fontWeight:700, color:'#6366f1', fontFamily:'monospace' }}>{a?.total_hours != null ? `${Number(a.total_hours).toFixed(1)}h` : '—'}</td>
                      <td>{a?.total_days || '—'}</td>
                      <td><Badge status={a?.status || 'draft'}/></td>
                      <td style={{ fontSize:11, color:'var(--text-muted)' }}>{a?.submitted_at ? dateFmt(a.submitted_at) : '—'}</td>
                      <td style={{ fontSize:11 }}>
                        {a?.manager_approved_at
                          ? <span style={{ color:'#15803d', fontWeight:600 }}>✓ {a.manager?.full_name || ''}</span>
                          : <span style={{ color:'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize:11 }}>
                        {a?.hr_approved_at
                          ? <span style={{ color:'#15803d', fontWeight:600 }}>✓ {a.hr?.full_name || ''}</span>
                          : <span style={{ color:'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize:11 }}>
                        {a?.finance_approved_at
                          ? <span style={{ color:'#15803d', fontWeight:600 }}>✓ {a.finance_approver?.full_name || ''}</span>
                          : <span style={{ color:'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          FINANCE / CEO APPROVAL TAB
      ════════════════════════════════════════════════════════ */}
      {activeTab === 'finance' && (
        <div>
          <div style={{ fontWeight:700, fontSize:13, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>
            Pending Finance / CEO Approval — {MONTHS[selMonth - 1]} {selYear}
          </div>
          <PendingList
            approvals={pendingFinList}
            onApprove={a => { setActionTarget({ approval:a, action:'approve' }); setActionComment('') }}
            onReject={a  => { setActionTarget({ approval:a, action:'reject'  }); setActionComment('') }}
            emptyMsg="No timesheets pending final approval this month."
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODALS
      ════════════════════════════════════════════════════════ */}

      {/* Submit timesheet */}
      <Modal open={showSubmit} onClose={() => setShowSubmit(false)}
        title={`Submit Timesheet — ${MONTHS[selMonth - 1]} ${selYear}`}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowSubmit(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitTimesheet} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </button>
        </>}>
        <div style={{ marginBottom:14, padding:'14px 16px', borderRadius:10, background:'var(--surface-2)', border:'1px solid var(--border)', display:'flex', gap:24 }}>
          <div><div style={{ fontSize:20, fontWeight:800, color:'#6366f1' }}>{totalHrs.toFixed(1)}h</div><div style={{ fontSize:11, color:'var(--text-muted)' }}>Total Hours</div></div>
          <div><div style={{ fontSize:20, fontWeight:800, color:'#10b981' }}>{totalDays}</div><div style={{ fontSize:11, color:'var(--text-muted)' }}>Working Days</div></div>
          <div><div style={{ fontSize:20, fontWeight:800, color:'#f59e0b' }}>{myLogs.length}</div><div style={{ fontSize:11, color:'var(--text-muted)' }}>Entries</div></div>
        </div>
        <div className="form-group">
          <label className="form-label">Note for approver (optional)</label>
          <textarea className="form-textarea" rows={3} value={submitNote} onChange={e => setSubmitNote(e.target.value)} placeholder="Any context or notes for your manager…"/>
        </div>
        {myApproval?.status === 'rejected' && (
          <div style={{ padding:'10px 14px', borderRadius:8, background:'#fee2e2', fontSize:12, color:'#dc2626', fontWeight:600, border:'1px solid #fecaca' }}>
            ⚠ Previously rejected. Resubmitting will restart the full approval chain from the manager.
          </div>
        )}
      </Modal>

      {/* Approve / Reject */}
      <Modal open={!!actionTarget} onClose={() => setActionTarget(null)}
        title={actionTarget?.action === 'approve'
          ? `✅ Approve — ${actionTarget?.approval?.employee?.full_name}`
          : `❌ Reject — ${actionTarget?.approval?.employee?.full_name}`}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setActionTarget(null)}>Cancel</button>
          <button
            className="btn btn-primary"
            style={actionTarget?.action === 'reject' ? { background:'#dc2626', borderColor:'#dc2626' } : {}}
            onClick={doAction}
            disabled={submitting || (actionTarget?.action === 'reject' && !actionComment.trim())}>
            {submitting ? 'Saving…' : actionTarget?.action === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </>}>
        {actionTarget && (
          <div>
            <div style={{ marginBottom:14, padding:'12px 14px', borderRadius:8, background:'var(--surface-2)' }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>
                {actionTarget.approval.employee?.full_name} · {MONTHS[selMonth - 1]} {selYear}
              </div>
              <div style={{ display:'flex', gap:16, fontSize:12, color:'var(--text-muted)', flexWrap:'wrap' }}>
                <span>Hours: <strong style={{ color:'#6366f1' }}>{Number(actionTarget.approval.total_hours||0).toFixed(1)}h</strong></span>
                <span>Days: <strong style={{ color:'#10b981' }}>{actionTarget.approval.total_days || 0}</strong></span>
                <Badge status={actionTarget.approval.status}/>
              </div>
              {actionTarget.approval.submission_note && (
                <div style={{ marginTop:8, fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>
                  Employee note: "{actionTarget.approval.submission_note}"
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">
                {actionTarget.action === 'reject' ? 'Rejection reason *' : 'Comment (optional)'}
              </label>
              <textarea className="form-textarea" rows={3} value={actionComment} onChange={e => setActionComment(e.target.value)}
                placeholder={actionTarget.action === 'reject' ? 'Required — explain why the timesheet is being rejected…' : 'Optional note for the employee…'}/>
            </div>
            {actionTarget.action === 'reject' && !actionComment.trim() && (
              <div style={{ fontSize:11, color:'#dc2626', fontWeight:600 }}>A rejection reason is required.</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

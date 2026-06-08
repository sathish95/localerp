import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Loader, Empty, Modal } from '../components/ui'
import { Clock, Plus, CheckCircle, Download, Calendar, User } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const today = () => new Date().toISOString().split('T')[0]

export default function TimesheetPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isMgr = ['admin','ceo','manager','hr','finance'].includes(role)

  const [logs,      setLogs]      = useState([])
  const [users,     setUsers]     = useState([])
  const [projects,  setProjects]  = useState([])
  const [rates,     setRates]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [selUser,   setSelUser]   = useState(profile?.id || '')
  const [selMonth,  setSelMonth]  = useState(new Date().getMonth())
  const [selYear,   setSelYear]   = useState(new Date().getFullYear())
  const [showAdd,   setShowAdd]   = useState(false)
  const [submitting,setSub]       = useState(false)

  // Add entry form
  const [form, setForm] = useState({
    user_id: profile?.id || '', date: today(), project_id: '', hours: '', comment: ''
  })

  useEffect(() => { loadAll() }, [selUser, selMonth, selYear])

  async function loadAll() {
    setLoading(true)
    const monthStart = `${selYear}-${String(selMonth+1).padStart(2,'0')}-01`
    const monthEnd   = new Date(selYear, selMonth+1, 0).toISOString().split('T')[0]

    const uid = isMgr ? (selUser || undefined) : profile?.id

    let q = supabase.from('time_logs')
      .select('*, employee:profiles!employee_id(id,full_name,role), project:projects(id,name,code)')
      .gte('work_date', monthStart).lte('work_date', monthEnd)
      .order('work_date', { ascending:false })

    if (uid) q = q.eq('employee_id', uid)

    const [logsRes, usersRes, projRes, ratesRes] = await Promise.all([
      q,
      isMgr ? supabase.from('profiles').select('id,full_name,role').order('full_name') : Promise.resolve({ data:[] }),
      supabase.from('projects').select('id,name,code').eq('status','active').order('name'),
      supabase.from('resource_rates').select('employee_id,monthly_salary,hourly_rate'),
    ])

    setLogs(logsRes.data || [])
    setUsers(usersRes.data || [])
    setProjects(projRes.data || [])
    setRates(ratesRes.data || [])
    setLoading(false)
  }

  async function submitEntry(e) {
    e.preventDefault(); setSub(true)
    try {
      const uid = isMgr ? form.user_id : profile?.id
      const { error } = await supabase.from('time_logs').insert({
        employee_id:  uid,
        project_id:   form.project_id || null,
        work_date:    form.date,
        check_in:     `${form.date}T09:00:00`,
        check_out:    form.hours ? `${form.date}T${String(9+Math.floor(parseFloat(form.hours))).padStart(2,'0')}:${String(Math.round((parseFloat(form.hours)%1)*60)).padStart(2,'0')}:00` : null,
        hours_worked: parseFloat(form.hours) || null,
        comment:      form.comment || null,
      })
      if (error) throw error
      setShowAdd(false); setForm({ user_id:profile?.id||'', date:today(), project_id:'', hours:'', comment:'' }); loadAll()
    } catch(e) { alert(e.message) }
    finally { setSub(false) }
  }

  // ── Computed ──────────────────────────────────────────────
  const totalHours = logs.reduce((s,l)=>s+(l.hours_worked||0),0)
  const byUser = {}
  logs.forEach(l => {
    const uid = l.employee_id; const name = l.employee?.full_name||'Unknown'
    if (!byUser[uid]) byUser[uid] = { name, role:l.employee?.role, hours:0, days:new Set(), logs:[] }
    byUser[uid].hours += l.hours_worked||0
    if(l.work_date) byUser[uid].days.add(l.work_date)
    byUser[uid].logs.push(l)
  })

  function getRate(uid) { return rates.find(r=>r.employee_id===uid) }

  function calcPay(uid) {
    const r = getRate(uid); if(!r) return null
    const u = byUser[uid]; if(!u) return null
    const hrRate = r.hourly_rate || (r.monthly_salary/(22*8))
    return { gross: Math.round(u.hours * hrRate), hourly: hrRate.toFixed(0) }
  }

  function exportCSV() {
    const rows = [['Date','Employee','Project','Hours','Work Done']]
    logs.forEach(l=>rows.push([l.work_date,l.employee?.full_name||'',l.project?.name||'',l.hours_worked||'',l.comment||'']))
    const csv = rows.map(r=>r.join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob)
    a.download=`timesheet-${MONTHS[selMonth]}-${selYear}.csv`; a.click()
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Timesheet</div>
          <div className="page-subtitle">Track and submit working hours by project</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-outline btn-sm" onClick={exportCSV}><Download size={13}/> Export CSV</button>
          <button className="btn btn-primary" onClick={()=>setShowAdd(true)}><Plus size={14}/> Add Entry</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        {isMgr && (
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <User size={14} style={{ color:'#64748b' }}/>
            <select className="form-select" value={selUser} onChange={e=>setSelUser(e.target.value)} style={{ width:'auto' }}>
              <option value="">All Users</option>
              {users.map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
            </select>
          </div>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Calendar size={14} style={{ color:'#64748b' }}/>
          <select className="form-select" value={selMonth} onChange={e=>setSelMonth(parseInt(e.target.value))} style={{ width:'auto' }}>
            {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>
          <select className="form-select" value={selYear} onChange={e=>setSelYear(parseInt(e.target.value))} style={{ width:'auto' }}>
            {[2023,2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:16 }}>
          {[
            { l:'Total Hours', v:`${totalHours.toFixed(1)}h`, c:'#6366f1' },
            { l:'Working Days', v:new Set(logs.map(l=>l.work_date)).size, c:'#10b981' },
            { l:'Team Members', v:Object.keys(byUser).length, c:'#f59e0b' },
          ].map(s=>(
            <div key={s.l} style={{ textAlign:'right' }}>
              <div style={{ fontWeight:800, fontSize:18, color:s.c }}>{s.v}</div>
              <div style={{ fontSize:11, color:'#64748b' }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* User summary cards (manager view) */}
      {isMgr && Object.keys(byUser).length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:12, marginBottom:20 }}>
          {Object.entries(byUser).map(([uid, u])=>{
            const pay = calcPay(uid)
            const rate = getRate(uid)
            return (
              <div key={uid} style={{ background:'#fff', borderRadius:14, padding:'16px', border:'1.5px solid #e2e8f0', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                  <div style={{ width:38, height:38, borderRadius:12, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:15, flexShrink:0 }}>
                    {u.name[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:13 }}>{u.name}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', textTransform:'capitalize' }}>{u.role}</div>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div style={{ padding:'8px', borderRadius:8, background:'#f8fafc' }}>
                    <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>Hours</div>
                    <div style={{ fontSize:18, fontWeight:800, color:'#6366f1' }}>{u.hours.toFixed(1)}h</div>
                  </div>
                  <div style={{ padding:'8px', borderRadius:8, background:'#f8fafc' }}>
                    <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>Days</div>
                    <div style={{ fontSize:18, fontWeight:800, color:'#10b981' }}>{u.days.size}</div>
                  </div>
                </div>
                {pay ? (
                  <div style={{ marginTop:10, padding:'8px 10px', borderRadius:8, background:'#f0fdf4', border:'1px solid #bbf7d0' }}>
                    <div style={{ fontSize:10, color:'#15803d', fontWeight:700 }}>Est. Pay ({MONTHS[selMonth]})</div>
                    <div style={{ fontSize:16, fontWeight:800, color:'#15803d' }}>{rupee(pay.gross)}</div>
                    <div style={{ fontSize:10, color:'#64748b' }}>@ ₹{pay.hourly}/hr</div>
                  </div>
                ) : !rate && (
                  <div style={{ marginTop:10, padding:'6px 10px', borderRadius:8, background:'#fef3c7', fontSize:11, color:'#b45309', fontWeight:600 }}>⚠ No rate set</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Detailed log table */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <span style={{ fontWeight:700, fontSize:14 }}>Log Entries — {MONTHS[selMonth]} {selYear}</span>
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>{logs.length} entries</span>
        </div>
        {logs.length===0 ? (
          <Empty icon={<Clock size={44}/>} title="No entries" desc="Add time entries for this period"/>
        ) : (
          <table>
            <thead><tr>
              <th>Date</th>
              {isMgr && <th>Employee</th>}
              <th>Project</th><th>Hours</th><th>Check In</th><th>Check Out</th><th>Work Done</th>
            </tr></thead>
            <tbody>
              {logs.map(l=>(
                <tr key={l.id}>
                  <td style={{ fontWeight:600, fontSize:13 }}>{dateFmt(l.work_date)}</td>
                  {isMgr && (
                    <td>
                      <div style={{ fontWeight:600, fontSize:13 }}>{l.employee?.full_name}</div>
                      <div style={{ fontSize:11, color:'#94a3b8', textTransform:'capitalize' }}>{l.employee?.role}</div>
                    </td>
                  )}
                  <td>{l.project ? <span style={{ padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#ede9fe', color:'#6d28d9' }}>{l.project.name}</span> : <span style={{ color:'#94a3b8', fontSize:12 }}>—</span>}</td>
                  <td style={{ fontWeight:800, color:'#6366f1', fontSize:14 }}>{l.hours_worked!=null ? `${l.hours_worked}h` : <span style={{ color:'#10b981', fontSize:11 }}>⏳ Active</span>}</td>
                  <td style={{ fontFamily:'monospace', fontSize:12, color:'#059669' }}>{l.check_in ? new Date(l.check_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
                  <td style={{ fontFamily:'monospace', fontSize:12, color:l.check_out?'#dc2626':'#f59e0b' }}>{l.check_out ? new Date(l.check_out).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : l.hours_worked ? '—' : '🟢 In'}</td>
                  <td style={{ fontSize:12, color:'#64748b', maxWidth:180, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l.comment||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Entry Modal */}
      <Modal open={showAdd} onClose={()=>setShowAdd(false)} title="Add Timesheet Entry"
        footer={<>
          <button className="btn btn-ghost" onClick={()=>setShowAdd(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitEntry} disabled={submitting}>{submitting?'Saving…':'Add Entry'}</button>
        </>}>
        {isMgr && (
          <div className="form-group">
            <label className="form-label">Employee *</label>
            <select className="form-select" value={form.user_id} onChange={e=>setForm(f=>({...f,user_id:e.target.value}))} required>
              <option value="">Select employee…</option>
              {users.map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
            </select>
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} required/>
          </div>
          <div className="form-group">
            <label className="form-label">Hours Worked *</label>
            <input className="form-input" type="number" step="0.5" min="0.5" max="16" value={form.hours} onChange={e=>setForm(f=>({...f,hours:e.target.value}))} placeholder="e.g. 8" required/>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Project</label>
          <select className="form-select" value={form.project_id} onChange={e=>setForm(f=>({...f,project_id:e.target.value}))}>
            <option value="">No project</option>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">What did you work on?</label>
          <textarea className="form-textarea" value={form.comment} onChange={e=>setForm(f=>({...f,comment:e.target.value}))} placeholder="Brief description of work done…"/>
        </div>
        {form.user_id && form.hours && (() => {
          const r = getRate(form.user_id||profile?.id)
          if (!r) return null
          const hrRate = r.hourly_rate||(r.monthly_salary/(22*8))
          const pay = Math.round(parseFloat(form.hours)*hrRate)
          return (
            <div style={{ padding:'10px 14px', borderRadius:10, background:'#f0fdf4', border:'1px solid #bbf7d0', fontSize:12, fontWeight:600, color:'#15803d' }}>
              💰 Estimated pay for this entry: {rupee(pay)} (@ ₹{hrRate.toFixed(0)}/hr)
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

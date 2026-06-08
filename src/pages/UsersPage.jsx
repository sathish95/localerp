import { useState, useEffect } from 'react'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { SearchBox, Empty, Modal, Loader, Confirm } from '../components/ui'
import {
  Users, Shield, Crown, Briefcase, Calculator, User, Building2,
  BadgeCheck, Plus, Edit2, Trash2, Eye, ArrowLeft, ChevronRight,
  Clock, DollarSign, Calendar, TrendingUp, CheckCircle, XCircle,
  ToggleLeft, ToggleRight
} from 'lucide-react'

const ROLE_CFG = {
  admin:           { label:'Admin',       icon:Shield,    grad:['#7c3aed','#a855f7'], light:'#ede9fe', dark:'#6d28d9' },
  ceo:             { label:'CEO',         icon:Crown,     grad:['#dc2626','#f97316'], light:'#fee2e2', dark:'#991b1b' },
  manager:         { label:'Manager',     icon:Briefcase, grad:['#0284c7','#06b6d4'], light:'#dbeafe', dark:'#1d4ed8' },
  finance:         { label:'Finance',     icon:Calculator,grad:['#059669','#34d399'], light:'#d1fae5', dark:'#065f46' },
  hr:              { label:'HR',          icon:Users,     grad:['#0891b2','#22d3ee'], light:'#cffafe', dark:'#155e75' },
  employee:        { label:'Employee',    icon:User,      grad:['#d97706','#fbbf24'], light:'#fef3c7', dark:'#92400e' },
  department_head: { label:'Dept. Head',  icon:Building2, grad:['#7c3aed','#6366f1'], light:'#ede9fe', dark:'#4c1d95' },
}
const ALL_ROLES = ['admin','ceo','manager','finance','hr','employee']
const fmt = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'

const initForm = () => ({
  full_name:'', email:'', role:'employee', designation:'', phone:'', department_id:'', is_active:true
})

export default function UsersPage() {
  const { profile } = useAuth()
  const myRole = profile?.role || 'employee'
  const canEdit = ['admin','ceo','hr'].includes(myRole)

  const [users,    setUsers]    = useState([])
  const [depts,    setDepts]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [roleFilter, setRoleF]  = useState('all')
  const [detail,   setDetail]   = useState(null)
  const [detailData, setDD]     = useState(null)
  const [detailLoad, setDL]     = useState(false)
  const [showModal, setShowM]   = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [form,     setForm]     = useState(initForm())
  const [submitting, setSub]    = useState(false)
  const [delUser,  setDelUser]  = useState(null)
  const [err,      setErr]      = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [u, d] = await Promise.all([
      supabase.from('profiles').select('*, department:departments(name)').order('full_name'),
      supabase.from('departments').select('id,name').order('name'),
    ])
    setUsers(u.data || [])
    setDepts(d.data || [])
    setLoading(false)
  }

  async function openDetail(user) {
    setDetail(user); setDL(true); setDD(null)
    const YEAR = new Date().getFullYear()
    const monthStart = `${YEAR}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`
    const [logs, leaves, expenses, rate] = await Promise.all([
      supabase.from('time_logs').select('hours_worked,work_date,project:projects(name)').eq('employee_id',user.id).order('work_date',{ascending:false}).limit(30),
      supabase.from('leave_requests').select('leave_type,from_date,to_date,permission_hours,status').eq('employee_id',user.id).eq('fiscal_year' in {} ? 'fiscal_year' : 'employee_id', user.id),
      supabase.from('expense_requests').select('amount,total_amount,status,expense_date,category').eq('requested_by',user.id).order('created_at',{ascending:false}).limit(20),
      supabase.from('resource_rates').select('monthly_salary,hourly_rate').eq('employee_id',user.id).maybeSingle(),
    ])
    const logData = logs.data || []
    const leaveData = leaves.data || []
    const expData = expenses.data || []
    const rateData = rate.data

    const totalHours = logData.reduce((s,l)=>s+(l.hours_worked||0),0)
    const thisMonthLogs = logData.filter(l=>l.work_date>=monthStart)
    const monthHours = thisMonthLogs.reduce((s,l)=>s+(l.hours_worked||0),0)
    const totalExpense = expData.reduce((s,e)=>s+(e.total_amount||e.amount||0),0)
    const approvedExp = expData.filter(e=>e.status==='approved').reduce((s,e)=>s+(e.total_amount||e.amount||0),0)
    const leaveDays = leaveData.filter(l=>l.status==='approved'&&l.leave_type!=='permission').reduce((s,l)=>{
      const d = l.to_date && l.from_date ? Math.ceil((new Date(l.to_date)-new Date(l.from_date))/86400000)+1 : 1
      return s+d
    },0)

    setDD({ logs:logData, leaves:leaveData, expenses:expData, rate:rateData, totalHours, monthHours, totalExpense, approvedExp, leaveDays })
    setDL(false)
  }

  async function handleSave(e) {
    e.preventDefault(); setSub(true); setErr('')
    try {
      const payload = {
        full_name: form.full_name,
        role: form.role,
        designation: form.designation || null,
        phone: form.phone || null,
        department_id: form.department_id || null,
        is_active: form.is_active,
      }
      if (editing) {
        const { error } = await supabase.from('profiles').update(payload).eq('id', editing.id)
        if (error) throw error
        if (detail?.id === editing.id) setDetail(prev => ({ ...prev, ...payload }))
      } else {
        // Create via Supabase auth signup
        const { data: authData, error: authErr } = await supabase.auth.admin?.createUser?.({
          email: form.email, email_confirm: true,
          user_metadata: { full_name: form.full_name, role: form.role }
        })
        if (authErr) {
          // Fallback: just insert into profiles if admin API not available
          const { error } = await supabase.from('profiles').insert({
            ...payload, email: form.email,
            id: crypto.randomUUID()
          })
          if (error) throw new Error('To create users, use Supabase Auth → Add user. Then update their role here.')
        }
      }
      setShowM(false); setForm(initForm()); load()
    } catch(e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function toggleActive(user) {
    await supabase.from('profiles').update({ is_active: !user.is_active }).eq('id', user.id)
    load()
    if (detail?.id === user.id) setDetail(prev => ({ ...prev, is_active: !prev.is_active }))
  }

  async function deleteUser(id) {
    await supabase.from('profiles').delete().eq('id', id)
    setDelUser(null); load(); if (detail?.id === id) setDetail(null)
  }

  const filtered = users.filter(u => {
    const ms = !search || u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
    const mf = roleFilter === 'all' || u.role === roleFilter
    return ms && mf
  })
  const roleCounts = ALL_ROLES.reduce((acc,r)=>({...acc,[r]:users.filter(u=>u.role===r).length}),{})

  if (loading) return <Loader />

  /* ── DETAIL VIEW ── */
  if (detail) {
    const rc = ROLE_CFG[detail.role] || ROLE_CFG.employee
    const Icon = rc.icon
    const initials = (detail.full_name||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
    const dd = detailData

    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setDetail(null)} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <ArrowLeft size={14}/> All Users
          </button>
          <ChevronRight size={14} style={{ color:'#94a3b8' }}/>
          <span style={{ fontWeight:700 }}>{detail.full_name}</span>
          {canEdit && (
            <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
              <button className="btn btn-outline btn-sm" onClick={()=>toggleActive(detail)}>
                {detail.is_active ? <><ToggleRight size={13}/> Deactivate</> : <><ToggleLeft size={13}/> Activate</>}
              </button>
              <button className="btn btn-outline btn-sm" onClick={()=>{setEditing(detail);setForm({full_name:detail.full_name||'',email:detail.email||'',role:detail.role||'employee',designation:detail.designation||'',phone:detail.phone||'',department_id:detail.department_id||'',is_active:detail.is_active!==false});setErr('');setShowM(true)}}>
                <Edit2 size={13}/> Edit
              </button>
              <button className="btn btn-ghost btn-sm" style={{color:'#ef4444'}} onClick={()=>setDelUser(detail.id)}>
                <Trash2 size={13}/> Delete
              </button>
            </div>
          )}
        </div>

        {/* Profile hero */}
        <div style={{ borderRadius:20, background:`linear-gradient(135deg,${rc.grad[0]},${rc.grad[1]})`, padding:'28px 32px', color:'#fff', marginBottom:20, position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', right:-20, top:-20, width:140, height:140, borderRadius:'50%', background:'rgba(255,255,255,.08)' }}/>
          <div style={{ display:'flex', alignItems:'center', gap:20 }}>
            <div style={{ width:70, height:70, borderRadius:20, background:'rgba(255,255,255,.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, fontWeight:800, flexShrink:0 }}>{initials}</div>
            <div>
              <div style={{ fontSize:22, fontWeight:800 }}>{detail.full_name}</div>
              <div style={{ opacity:.8, fontSize:14 }}>{detail.email}</div>
              <div style={{ display:'flex', gap:10, marginTop:8, flexWrap:'wrap' }}>
                <span style={{ padding:'4px 12px', borderRadius:999, background:'rgba(255,255,255,.2)', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:5 }}>
                  <Icon size={12}/> {rc.label}
                </span>
                {detail.department?.name && <span style={{ padding:'4px 12px', borderRadius:999, background:'rgba(255,255,255,.15)', fontSize:12 }}>{detail.department.name}</span>}
                <span style={{ padding:'4px 12px', borderRadius:999, background: detail.is_active!==false?'rgba(16,185,129,.3)':'rgba(239,68,68,.3)', fontSize:12, fontWeight:700 }}>
                  {detail.is_active!==false?'✓ Active':'✗ Inactive'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        {detailLoad ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:60 }}><div className="spinner"/></div>
        ) : dd && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:12, marginBottom:20 }}>
              {[
                { l:'Monthly Rate', v: dd.rate ? rupee(dd.rate.monthly_salary) : '—', c:'#6366f1', icon:<DollarSign size={16}/> },
                { l:'Hourly Rate', v: dd.rate ? `₹${dd.rate.hourly_rate?.toFixed(0)}/hr` : '—', c:'#0891b2', icon:<Clock size={16}/> },
                { l:'Hours This Month', v:`${dd.monthHours.toFixed(1)}h`, c:'#10b981', icon:<Clock size={16}/> },
                { l:'Total Hours', v:`${dd.totalHours.toFixed(1)}h`, c:'#3b82f6', icon:<TrendingUp size={16}/> },
                { l:'Total Expenses', v:rupee(dd.totalExpense), c:'#f59e0b', icon:<DollarSign size={16}/> },
                { l:'Leave Days Used', v:dd.leaveDays, c:'#ec4899', icon:<Calendar size={16}/> },
              ].map(s=>(
                <div key={s.l} style={{ background:'#fff', borderRadius:14, padding:'14px 16px', border:`1.5px solid ${s.c}20`, borderTop:`4px solid ${s.c}` }}>
                  <div style={{ color:s.c, marginBottom:6 }}>{s.icon}</div>
                  <div style={{ fontSize:18, fontWeight:800, color:s.c, lineHeight:1 }}>{s.v}</div>
                  <div style={{ fontSize:11, color:'#64748b', fontWeight:600, marginTop:4 }}>{s.l}</div>
                </div>
              ))}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {/* Recent time logs */}
              <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #e2e8f0', overflow:'hidden' }}>
                <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', fontWeight:700, fontSize:14 }}>⏱ Recent Time Logs</div>
                {dd.logs.length === 0 ? (
                  <div style={{ padding:'30px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>No logs yet</div>
                ) : (
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead><tr style={{ background:'#f8fafc' }}>
                      {['Date','Project','Hours'].map(h=><th key={h} style={{ padding:'8px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {dd.logs.slice(0,8).map((l,i)=>(
                        <tr key={i} style={{ borderBottom:'1px solid #f8fafc' }}>
                          <td style={{ padding:'8px 14px', fontSize:12 }}>{fmt(l.work_date)}</td>
                          <td style={{ padding:'8px 14px' }}>{l.project ? <span style={{ padding:'2px 7px', borderRadius:999, fontSize:11, fontWeight:700, background:'#ede9fe', color:'#6d28d9' }}>{l.project.name}</span> : <span style={{ color:'#94a3b8', fontSize:12 }}>—</span>}</td>
                          <td style={{ padding:'8px 14px', fontWeight:700, color:'#6366f1', fontSize:13 }}>{l.hours_worked!=null?`${l.hours_worked}h`:'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Expense summary */}
              <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #e2e8f0', overflow:'hidden' }}>
                <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', fontWeight:700, fontSize:14 }}>🧾 Recent Expenses</div>
                {dd.expenses.length === 0 ? (
                  <div style={{ padding:'30px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>No expenses yet</div>
                ) : (
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead><tr style={{ background:'#f8fafc' }}>
                      {['Category','Amount','Status'].map(h=><th key={h} style={{ padding:'8px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {dd.expenses.slice(0,8).map((e,i)=>(
                        <tr key={i} style={{ borderBottom:'1px solid #f8fafc' }}>
                          <td style={{ padding:'8px 14px', fontSize:12 }}>{e.category||'—'}</td>
                          <td style={{ padding:'8px 14px', fontWeight:700, fontSize:13 }}>{rupee(e.total_amount||e.amount)}</td>
                          <td style={{ padding:'8px 14px' }}>
                            <span style={{ padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700,
                              background:e.status==='approved'?'#dcfce7':e.status==='rejected'?'#fee2e2':'#fef3c7',
                              color:e.status==='approved'?'#15803d':e.status==='rejected'?'#dc2626':'#b45309' }}>
                              {e.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Leave summary */}
            {dd.leaves.length > 0 && (
              <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #e2e8f0', overflow:'hidden', marginTop:16 }}>
                <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', fontWeight:700, fontSize:14 }}>📅 Leave History</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:10, padding:16 }}>
                  {dd.leaves.map((l,i)=>{
                    const isPerm = l.leave_type==='permission'
                    const days = isPerm ? null : l.to_date && l.from_date ? Math.ceil((new Date(l.to_date)-new Date(l.from_date))/86400000)+1 : 1
                    const lColors = { sick:'#dc2626', casual:'#1d4ed8', personal:'#6d28d9', permission:'#b45309' }
                    const lc = lColors[l.leave_type]||'#6366f1'
                    return (
                      <div key={i} style={{ padding:'10px 14px', borderRadius:10, border:`1.5px solid ${lc}20`, background:`${lc}06` }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                          <span style={{ fontSize:12, fontWeight:700, color:lc, textTransform:'capitalize' }}>{l.leave_type}</span>
                          <span style={{ fontSize:11, padding:'2px 7px', borderRadius:999, background:l.status==='approved'?'#dcfce7':'#fef3c7', color:l.status==='approved'?'#15803d':'#b45309', fontWeight:700 }}>{l.status}</span>
                        </div>
                        <div style={{ fontSize:11, color:'#64748b' }}>
                          {isPerm ? `${l.permission_hours?.toFixed(1)}h` : `${days} day${days!==1?'s':''}`}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Edit Modal */}
        <Modal open={showModal} onClose={()=>{setShowM(false);setErr('')}} title={editing?'Edit User':'Add User'} size="lg"
          footer={<>
            <button className="btn btn-ghost" onClick={()=>setShowM(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={submitting}>{submitting?'Saving…':editing?'Update':'Create'}</button>
          </>}>
          <UserForm form={form} setForm={setForm} depts={depts} editing={!!editing} err={err} />
        </Modal>
        <Confirm open={!!delUser} message="Delete this user? This cannot be undone." danger onConfirm={()=>deleteUser(delUser)} onCancel={()=>setDelUser(null)} />
      </div>
    )
  }

  /* ── LIST VIEW ── */
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">User Management</div>
          <div className="page-subtitle">{users.length} users — ThingsaliveWork</div>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={()=>{setEditing(null);setForm(initForm());setErr('');setShowM(true)}}>
            <Plus size={15}/> Add User
          </button>
        )}
      </div>

      {/* Role filter cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10, marginBottom:20 }}>
        <div onClick={()=>setRoleF('all')} style={{ background:roleFilter==='all'?'#1e293b':'#fff', borderRadius:14, padding:'14px 16px', border:'1.5px solid #e2e8f0', cursor:'pointer' }}>
          <div style={{ fontSize:26, fontWeight:800, color:roleFilter==='all'?'#fff':'#1e293b', lineHeight:1 }}>{users.length}</div>
          <div style={{ fontSize:11, fontWeight:600, color:roleFilter==='all'?'#94a3b8':'#64748b', marginTop:4 }}>All Users</div>
        </div>
        {ALL_ROLES.map(r=>{
          const rc = ROLE_CFG[r]; const Icon = rc.icon; const active = roleFilter===r
          return (
            <div key={r} onClick={()=>setRoleF(active?'all':r)}
              style={{ borderRadius:14, padding:'14px 16px', border:`1.5px solid ${active?rc.dark:'#e2e8f0'}`, cursor:'pointer',
                background:active?`linear-gradient(135deg,${rc.grad[0]},${rc.grad[1]})`:'#fff' }}>
              <div style={{ marginBottom:6 }}><Icon size={14} style={{ color:active?'rgba(255,255,255,.8)':rc.dark }}/></div>
              <div style={{ fontSize:24, fontWeight:800, color:active?'#fff':rc.dark, lineHeight:1 }}>{roleCounts[r]||0}</div>
              <div style={{ fontSize:11, fontWeight:600, color:active?'rgba(255,255,255,.75)':'#64748b', marginTop:4 }}>{rc.label}s</div>
            </div>
          )
        })}
      </div>

      {/* Search + filter */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search by name or email…" />
        <select className="form-select" value={roleFilter} onChange={e=>setRoleF(e.target.value)} style={{ width:'auto' }}>
          <option value="all">All Roles</option>
          {ALL_ROLES.map(r=><option key={r} value={r}>{ROLE_CFG[r]?.label||r}</option>)}
        </select>
        <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>{filtered.length} users</span>
      </div>

      {/* User grid */}
      {filtered.length===0 ? (
        <div style={{ background:'#fff', borderRadius:14, border:'1.5px solid #e2e8f0' }}><Empty icon={<Users size={44}/>} title="No users found" desc="Try a different search or filter"/></div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14 }}>
          {filtered.map(user=>{
            const rc = ROLE_CFG[user.role]||ROLE_CFG.employee
            const Icon = rc.icon
            const initials = (user.full_name||user.email||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
            const inactive = user.is_active===false
            return (
              <div key={user.id} style={{ background:'#fff', borderRadius:16, border:`1.5px solid ${inactive?'#e2e8f0':'#e2e8f0'}`, overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,.04)', opacity:inactive?.7:1, transition:'all .15s' }}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,.09)'}}
                onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.04)'}}>
                <div style={{ height:3, background:`linear-gradient(90deg,${rc.grad[0]},${rc.grad[1]})` }}/>
                <div style={{ padding:'16px 18px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                    <div style={{ width:44, height:44, borderRadius:14, background:`linear-gradient(135deg,${rc.grad[0]},${rc.grad[1]})`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:16, flexShrink:0 }}>{initials}</div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:14, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user.full_name||'Unknown'}</div>
                      <div style={{ fontSize:11, color:'#94a3b8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user.email}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:999, background:rc.light, color:rc.dark, fontSize:11, fontWeight:700 }}>
                      <Icon size={10}/> {rc.label}
                    </span>
                    {inactive && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:999, background:'#fee2e2', color:'#dc2626', fontWeight:700 }}>Inactive</span>}
                    {user.department?.name && <span style={{ fontSize:11, color:'#94a3b8' }}>{user.department.name}</span>}
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button className="btn btn-ghost btn-sm" style={{ flex:1, justifyContent:'center' }} onClick={()=>openDetail(user)}>
                      <Eye size={13}/> Details
                    </button>
                    {canEdit && <>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={()=>{setEditing(user);setForm({full_name:user.full_name||'',email:user.email||'',role:user.role||'employee',designation:user.designation||'',phone:user.phone||'',department_id:user.department_id||'',is_active:user.is_active!==false});setErr('');setShowM(true)}}><Edit2 size={13}/></button>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={()=>toggleActive(user)} title={user.is_active!==false?'Deactivate':'Activate'}>
                        {user.is_active!==false ? <ToggleRight size={13} style={{color:'#10b981'}}/> : <ToggleLeft size={13} style={{color:'#ef4444'}}/>}
                      </button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{color:'#ef4444'}} onClick={()=>setDelUser(user.id)}><Trash2 size={13}/></button>
                    </>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={showModal} onClose={()=>{setShowM(false);setErr('')}} title={editing?'Edit User':'Add User'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={()=>setShowM(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={submitting}>{submitting?'Saving…':editing?'Update':'Create'}</button>
        </>}>
        <UserForm form={form} setForm={setForm} depts={depts} editing={!!editing} err={err} />
      </Modal>
      <Confirm open={!!delUser} message="Delete this user?" danger onConfirm={()=>deleteUser(delUser)} onCancel={()=>setDelUser(null)} />
    </div>
  )
}

function UserForm({ form, setForm, depts, editing, err }) {
  return (
    <>
      {err && <div className="alert alert-danger" style={{ marginBottom:14 }}>{err}</div>}
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input className="form-input" value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))} placeholder="John Doe" required/>
        </div>
        <div className="form-group">
          <label className="form-label">Email {!editing&&'*'}</label>
          <input className="form-input" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="john@company.com" disabled={!!editing} required={!editing}/>
          {editing && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>Email cannot be changed after creation</div>}
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Role *</label>
          <select className="form-select" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
            {Object.entries({ admin:'Admin', ceo:'CEO', manager:'Manager', finance:'Finance', hr:'HR', employee:'Employee' }).map(([k,v])=>(
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Department</label>
          <select className="form-select" value={form.department_id} onChange={e=>setForm(f=>({...f,department_id:e.target.value}))}>
            <option value="">No department</option>
            {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Designation</label>
          <input className="form-input" value={form.designation} onChange={e=>setForm(f=>({...f,designation:e.target.value}))} placeholder="Software Engineer"/>
        </div>
        <div className="form-group">
          <label className="form-label">Phone</label>
          <input className="form-input" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="+91 98765 43210"/>
        </div>
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', fontSize:13, fontWeight:600 }}>
        <input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))} style={{ width:16, height:16, accentColor:'#10b981' }}/>
        Active User
      </label>
    </>
  )
}

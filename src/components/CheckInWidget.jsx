import { useState, useEffect, useRef } from 'react'
import { supabase, dateFmt } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const SL = { backlog:'Backlog', todo:'To Do', in_progress:'In Progress', delayed:'Delayed', qa:'QA Testing', ready_for_demo:'Ready for Demo', closed:'Closed' }
const SC = { backlog:'#64748b', todo:'#3b82f6', in_progress:'#f59e0b', delayed:'#e11d48', qa:'#8b5cf6', ready_for_demo:'#10b981', closed:'#94a3b8' }
const STATUSES = ['backlog','todo','in_progress','delayed','qa','ready_for_demo','closed']

export default function CheckInWidget({ variant = 'widget' }) {
  const { profile } = useAuth()
  const [open, setOpen]        = useState(false)
  const [phase, setPhase]      = useState('idle')   // idle | form | active | checkout
  const [activeLog, setActiveLog] = useState(null)
  const [projects, setProjects]  = useState([])
  const [tasks, setTasks]        = useState([])
  const [selProject, setSelProject] = useState('')
  const [selTasks, setSelTasks]  = useState([])
  const [comment, setComment]    = useState('')
  const [elapsed, setElapsed]    = useState('')
  const [loading, setLoading]    = useState(false)
  const [coTasks, setCoTasks]    = useState([])
  const timerRef = useRef(null)

  useEffect(() => { if (profile?.id) init() }, [profile?.id])

  useEffect(() => {
    clearInterval(timerRef.current)
    if (activeLog?.check_in) {
      timerRef.current = setInterval(() => {
        const s = (Date.now() - new Date(activeLog.check_in)) / 1000
        const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60)
        setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`)
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [activeLog])

  async function init() {
    const today = new Date().toISOString().split('T')[0]
    const [logRes, projRes] = await Promise.all([
      supabase.from('time_logs').select('*,project:projects(id,name)').eq('employee_id', profile.id).eq('work_date', today).is('check_out', null).order('check_in', {ascending:false}).limit(1),
      supabase.from('projects').select('id,name').eq('status','active').order('name'),
    ])
    const log = logRes.data?.[0] || null
    setActiveLog(log)
    setProjects(projRes.data || [])
    setPhase(log ? 'active' : 'idle')
  }

  async function loadTasks(projId) {
    if (!projId) { setTasks([]); return }
    const { data } = await supabase.from('project_tasks')
      .select('id,task_id,task_name,status,priority,planned_start_date,planned_end_date,estimated_hours')
      .eq('project_id', projId).eq('assigned_to', profile.id)
      .not('status', 'in', '("closed","ready_for_demo")')
      .order('planned_end_date')
    setTasks(data || [])
  }

  async function doCheckIn() {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const { data: logData, error } = await supabase.from('time_logs').insert({
        employee_id: profile.id, project_id: selProject||null,
        work_date: today, check_in: new Date().toISOString(), comment: comment||null,
      }).select().single()
      if (error) throw error
      if (selTasks.length > 0) {
        await supabase.from('checkin_tasks').insert(selTasks.map(tid => ({
          checkin_log_id: logData.id, task_id: tid,
          employee_id: profile.id, work_date: today,
        })))
        await supabase.from('project_tasks').update({ status:'in_progress' })
          .in('id', selTasks).not('status', 'in', '("in_progress","qa","ready_for_demo","closed")')
      }
      setSelTasks([]); setComment(''); setSelProject(''); setOpen(false)
      init()
    } catch(e) { alert(e.message) }
    setLoading(false)
  }

  async function openCheckout() {
    const { data: linked } = await supabase.from('checkin_tasks')
      .select('*,task:project_tasks(id,task_id,task_name,status,estimated_hours)')
      .eq('checkin_log_id', activeLog.id)
    // Default: any task not yet completed (closed) is marked Delayed at checkout
    setCoTasks((linked||[]).map(l => ({...l, new_status: l.task?.status === 'closed' ? 'closed' : 'delayed'})))
    setPhase('checkout')
  }

  async function doCheckOut() {
    setLoading(true)
    try {
      const now = new Date()
      const hrs = Math.round((now - new Date(activeLog.check_in)) / 3600000 * 100) / 100
      await supabase.from('time_logs').update({ check_out: now.toISOString(), hours_worked: hrs }).eq('id', activeLog.id)
      for (const ct of coTasks) {
        if (ct.task?.id && ct.new_status !== ct.task?.status) {
          await supabase.from('project_tasks').update({ status: ct.new_status }).eq('id', ct.task.id)
          await supabase.from('checkin_tasks').update({ status_update: ct.new_status }).eq('id', ct.id)
        }
      }
      setOpen(false); setPhase('idle'); setActiveLog(null); setCoTasks([])
      init()
    } catch(e) { alert(e.message) }
    setLoading(false)
  }

  const isActive = phase === 'active' || phase === 'checkout'

  const widgetStyle = {
    display:'flex', alignItems:'center', gap:6, padding:'5px 12px',
    borderRadius:7, border:`1.5px solid ${isActive?'#10b981':'rgba(255,255,255,0.15)'}`,
    background: isActive ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.07)',
    cursor:'pointer', fontFamily:'inherit', fontSize:11, fontWeight:700,
    color: isActive ? '#10b981' : 'rgba(255,255,255,0.8)', transition:'all .2s',
    whiteSpace:'nowrap', position:'relative',
  }

  const popupStyle = {
    position:'absolute', top:'calc(100% + 8px)', right:0, zIndex:9999,
    width:320, background:'var(--surface)', border:'1px solid var(--border)',
    borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,.18)', overflow:'hidden',
  }

  const inputStyle = {
    width:'100%', padding:'8px 10px', borderRadius:7,
    border:'1px solid var(--border)', background:'var(--surface-2)',
    color:'var(--text)', fontSize:12, fontFamily:'inherit', outline:'none',
  }

  const btnPrimary = {
    width:'100%', padding:'10px', background:'var(--c1)', border:'none',
    borderRadius:8, color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit',
  }

  const phaseContent = (
    <>
          {/* IDLE: check-in form */}
          {phase === 'idle' && (
            <div style={{padding:16}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:7}}>
                <span style={{fontSize:16}}>▶</span> Start Work Session
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:5}}>Project</div>
                <select style={inputStyle} value={selProject}
                  onChange={e=>{setSelProject(e.target.value);loadTasks(e.target.value);setSelTasks([])}}>
                  <option value="">No project</option>
                  {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {tasks.length > 0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:6}}>
                    Today's tasks <span style={{fontWeight:400}}>(check to select)</span>
                  </div>
                  <div style={{maxHeight:190,overflowY:'auto',display:'flex',flexDirection:'column',gap:5}}>
                    {tasks.map(t => {
                      const sel = selTasks.includes(t.id)
                      return (
                        <div key={t.id} onClick={()=>setSelTasks(p=>sel?p.filter(x=>x!==t.id):[...p,t.id])}
                          style={{display:'flex',alignItems:'flex-start',gap:8,padding:'8px 10px',borderRadius:7,cursor:'pointer',
                            background:sel?`${SC[t.status]}12`:'var(--surface-2)',
                            border:`1px solid ${sel?SC[t.status]:'var(--border)'}`,transition:'all .12s'}}>
                          <div style={{width:15,height:15,borderRadius:4,border:`2px solid ${sel?'var(--c1)':'var(--border)'}`,
                            background:sel?'var(--c1)':'transparent',flexShrink:0,marginTop:1,
                            display:'flex',alignItems:'center',justifyContent:'center'}}>
                            {sel&&<span style={{color:'#fff',fontSize:9,fontWeight:900}}>✓</span>}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.task_name}</div>
                            <div style={{display:'flex',gap:5,marginTop:2,fontSize:10,color:'var(--text-muted)',flexWrap:'wrap'}}>
                              <span style={{fontFamily:'var(--font-mono)',color:'var(--c1)'}}>{t.task_id}</span>
                              <span style={{padding:'1px 5px',borderRadius:3,background:`${SC[t.status]}15`,color:SC[t.status],fontWeight:600}}>{SL[t.status]}</span>
                              {t.planned_end_date&&<span>📅 {dateFmt(t.planned_end_date)}</span>}
                              {t.estimated_hours&&<span>⏱ {t.estimated_hours}h</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {selTasks.length>0&&<div style={{fontSize:10,color:'var(--c1)',marginTop:4,fontWeight:600}}>{selTasks.length} task{selTasks.length>1?'s':''} → will move to In Progress</div>}
                </div>
              )}

              {selProject && tasks.length===0 && (
                <div style={{padding:'8px 10px',borderRadius:7,background:'var(--surface-2)',fontSize:12,color:'var(--text-muted)',marginBottom:10}}>No open tasks assigned to you</div>
              )}

              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:5}}>What are you working on?</div>
                <input style={inputStyle} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Brief description…" onKeyDown={e=>e.key==='Enter'&&doCheckIn()}/>
              </div>
              <div style={{fontSize:10,color:'var(--text-muted)',textAlign:'center',marginBottom:10}}>
                {new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}
              </div>
              <button style={btnPrimary} onClick={doCheckIn} disabled={loading}>
                {loading?'Checking in…':'▶ Check In Now'}
              </button>
            </div>
          )}

          {/* ACTIVE: session running */}
          {phase === 'active' && (
            <div style={{padding:16}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:12}}>
                <span style={{width:9,height:9,borderRadius:'50%',background:'#10b981',animation:'pulse 2s infinite'}}/>
                <span style={{fontWeight:700,fontSize:13,color:'#15803d'}}>Checked In</span>
                <span style={{marginLeft:'auto',fontSize:10,color:'var(--text-muted)'}}>
                  {new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}
                </span>
              </div>
              <div style={{padding:'12px 14px',borderRadius:10,background:'var(--surface-2)',marginBottom:12,textAlign:'center'}}>
                <div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:28,color:'var(--c1)',letterSpacing:2}}>{elapsed||'00:00:00'}</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>
                  {activeLog?.project?.name||'No project'} · Since {activeLog?.check_in?new Date(activeLog.check_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}):'—'}
                </div>
                {activeLog?.comment&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2,fontStyle:'italic'}}>"{activeLog.comment}"</div>}
              </div>
              <button style={{...btnPrimary,background:'#e11d48'}} onClick={openCheckout}>⏹ Check Out</button>
            </div>
          )}

          {/* CHECKOUT: task status update */}
          {phase === 'checkout' && (
            <div style={{padding:16}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:3}}>Check Out</div>
              <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>Session: {elapsed} · Update task statuses</div>

              {coTasks.length > 0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:7}}>TASKS WORKED ON</div>
                  <div style={{display:'flex',flexDirection:'column',gap:7,maxHeight:200,overflowY:'auto'}}>
                    {coTasks.map((ct,i) => (
                      <div key={ct.id} style={{padding:'9px 11px',borderRadius:8,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
                        <div style={{fontSize:12,fontWeight:600,marginBottom:5}}>
                          <span style={{fontFamily:'var(--font-mono)',color:'var(--c1)',fontSize:10}}>{ct.task?.task_id} </span>
                          {ct.task?.task_name}
                        </div>
                        <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:5}}>
                          Was: <span style={{color:SC[ct.task?.status||'todo'],fontWeight:600}}>{SL[ct.task?.status||'todo']}</span>
                          {ct.task?.estimated_hours&&<span> · {ct.task.estimated_hours}h est</span>}
                        </div>
                        <select style={{...inputStyle,color:SC[ct.new_status]||'var(--c1)',fontWeight:600,fontSize:11,
                          background:`${SC[ct.new_status]||'var(--c1)'}12`,
                          border:`1px solid ${SC[ct.new_status]||'var(--c1)'}30`}}
                          value={ct.new_status}
                          onChange={e=>setCoTasks(p=>p.map((x,j)=>j===i?{...x,new_status:e.target.value}:x))}>
                          {STATUSES.map(s=><option key={s} value={s}>{SL[s]}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {coTasks.length===0&&(
                <div style={{padding:'9px 11px',borderRadius:8,background:'var(--surface-2)',fontSize:12,color:'var(--text-muted)',marginBottom:12}}>No tasks linked to this session</div>
              )}

              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setPhase('active')} style={{flex:1,padding:'9px',background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-soft)',fontWeight:600,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>← Back</button>
                <button onClick={doCheckOut} disabled={loading} style={{flex:2,padding:'9px',background:'#e11d48',border:'none',borderRadius:8,color:'#fff',fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                  {loading?'Saving…':'✓ Confirm Checkout'}
                </button>
              </div>
            </div>
          )}
    </>
  )

  // Dashboard card variant — always-visible inline panel
  if (variant === 'card') {
    return (
      <div style={{background:'var(--surface)',borderRadius:16,border:'1.5px solid var(--border)',
        boxShadow:'0 1px 4px rgba(0,0,0,.04)',overflow:'hidden',maxWidth:460}}>
        <div style={{padding:'11px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:8}}>
          <span style={{width:8,height:8,borderRadius:'50%',background:isActive?'#10b981':'#cbd5e1',
            boxShadow:isActive?'0 0 6px #10b981':undefined,animation:isActive?'pulse 2s infinite':undefined}}/>
          <span style={{fontWeight:700,fontSize:14}}>⏱ Time Tracking</span>
          {isActive && <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontWeight:800,fontSize:14,color:'var(--c1)'}}>{elapsed||'00:00:00'}</span>}
        </div>
        {phaseContent}
      </div>
    )
  }

  // Topbar widget variant — compact button + popup
  return (
    <div style={{position:'relative'}}>
      <button style={widgetStyle} onClick={() => setOpen(o => !o)}>
        <span style={{width:7,height:7,borderRadius:'50%',background:isActive?'#10b981':'rgba(255,255,255,0.4)',
          boxShadow:isActive?'0 0 6px #10b981':undefined, animation:isActive?'pulse 2s infinite':undefined}}/>
        {isActive ? (elapsed||'00:00:00') : '▶ Check In'}
        <span style={{opacity:.6,fontSize:9}}>▾</span>
      </button>

      {open && <>
        <div style={{position:'fixed',inset:0,zIndex:9998}} onClick={()=>setOpen(false)}/>
        <div style={popupStyle}>
          {phaseContent}
        </div>
      </>}
    </div>
  )
}

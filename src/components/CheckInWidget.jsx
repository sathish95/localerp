import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase, dateFmt } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { notifyManagers } from '../lib/notifications'
import { listFlows, makeStatusHelpers } from '../lib/departmentStatusFlows'
import { ACTIVITY_TYPES, activityLabel, startVisit, checkOutLog, getGps, listLogDevices, addDeviceToLog, removeLogDevice, CHECKIN_EVENT } from '../lib/supportVisits'

const SL = { backlog:'Backlog', todo:'To Do', in_progress:'In Progress', delayed:'Delayed', qa:'QA Testing', ready_for_demo:'Ready for Demo', closed:'Closed' }
const SC = { backlog:'#64748b', todo:'#3b82f6', in_progress:'#f59e0b', delayed:'#e11d48', qa:'#8b5cf6', ready_for_demo:'#10b981', closed:'#94a3b8' }
const STATUSES = ['backlog','todo','in_progress','delayed','qa','ready_for_demo','closed']
// Pre-STEP198 fallback for a department with no configured flow row yet —
// see makeStatusHelpers in departmentStatusFlows.js. Without this, tasks
// belonging to a department with its OWN status pipeline (e.g. Application/
// Firmware/Hardware, which use 'done' instead of 'closed') always showed
// this global list's labels/colors here — the "status doesn't match
// department, shows the default" confusion this fixes.
const LEGACY_STEPS = STATUSES.map(s => ({ status_key: s, label: SL[s], color: SC[s], is_closed: s === 'closed' }))

export default function CheckInWidget({ variant = 'widget' }) {
  const { profile } = useAuth()
  const [open, setOpen]        = useState(false)
  const [phase, setPhase]      = useState('idle')   // idle | form | active
  const [activeLog, setActiveLog] = useState(null)
  const [projects, setProjects]  = useState([])
  const [tasks, setTasks]        = useState([])
  const [selProject, setSelProject] = useState('')
  const [selTasks, setSelTasks]  = useState([])
  const [comment, setComment]    = useState('')
  const [elapsed, setElapsed]    = useState('')
  const [loading, setLoading]    = useState(false)
  const [flows, setFlows]        = useState([])
  // STEP248 support visits
  const [visit, setVisit]        = useState(false)
  const [engagements, setEngagements] = useState([])
  const [selEng, setSelEng]      = useState('')
  const [selSite, setSelSite]    = useState('')
  const [logDevices, setLogDevices] = useState([])
  const [visitDevices, setVisitDevices] = useState([])
  const [addDev, setAddDev]      = useState({ deviceId: '', activity: 'INSPECTION', minutes: '', note: '' })
  const [visitErr, setVisitErr]  = useState('')
  const timerRef = useRef(null)
  const helpers = useMemo(() => makeStatusHelpers(flows, LEGACY_STEPS), [flows])

  useEffect(() => { if (profile?.id) init() }, [profile?.id])
  // "Check in here" on a device view starts / extends a visit — reload when it does
  useEffect(() => {
    const reload = () => profile?.id && init()
    window.addEventListener(CHECKIN_EVENT, reload)
    return () => window.removeEventListener(CHECKIN_EVENT, reload)
  }, [profile?.id])

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
    const [logRes, projRes, flowsRes] = await Promise.all([
      supabase.from('time_logs').select('*,project:projects(id,name)').eq('employee_id', profile.id).eq('work_date', today).is('check_out', null).order('check_in', {ascending:false}).limit(1),
      supabase.from('projects').select('id,name').eq('status','active').order('name'),
      listFlows(profile.organization_id).catch(() => []),
    ])
    const log = logRes.data?.[0] || null
    setActiveLog(log)
    setProjects(projRes.data || [])
    supabase.from('golive_engagements').select('id,code,name,project_id,sites').in('status', ['ACTIVE', 'EXIT_REVIEW']).is('deleted_at', null).order('name')
      .then(({ data }) => setEngagements(data || []))
    if (log?.visit_type === 'SUPPORT') loadVisit(log); else { setLogDevices([]); setVisitDevices([]) }
    setFlows(flowsRes || [])
    setPhase(log ? 'active' : 'idle')
    loadTasks(selProject, flowsRes || [])
  }

  // 'general' tasks are the universal miscellaneous/non-project work items —
  // project-less by definition, so they never show up under a specific
  // project's filter, and they should be checkin-able by anyone whether
  // they're personally assigned or left open for whoever picks them up.
  // They're always included alongside whatever project is selected (or
  // even with none selected), rather than requiring a project pick first.
  // Excludes "done" tasks using each task's OWN department status flow
  // (not a hardcoded 'closed'/'ready_for_demo' key list — a custom flow
  // may use 'done' instead, see LEGACY_STEPS comment above), so filtering
  // client-side after fetch instead of in the query. `flowsList` defaults
  // to state but init() passes flowsRes directly since setFlows() hasn't
  // committed yet on first load.
  async function loadTasks(projId, flowsList = flows) {
    const h = makeStatusHelpers(flowsList, LEGACY_STEPS)
    const cols = 'id,task_id,task_name,status,priority,planned_start_date,planned_end_date,estimated_hours,department_id'
    const [projRes, genRes] = await Promise.all([
      projId
        ? supabase.from('project_tasks').select(cols)
            .eq('project_id', projId).eq('assigned_to', profile.id)
            .order('planned_end_date')
        : Promise.resolve({ data: [] }),
      supabase.from('project_tasks').select(cols)
        .eq('task_type', 'general')
        .or(`assigned_to.eq.${profile.id},assigned_to.is.null`)
        .order('planned_end_date'),
    ])
    const merged = [...(genRes.data || []), ...(projRes.data || [])]
    setTasks(merged.filter(t => !h.isTaskDone(t)))
  }

  // devices on the running visit, and the devices that can be added (the engagement's, else the project's)
  async function loadVisit(log) {
    setVisitErr('')
    try { setLogDevices(await listLogDevices(log.id)) } catch (e) { setVisitErr(e.message) }
    let list = []
    if (log.engagement_id) {
      const { data } = await supabase.from('golive_enrollments').select('device_id,equipment_id,equipment_name,site,device:device_instances(id,device_code,serial_number)')
        .eq('engagement_id', log.engagement_id).is('deleted_at', null).is('unenrolled_at', null)
      list = (data || []).map(e => ({ id: e.device_id, code: e.device?.serial_number || e.device?.device_code, equipment: [e.equipment_id, e.equipment_name].filter(Boolean).join(' · '), site: e.site }))
    } else if (log.project_id) {
      const { data } = await supabase.from('device_instances').select('id,device_code,serial_number,equipment_id,equipment_name,current_location').eq('project_id', log.project_id).order('device_code')
      list = (data || []).map(d => ({ id: d.id, code: d.serial_number || d.device_code, equipment: [d.equipment_id, d.equipment_name].filter(Boolean).join(' · '), site: d.current_location }))
    }
    if (log.site) list.sort((a, b) => (b.site === log.site) - (a.site === log.site))
    setVisitDevices(list)
  }
  async function addVisitDevice() {
    setVisitErr('')
    try {
      await addDeviceToLog(activeLog.id, addDev)
      setAddDev(a => ({ ...a, deviceId: '', minutes: '', note: '' }))
      setLogDevices(await listLogDevices(activeLog.id))
    } catch (e) { setVisitErr(e.message) }
  }
  async function removeVisitDevice(id) {
    try { await removeLogDevice(id); setLogDevices(await listLogDevices(activeLog.id)) } catch (e) { setVisitErr(e.message) }
  }

  async function doCheckIn() {
    setLoading(true)
    if (visit) {
      try {
        const eng = engagements.find(e => e.id === selEng)
        const gps = await getGps()
        await startVisit({ employeeId: profile.id, projectId: eng?.project_id || selProject || null, engagementId: selEng || null, site: selSite || null, comment, gps })
        setComment(''); setSelProject(''); setSelEng(''); setSelSite(''); setVisit(false); setOpen(false)
        notifyManagers({ type: 'checkin', title: `🟢 ${profile.full_name} started a support visit`, body: [eng?.name, selSite, comment].filter(Boolean).join(' · ') || 'Support visit', link: '/resources', senderId: profile.id })
        init()
      } catch (e) { alert(e.message) }
      setLoading(false)
      return
    }
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
        // Only bump tasks whose OWN department flow actually has an
        // 'in_progress' step — a custom flow (e.g. Application/Firmware/
        // Hardware) may not use that key at all, and forcing it there would
        // just create a new, worse status-confusion bug.
        const bumpIds = selTasks.filter(tid => {
          const t = tasks.find(x => x.id === tid)
          if (!t) return false
          if (['in_progress', 'qa', 'ready_for_demo', 'closed'].includes(t.status)) return false
          return helpers.stepsForTask(t).some(s => s.status_key === 'in_progress' && !s.is_closed)
        })
        if (bumpIds.length) await supabase.from('project_tasks').update({ status:'in_progress' }).in('id', bumpIds)
      }
      setSelTasks([]); setComment(''); setSelProject(''); setOpen(false)
      // Notify managers about check-in
      notifyManagers({
        type: 'checkin',
        title: `🟢 ${profile.full_name} checked in`,
        body: comment || (selProject ? `Project session started` : 'Work session started'),
        link: '/resources',
        senderId: profile.id,
      })
      init()
    } catch(e) { alert(e.message) }
    setLoading(false)
  }

  // Checkout no longer prompts for (or applies) a task status change —
  // it only closes the time_logs session. Task status is managed solely
  // from the task itself (Task Detail / Kanban), never as a side effect
  // of ending a check-in session.
  async function doCheckOut() {
    setLoading(true)
    try {
      const gps = activeLog.visit_type === 'SUPPORT' ? await getGps() : null
      const hrs = await checkOutLog(activeLog, gps)
      // Notify managers about checkout
      notifyManagers({
        type: 'checkout',
        title: `🔴 ${profile.full_name} checked out`,
        body: `Session duration: ${elapsed || hrs + 'h'}`,
        link: '/resources',
        senderId: profile.id,
      })
      setOpen(false); setPhase('idle'); setActiveLog(null)
      init()
    } catch(e) { alert(e.message) }
    setLoading(false)
  }

  const isActive = phase === 'active'

  const widgetStyle = {
    display:'flex', alignItems:'center', gap:6, padding:'5px 12px',
    borderRadius:7,
    border: isActive ? '1.5px solid #10b981' : '1.5px solid rgba(99,102,241,0.45)',
    background: isActive ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.12)',
    cursor:'pointer', fontFamily:'inherit', fontSize:11, fontWeight:700,
    color: isActive ? '#10b981' : '#a5b4fc',
    boxShadow: isActive ? '0 0 8px rgba(16,185,129,0.25)' : 'none',
    transition:'all .2s', whiteSpace:'nowrap', position:'relative',
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
              <label style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:7,border:`1px solid ${visit?'var(--c1)':'var(--border)'}`,background:visit?'rgba(99,102,241,.08)':'transparent',marginBottom:10,cursor:'pointer',fontSize:12,fontWeight:600}}>
                <input type="checkbox" checked={visit} onChange={e=>setVisit(e.target.checked)}/> Support / site visit
                <span style={{fontWeight:400,color:'var(--text-muted)',fontSize:10.5}}>record devices worked on · billed to project support</span>
              </label>
              {visit && engagements.length > 0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:5}}>Go-live engagement</div>
                  <select style={inputStyle} value={selEng} onChange={e=>{const g=engagements.find(x=>x.id===e.target.value);setSelEng(e.target.value);setSelSite('');if(g?.project_id){setSelProject(g.project_id);loadTasks(g.project_id)}}}>
                    <option value="">None (project only)</option>
                    {engagements.map(g=><option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
                  </select>
                  {(engagements.find(g=>g.id===selEng)?.sites||[]).length>0&&(
                    <select style={{...inputStyle,marginTop:6}} value={selSite} onChange={e=>setSelSite(e.target.value)}>
                      <option value="">Site…</option>
                      {engagements.find(g=>g.id===selEng).sites.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              )}
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
                            background:sel?`${helpers.colorFor(t)}12`:'var(--surface-2)',
                            border:`1px solid ${sel?helpers.colorFor(t):'var(--border)'}`,transition:'all .12s'}}>
                          <div style={{width:15,height:15,borderRadius:4,border:`2px solid ${sel?'var(--c1)':'var(--border)'}`,
                            background:sel?'var(--c1)':'transparent',flexShrink:0,marginTop:1,
                            display:'flex',alignItems:'center',justifyContent:'center'}}>
                            {sel&&<span style={{color:'#fff',fontSize:9,fontWeight:900}}>✓</span>}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.task_name}</div>
                            <div style={{display:'flex',gap:5,marginTop:2,fontSize:10,color:'var(--text-muted)',flexWrap:'wrap'}}>
                              <span style={{fontFamily:'var(--font-mono)',color:'var(--c1)'}}>{t.task_id}</span>
                              <span style={{padding:'1px 5px',borderRadius:3,background:`${helpers.colorFor(t)}15`,color:helpers.colorFor(t),fontWeight:600}}>{helpers.labelFor(t)}</span>
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
                {activeLog?.visit_type==='SUPPORT'&&<div style={{fontSize:10.5,color:'var(--c1)',marginTop:4,fontWeight:700}}>Support visit{activeLog.site?` · ${activeLog.site}`:''}</div>}
              </div>
              {activeLog?.visit_type==='SUPPORT'&&(
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',marginBottom:6}}>Devices worked on ({logDevices.length})</div>
                  {visitErr&&<div style={{fontSize:11,color:'#b91c1c',marginBottom:6}}>{visitErr}</div>}
                  <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:150,overflowY:'auto',marginBottom:6}}>
                    {logDevices.map(d=>{const dev=visitDevices.find(v=>v.id===d.device_id);return (
                      <div key={d.id} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 8px',borderRadius:6,background:'var(--surface-2)',fontSize:11.5}}>
                        <span style={{fontFamily:'var(--font-mono)',fontWeight:700}}>{dev?.code||'Device'}</span>
                        <span style={{color:'var(--text-muted)',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{activityLabel(d.activity_type)}{d.minutes!=null?` · ${d.minutes} min`:''}{d.note?` · ${d.note}`:''}</span>
                        <button onClick={()=>removeVisitDevice(d.id)} title="Remove" style={{border:'none',background:'none',cursor:'pointer',color:'#b91c1c',fontSize:13,padding:0}}>×</button>
                      </div>
                    )})}
                  </div>
                  <select style={inputStyle} value={addDev.deviceId} onChange={e=>setAddDev(a=>({...a,deviceId:e.target.value}))}>
                    <option value="">{visitDevices.length?'Add a device…':'No devices on this engagement / project'}</option>
                    {visitDevices.filter(v=>!logDevices.some(d=>d.device_id===v.id)).map(v=><option key={v.id} value={v.id}>{v.code}{v.equipment?` · ${v.equipment}`:''}{v.site&&v.site!==activeLog.site?` · ${v.site}`:''}</option>)}
                  </select>
                  {addDev.deviceId&&(
                    <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:5}}>
                      <div style={{display:'flex',gap:5}}>
                        <select style={{...inputStyle,flex:2}} value={addDev.activity} onChange={e=>setAddDev(a=>({...a,activity:e.target.value}))}>{ACTIVITY_TYPES.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select>
                        <input style={{...inputStyle,flex:1}} type="number" min="0" placeholder="min" value={addDev.minutes} onChange={e=>setAddDev(a=>({...a,minutes:e.target.value}))}/>
                      </div>
                      <input style={inputStyle} placeholder="What was done (optional)" value={addDev.note} onChange={e=>setAddDev(a=>({...a,note:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&addVisitDevice()}/>
                      <button style={{...btnPrimary,padding:'7px',fontSize:12}} onClick={addVisitDevice}>Add device</button>
                    </div>
                  )}
                </div>
              )}
              <button style={{...btnPrimary,background:'#e11d48'}} onClick={doCheckOut} disabled={loading}>
                {loading?'Checking out…':'⏹ Check Out'}
              </button>
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

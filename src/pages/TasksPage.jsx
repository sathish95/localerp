import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, timeFmt, rupee } from '../lib/supabase'
import { sendNotif } from '../lib/notifications'
import { Modal, Loader, Empty, Confirm, SearchBox } from '../components/ui'
import ExcelImport from '../components/ui/ExcelImport'
import CustomDashboardsPanel from '../components/CustomDashboardsPanel'
import { Plus, Edit2, Trash2, LayoutGrid, List, BarChart2,
  Filter, X, Target, Zap, UserPlus, Shield, Save, ChevronDown, ChevronRight, Eye, Clock, TrendingUp, AlertTriangle, CheckCircle2, Upload, MessageSquare, Send } from 'lucide-react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

/* ─── Constants ─────────────────────────────────────────── */
const STATUSES=['backlog','todo','in_progress','delayed','qa','ready_for_demo','closed']
const SL={backlog:'Backlog',todo:'To Do',in_progress:'In Progress',delayed:'Delayed',qa:'QA Testing',ready_for_demo:'Ready for Demo',closed:'Closed'}
const SC={backlog:'#64748b',todo:'#3b82f6',in_progress:'#f59e0b',delayed:'#e11d48',qa:'#8b5cf6',ready_for_demo:'#10b981',closed:'#94a3b8'}
const PC={critical:'#e11d48',high:'#f59e0b',medium:'#3b82f6',low:'#10b981'}
const PI={critical:'🔴',high:'🟠',medium:'🔵',low:'🟢'}
const PRIOS=['critical','high','medium','low']
const TASK_TYPES=['task','bug','change_request','feature','improvement']
const STORY_TYPES=['story','epic','bug','change_request','feature']
const TYPE_ICO={task:'📋',bug:'🐛',change_request:'🔄',feature:'✨',improvement:'⚡',story:'📖',epic:'🗺'}
const TYPE_CLR={task:'#3b82f6',bug:'#e11d48',change_request:'#f59e0b',feature:'#10b981',improvement:'#8b5cf6',story:'#3b82f6',epic:'#7c3aed'}
const ALL_ROLES=['employee','developer','lead','manager','department_head','ceo','admin','finance','hr']
const DEF_PERMS={
  employee:       {can_view:true,can_create:false,can_edit:false,can_delete:false,can_change_status:true},
  developer:      {can_view:true,can_create:false,can_edit:true,can_delete:false,can_change_status:true},
  lead:           {can_view:true,can_create:true,can_edit:true,can_delete:true,can_change_status:true},
  manager:        {can_view:true,can_create:true,can_edit:true,can_delete:true,can_change_status:true},
  department_head:{can_view:true,can_create:true,can_edit:true,can_delete:true,can_change_status:true},
  ceo:            {can_view:true,can_create:true,can_edit:true,can_delete:true,can_change_status:true},
  admin:          {can_view:true,can_create:true,can_edit:true,can_delete:true,can_change_status:true},
  finance:        {can_view:true,can_create:false,can_edit:false,can_delete:false,can_change_status:false},
  hr:             {can_view:true,can_create:false,can_edit:false,can_delete:false,can_change_status:false},
}

/* ─── Helpers ────────────────────────────────────────────── */
const Pill=({label,color,bg})=><span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:bg||`${color}18`,color,border:`1px solid ${color}28`,textTransform:'capitalize',whiteSpace:'nowrap'}}>{label?.replace(/_/g,' ')}</span>
const Ava=({name='?',size=24})=>{const i=(name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();return<div title={name} style={{width:size,height:size,borderRadius:Math.round(size*.3),background:'linear-gradient(135deg,var(--c1),#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:Math.round(size*.38),fontWeight:700,flexShrink:0}}>{i}</div>}
const Kpi=({label,v,color='var(--c1)',sub})=><div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,borderTop:`2px solid ${color}`,padding:'10px 14px',minWidth:0,overflow:'hidden'}}><div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:'clamp(16px,3vw,22px)',color,lineHeight:1.2,marginBottom:3,overflowWrap:'break-word',wordBreak:'break-word'}}>{v}</div><div style={{fontSize:10,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>{sub&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{sub}</div>}</div>
const KpiGroup=({title,children})=><div><div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{title}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(105px,1fr))',gap:10}}>{children}</div></div>
const StatusKpiCard=({status,tasks,color,onAdd,canAdd})=>{
  const est=tasks.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0)
  const act=tasks.reduce((s,t)=>s+(Number(t.actual_hours)||0),0)
  const [hover,setHover]=useState(false)
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,borderTop:`3px solid ${color}`,padding:'14px 16px',display:'flex',flexDirection:'column',gap:9,transition:'transform .18s, box-shadow .18s',transform:hover?'translateY(-2px)':'none',boxShadow:hover?'var(--shadow)':'var(--shadow-sm)',minWidth:0,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:10.5,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>{SL[status]}</span>
        <span style={{width:7,height:7,borderRadius:'50%',background:color,boxShadow:`0 0 0 3px ${color}18`,flexShrink:0}}/>
      </div>
      <div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:'clamp(16px,3vw,22px)',color,lineHeight:1.2,overflowWrap:'break-word',wordBreak:'break-word'}}>{tasks.length}</div>
      <div style={{display:'flex',alignItems:'center',gap:10,fontSize:10.5,color:'var(--text-muted)',flexWrap:'wrap'}}>
        <span style={{display:'flex',alignItems:'center',gap:3}}><Clock size={10}/> Est <strong style={{color:'var(--text)',fontFamily:'var(--font-mono)',overflowWrap:'break-word'}}>{est}h</strong></span>
        <span style={{display:'flex',alignItems:'center',gap:3}}>Act <strong style={{color:act>est&&est>0?'var(--rose)':'var(--text)',fontFamily:'var(--font-mono)',overflowWrap:'break-word'}}>{act}h</strong></span>
      </div>
      {canAdd?
        <button onClick={onAdd}
          style={{marginTop:2,padding:'6px 0',border:`1px dashed ${color}40`,borderRadius:7,background:hover?`${color}0f`:'transparent',cursor:'pointer',fontSize:11,fontWeight:700,color,fontFamily:'inherit',transition:'background .15s'}}>
          + Add task
        </button>
        :<div style={{height:1}}/>}
    </div>
  )
}
const ProgBar=({pct,color='var(--c1)'})=><div style={{height:4,borderRadius:2,background:'var(--bg-3)',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,pct||0)}%`,background:color,borderRadius:2,transition:'width .3s'}}/></div>

/* ─── Reports helpers (literal colors — theme-independent, matches DashboardPage charts) ─── */
const ReportHero=({icon,label,value,color,sub})=>{
  const [hover,setHover]=useState(false)
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:'#fff',border:'1.5px solid #e2e8f0',borderRadius:16,padding:'16px 18px',display:'flex',flexDirection:'column',gap:10,boxShadow:hover?'0 6px 18px rgba(0,0,0,.08)':'0 1px 4px rgba(0,0,0,.04)',transform:hover?'translateY(-2px)':'none',transition:'all .18s',minWidth:0,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
        <span style={{fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</span>
        <div style={{width:30,height:30,borderRadius:9,background:`${color}15`,display:'flex',alignItems:'center',justifyContent:'center',color,flexShrink:0}}>{icon}</div>
      </div>
      <div style={{fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontWeight:800,fontSize:'clamp(18px,4vw,28px)',color:'#0f172a',lineHeight:1.2,overflowWrap:'break-word',wordBreak:'break-word'}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:'#94a3b8'}}>{sub}</div>}
    </div>
  )
}
function ChartCard({title,sub,children,height=230,right}) {
  return (
    <div style={{background:'#fff',borderRadius:16,border:'1.5px solid #e2e8f0',overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,.04)'}}>
      <div style={{padding:'14px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
        <div><div style={{fontWeight:700,fontSize:13.5}}>{title}</div>{sub&&<div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{sub}</div>}</div>
        {right}
      </div>
      <div style={{padding:'16px 18px'}}>{children}</div>
    </div>
  )
}
const LegendRow=({label,value,total,color})=>{
  const pct=total>0?Math.round((value/total)*100):0
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0'}}>
      <span style={{width:9,height:9,borderRadius:3,background:color,flexShrink:0}}/>
      <span style={{fontSize:12,color:'#334155',flex:1,minWidth:0,textTransform:'capitalize',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
      <span style={{fontSize:11,color:'#94a3b8',fontFamily:'ui-monospace,monospace'}}>{value}</span>
      <span style={{fontSize:11,fontWeight:700,color:'#0f172a',width:32,textAlign:'right'}}>{pct}%</span>
    </div>
  )
}
const ReportTip=({active,payload})=>{
  if(!active||!payload?.length)return null
  const p=payload[0]
  return <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:8,padding:'6px 10px',fontSize:12,boxShadow:'0 4px 12px rgba(0,0,0,.08)'}}>
    <span style={{fontWeight:700,textTransform:'capitalize'}}>{p.name||p.payload?.name}</span>: {p.value}
  </div>
}
const isOverdue=t=>t.planned_end_date&&new Date(t.planned_end_date)<new Date()&&t.status!=='closed'
const TypeBadge=({type,size='sm'})=>{const c=TYPE_CLR[type]||'#3b82f6';return<span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:`${c}15`,color:c,border:`1px solid ${c}25`,whiteSpace:'nowrap'}}>{TYPE_ICO[type]} {type?.replace(/_/g,' ')}</span>}

/* ─── Task Form ──────────────────────────────────────────── */
function TaskForm({form,setForm,projects,users,stories,sprints,changReqs,projectId,isMgr}) {
  return (
    <div style={{display:'grid',gap:12}}>
      {!projectId&&<div className="form-group"><label className="form-label">Project *</label>
        <select className="form-select" value={form.project_id||''} onChange={e=>setForm(f=>({...f,project_id:e.target.value,user_story_id:'',sprint_id:''}))}>
          <option value="">Select…</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Task Name *</label>
          <input className="form-input" value={form.task_name||''} onChange={e=>setForm(f=>({...f,task_name:e.target.value}))} placeholder="e.g. Build login API" required/></div>
        <div className="form-group"><label className="form-label">Type</label>
          <select className="form-select" value={form.task_type||'task'} onChange={e=>setForm(f=>({...f,task_type:e.target.value}))}>
            {TASK_TYPES.map(t=><option key={t} value={t}>{TYPE_ICO[t]} {t.replace(/_/g,' ')}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Module</label>
          <input className="form-input" value={form.module_name||''} onChange={e=>setForm(f=>({...f,module_name:e.target.value}))} placeholder="e.g. Auth"/></div>
        <div className="form-group"><label className="form-label">Priority</label>
          <select className="form-select" value={form.priority||'medium'} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
            {PRIOS.map(p=><option key={p} value={p}>{PI[p]} {p}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Assigned To</label>
          <select className="form-select" value={form.assigned_to||''} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value||null}))}>
            <option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Status</label>
          <select className="form-select" value={form.status||'backlog'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
            {STATUSES.map(s=><option key={s} value={s}>{SL[s]}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Planned Start</label>
          <input className="form-input" type="date" value={form.planned_start_date||''} onChange={e=>setForm(f=>({...f,planned_start_date:e.target.value}))}/></div>
        <div className="form-group"><label className="form-label">Planned End</label>
          <input className="form-input" type="date" value={form.planned_end_date||''} onChange={e=>setForm(f=>({...f,planned_end_date:e.target.value}))}/></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Est. Hours</label>
          <input className="form-input" type="number" step="0.5" value={form.estimated_hours||''} onChange={e=>setForm(f=>({...f,estimated_hours:e.target.value}))}/></div>
        <div className="form-group"><label className="form-label">Actual Hours</label>
          <input className="form-input" type="number" step="0.5" value={form.actual_hours||''} onChange={e=>setForm(f=>({...f,actual_hours:e.target.value}))}/></div>
      </div>
      {stories.length>0&&<div className="form-group"><label className="form-label">User Story</label>
        <select className="form-select" value={form.user_story_id||''} onChange={e=>setForm(f=>({...f,user_story_id:e.target.value||null}))}>
          <option value="">No story</option>{stories.map(s=><option key={s.id} value={s.id}>[{s.story_id}] {s.title}</option>)}
        </select></div>}
      {sprints.length>0&&<div className="form-group"><label className="form-label">Sprint</label>
        <select className="form-select" value={form.sprint_id||''} onChange={e=>setForm(f=>({...f,sprint_id:e.target.value||null}))}>
          <option value="">No sprint</option>{sprints.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select></div>}
      {changReqs.length>0&&<div className="form-group"><label className="form-label">Change Request</label>
        <select className="form-select" value={form.change_request_id||''} onChange={e=>setForm(f=>({...f,change_request_id:e.target.value||null}))}>
          <option value="">None</option>{changReqs.map(c=><option key={c.id} value={c.id}>[{c.cr_id}] {c.title}</option>)}
        </select></div>}
      <div className="form-group"><label className="form-label">Description</label>
        <textarea className="form-textarea" rows={3} value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Task details, acceptance criteria…"/></div>
    </div>
  )
}

/* ─── Story Form ─────────────────────────────────────────── */
function StoryForm({form,setForm,users,epics,sprints}) {
  return (
    <div style={{display:'grid',gap:12}}>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Title *</label>
          <input className="form-input" value={form.title||''} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="As a user, I want to…" required/></div>
        <div className="form-group"><label className="form-label">Type</label>
          <select className="form-select" value={form.story_type||'story'} onChange={e=>setForm(f=>({...f,story_type:e.target.value}))}>
            {STORY_TYPES.map(t=><option key={t} value={t}>{TYPE_ICO[t]} {t.replace(/_/g,' ')}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Priority</label>
          <select className="form-select" value={form.priority||'medium'} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
            {PRIOS.map(p=><option key={p} value={p}>{PI[p]} {p}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Story Points</label>
          <input className="form-input" type="number" min="0" value={form.story_points||0} onChange={e=>setForm(f=>({...f,story_points:parseInt(e.target.value)||0}))}/></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Assignee</label>
          <select className="form-select" value={form.assignee_id||''} onChange={e=>setForm(f=>({...f,assignee_id:e.target.value||null}))}>
            <option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Status</label>
          <select className="form-select" value={form.status||'open'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
            {['open','in_progress','done','cancelled'].map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Epic</label>
          <select className="form-select" value={form.epic_id||''} onChange={e=>setForm(f=>({...f,epic_id:e.target.value||null}))}>
            <option value="">No epic</option>{epics.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Sprint</label>
          <select className="form-select" value={form.sprint_id||''} onChange={e=>setForm(f=>({...f,sprint_id:e.target.value||null}))}>
            <option value="">No sprint</option>{sprints.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Start</label>
          <input className="form-input" type="date" value={form.start_date||''} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))}/></div>
        <div className="form-group"><label className="form-label">End</label>
          <input className="form-input" type="date" value={form.end_date||''} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))}/></div>
      </div>
      <div className="form-group"><label className="form-label">Description</label>
        <textarea className="form-textarea" rows={2} value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
    </div>
  )
}

/* ─── Permissions Panel ──────────────────────────────────── */
function PermissionsPanel({perms,setPerms,onSave,saved}) {
  const KEYS=[{k:'can_view',l:'View'},{k:'can_create',l:'Create'},{k:'can_edit',l:'Edit'},{k:'can_delete',l:'Delete'},{k:'can_change_status',l:'Change Status'}]
  return (
    <div>
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Task Permission Matrix</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>Configure what each role can do. Saved to database — team-wide.</div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:'var(--surface-2)'}}>
            <th style={{padding:'8px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}}>Role</th>
            {KEYS.map(p=><th key={p.k} style={{padding:'8px 14px',textAlign:'center',fontSize:11,fontWeight:700,color:'var(--text-muted)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>{p.l}</th>)}
          </tr></thead>
          <tbody>
            {ALL_ROLES.map(role=>(
              <tr key={role} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'9px 14px',fontWeight:600,textTransform:'capitalize'}}>{role.replace(/_/g,' ')}</td>
                {KEYS.map(p=>{
                  const val=perms[role]?.[p.k]??DEF_PERMS[role]?.[p.k]??false
                  return <td key={p.k} style={{padding:'9px 14px',textAlign:'center'}}>
                    <input type="checkbox" checked={val}
                      onChange={e=>setPerms(prev=>({...prev,[role]:{...(prev[role]||DEF_PERMS[role]||{}),[p.k]:e.target.checked}}))}
                      style={{accentColor:'var(--c1)',width:15,height:15,cursor:'pointer'}}/>
                  </td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:10,marginTop:16,alignItems:'center'}}>
        <button className="btn btn-primary" onClick={onSave} style={{display:'flex',alignItems:'center',gap:6}}><Save size={13}/> Save Permissions</button>
        {saved&&<span style={{fontSize:12,color:'var(--emerald)',fontWeight:600}}>✓ Saved!</span>}
      </div>
    </div>
  )
}

/* ─── Task Detail (view with inline status change) ───────── */
function TaskDetail({task,projects,users,stories,sprints,changReqs,canChangeStatus,onStatusChange,profile,onProgressUpdate,onCommentPosted}) {
  if(!task) return null
  const proj=projects.find(p=>p.id===task.project_id)
  const assignee=users.find(u=>u.id===task.assigned_to)
  const story=stories.find(s=>s.id===task.user_story_id)
  const sprint=sprints.find(s=>s.id===task.sprint_id)
  const cr=changReqs.find(c=>c.id===task.change_request_id)
  const over=isOverdue(task)
  const Row=({label,children})=>(<div style={{display:'flex',gap:12,padding:'8px 0',borderBottom:'1px solid var(--border)'}}><div style={{width:130,fontSize:12,color:'var(--text-muted)',fontWeight:600,flexShrink:0}}>{label}</div><div style={{fontSize:13,flex:1,minWidth:0}}>{(children===null||children===undefined||children==='')?<span style={{color:'var(--text-muted)'}}>—</span>:children}</div></div>)
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:12}}>
        <span style={{fontFamily:'var(--font-mono)',fontSize:12,color:'var(--c1)',fontWeight:700}}>{task.task_id||'—'}</span>
        <TypeBadge type={task.task_type||'task'}/>
        <Pill label={task.priority} color={PC[task.priority]}/>
        {over&&<span style={{padding:'2px 8px',borderRadius:4,fontSize:10,background:'rgba(225,29,72,.1)',color:'var(--rose)',fontWeight:700}}>⚠ OVERDUE</span>}
      </div>
      <div style={{fontSize:17,fontWeight:700,marginBottom:14,lineHeight:1.3}}>{task.task_name}</div>
      <Row label="Status">
        {canChangeStatus
          ? <select style={{background:`${SC[task.status]}12`,color:SC[task.status],border:`1px solid ${SC[task.status]}30`,borderRadius:5,padding:'4px 10px',fontSize:12,fontWeight:700,cursor:'pointer',outline:'none',fontFamily:'inherit'}}
              value={task.status} onChange={e=>onStatusChange&&onStatusChange(e.target.value)}>
              {STATUSES.map(s=><option key={s} value={s}>{SL[s]}</option>)}
            </select>
          : <Pill label={SL[task.status]} color={SC[task.status]}/>}
      </Row>
      <Row label="Project">{proj?.name}</Row>
      <Row label="Module">{task.module_name}</Row>
      <Row label="Assignee">{assignee?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ava name={assignee.full_name} size={20}/>{assignee.full_name}</span>:null}</Row>
      <Row label="Priority">{PI[task.priority]} {task.priority}</Row>
      <Row label="Progress">{task.progress_pct!=null?(<div style={{display:'flex',alignItems:'center',gap:10}}><div style={{flex:1,maxWidth:180}}><ProgBar pct={task.progress_pct} color={task.progress_pct>=100?'var(--emerald)':'var(--c1)'}/></div><span style={{fontSize:12,fontWeight:700,fontFamily:'var(--font-mono)',color:'var(--c1)'}}>{task.progress_pct}%</span></div>):null}</Row>
      <Row label="Planned Start">{dateFmt(task.planned_start_date)}</Row>
      <Row label="Planned End"><span style={{color:over?'var(--rose)':undefined}}>{dateFmt(task.planned_end_date)}</span></Row>
      {task.actual_start_date&&<Row label="Actual Start">{dateFmt(task.actual_start_date)}</Row>}
      {task.actual_end_date&&<Row label="Actual End">{dateFmt(task.actual_end_date)}</Row>}
      <Row label="Estimated Hours">{task.estimated_hours!=null?`${task.estimated_hours}h`:null}</Row>
      <Row label="Actual Hours">{task.actual_hours!=null?`${task.actual_hours}h`:null}</Row>
      <Row label="User Story">{story?`[${story.story_id}] ${story.title}`:null}</Row>
      <Row label="Sprint">{sprint?.name}</Row>
      <Row label="Change Request">{cr?`[${cr.cr_id}] ${cr.title}`:null}</Row>
      <Row label="Description"><div style={{whiteSpace:'pre-wrap'}}>{task.description}</div></Row>
      <TaskComments taskId={task.id} users={users} profile={profile} onProgress={pct=>onProgressUpdate&&onProgressUpdate(task.id,pct)} onPosted={()=>onCommentPosted&&onCommentPosted(task.id)}/>
    </div>
  )
}

/* ─── Task Comments / Daily Updates ─────────────────────── */
function TaskComments({taskId,users,profile,onProgress,onPosted}) {
  const [comments,setComments]=useState([])
  const [loading,setLoading]=useState(true)
  const [text,setText]=useState('')
  const [pct,setPct]=useState('')
  const [posting,setPosting]=useState(false)

  useEffect(()=>{ if(taskId) load() },[taskId])

  async function load(){
    setLoading(true)
    // NOTE: task_comments.user_id is a soft reference (plain UUID, no FK constraint —
    // matches this app's convention), so PostgREST can't embed `profiles` directly.
    // Resolve the commenter's name from the already-loaded `users` list instead.
    const {data,error}=await supabase.from('task_comments').select('*').eq('task_id',taskId).order('created_at',{ascending:false})
    if(error){ console.error(error); setComments([]) }
    else setComments(data||[])
    setLoading(false)
  }

  async function post(){
    if(!text.trim())return
    setPosting(true)
    try{
      const progress_pct = pct===''?null:Math.max(0,Math.min(100,parseInt(pct)||0))
      const {error}=await supabase.from('task_comments').insert({task_id:taskId,user_id:profile.id,comment:text.trim(),progress_pct})
      if(error) throw error
      if(progress_pct!=null){
        const {data:updRows,error:updErr}=await supabase.from('project_tasks').update({progress_pct}).eq('id',taskId).select('id')
        if(updErr) throw updErr
        if(!updRows||updRows.length===0) throw new Error('Progress was not saved — you may not have permission to update this task')
        onProgress&&onProgress(progress_pct)
      }
      setText(''); setPct('')
      onPosted&&onPosted()
      load()
    }catch(e){ alert(e.message) } finally{ setPosting(false) }
  }

  return (
    <div style={{marginTop:18}}>
      <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',marginBottom:10,display:'flex',alignItems:'center',gap:6}}><MessageSquare size={13}/> Daily Updates</div>
      <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'flex-start'}}>
        <textarea className="form-textarea" placeholder="Post a daily update…" value={text} onChange={e=>setText(e.target.value)} style={{flex:1,minHeight:56,fontSize:13}}/>
        <div style={{display:'flex',flexDirection:'column',gap:6,width:88,flexShrink:0}}>
          <input type="number" min={0} max={100} className="form-input" placeholder="%" value={pct} onChange={e=>setPct(e.target.value)} style={{fontSize:13,textAlign:'center'}}/>
          <button className="btn btn-primary btn-sm" onClick={post} disabled={posting||!text.trim()} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Send size={11}/> Post</button>
        </div>
      </div>
      {loading?<Loader/>:comments.length===0?(
        <div style={{fontSize:12,color:'var(--text-muted)',textAlign:'center',padding:'14px 0'}}>No updates yet — post the first one above</div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:10,maxHeight:280,overflowY:'auto'}}>
          {comments.map(c=>{
            const commenter=users?.find(u=>u.id===c.user_id)
            return (
            <div key={c.id} style={{padding:'10px 12px',borderRadius:10,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5,gap:8,flexWrap:'wrap'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:6,fontWeight:700,fontSize:12}}>
                  {commenter&&<Ava name={commenter.full_name} size={18}/>}
                  {commenter?.full_name||(c.user_id===profile?.id?profile.full_name:'Unknown')}
                </span>
                <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                  {c.progress_pct!=null&&<span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'#6366f118',color:'#6366f1'}}>{c.progress_pct}% completed</span>}
                  <span style={{fontSize:10,color:'var(--text-muted)'}}>{timeFmt(c.created_at)}</span>
                </div>
              </div>
              <div style={{fontSize:13,whiteSpace:'pre-wrap'}}>{c.comment}</div>
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

/* ══ MAIN PAGE ═══════════════════════════════════════════════ */
export default function TasksPage() {
  const { profile } = useAuth()
  const role  = profile?.role||'employee'
  const isMgr = ['admin','ceo','manager','department_head'].includes(role)

  const [perms,      setPerms]     = useState({...DEF_PERMS})
  const [permsSaved, setPermSaved] = useState(false)
  const myPerm = useMemo(()=>perms[role]||DEF_PERMS[role]||DEF_PERMS.employee,[perms,role])

  const [projects,  setProjects]  = useState([])
  const [tasks,     setTasks]     = useState([])
  const [stories,   setStories]   = useState([])
  const [sprints,   setSprints]   = useState([])
  const [epics,     setEpics]     = useState([])
  const [users,     setUsers]     = useState([])
  const usersRef    = useRef([])
  const [changReqs, setChangReqs] = useState([])
  const [commentCounts, setCommentCounts] = useState({})
  const [loading,   setLoading]   = useState(true)

  const [selProj,   setSelProj]  = useState('')
  const [selSprint, setSelSprint]= useState('')
  const [selModule, setSelModule]= useState('')
  const [selAssign, setSelAssign]= useState('')
  const [selStatus, setSelStatus]= useState('')
  const [selPrio,   setSelPrio]  = useState('')
  const [selType,   setSelType]  = useState('')
  const [search,    setSearch]   = useState('')
  const [searchParams] = useSearchParams()
  const view = searchParams.get('view') || 'kanban'
  const [groupBy,   setGroupBy]  = useState('none')

  const [showTask,   setShowTask]  = useState(false); const [editTask,  setEditTask]  = useState(null); const [taskForm,  setTaskForm]  = useState({}); const [subTask,  setSubTask]  = useState(false); const [delTask,  setDelTask]  = useState(null)
  const [detailTask, setDetailTask]= useState(null)
  const openDetail=t=>setDetailTask(t)
  const [showStory,  setShowStory] = useState(false); const [editStory, setEditStory] = useState(null); const [storyForm, setStoryForm] = useState({}); const [subStory, setSubStory] = useState(false); const [delStory, setDelStory] = useState(null)
  const [showSprint, setShowSprint]= useState(false); const [editSprint,setEditSprint]= useState(null); const [sprintForm,setSprintForm]= useState({})
  const [showAssign, setShowAssign]= useState(false); const [assignments,setAssignments]= useState([]); const [newAssign, setNewAssign] = useState({user_id:'',role:'member'})
  const [showPerms,  setShowPerms] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importProj, setImportProj] = useState('')

  // Keep usersRef current so the realtime closure always resolves assignee names
  useEffect(()=>{ usersRef.current=users },[users])

  useEffect(()=>{
    loadAll()
    // Fallback: reload when user returns to this tab (covers cases where realtime
    // wasn't active, e.g. STEP21 SQL not yet run)
    const onVisible=()=>{ if(document.visibilityState==='visible') loadAll() }
    document.addEventListener('visibilitychange',onVisible)
    return ()=>document.removeEventListener('visibilitychange',onVisible)
  },[profile?.id])

  // Real-time: auto-sync Kanban when check-in/out (or any writer) updates
  // a task status. Requires STEP21 SQL (realtime enabled on project_tasks).
  useEffect(()=>{
    const ch=supabase.channel('task-status-sync')
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'project_tasks'},payload=>{
        const u=payload.new
        // payload.new is a flat DB row — it never contains the joined `assignee`
        // object. Reconstruct it from the local users cache so avatars stay correct.
        const resolvedAssignee=usersRef.current.find(usr=>usr.id===u.assigned_to)||null
        setTasks(prev=>{
          // Ignore updates for tasks outside the current user's project scope
          if(!prev.some(t=>t.id===u.id)) return prev
          return prev.map(t=>t.id!==u.id?t:{
            ...t, ...u,
            // If assigned_to didn't change keep the richer joined object, else use resolved
            assignee: u.assigned_to===t.assigned_to ? t.assignee : resolvedAssignee
          })
        })
        setDetailTask(d=>d?.id!==u.id?d:{
          ...d, ...u,
          assignee: u.assigned_to===d.assigned_to ? d.assignee : resolvedAssignee
        })
      })
      .subscribe()
    return ()=>{ supabase.removeChannel(ch) }
  },[])

  async function loadAll() {
    setLoading(true)
    const [uR,pR,permR] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role').order('full_name'),
      isMgr
        ? supabase.from('projects').select('id,name,code,status').eq('status','active').order('name')
        : supabase.from('project_assignments').select('project:projects(id,name,code,status)').eq('user_id',profile.id),
      supabase.from('task_role_permissions').select('*').is('project_id',null),
    ])
    const us=uR.data||[]
    setUsers(us)
    if(permR.data?.length>0){
      const dp={}
      permR.data.forEach(p=>{dp[p.role]={can_view:p.can_view,can_create:p.can_create,can_edit:p.can_edit,can_delete:p.can_delete,can_change_status:p.can_change_status}})
      setPerms({...DEF_PERMS,...dp})
    }

    if(isMgr) {
      // Managers see all active projects and all their tasks
      const ps=pR.data||[]
      setProjects(ps)
      if(ps.length>0){
        const ids=ps.map(p=>p.id)
        const [tR,sR,spR,eR,crR]=await Promise.all([
          supabase.from('project_tasks').select('*,assignee:profiles!assigned_to(id,full_name)').in('project_id',ids).order('created_at',{ascending:false}),
          supabase.from('user_stories').select('*,assignee:profiles!assignee_id(id,full_name)').in('project_id',ids).order('created_at',{ascending:false}),
          supabase.from('sprints').select('*').in('project_id',ids).order('created_at',{ascending:false}),
          supabase.from('epics').select('*').in('project_id',ids),
          supabase.from('change_requests').select('*').in('project_id',ids).order('created_at',{ascending:false}),
        ])
        setTasks(tR.data||[]); setStories(sR.data||[])
        setSprints(spR.data||[]); setEpics(eR.data||[])
        setChangReqs(crR.data||[])
        loadCommentCounts((tR.data||[]).map(t=>t.id))
      }
    } else {
      // Non-managers (employee, developer, lead, etc.):
      // Load tasks ASSIGNED TO THEM + tasks in any project they are formally assigned to.
      // This ensures employees always see their tasks even if not in project_assignments.
      const assignedProjects=(pR.data||[]).map(r=>r.project).filter(Boolean)
      const assignedProjIds=assignedProjects.map(p=>p.id)

      // Build task query: directly assigned OR in their projects
      let taskQ=supabase.from('project_tasks')
        .select('*,assignee:profiles!assigned_to(id,full_name)')
        .order('created_at',{ascending:false})
      if(assignedProjIds.length>0){
        taskQ=taskQ.or(`assigned_to.eq.${profile.id},project_id.in.(${assignedProjIds.join(',')})`)
      } else {
        taskQ=taskQ.eq('assigned_to',profile.id)
      }
      const {data:taskData}=await taskQ
      const fetchedTasks=taskData||[]

      // Discover projects from task results that aren't already in assignedProjects
      const taskProjIds=[...new Set(fetchedTasks.map(t=>t.project_id).filter(Boolean))]
      const extraProjIds=taskProjIds.filter(id=>!assignedProjIds.includes(id))
      let allProjects=[...assignedProjects]
      if(extraProjIds.length>0){
        const {data:extraProjs}=await supabase.from('projects').select('id,name,code,status').in('id',extraProjIds)
        if(extraProjs) allProjects=[...allProjects,...extraProjs]
      }
      setProjects(allProjects)
      setTasks(fetchedTasks)
      loadCommentCounts(fetchedTasks.map(t=>t.id))

      // Load stories, sprints, epics, CRs for all visible project IDs
      const allProjIds=[...new Set([...assignedProjIds,...taskProjIds])]
      if(allProjIds.length>0){
        const [sR,spR,eR,crR]=await Promise.all([
          supabase.from('user_stories').select('*,assignee:profiles!assignee_id(id,full_name)').in('project_id',allProjIds).order('created_at',{ascending:false}),
          supabase.from('sprints').select('*').in('project_id',allProjIds).order('created_at',{ascending:false}),
          supabase.from('epics').select('*').in('project_id',allProjIds),
          supabase.from('change_requests').select('*').in('project_id',allProjIds).order('created_at',{ascending:false}),
        ])
        setStories(sR.data||[]); setSprints(spR.data||[])
        setEpics(eR.data||[]); setChangReqs(crR.data||[])
      } else {
        setStories([]); setSprints([]); setEpics([]); setChangReqs([])
      }
    }
    setLoading(false)
  }

  async function savePermissions() {
    for(const[r,p]of Object.entries(perms)){
      await supabase.from('task_role_permissions').upsert({project_id:null,role:r,...p},{onConflict:'project_id,role'})
    }
    setPermSaved(true); setTimeout(()=>setPermSaved(false),2500)
  }

  async function saveTask(e) {
    e.preventDefault(); setSubTask(true)
    try {
      const p={task_name:taskForm.task_name,task_type:taskForm.task_type||'task',description:taskForm.description||null,module_name:taskForm.module_name||null,priority:taskForm.priority||'medium',assigned_to:taskForm.assigned_to||null,status:taskForm.status||'backlog',planned_start_date:taskForm.planned_start_date||null,planned_end_date:taskForm.planned_end_date||null,estimated_hours:parseFloat(taskForm.estimated_hours)||null,actual_hours:parseFloat(taskForm.actual_hours)||null,user_story_id:taskForm.user_story_id||null,sprint_id:taskForm.sprint_id||null,change_request_id:taskForm.change_request_id||null,project_id:taskForm.project_id||selProj||projects[0]?.id}
      if(editTask){
        const wasAssignedTo = editTask.assigned_to
        await supabase.from('project_tasks').update(p).eq('id',editTask.id)
        // Notify if assignee changed
        if(p.assigned_to && p.assigned_to !== wasAssignedTo && p.assigned_to !== profile.id){
          sendNotif(p.assigned_to,{type:'task_assigned',title:`📋 Task assigned to you`,body:`${p.task_name} — ${SL[p.status]||p.status}`,link:'/tasks',senderId:profile.id})
        }
      } else {
        await supabase.from('project_tasks').insert({...p,created_by:profile.id})
        // Notify the assignee
        if(p.assigned_to && p.assigned_to !== profile.id){
          sendNotif(p.assigned_to,{type:'task_assigned',title:`📋 New task assigned to you`,body:`${p.task_name}`,link:'/tasks',senderId:profile.id})
        }
      }
      setShowTask(false);setEditTask(null);loadAll()
    }catch(e){alert(e.message)}finally{setSubTask(false)}
  }

  async function saveStory(e) {
    e.preventDefault(); setSubStory(true)
    try {
      const p={title:storyForm.title,story_type:storyForm.story_type||'story',description:storyForm.description||null,priority:storyForm.priority||'medium',status:storyForm.status||'open',story_points:parseInt(storyForm.story_points)||0,assignee_id:storyForm.assignee_id||null,epic_id:storyForm.epic_id||null,sprint_id:storyForm.sprint_id||null,start_date:storyForm.start_date||null,end_date:storyForm.end_date||null,project_id:storyForm.project_id||selProj||projects[0]?.id}
      if(editStory)await supabase.from('user_stories').update(p).eq('id',editStory.id)
      else await supabase.from('user_stories').insert({...p,created_by:profile.id})
      setShowStory(false);setEditStory(null);loadAll()
    }catch(e){alert(e.message)}finally{setSubStory(false)}
  }

  async function saveSprint() {
    const p={name:sprintForm.name,goal:sprintForm.goal||null,start_date:sprintForm.start_date||null,end_date:sprintForm.end_date||null,status:sprintForm.status||'planning',project_id:sprintForm.project_id||selProj||projects[0]?.id}
    if(editSprint)await supabase.from('sprints').update(p).eq('id',editSprint.id)
    else await supabase.from('sprints').insert({...p,created_by:profile.id})
    setShowSprint(false);setEditSprint(null);loadAll()
  }

  async function loadCommentCounts(taskIds){
    if(!taskIds.length){ setCommentCounts({}); return }
    const {data}=await supabase.from('task_comments').select('task_id').in('task_id',taskIds)
    const counts={}
    ;(data||[]).forEach(c=>{counts[c.task_id]=(counts[c.task_id]||0)+1})
    setCommentCounts(counts)
  }
  async function dropOnColumn(e,st){e.preventDefault();const tid=e.dataTransfer.getData('task_id');if(!tid||!myPerm.can_change_status)return;await supabase.from('project_tasks').update({status:st}).eq('id',tid);setTasks(p=>p.map(t=>t.id===tid?{...t,status:st}:t));setDetailTask(d=>d?.id===tid?{...d,status:st}:d)}
  async function changeStatus(id,st){
    if(!myPerm.can_change_status)return
    await supabase.from('project_tasks').update({status:st}).eq('id',id)
    setTasks(p=>p.map(t=>t.id===id?{...t,status:st}:t))
    setDetailTask(d=>d?.id===id?{...d,status:st}:d)
    // Notify the task creator/assignee about status change (if different from current user)
    const task = tasks.find(t=>t.id===id)
    if(task){
      const notifyId = task.assigned_to !== profile.id ? task.assigned_to : (task.created_by !== profile.id ? task.created_by : null)
      if(notifyId) sendNotif(notifyId,{type:'task_status',title:`🔄 Task status updated`,body:`${task.task_name} → ${SL[st]||st}`,link:'/tasks',senderId:profile.id})
    }
  }

  async function loadAssignments(pid){const{data}=await supabase.from('project_assignments').select('*,user:profiles(id,full_name,role)').eq('project_id',pid);setAssignments(data||[])}
  async function addAssignment(){if(!newAssign.user_id||!selProj)return;await supabase.from('project_assignments').upsert({project_id:selProj,user_id:newAssign.user_id,role:newAssign.role,assigned_by:profile.id});loadAssignments(selProj);setNewAssign({user_id:'',role:'member'})}
  async function removeAssignment(id){await supabase.from('project_assignments').delete().eq('id',id);loadAssignments(selProj)}

  const projTasks=useMemo(()=>tasks.filter(t=>{
    if(selProj&&t.project_id!==selProj)return false
    if(selSprint&&t.sprint_id!==selSprint)return false
    if(selModule&&t.module_name!==selModule)return false
    if(selAssign&&t.assigned_to!==selAssign)return false
    if(selStatus&&t.status!==selStatus)return false
    if(selPrio&&t.priority!==selPrio)return false
    if(selType&&t.task_type!==selType)return false
    if(search&&!t.task_name?.toLowerCase().includes(search.toLowerCase()))return false
    return true
  }),[tasks,selProj,selSprint,selModule,selAssign,selStatus,selPrio,selType,search])

  const projStories=useMemo(()=>stories.filter(s=>!selProj||s.project_id===selProj),[stories,selProj])
  const projEpics=useMemo(()=>epics.filter(e=>!selProj||e.project_id===selProj),[epics,selProj])
  const modules=useMemo(()=>[...new Set(tasks.filter(t=>t.module_name).map(t=>t.module_name))],[tasks])
  const sprintStats=useMemo(()=>{
    const list=sprints.filter(s=>!selProj||s.project_id===selProj)
    return {planning:list.filter(s=>s.status==='planning').length,active:list.filter(s=>s.status==='active').length,completed:list.filter(s=>s.status==='completed').length,total:list.length}
  },[sprints,selProj])
  const storyStats=useMemo(()=>{
    const pts=projStories.reduce((a,b)=>a+(b.story_points||0),0)
    const done=projStories.filter(s=>s.status==='done').reduce((a,b)=>a+(b.story_points||0),0)
    return {epics:projEpics.length,stories:projStories.length,pts,done,open:projStories.filter(s=>s.status==='open').length}
  },[projStories,projEpics])
  const kpis=useMemo(()=>({
    total:projTasks.length,backlog:projTasks.filter(t=>t.status==='backlog').length,
    todo:projTasks.filter(t=>t.status==='todo').length,inProgress:projTasks.filter(t=>t.status==='in_progress').length,
    qa:projTasks.filter(t=>t.status==='qa').length,demo:projTasks.filter(t=>t.status==='ready_for_demo').length,
    delayed:projTasks.filter(t=>t.status==='delayed').length,
    closed:projTasks.filter(t=>t.status==='closed').length,overdue:projTasks.filter(t=>isOverdue(t)).length,
    estHrs:projTasks.reduce((s,t)=>s+(t.estimated_hours||0),0),actHrs:projTasks.reduce((s,t)=>s+(t.actual_hours||0),0),
    crCount:projTasks.filter(t=>t.task_type==='change_request').length,
    crHrs:projTasks.filter(t=>t.task_type==='change_request').reduce((s,t)=>s+(t.actual_hours||0),0),
    bugs:projTasks.filter(t=>t.task_type==='bug').length,
  }),[projTasks])

  const selProjData=projects.find(p=>p.id===selProj)
  if(loading)return <Loader/>

  const FilterBar=()=>(
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:16,padding:'12px 14px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10}}>
      <Filter size={13} style={{color:'var(--text-muted)',flexShrink:0}}/>
      <select className="form-select" value={selProj} onChange={e=>{setSelProj(e.target.value);setSelSprint('')}} style={{width:'auto',fontSize:12}}>
        <option value="">All Projects</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {sprints.filter(s=>!selProj||s.project_id===selProj).length>0&&
        <select className="form-select" value={selSprint} onChange={e=>setSelSprint(e.target.value)} style={{width:'auto',fontSize:12}}>
          <option value="">All Sprints</option>{sprints.filter(s=>!selProj||s.project_id===selProj).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>}
      {modules.length>0&&<select className="form-select" value={selModule} onChange={e=>setSelModule(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Modules</option>{modules.map(m=><option key={m} value={m}>{m}</option>)}
      </select>}
      <select className="form-select" value={selAssign} onChange={e=>setSelAssign(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Assignees</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
      <select className="form-select" value={selStatus} onChange={e=>setSelStatus(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Statuses</option>{STATUSES.map(s=><option key={s} value={s}>{SL[s]}</option>)}
      </select>
      <select className="form-select" value={selPrio} onChange={e=>setSelPrio(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Priorities</option>{PRIOS.map(p=><option key={p} value={p}>{PI[p]} {p}</option>)}
      </select>
      <select className="form-select" value={selType} onChange={e=>setSelType(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Types</option>{TASK_TYPES.map(t=><option key={t} value={t}>{TYPE_ICO[t]} {t.replace(/_/g,' ')}</option>)}
      </select>
      <div style={{flex:1,minWidth:120}}><SearchBox value={search} onChange={setSearch} placeholder="Search tasks…"/></div>
      {view==='list'&&(
        <select className="form-select" value={groupBy} onChange={e=>setGroupBy(e.target.value)} style={{width:'auto',fontSize:12}}>
          <option value="none">No Grouping</option>
          <option value="status">Group by Status</option>
          <option value="assignee">Group by Assignee</option>
          <option value="module">Group by Module</option>
          <option value="priority">Group by Priority</option>
          <option value="sprint">Group by Sprint</option>
        </select>
      )}
      {(selProj||selSprint||selModule||selAssign||selStatus||selPrio||selType||search)&&
        <button className="btn btn-ghost btn-sm" onClick={()=>{setSelProj('');setSelSprint('');setSelModule('');setSelAssign('');setSelStatus('');setSelPrio('');setSelType('');setSearch('')}}><X size={11}/> Clear</button>}
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Task Management</div>
          <div className="page-subtitle">{kpis.total} tasks · {projStories.length} stories · Role: <strong style={{textTransform:'capitalize'}}>{role.replace(/_/g,' ')}</strong></div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {isMgr&&<button className="btn btn-ghost btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>setShowPerms(true)}><Shield size={13}/> Permissions</button>}
          {isMgr&&selProj&&<button className="btn btn-outline btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{loadAssignments(selProj);setShowAssign(true)}}><UserPlus size={13}/> Access</button>}
          {isMgr&&<button className="btn btn-ghost btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setEditSprint(null);setSprintForm({project_id:selProj||projects[0]?.id,name:'',goal:'',start_date:'',end_date:'',status:'planning'});setShowSprint(true)}}><Zap size={13}/> Sprint</button>}
          {myPerm.can_create&&<button className="btn btn-outline btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setEditStory(null);setStoryForm({project_id:selProj||projects[0]?.id,priority:'medium',status:'open',story_points:0,story_type:'story'});setShowStory(true)}}><Target size={13}/> Story</button>}
          {myPerm.can_create&&<button className="btn btn-outline btn-sm" title="Bulk-import tasks from Excel/CSV" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setImportProj(selProj||projects[0]?.id||'');setShowImport(true)}}><Upload size={13}/> Import Tasks</button>}
          {myPerm.can_create&&<button className="btn btn-primary" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setEditTask(null);setTaskForm({project_id:selProj||projects[0]?.id,priority:'medium',status:'backlog',task_type:'task'});setShowTask(true)}}><Plus size={14}/> New Task</button>}
        </div>
      </div>

      <FilterBar/>

          {/* KANBAN */}
          {view==='kanban'&&(
            <>
              <div style={{display:'grid',gridTemplateColumns:`repeat(auto-fit,minmax(130px,1fr))`,gap:10,marginBottom:16}}>
                {STATUSES.map(status=>(
                  <StatusKpiCard key={status} status={status} tasks={projTasks.filter(t=>t.status===status)} color={SC[status]}
                    canAdd={myPerm.can_create}
                    onAdd={()=>{setEditTask(null);setTaskForm({project_id:selProj||projects[0]?.id,status,priority:'medium',task_type:'task'});setShowTask(true)}}/>
                ))}
              </div>
              <div style={{overflowX:'auto',paddingBottom:12}}>
                <div style={{display:'grid',gridTemplateColumns:`repeat(${STATUSES.length},minmax(220px,1fr))`,gap:10,minWidth:STATUSES.length*230}}>
                  {STATUSES.map(status=>{
                    const colTasks=projTasks.filter(t=>t.status===status),cc=SC[status]
                    return (
                      <div key={status} onDragOver={e=>e.preventDefault()} onDrop={e=>dropOnColumn(e,status)}
                        style={{background:`${cc}06`,border:`1px solid ${cc}20`,borderRadius:10,minHeight:280,display:'flex',flexDirection:'column'}}>
                        <div style={{padding:'10px 14px',borderBottom:`1px solid ${cc}20`,display:'flex',alignItems:'center',gap:8}}>
                          <span style={{width:8,height:8,borderRadius:'50%',background:cc,flexShrink:0}}/>
                          <span style={{fontSize:12,fontWeight:700,color:cc}}>{SL[status]}</span>
                          <span style={{marginLeft:'auto',minWidth:20,height:20,borderRadius:4,background:`${cc}20`,color:cc,fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 5px'}}>{colTasks.length}</span>
                        </div>
                        <div style={{flex:1,padding:'8px',display:'flex',flexDirection:'column',gap:7,overflowY:'auto',maxHeight:580}}>
                          {colTasks.map(task=>(
                            <KanbanCard key={task.id} task={task} users={users} commentCount={commentCounts[task.id]||0}
                              canEdit={myPerm.can_edit} canDelete={myPerm.can_delete} canChangeStatus={myPerm.can_change_status}
                              onView={()=>openDetail(task)}
                              onEdit={()=>{setEditTask(task);setTaskForm({...task});setShowTask(true)}}
                              onDelete={()=>setDelTask(task.id)}
                              onStatus={s=>changeStatus(task.id,s)}/>
                          ))}
                          {myPerm.can_create&&(
                            <button onClick={()=>{setEditTask(null);setTaskForm({project_id:selProj||projects[0]?.id,status,priority:'medium',task_type:'task'});setShowTask(true)}}
                              style={{width:'100%',padding:'8px',border:`1px dashed ${cc}40`,borderRadius:7,background:'transparent',cursor:'pointer',fontSize:11,color:`${cc}80`,fontFamily:'inherit',transition:'all .15s'}}
                              onMouseEnter={e=>{e.currentTarget.style.background=`${cc}08`;e.currentTarget.style.borderColor=cc}}
                              onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.borderColor=`${cc}40`}}>
                              + Add task
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

      {/* LIST */}
      {view==='list'&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:16}}>
        <Kpi label="Total"    v={kpis.total}          color="#3b82f6"/>
        <Kpi label="Overdue"  v={kpis.overdue}        color="#e11d48"/>
        <Kpi label="Bugs"     v={kpis.bugs}           color="#e11d48"/>
        <Kpi label="CR Tasks" v={kpis.crCount}        color="#f59e0b"/>
        <Kpi label="Est. Hrs" v={`${kpis.estHrs}h`}  color="#14b8a6"/>
        <Kpi label="Act. Hrs" v={`${kpis.actHrs}h`}  color="#06b6d4"/>
      </div>}
      {view==='list'&&(()=>{
        const TaskRow=({t})=>{const proj=projects.find(p=>p.id===t.project_id),over=isOverdue(t);return(
          <tr key={t.id} style={{background:over?'rgba(225,29,72,.03)':'transparent'}}>
            <td><span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--c1)',fontWeight:700,cursor:'pointer'}} onClick={()=>openDetail(t)}>{t.task_id||'—'}</span></td>
            <td><TypeBadge type={t.task_type||'task'}/></td>
            <td><div style={{fontWeight:600,fontSize:13,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}} onClick={()=>openDetail(t)}>{t.task_name}</div>{over&&<div style={{fontSize:10,color:'var(--rose)'}}>⚠ Overdue</div>}</td>
            <td><span style={{fontSize:11,color:'var(--text-muted)'}}>{t.module_name||'—'}</span></td>
            <td><span style={{fontSize:11,color:'var(--text-muted)'}}>{proj?.name||'—'}</span></td>
            <td>{t.assignee?<div style={{display:'flex',alignItems:'center',gap:5}}><Ava name={t.assignee.full_name} size={20}/><span style={{fontSize:11}}>{t.assignee.full_name.split(' ')[0]}</span></div>:<span style={{color:'var(--text-muted)',fontSize:11}}>—</span>}</td>
            <td><span style={{fontSize:12}}>{PI[t.priority]} {t.priority}</span></td>
            <td>{myPerm.can_change_status
              ?<select style={{background:`${SC[t.status]}12`,color:SC[t.status],border:`1px solid ${SC[t.status]}30`,borderRadius:5,padding:'3px 8px',fontSize:11,fontWeight:700,cursor:'pointer',outline:'none',fontFamily:'inherit'}} value={t.status} onChange={e=>changeStatus(t.id,e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{SL[s]}</option>)}</select>
              :<Pill label={SL[t.status]} color={SC[t.status]}/>}
            </td>
            <td><span style={{fontSize:11,color:over?'var(--rose)':'var(--text-muted)',fontFamily:'var(--font-mono)'}}>{dateFmt(t.planned_end_date)||'—'}</span></td>
            <td><span style={{fontFamily:'var(--font-mono)',fontSize:11}}>{t.estimated_hours||'—'}</span></td>
            <td><span style={{fontFamily:'var(--font-mono)',fontSize:11,color:t.actual_hours>t.estimated_hours?'var(--rose)':'var(--text)'}}>{t.actual_hours||'—'}</span></td>
            <td><div style={{display:'flex',gap:4}}>
              <button className="btn btn-ghost btn-sm btn-icon" title="View" onClick={()=>openDetail(t)}><Eye size={11}/></button>
              {myPerm.can_edit&&<button className="btn btn-ghost btn-sm btn-icon" onClick={()=>{setEditTask(t);setTaskForm({...t});setShowTask(true)}}><Edit2 size={11}/></button>}
              {myPerm.can_delete&&<button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} onClick={()=>setDelTask(t.id)}><Trash2 size={11}/></button>}
            </div></td>
          </tr>
        )}
        const THead=()=><thead><tr><th>ID</th><th>Type</th><th>Task Name</th><th>Module</th><th>Project</th><th>Assignee</th><th>Priority</th><th>Status</th><th>End Date</th><th>Est.</th><th>Act.</th><th></th></tr></thead>
        const GroupHeader=({label,color,count})=><tr><td colSpan={12} style={{padding:'10px 14px',background:'var(--surface-2)',borderTop:'2px solid var(--border)',fontWeight:700,fontSize:12,color:color||'var(--text-muted)'}}>{label} <span style={{fontWeight:400,fontSize:11}}>({count})</span></td></tr>
        if(projTasks.length===0)return<div className="table-wrap"><table><THead/><tbody><tr><td colSpan={12} style={{padding:'30px',textAlign:'center',color:'var(--text-muted)'}}>No tasks found — try clearing filters</td></tr></tbody></table></div>
        if(groupBy==='none')return<div className="table-wrap"><table><THead/><tbody>{projTasks.map(t=><TaskRow key={t.id} t={t}/>)}</tbody></table></div>
        // Grouped rendering
        const groupKey=t=>{
          if(groupBy==='status')return t.status
          if(groupBy==='assignee')return t.assigned_to||(t.assignee?.id)||'__unassigned'
          if(groupBy==='module')return t.module_name||'__no_module'
          if(groupBy==='priority')return t.priority||'medium'
          if(groupBy==='sprint')return t.sprint_id||'__no_sprint'
          return 'all'
        }
        const groupLabel=k=>{
          if(groupBy==='status')return SL[k]||k
          if(groupBy==='assignee'){if(k==='__unassigned')return'Unassigned';const u=users.find(u=>u.id===k);return u?.full_name||k}
          if(groupBy==='module')return k==='__no_module'?'No Module':k
          if(groupBy==='priority')return k.charAt(0).toUpperCase()+k.slice(1)
          if(groupBy==='sprint'){if(k==='__no_sprint')return'No Sprint';const s=sprints.find(s=>s.id===k);return s?.name||k}
          return k
        }
        const groupColor=k=>{
          if(groupBy==='status')return SC[k]
          if(groupBy==='priority')return PC[k]
          return 'var(--c1)'
        }
        const groupOrder=groupBy==='status'?STATUSES:groupBy==='priority'?PRIOS:null
        const grouped=projTasks.reduce((acc,t)=>{const k=groupKey(t);(acc[k]=acc[k]||[]).push(t);return acc},{})
        const keys=groupOrder?[...groupOrder.filter(k=>grouped[k]),...Object.keys(grouped).filter(k=>!groupOrder.includes(k))]:Object.keys(grouped).sort()
        return<div className="table-wrap"><table><THead/><tbody>
          {keys.map(k=>[
            <GroupHeader key={`hdr-${k}`} label={groupLabel(k)} color={groupColor(k)} count={(grouped[k]||[]).length}/>,
            ...(grouped[k]||[]).map(t=><TaskRow key={t.id} t={t}/>)
          ])}
        </tbody></table></div>
      })()}

      {/* STORIES */}
      {view==='stories'&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:16}}>
        <Kpi label="Epics"       v={storyStats.epics} color="#7c3aed"/>
        <Kpi label="Stories"     v={storyStats.stories} color="#3b82f6"/>
        <Kpi label="Open"        v={storyStats.open} color="#64748b"/>
        <Kpi label="Points"      v={storyStats.pts} color="#f59e0b"/>
        <Kpi label="Points Done" v={storyStats.done} color="#10b981"/>
      </div>}
      {view==='stories'&&(
        <StoriesTree epics={projEpics} stories={projStories} tasks={tasks} myPerm={myPerm}
          onEditStory={s=>{setEditStory(s);setStoryForm({...s});setShowStory(true)}}
          onDeleteStory={id=>setDelStory(id)}
          onAddTask={s=>{setEditTask(null);setTaskForm({project_id:s.project_id,user_story_id:s.id,priority:'medium',status:'backlog',task_type:'task'});setShowTask(true)}}
          onViewTask={t=>openDetail(t)}/>
      )}

      {/* SPRINTS */}
      {view==='sprints'&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:16}}>
        <Kpi label="Total"     v={sprintStats.total}     color="#3b82f6"/>
        <Kpi label="Planning"  v={sprintStats.planning}  color="#64748b"/>
        <Kpi label="Active"    v={sprintStats.active}    color="#f59e0b"/>
        <Kpi label="Completed" v={sprintStats.completed} color="#10b981"/>
      </div>}
      {view==='sprints'&&(
        <div>
          {sprints.filter(s=>!selProj||s.project_id===selProj).length===0
            ?<Empty icon="⚡" title="No sprints" desc="Create a sprint to organise time-boxed iterations"/>
            :sprints.filter(s=>!selProj||s.project_id===selProj).map(s=>{
              const spTasks=tasks.filter(t=>t.sprint_id===s.id)
              const spSt=stories.filter(st=>st.sprint_id===s.id)
              const pts=spSt.reduce((a,b)=>a+(b.story_points||0),0)
              const dv=spSt.filter(x=>x.status==='done').reduce((a,b)=>a+(b.story_points||0),0)
              const pct=spTasks.length>0?Math.round((spTasks.filter(t=>t.status==='closed').length/spTasks.length)*100):0
              const sclr={planning:'#64748b',active:'#f59e0b',completed:'#10b981'}[s.status]
              return (
                <div key={s.id} style={{background:'var(--surface)',border:`1px solid ${sclr}25`,borderLeft:`3px solid ${sclr}`,borderRadius:10,marginBottom:10,padding:'14px 18px'}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                    <div style={{flex:1}}><div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><span style={{fontWeight:700,fontSize:14}}>{s.name}</span><Pill label={s.status} color={sclr}/></div>
                      {s.goal&&<div style={{fontSize:12,color:'var(--text-muted)',marginBottom:6}}>{s.goal}</div>}
                      <div style={{fontSize:11,color:'var(--text-muted)',display:'flex',gap:12,flexWrap:'wrap'}}>{s.start_date&&<span>📅 {dateFmt(s.start_date)}</span>}{s.end_date&&<span>🏁 {dateFmt(s.end_date)}</span>}<span>📋 {spTasks.length}</span><span>⬡ {pts}pts · {dv} done</span></div>
                    </div>
                    <div style={{width:130}}><div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-muted)',marginBottom:4}}><span>Progress</span><span>{pct}%</span></div><ProgBar pct={pct} color={sclr}/>{pts>0&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>Velocity: {dv}/{pts}pts</div>}</div>
                    <div style={{display:'flex',gap:6,flexShrink:0}}>
                      {isMgr&&s.status==='planning'&&<button className="btn btn-primary btn-sm" onClick={async()=>{await supabase.from('sprints').update({status:'active'}).eq('id',s.id);loadAll()}}>▶ Start</button>}
                      {isMgr&&s.status==='active'&&<button className="btn btn-ghost btn-sm" onClick={async()=>{await supabase.from('sprints').update({status:'completed'}).eq('id',s.id);loadAll()}}>✓ Complete</button>}
                      {isMgr&&<button className="btn btn-ghost btn-sm btn-icon" onClick={()=>{setEditSprint(s);setSprintForm({...s});setShowSprint(true)}}><Edit2 size={11}/></button>}
                    </div>
                  </div>
                  {spTasks.length>0&&<div style={{marginTop:10,display:'flex',gap:5,flexWrap:'wrap'}}>{STATUSES.map(st=>{const n=spTasks.filter(t=>t.status===st).length;return n>0?<span key={st} style={{padding:'3px 9px',borderRadius:4,fontSize:10,fontWeight:700,background:`${SC[st]}12`,color:SC[st],border:`1px solid ${SC[st]}25`}}>{SL[st]}: {n}</span>:null})}</div>}
                </div>
              )
            })
          }
        </div>
      )}

      {/* REPORTS */}
      {view==='reports'&&(()=>{
        const total=tasks.length
        const closed=tasks.filter(t=>t.status==='closed').length
        const completion=total>0?Math.round((closed/total)*100):0
        const estHrsAll=tasks.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0)
        const actHrsAll=tasks.reduce((s,t)=>s+(Number(t.actual_hours)||0),0)
        const onTimeClosed=tasks.filter(t=>t.status==='closed'&&(!t.planned_end_date||!t.actual_end_date||new Date(t.actual_end_date)<=new Date(t.planned_end_date))).length
        const onTimeRate=closed>0?Math.round((onTimeClosed/closed)*100):0
        const overdueCount=tasks.filter(isOverdue).length
        const activeProjects=projects.filter(p=>tasks.some(t=>t.project_id===p.id)).length

        const statusData=STATUSES.map(s=>({key:s,name:SL[s],value:tasks.filter(t=>t.status===s).length,color:SC[s]})).filter(d=>d.value>0)
        const priorityData=PRIOS.map(p=>({name:p,value:tasks.filter(t=>t.priority===p).length,color:PC[p]}))
        const typeData=TASK_TYPES.map(t=>({key:t,name:t.replace(/_/g,' '),value:tasks.filter(x=>(x.task_type||'task')===t).length,color:TYPE_CLR[t]})).filter(d=>d.value>0)

        return (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* HERO STATS */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12}}>
            <ReportHero icon={<Target size={15}/>} label="Completion Rate" value={`${completion}%`} color="#10b981" sub={`${closed} of ${total} tasks closed`}/>
            <ReportHero icon={<TrendingUp size={15}/>} label="On-Time Delivery" value={`${onTimeRate}%`} color="#3b82f6" sub={`${onTimeClosed} of ${closed} on schedule`}/>
            <ReportHero icon={<AlertTriangle size={15}/>} label="Overdue" value={overdueCount} color="#e11d48" sub="Past planned end date"/>
            <ReportHero icon={<Clock size={15}/>} label="Hours Logged" value={`${actHrsAll}h`} color="#8b5cf6" sub={`of ${estHrsAll}h estimated`}/>
            <ReportHero icon={<BarChart2 size={15}/>} label="Active Projects" value={activeProjects} color="#f59e0b" sub={`${projects.length} total`}/>
          </div>

          {/* CHARTS */}
          <div style={{display:'grid',gridTemplateColumns:'minmax(280px,1.1fr) minmax(260px,1fr)',gap:16}}>
            <ChartCard title="Status Distribution" sub={`${total} tasks across all active projects`}>
              {total===0?<div style={{padding:'30px 0',textAlign:'center',color:'#94a3b8',fontSize:12}}>No tasks yet</div>:
              <div style={{display:'flex',alignItems:'center',gap:18,flexWrap:'wrap'}}>
                <div style={{position:'relative',width:180,height:180,flexShrink:0}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" innerRadius={54} outerRadius={82} dataKey="value" paddingAngle={statusData.length>1?3:0} cornerRadius={4} stroke="none">
                        {statusData.map(d=><Cell key={d.key} fill={d.color}/>)}
                      </Pie>
                      <Tooltip content={<ReportTip/>}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',pointerEvents:'none',padding:'0 20px',textAlign:'center'}}>
                    <div style={{fontSize:'clamp(16px,3vw,24px)',fontWeight:800,color:'#0f172a',lineHeight:1,fontFamily:'ui-monospace,monospace',overflowWrap:'break-word'}}>{total}</div>
                    <div style={{fontSize:10,color:'#94a3b8',fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'}}>Total</div>
                  </div>
                </div>
                <div style={{flex:1,minWidth:160}}>
                  {statusData.map(d=><LegendRow key={d.key} label={d.name} value={d.value} total={total} color={d.color}/>)}
                </div>
              </div>}
            </ChartCard>

            <ChartCard title="Priority Breakdown" sub="Task count by priority level" height={230}>
              {total===0?<div style={{padding:'30px 0',textAlign:'center',color:'#94a3b8',fontSize:12}}>No tasks yet</div>:
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={priorityData} layout="vertical" margin={{left:6,right:16}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false}/>
                  <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="name" width={64} tick={{fontSize:11.5,fill:'#334155',textTransform:'capitalize'}} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ReportTip/>} cursor={{fill:'#f8fafc'}}/>
                  <Bar dataKey="value" radius={[0,6,6,0]} barSize={20}>
                    {priorityData.map(d=><Cell key={d.name} fill={d.color}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>}
            </ChartCard>
          </div>

          {/* TASK TYPE MIX */}
          {typeData.length>0&&
            <ChartCard title="Task Type Mix" sub={`${total} tasks by type`}>
              <div style={{display:'flex',gap:2,height:14,borderRadius:7,overflow:'hidden',marginBottom:14}}>
                {typeData.map(d=><div key={d.key} title={`${d.name}: ${d.value}`} style={{width:`${(d.value/total)*100}%`,background:d.color,minWidth:2}}/>)}
              </div>
              <div style={{display:'flex',gap:18,flexWrap:'wrap'}}>
                {typeData.map(d=>(
                  <div key={d.key} style={{display:'flex',alignItems:'center',gap:7}}>
                    <span style={{width:9,height:9,borderRadius:3,background:d.color,flexShrink:0}}/>
                    <span style={{fontSize:12,color:'#334155',textTransform:'capitalize'}}>{TYPE_ICO[d.key]} {d.name}</span>
                    <span style={{fontSize:11,fontWeight:700,color:'#0f172a'}}>{d.value}</span>
                  </div>
                ))}
              </div>
            </ChartCard>}

          {/* PROJECT PROGRESS */}
          <ChartCard title="📊 Project Progress" sub={`${activeProjects} of ${projects.length} projects have activity`}>
            {projects.length===0?<div style={{padding:'20px 0',color:'#94a3b8',fontSize:12,textAlign:'center'}}>No projects</div>
              :[...projects].sort((a,b)=>{
                  const pa=tasks.filter(t=>t.project_id===a.id),pb=tasks.filter(t=>t.project_id===b.id)
                  const pctA=pa.length?Math.round((pa.filter(t=>t.status==='closed').length/pa.length)*100):-1
                  const pctB=pb.length?Math.round((pb.filter(t=>t.status==='closed').length/pb.length)*100):-1
                  return pctB-pctA
                }).map(p=>{const pt=tasks.filter(t=>t.project_id===p.id),done=pt.filter(t=>t.status==='closed').length,pct=pt.length>0?Math.round((done/pt.length)*100):0,pclr=pct===100?'#10b981':pct>60?'#6366f1':pct>0?'#f59e0b':'#cbd5e1'
                  return <div key={p.id} style={{display:'flex',alignItems:'center',gap:14,padding:'11px 0',borderBottom:'1px solid #f1f5f9'}}>
                    <span style={{width:170,fontWeight:600,fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flexShrink:0}}>{p.name}</span>
                    <span style={{width:70,fontFamily:'ui-monospace,monospace',fontSize:11,color:'#94a3b8',flexShrink:0}}>{done}/{pt.length}</span>
                    <div style={{flex:1,height:7,borderRadius:4,background:'#f1f5f9',overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:pclr,borderRadius:4,transition:'width .3s'}}/></div>
                    <span style={{width:40,fontFamily:'ui-monospace,monospace',fontWeight:700,fontSize:12.5,textAlign:'right',color:pclr,flexShrink:0}}>{pct}%</span>
                  </div>
                })
            }
          </ChartCard>

          {/* RESOURCE UTILIZATION */}
          <ChartCard title="👥 Resource Utilization" sub="Ranked by hours logged">
            {(()=>{
              const rows=users.filter(u=>tasks.some(t=>t.assigned_to===u.id)).map(u=>{
                const ut=tasks.filter(t=>t.assigned_to===u.id)
                return {u,total:ut.length,closed:ut.filter(t=>t.status==='closed').length,cr:ut.filter(t=>t.task_type==='change_request').length,
                  est:ut.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0),act:ut.reduce((s,t)=>s+(Number(t.actual_hours)||0),0)}
              }).sort((a,b)=>b.act-a.act)
              if(rows.length===0)return<div style={{padding:'20px 0',color:'#94a3b8',fontSize:12,textAlign:'center'}}>No assigned tasks yet</div>
              const maxHrs=Math.max(...rows.map(r=>Math.max(r.est,r.act)),1)
              return rows.map((r,i)=>(
                <div key={r.u.id} style={{display:'flex',alignItems:'center',gap:14,padding:'10px 0',borderBottom:'1px solid #f1f5f9',flexWrap:'wrap'}}>
                  <span style={{width:20,fontSize:11,fontWeight:800,color:i<3?'#f59e0b':'#cbd5e1',flexShrink:0,textAlign:'center'}}>{i+1}</span>
                  <div style={{display:'flex',alignItems:'center',gap:8,width:150,flexShrink:0}}><Ava name={r.u.full_name} size={26}/><div><div style={{fontSize:12,fontWeight:600}}>{r.u.full_name}</div><div style={{fontSize:10,color:'#94a3b8',textTransform:'capitalize'}}>{r.u.role}</div></div></div>
                  <div style={{display:'flex',gap:12,flexShrink:0}}>
                    <span style={{fontSize:11.5,color:'#94a3b8'}}>Total <strong style={{color:'#0f172a'}}>{r.total}</strong></span>
                    <span style={{fontSize:11.5,color:'#94a3b8'}}>Done <strong style={{color:'#10b981'}}>{r.closed}</strong></span>
                    {r.cr>0&&<span style={{fontSize:11.5,color:'#94a3b8'}}>CR <strong style={{color:'#f59e0b'}}>{r.cr}</strong></span>}
                  </div>
                  <div style={{flex:1,minWidth:130,display:'flex',flexDirection:'column',gap:3}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:26,fontSize:9,color:'#94a3b8'}}>Est</span><div style={{flex:1,height:5,borderRadius:3,background:'#f1f5f9',overflow:'hidden'}}><div style={{height:'100%',width:`${(r.est/maxHrs)*100}%`,background:'#94a3b8',borderRadius:3}}/></div><span style={{width:34,fontSize:10,fontFamily:'ui-monospace,monospace',color:'#94a3b8',textAlign:'right'}}>{r.est}h</span></div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:26,fontSize:9,color:'#6366f1'}}>Act</span><div style={{flex:1,height:5,borderRadius:3,background:'#f1f5f9',overflow:'hidden'}}><div style={{height:'100%',width:`${(r.act/maxHrs)*100}%`,background:r.act>r.est&&r.est>0?'#e11d48':'#6366f1',borderRadius:3}}/></div><span style={{width:34,fontSize:10,fontFamily:'ui-monospace,monospace',fontWeight:700,color:r.act>r.est&&r.est>0?'#e11d48':'#6366f1',textAlign:'right'}}>{r.act}h</span></div>
                  </div>
                </div>
              ))
            })()}
          </ChartCard>

          {/* CHANGE REQUEST SUMMARY */}
          {(()=>{
            const crByProj=projects.map(p=>{
              const crTasks=tasks.filter(t=>t.project_id===p.id&&t.task_type==='change_request')
              return {p,crTasks,hrs:crTasks.reduce((s,t)=>s+(Number(t.actual_hours)||0),0),closed:crTasks.filter(t=>t.status==='closed').length}
            }).filter(r=>r.crTasks.length>0)
            if(crByProj.length===0)return null
            return (
              <ChartCard title="🔄 Change Request Summary" sub={`${crByProj.reduce((s,r)=>s+r.crTasks.length,0)} CR tasks across ${crByProj.length} projects`}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
                  {crByProj.map(r=>(
                    <div key={r.p.id} style={{background:'#fbf8ff',border:'1px solid #ede9fe',borderRadius:12,padding:'12px 14px'}}>
                      <div style={{fontWeight:700,fontSize:12.5,marginBottom:8,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.p.name}</div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#7c3aed',fontWeight:700,marginBottom:4}}>
                        <span>🔄 {r.crTasks.length} CR tasks</span><span>{r.closed} closed</span>
                      </div>
                      <div style={{fontSize:11,color:'#94a3b8',fontFamily:'ui-monospace,monospace'}}>{r.hrs}h actual logged</div>
                    </div>
                  ))}
                </div>
              </ChartCard>
            )
          })()}

        </div>
        )
      })()}

      {view==='dashboards'&&(
        <div>
          <ChartCard title="🧩 Custom Dashboards" sub="Drag-and-drop review dashboards for the selected project, bound to a date range">
            <CustomDashboardsPanel projectId={selProj} />
          </ChartCard>
        </div>
      )}

      {/* MODALS */}

      {/* Task Detail Modal */}
      <Modal open={!!detailTask} onClose={()=>setDetailTask(null)}
        title={detailTask?.task_id||'Task Detail'} size="lg"
        footer={<>
          {myPerm.can_edit&&detailTask&&<button className="btn btn-outline btn-sm" onClick={()=>{setEditTask(detailTask);setTaskForm({...detailTask});setDetailTask(null);setShowTask(true)}}><Edit2 size={12}/> Edit</button>}
          <button className="btn btn-ghost" onClick={()=>setDetailTask(null)}>Close</button>
        </>}>
        <TaskDetail task={detailTask} projects={projects} users={users} stories={stories}
          sprints={sprints} changReqs={changReqs}
          canChangeStatus={myPerm.can_change_status}
          onStatusChange={s=>changeStatus(detailTask.id,s)}
          profile={profile}
          onProgressUpdate={(id,pct)=>{setTasks(p=>p.map(t=>t.id===id?{...t,progress_pct:pct}:t));setDetailTask(d=>d?.id===id?{...d,progress_pct:pct}:d)}}
          onCommentPosted={id=>setCommentCounts(c=>({...c,[id]:(c[id]||0)+1}))}/>
      </Modal>

      <Modal open={showTask} onClose={()=>{setShowTask(false);setEditTask(null)}} title={editTask?`Edit ${editTask.task_id||'Task'}`:'New Task'} size="lg"
        footer={<><button className="btn btn-ghost" onClick={()=>{setShowTask(false);setEditTask(null)}}>Cancel</button><button className="btn btn-primary" onClick={saveTask} disabled={subTask}>{subTask?'Saving…':'Save Task'}</button></>}>
        <TaskForm form={taskForm} setForm={setTaskForm} projects={projects} users={users} isMgr={isMgr}
          stories={stories.filter(s=>!taskForm.project_id||s.project_id===taskForm.project_id)}
          sprints={sprints.filter(s=>!taskForm.project_id||s.project_id===taskForm.project_id)}
          changReqs={changReqs.filter(c=>!taskForm.project_id||c.project_id===taskForm.project_id)}
          projectId={selProj}/>
      </Modal>

      <Modal open={showStory} onClose={()=>{setShowStory(false);setEditStory(null)}} title={editStory?`Edit ${editStory.story_id||'Story'}`:'New Story'} size="lg"
        footer={<><button className="btn btn-ghost" onClick={()=>{setShowStory(false);setEditStory(null)}}>Cancel</button><button className="btn btn-primary" onClick={saveStory} disabled={subStory}>{subStory?'Saving…':'Save Story'}</button></>}>
        <StoryForm form={storyForm} setForm={setStoryForm} users={users}
          epics={epics.filter(e=>!storyForm.project_id||e.project_id===storyForm.project_id)}
          sprints={sprints.filter(s=>!storyForm.project_id||s.project_id===storyForm.project_id)}/>
      </Modal>

      <Modal open={showSprint} onClose={()=>setShowSprint(false)} title={editSprint?'Edit Sprint':'New Sprint'} size="md"
        footer={<><button className="btn btn-ghost" onClick={()=>setShowSprint(false)}>Cancel</button><button className="btn btn-primary" onClick={saveSprint}>Save</button></>}>
        <div style={{display:'grid',gap:12}}>
          <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={sprintForm.name||''} onChange={e=>setSprintForm(f=>({...f,name:e.target.value}))} required/></div>
          <div className="form-group"><label className="form-label">Goal</label><textarea className="form-textarea" rows={2} value={sprintForm.goal||''} onChange={e=>setSprintForm(f=>({...f,goal:e.target.value}))}/></div>
          <div className="form-row"><div className="form-group"><label className="form-label">Start</label><input className="form-input" type="date" value={sprintForm.start_date||''} onChange={e=>setSprintForm(f=>({...f,start_date:e.target.value}))}/></div><div className="form-group"><label className="form-label">End</label><input className="form-input" type="date" value={sprintForm.end_date||''} onChange={e=>setSprintForm(f=>({...f,end_date:e.target.value}))}/></div></div>
          <div className="form-row"><div className="form-group"><label className="form-label">Status</label><select className="form-select" value={sprintForm.status||'planning'} onChange={e=>setSprintForm(f=>({...f,status:e.target.value}))}>{['planning','active','completed'].map(s=><option key={s} value={s}>{s}</option>)}</select></div><div className="form-group"><label className="form-label">Project</label><select className="form-select" value={sprintForm.project_id||''} onChange={e=>setSprintForm(f=>({...f,project_id:e.target.value}))}><option value="">Select…</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div></div>
        </div>
      </Modal>

      <Modal open={showAssign} onClose={()=>setShowAssign(false)} title={`Manage Access — ${selProjData?.name||''}`} size="lg"
        footer={<><button className="btn btn-primary" onClick={()=>setShowAssign(false)}>Done</button></>}>
        <div style={{marginBottom:16}}>
          <div style={{fontWeight:600,fontSize:12,marginBottom:10,color:'var(--text-muted)'}}>CURRENT MEMBERS</div>
          {assignments.length===0?<div style={{fontSize:12,color:'var(--text-muted)',fontStyle:'italic',marginBottom:12}}>No members assigned yet</div>
            :assignments.map(a=>(
            <div key={a.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
              <Ava name={a.user?.full_name||'?'} size={28}/>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600}}>{a.user?.full_name}</div><div style={{fontSize:10,color:'var(--text-muted)',textTransform:'capitalize'}}>{a.user?.role}</div></div>
              <span style={{padding:'2px 8px',borderRadius:4,fontSize:10,background:'var(--c1-soft)',color:'var(--c1)',fontWeight:600}}>{a.role}</span>
              <button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} onClick={()=>removeAssignment(a.id)}><Trash2 size={11}/></button>
            </div>
          ))}
        </div>
        <div style={{padding:14,background:'var(--surface-2)',borderRadius:8,border:'1px solid var(--border)'}}>
          <div style={{fontWeight:600,fontSize:12,marginBottom:10}}>ADD MEMBER</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Employee</label><select className="form-select" value={newAssign.user_id} onChange={e=>setNewAssign(a=>({...a,user_id:e.target.value}))}><option value="">Select…</option>{users.filter(u=>!assignments.some(a=>a.user_id===u.id)).map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}</select></div>
            <div className="form-group"><label className="form-label">Role</label><select className="form-select" value={newAssign.role} onChange={e=>setNewAssign(a=>({...a,role:e.target.value}))}>{['member','lead','viewer'].map(r=><option key={r} value={r}>{r}</option>)}</select></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={addAssignment} disabled={!newAssign.user_id}><Plus size={12}/> Add</button>
        </div>
      </Modal>

      <Modal open={showPerms} onClose={()=>setShowPerms(false)} title="Task Role Permissions" size="xl"
        footer={<><button className="btn btn-ghost" onClick={()=>setShowPerms(false)}>Close</button></>}>
        <PermissionsPanel perms={perms} setPerms={setPerms} onSave={savePermissions} saved={permsSaved}/>
      </Modal>

      <Modal open={showImport} onClose={()=>setShowImport(false)} title="Import Tasks" size="xl">
        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">Project *</label>
          <select className="form-select" value={importProj} onChange={e=>setImportProj(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {importProj
          ? <ExcelImport type="tasks" projectId={importProj}
              lookups={{users, sprints:sprints.filter(s=>s.project_id===importProj), stories:stories.filter(s=>s.project_id===importProj)}}
              onSuccess={()=>{loadAll()}} onClose={()=>setShowImport(false)}/>
          : <div style={{padding:'20px 0',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>Choose a project above to start importing tasks into its Backlog.</div>}
      </Modal>

      <Confirm open={!!delTask} message="Delete this task?" danger onConfirm={async()=>{await supabase.from('project_tasks').delete().eq('id',delTask);setDelTask(null);loadAll()}} onCancel={()=>setDelTask(null)}/>
      <Confirm open={!!delStory} message="Delete this story? Tasks remain." danger onConfirm={async()=>{await supabase.from('user_stories').delete().eq('id',delStory);setDelStory(null);loadAll()}} onCancel={()=>setDelStory(null)}/>
    </div>
  )
}

function KanbanCard({task,users,canEdit,canDelete,canChangeStatus,onView,onEdit,onDelete,onStatus,commentCount=0}) {
  const [dragging,setDragging]=useState(false)
  const [hover,setHover]=useState(false)
  const assignee=users.find(u=>u.id===task.assigned_to),over=isOverdue(task)
  const pct=task.progress_pct
  return (
    <div draggable
      onDragStart={e=>{setDragging(true);e.dataTransfer.setData('task_id',task.id)}}
      onDragEnd={()=>setDragging(false)}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{background:'var(--surface)',border:`1px solid ${over?'rgba(225,29,72,.35)':'var(--border)'}`,borderTop:`3px solid ${SC[task.status]}`,borderRadius:12,padding:'12px 13px',cursor:'grab',opacity:dragging?.6:1,boxShadow:hover?'0 10px 22px rgba(0,0,0,.1)':'var(--shadow-sm)',transform:hover&&!dragging?'translateY(-2px)':'none',transition:'transform .16s, box-shadow .16s, opacity .16s'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:7}}>
        <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
          <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--c1)',fontWeight:700}}>{task.task_id||''}</span>
          <TypeBadge type={task.task_type||'task'}/>
        </div>
        <div style={{display:'flex',gap:2,flexShrink:0,opacity:hover?1:0,transition:'opacity .15s'}}>
          {onView&&<button style={{background:'none',border:'none',cursor:'pointer',padding:3,borderRadius:5,color:'var(--text-muted)'}} title="View details" onClick={onView}><Eye size={12}/></button>}
          {canEdit&&<button style={{background:'none',border:'none',cursor:'pointer',padding:3,borderRadius:5,color:'var(--text-muted)'}} onClick={onEdit}><Edit2 size={11}/></button>}
          {canDelete&&<button style={{background:'none',border:'none',cursor:'pointer',padding:3,borderRadius:5,color:'var(--rose)'}} onClick={onDelete}><Trash2 size={11}/></button>}
        </div>
      </div>
      <div style={{fontSize:12.5,fontWeight:700,marginBottom:8,lineHeight:1.4,cursor:onView?'pointer':'default',color:'var(--text)'}} onClick={onView}>{task.task_name}</div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:9}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:600,background:`${PC[task.priority]}12`,color:PC[task.priority]}}>{PI[task.priority]} {task.priority}</span>
        {task.module_name&&<span style={{padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:600,background:'var(--bg-3)',color:'var(--text-muted)'}}>{task.module_name}</span>}
        {over&&<span style={{padding:'2px 7px',borderRadius:5,fontSize:10,background:'rgba(225,29,72,.1)',color:'var(--rose)',fontWeight:700}}>⚠ OVERDUE</span>}
      </div>
      {pct!=null&&<div style={{marginBottom:9}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
          <span style={{fontSize:9,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em'}}>Progress</span>
          <span style={{fontSize:10.5,fontWeight:800,color:pct>=100?'var(--emerald)':'#6366f1',fontFamily:'var(--font-mono)'}}>{pct}% completed</span>
        </div>
        <ProgBar pct={pct} color={pct>=100?'var(--emerald)':'#6366f1'}/>
      </div>}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6,paddingTop:8,borderTop:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
          {assignee&&<Ava name={assignee.full_name} size={19}/>}
          {task.estimated_hours&&<span style={{display:'inline-flex',alignItems:'center',gap:2,fontSize:10,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}><Clock size={10}/>{task.estimated_hours}h</span>}
          {commentCount>0&&<span style={{display:'inline-flex',alignItems:'center',gap:2,fontSize:10,color:'var(--text-muted)'}} title={`${commentCount} update${commentCount===1?'':'s'}`}><MessageSquare size={10}/>{commentCount}</span>}
        </div>
        {task.planned_end_date&&<span style={{fontSize:10,fontWeight:over?700:500,padding:over?'2px 7px':0,borderRadius:5,background:over?'rgba(225,29,72,.1)':'transparent',color:over?'var(--rose)':'var(--text-muted)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>{dateFmt(task.planned_end_date)}</span>}
      </div>
      {canChangeStatus&&<div style={{marginTop:8,display:'flex',gap:3}}>
        {STATUSES.filter(s=>s!==task.status).slice(0,3).map(s=>(
          <button key={s} onClick={()=>onStatus(s)}
            style={{flex:1,padding:'4px 4px',border:`1px solid ${SC[s]}30`,borderRadius:6,background:`${SC[s]}08`,cursor:'pointer',fontSize:9,color:SC[s],fontFamily:'inherit',fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background=`${SC[s]}18`}
            onMouseLeave={e=>e.currentTarget.style.background=`${SC[s]}08`}>
            → {SL[s].split(' ')[0]}
          </button>
        ))}
      </div>}
    </div>
  )
}

/* ─── Stories Tree View ──────────────────────────────────── */
function StoriesTree({epics,stories,tasks,myPerm,onEditStory,onDeleteStory,onAddTask,onViewTask}) {
  const [collapsed,setCollapsed]=useState(()=>new Set())
  const toggle=id=>setCollapsed(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})

  const groups=useMemo(()=>{
    const map=new Map()
    epics.forEach(e=>map.set(e.id,{epic:e,stories:[]}))
    const noEpic=[]
    stories.forEach(s=>{
      if(s.epic_id&&map.has(s.epic_id)) map.get(s.epic_id).stories.push(s)
      else noEpic.push(s)
    })
    const list=[...map.values()]
    if(noEpic.length>0) list.push({epic:{id:'__none',name:'No Epic'},stories:noEpic})
    return list
  },[epics,stories])

  if(stories.length===0) return <Empty icon="📖" title="No user stories" desc="Create a story to group related tasks"/>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {groups.map(({epic,stories:epicStories})=>{
        if(epicStories.length===0&&epic.id!=='__none') return null
        const isNone=epic.id==='__none'
        const epicKey=`e-${epic.id}`
        const epicOpen=!collapsed.has(epicKey)
        const totalTasks=epicStories.reduce((a,s)=>a+tasks.filter(t=>t.user_story_id===s.id).length,0)
        const doneTasks=epicStories.reduce((a,s)=>a+tasks.filter(t=>t.user_story_id===s.id&&t.status==='closed').length,0)
        const epct=totalTasks>0?Math.round((doneTasks/totalTasks)*100):0
        return (
          <div key={epic.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',boxShadow:'var(--shadow-sm)'}}>
            <div onClick={()=>toggle(epicKey)}
              style={{display:'flex',alignItems:'center',gap:9,padding:'12px 16px',cursor:'pointer',background:isNone?'transparent':'linear-gradient(90deg,rgba(124,58,237,.08),transparent 60%)',borderBottom:epicOpen?'1px solid var(--border)':'none',flexWrap:'wrap'}}>
              {epicOpen?<ChevronDown size={14} style={{color:'var(--text-muted)',flexShrink:0}}/>:<ChevronRight size={14} style={{color:'var(--text-muted)',flexShrink:0}}/>}
              <span style={{fontSize:15,flexShrink:0}}>{isNone?'📁':'🗺️'}</span>
              <span style={{fontWeight:800,fontSize:13.5,flex:1,minWidth:120}}>{epic.name}</span>
              <span style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',background:'var(--bg-3)',padding:'2px 9px',borderRadius:20,flexShrink:0}}>{epicStories.length} {epicStories.length===1?'story':'stories'}</span>
              {totalTasks>0&&<div style={{width:110,display:'flex',alignItems:'center',gap:6,flexShrink:0}}><ProgBar pct={epct} color={epct===100?'var(--emerald)':'#7c3aed'}/><span style={{fontSize:10,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>{epct}%</span></div>}
            </div>
            {epicOpen&&(
              <div style={{padding:'6px 10px 10px'}}>
                {epicStories.length===0&&<div style={{fontSize:11,color:'var(--text-muted)',fontStyle:'italic',padding:'8px 14px'}}>No stories in this epic yet</div>}
                {epicStories.map(s=>{
                  const stTasks=tasks.filter(t=>t.user_story_id===s.id)
                  const done=stTasks.filter(t=>t.status==='closed').length
                  const spct=stTasks.length>0?Math.round((done/stTasks.length)*100):0
                  const storyKey=`s-${s.id}`
                  const storyOpen=!collapsed.has(storyKey)
                  return (
                    <div key={s.id} style={{marginLeft:20,borderLeft:'2px solid var(--border)',paddingLeft:14,marginTop:4}}>
                      <div onClick={()=>stTasks.length>0&&toggle(storyKey)}
                        style={{display:'flex',alignItems:'center',gap:8,padding:'9px 10px',borderRadius:8,cursor:stTasks.length>0?'pointer':'default',flexWrap:'wrap',transition:'background .12s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        {stTasks.length>0?(storyOpen?<ChevronDown size={12} style={{color:'var(--text-muted)',flexShrink:0}}/>:<ChevronRight size={12} style={{color:'var(--text-muted)',flexShrink:0}}/>):<span style={{width:12,flexShrink:0}}/>}
                        <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--c1)',fontWeight:700,flexShrink:0}}>{s.story_id||'—'}</span>
                        <TypeBadge type={s.story_type||'story'}/>
                        <span style={{fontWeight:700,fontSize:12.5,flex:1,minWidth:140}}>{s.title}</span>
                        <Pill label={s.priority} color={PC[s.priority]}/>
                        <Pill label={s.status.replace(/_/g,' ')} color={s.status==='done'?'#10b981':s.status==='in_progress'?'#f59e0b':'#64748b'}/>
                        {s.story_points>0&&<span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0}}>⬡ {s.story_points}pts</span>}
                        {stTasks.length>0&&<div style={{width:86,display:'flex',alignItems:'center',gap:6,flexShrink:0}}><ProgBar pct={spct} color={spct===100?'var(--emerald)':'var(--c1)'}/><span style={{fontSize:9,color:'var(--text-muted)'}}>{done}/{stTasks.length}</span></div>}
                        <div style={{display:'flex',gap:3,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                          {myPerm.can_create&&<button className="btn btn-ghost btn-sm btn-icon" title="Add task" onClick={()=>onAddTask(s)}><Plus size={11}/></button>}
                          {myPerm.can_edit&&<button className="btn btn-ghost btn-sm btn-icon" onClick={()=>onEditStory(s)}><Edit2 size={11}/></button>}
                          {myPerm.can_delete&&<button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} onClick={()=>onDeleteStory(s.id)}><Trash2 size={11}/></button>}
                        </div>
                      </div>
                      {storyOpen&&stTasks.length>0&&(
                        <div style={{marginLeft:18,borderLeft:'2px dashed var(--border)',paddingLeft:14,display:'flex',flexDirection:'column',gap:1,marginBottom:6,marginTop:2}}>
                          {stTasks.map(t=>{
                            const over=isOverdue(t)
                            return (
                              <div key={t.id} onClick={()=>onViewTask(t)}
                                style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',borderRadius:7,cursor:'pointer',fontSize:11.5,flexWrap:'wrap'}}
                                onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                <span style={{flexShrink:0}}>{TYPE_ICO[t.task_type||'task']}</span>
                                <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--c1)',fontWeight:700,flexShrink:0}}>{t.task_id}</span>
                                <span style={{flex:1,minWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.task_name}</span>
                                <Pill label={SL[t.status]} color={SC[t.status]}/>
                                {t.assignee&&<Ava name={t.assignee.full_name} size={17}/>}
                                {over&&<span style={{fontSize:9,fontWeight:700,color:'var(--rose)',flexShrink:0}}>⚠ OVERDUE</span>}
                                <span style={{fontSize:10,color:'var(--text-muted)',fontFamily:'var(--font-mono)',flexShrink:0}}>{t.estimated_hours||0}h est · {t.actual_hours||0}h act</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, rupee } from '../lib/supabase'
import { Modal, Loader, Empty, Confirm, SearchBox } from '../components/ui'
import { Plus, Edit2, Trash2, LayoutGrid, List, BarChart2,
  Filter, X, Target, Zap, UserPlus, Shield, Save, ChevronDown, Eye } from 'lucide-react'

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
const Kpi=({label,v,color='var(--c1)',sub})=><div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,borderTop:`2px solid ${color}`,padding:'10px 14px'}}><div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:20,color,lineHeight:1,marginBottom:3}}>{v}</div><div style={{fontSize:10,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>{sub&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{sub}</div>}</div>
const KpiGroup=({title,children})=><div><div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{title}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(105px,1fr))',gap:10}}>{children}</div></div>
const ProgBar=({pct,color='var(--c1)'})=><div style={{height:4,borderRadius:2,background:'var(--bg-3)',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,pct||0)}%`,background:color,borderRadius:2,transition:'width .3s'}}/></div>
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

/* ─── Task Detail (read-only view) ───────────────────────── */
function TaskDetail({task,projects,users,stories,sprints,changReqs}) {
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
        <Pill label={SL[task.status]} color={SC[task.status]}/>
        <Pill label={task.priority} color={PC[task.priority]}/>
        {over&&<span style={{padding:'2px 8px',borderRadius:4,fontSize:10,background:'rgba(225,29,72,.1)',color:'var(--rose)',fontWeight:700}}>⚠ OVERDUE</span>}
      </div>
      <div style={{fontSize:17,fontWeight:700,marginBottom:14,lineHeight:1.3}}>{task.task_name}</div>
      <Row label="Project">{proj?.name}</Row>
      <Row label="Module">{task.module_name}</Row>
      <Row label="Assignee">{assignee?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ava name={assignee.full_name} size={20}/>{assignee.full_name}</span>:null}</Row>
      <Row label="Priority">{PI[task.priority]} {task.priority}</Row>
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
  const [changReqs, setChangReqs] = useState([])
  const [loading,   setLoading]   = useState(true)

  const [selProj,   setSelProj]  = useState('')
  const [selSprint, setSelSprint]= useState('')
  const [selModule, setSelModule]= useState('')
  const [selAssign, setSelAssign]= useState('')
  const [selStatus, setSelStatus]= useState('')
  const [selPrio,   setSelPrio]  = useState('')
  const [selType,   setSelType]  = useState('')
  const [search,    setSearch]   = useState('')
  const [view,      setView]     = useState('kanban')

  const [showTask,   setShowTask]  = useState(false); const [editTask,  setEditTask]  = useState(null); const [taskForm,  setTaskForm]  = useState({}); const [subTask,  setSubTask]  = useState(false); const [delTask,  setDelTask]  = useState(null)
  const [detailTask, setDetailTask]= useState(null)
  const openDetail=t=>setDetailTask(t)
  const [showStory,  setShowStory] = useState(false); const [editStory, setEditStory] = useState(null); const [storyForm, setStoryForm] = useState({}); const [subStory, setSubStory] = useState(false); const [delStory, setDelStory] = useState(null)
  const [showSprint, setShowSprint]= useState(false); const [editSprint,setEditSprint]= useState(null); const [sprintForm,setSprintForm]= useState({})
  const [showAssign, setShowAssign]= useState(false); const [assignments,setAssignments]= useState([]); const [newAssign, setNewAssign] = useState({user_id:'',role:'member'})
  const [showPerms,  setShowPerms] = useState(false)

  useEffect(()=>{loadAll()},[profile?.id])

  async function loadAll() {
    setLoading(true)
    const [uR,pR,permR] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role').order('full_name'),
      isMgr ? supabase.from('projects').select('id,name,code,status').eq('status','active').order('name')
             : supabase.from('project_assignments').select('project:projects(id,name,code,status)').eq('user_id',profile.id),
      supabase.from('task_role_permissions').select('*').is('project_id',null),
    ])
    const us=uR.data||[]
    const ps=isMgr?(pR.data||[]):(pR.data||[]).map(r=>r.project).filter(Boolean)
    setUsers(us); setProjects(ps)
    if(permR.data?.length>0){const dp={};permR.data.forEach(p=>{dp[p.role]={can_view:p.can_view,can_create:p.can_create,can_edit:p.can_edit,can_delete:p.can_delete,can_change_status:p.can_change_status}});setPerms({...DEF_PERMS,...dp})}
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
      if(editTask)await supabase.from('project_tasks').update(p).eq('id',editTask.id)
      else await supabase.from('project_tasks').insert({...p,created_by:profile.id})
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

  async function dropOnColumn(e,st){e.preventDefault();const tid=e.dataTransfer.getData('task_id');if(!tid||!myPerm.can_change_status)return;await supabase.from('project_tasks').update({status:st}).eq('id',tid);setTasks(p=>p.map(t=>t.id===tid?{...t,status:st}:t))}
  async function changeStatus(id,st){if(!myPerm.can_change_status)return;await supabase.from('project_tasks').update({status:st}).eq('id',id);setTasks(p=>p.map(t=>t.id===id?{...t,status:st}:t))}

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
  const modules=useMemo(()=>[...new Set(tasks.filter(t=>t.module_name).map(t=>t.module_name))],[tasks])
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
          {myPerm.can_create&&<button className="btn btn-primary" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setEditTask(null);setTaskForm({project_id:selProj||projects[0]?.id,priority:'medium',status:'backlog',task_type:'task'});setShowTask(true)}}><Plus size={14}/> New Task</button>}
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(105px,1fr))',gap:10,marginBottom:16}}>
        <Kpi label="Total"       v={kpis.total}                    color="#3b82f6"/>
        <Kpi label="Backlog"     v={kpis.backlog}                  color="#64748b"/>
        <Kpi label="To Do"       v={kpis.todo}                     color="#3b82f6"/>
        <Kpi label="In Progress" v={kpis.inProgress}               color="#f59e0b"/>
        <Kpi label="Delayed"     v={kpis.delayed}                  color="#e11d48"/>
        <Kpi label="QA"          v={kpis.qa}                       color="#8b5cf6"/>
        <Kpi label="Demo"        v={kpis.demo}                     color="#10b981"/>
        <Kpi label="Closed"      v={kpis.closed}                   color="#94a3b8"/>
        <Kpi label="Overdue"     v={kpis.overdue}                  color="#e11d48"/>
        <Kpi label="CR Tasks"    v={kpis.crCount}                  color="#f59e0b"    sub="Change requests"/>
        <Kpi label="CR Hours"    v={`${kpis.crHrs}h`}             color="#f59e0b"    sub="On change reqs"/>
        <Kpi label="Bugs"        v={kpis.bugs}                     color="#e11d48"    sub="Bug tasks"/>
        <Kpi label="Est. Hours"  v={`${kpis.estHrs}h`}            color="#14b8a6"/>
        <Kpi label="Act. Hours"  v={`${kpis.actHrs}h`}            color="#06b6d4"/>
      </div>

      {/* View Tabs */}
      <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',marginBottom:16}}>
        {[{id:'kanban',icon:'⊞',l:'Kanban'},{id:'list',icon:'☰',l:'List'},{id:'stories',icon:'◎',l:`Stories (${projStories.length})`},{id:'sprints',icon:'⚡',l:`Sprints`},{id:'reports',icon:'📊',l:'Reports'}].map(t=>{
          const active=view===t.id
          return <button key={t.id} onClick={()=>setView(t.id)} style={{display:'flex',alignItems:'center',gap:5,padding:'9px 14px',border:'none',borderBottom:`2px solid ${active?'var(--c1)':'transparent'}`,cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:active?700:500,background:'transparent',color:active?'var(--c1)':'var(--text-muted)',marginBottom:-1,transition:'all .15s'}}>{t.icon} {t.l}</button>
        })}
      </div>

      <FilterBar/>

      {/* KANBAN */}
      {view==='kanban'&&(
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
                      <KanbanCard key={task.id} task={task} users={users}
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
      )}

      {/* LIST */}
      {view==='list'&&(
        <div className="table-wrap"><table>
          <thead><tr><th>ID</th><th>Type</th><th>Task Name</th><th>Module</th><th>Project</th><th>Assignee</th><th>Priority</th><th>Status</th><th>End Date</th><th>Est.</th><th>Act.</th>{(myPerm.can_edit||myPerm.can_delete)&&<th></th>}</tr></thead>
          <tbody>
            {projTasks.length===0?<tr><td colSpan={12} style={{padding:'30px',textAlign:'center',color:'var(--text-muted)'}}>No tasks found — try clearing filters</td></tr>
              :projTasks.map(t=>{const proj=projects.find(p=>p.id===t.project_id),over=isOverdue(t)
                return <tr key={t.id} style={{background:over?'rgba(225,29,72,.03)':'transparent'}}>
                  <td><span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--c1)',fontWeight:700}}>{t.task_id||'—'}</span></td>
                  <td><TypeBadge type={t.task_type||'task'}/></td>
                  <td><div style={{fontWeight:600,fontSize:13,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.task_name}</div>{over&&<div style={{fontSize:10,color:'var(--rose)'}}>⚠ Overdue</div>}</td>
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
                  {(myPerm.can_edit||myPerm.can_delete)&&<td><div style={{display:'flex',gap:4}}>
                    {myPerm.can_edit&&<button className="btn btn-ghost btn-sm btn-icon" onClick={()=>{setEditTask(t);setTaskForm({...t});setShowTask(true)}}><Edit2 size={11}/></button>}
                    {myPerm.can_delete&&<button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} onClick={()=>setDelTask(t.id)}><Trash2 size={11}/></button>}
                  </div></td>}
                </tr>
              })
            }
          </tbody>
        </table></div>
      )}

      {/* STORIES */}
      {view==='stories'&&(
        <div>
          {projStories.length===0?<Empty icon="📖" title="No user stories" desc="Create a story to group related tasks"/>
            :projStories.map(s=>{
              const stTasks=tasks.filter(t=>t.user_story_id===s.id)
              const done=stTasks.filter(t=>t.status==='closed').length
              const pct=stTasks.length>0?Math.round((done/stTasks.length)*100):0
              return (
                <div key={s.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,marginBottom:10,overflow:'hidden'}}>
                  <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--c1)',fontWeight:700,flexShrink:0}}>{s.story_id||'—'}</span>
                    <TypeBadge type={s.story_type||'story'}/>
                    <div style={{flex:1,minWidth:160}}>
                      <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{s.title}</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <Pill label={s.priority} color={PC[s.priority]}/><Pill label={s.status.replace(/_/g,' ')} color={s.status==='done'?'#10b981':s.status==='in_progress'?'#f59e0b':'#64748b'}/>
                        {s.story_points>0&&<span style={{fontSize:11,color:'var(--text-muted)'}}>⬡ {s.story_points}pts</span>}
                      </div>
                    </div>
                    <div style={{width:120}}><div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-muted)',marginBottom:3}}><span>{done}/{stTasks.length}</span><span>{pct}%</span></div><ProgBar pct={pct} color={pct===100?'var(--emerald)':'var(--c1)'}/></div>
                    <div style={{display:'flex',gap:6,flexShrink:0}}>
                      {myPerm.can_create&&<button className="btn btn-primary btn-sm" onClick={()=>{setEditTask(null);setTaskForm({project_id:s.project_id,user_story_id:s.id,priority:'medium',status:'backlog',task_type:'task'});setShowTask(true)}}><Plus size={11}/> Task</button>}
                      {myPerm.can_edit&&<button className="btn btn-ghost btn-sm btn-icon" onClick={()=>{setEditStory(s);setStoryForm({...s});setShowStory(true)}}><Edit2 size={11}/></button>}
                      {myPerm.can_delete&&<button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} onClick={()=>setDelStory(s.id)}><Trash2 size={11}/></button>}
                    </div>
                  </div>
                  {stTasks.length>0&&<div style={{borderTop:'1px solid var(--border)',padding:'8px 16px',display:'flex',gap:6,flexWrap:'wrap'}}>
                    {stTasks.slice(0,6).map(t=>(
                      <span key={t.id} style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 9px',borderRadius:5,fontSize:11,background:`${SC[t.status]}12`,color:SC[t.status],border:`1px solid ${SC[t.status]}25`,cursor:'pointer'}}
                        onClick={()=>{if(myPerm.can_edit){setEditTask(t);setTaskForm({...t});setShowTask(true)}}}>
                        {TYPE_ICO[t.task_type||'task']} {t.task_id} · {t.task_name.slice(0,18)}{t.task_name.length>18?'…':''}
                      </span>
                    ))}
                    {stTasks.length>6&&<span style={{fontSize:11,color:'var(--text-muted)'}}>+{stTasks.length-6} more</span>}
                  </div>}
                </div>
              )
            })
          }
        </div>
      )}

      {/* SPRINTS */}
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
      {view==='reports'&&(
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="card">
            <div className="card-header"><span className="card-title">📊 Project Progress</span></div>
            {projects.length===0?<div style={{padding:'20px',color:'var(--text-muted)',fontSize:12}}>No projects</div>
              :projects.map(p=>{const pt=tasks.filter(t=>t.project_id===p.id),done=pt.filter(t=>t.status==='closed').length,pct=pt.length>0?Math.round((done/pt.length)*100):0
                return <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{width:160,fontWeight:600,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
                  <span style={{width:80,fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)'}}>{done}/{pt.length}</span>
                  <div style={{flex:1}}><ProgBar pct={pct} color={pct===100?'var(--emerald)':pct>60?'var(--c1)':'var(--amber)'}/></div>
                  <span style={{width:36,fontFamily:'var(--font-mono)',fontWeight:700,fontSize:12,textAlign:'right'}}>{pct}%</span>
                </div>
              })
            }
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title">👥 Resource Utilization</span></div>
            {users.filter(u=>tasks.some(t=>t.assigned_to===u.id)).map(u=>{
              const ut=tasks.filter(t=>t.assigned_to===u.id),closed=ut.filter(t=>t.status==='closed').length,hrs=ut.reduce((s,t)=>s+(t.actual_hours||0),0)
              return <div key={u.id} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,width:160,flexShrink:0}}><Ava name={u.full_name} size={26}/><div><div style={{fontSize:12,fontWeight:600}}>{u.full_name}</div><div style={{fontSize:10,color:'var(--text-muted)',textTransform:'capitalize'}}>{u.role}</div></div></div>
                <div style={{display:'flex',gap:14,flex:1,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,color:'var(--text-muted)'}}>Total: <strong>{ut.length}</strong></span>
                  <span style={{fontSize:12,color:'var(--emerald)'}}>Done: <strong>{closed}</strong></span>
                  <span style={{fontSize:12,color:'var(--amber)'}}>CR: <strong>{ut.filter(t=>t.task_type==='change_request').length}</strong></span>
                  <span style={{fontSize:12,color:'var(--c1)'}}>Hours: <strong style={{fontFamily:'var(--font-mono)'}}>{hrs}h</strong></span>
                </div>
              </div>
            })}
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title">🔄 Change Request Summary</span></div>
            {projects.map(p=>{
              const crTasks=tasks.filter(t=>t.project_id===p.id&&t.task_type==='change_request')
              if(crTasks.length===0)return null
              const crHrs=crTasks.reduce((s,t)=>s+(t.actual_hours||0),0)
              return <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                <span style={{width:160,fontWeight:600,fontSize:12}}>{p.name}</span>
                <span style={{fontSize:12,color:'var(--amber)'}}>🔄 {crTasks.length} CR tasks</span>
                <span style={{fontSize:12,color:'var(--c1)',fontFamily:'var(--font-mono)'}}>{crHrs}h actual</span>
                <span style={{fontSize:12,color:'var(--text-muted)'}}>{crTasks.filter(t=>t.status==='closed').length} closed</span>
              </div>
            })}
          </div>
        </div>
      )}

      {/* MODALS */}
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

      <Confirm open={!!delTask} message="Delete this task?" danger onConfirm={async()=>{await supabase.from('project_tasks').delete().eq('id',delTask);setDelTask(null);loadAll()}} onCancel={()=>setDelTask(null)}/>
      <Confirm open={!!delStory} message="Delete this story? Tasks remain." danger onConfirm={async()=>{await supabase.from('user_stories').delete().eq('id',delStory);setDelStory(null);loadAll()}} onCancel={()=>setDelStory(null)}/>
    </div>
  )
}

function KanbanCard({task,users,canEdit,canDelete,canChangeStatus,onView,onEdit,onDelete,onStatus}) {
  const [dragging,setDragging]=useState(false)
  const assignee=users.find(u=>u.id===task.assigned_to),over=isOverdue(task)
  return (
    <div draggable
      onDragStart={e=>{setDragging(true);e.dataTransfer.setData('task_id',task.id)}}
      onDragEnd={()=>setDragging(false)}
      style={{background:'var(--surface)',border:`1px solid ${over?'rgba(225,29,72,.3)':'var(--border)'}`,borderRadius:8,padding:'10px 12px',cursor:'grab',opacity:dragging?.7:1,boxShadow:'var(--shadow-sm)',transition:'all .15s',borderLeft:`3px solid ${SC[task.status]}`}}
      onMouseEnter={e=>e.currentTarget.style.boxShadow='var(--shadow)'}
      onMouseLeave={e=>e.currentTarget.style.boxShadow='var(--shadow-sm)'}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--c1)',fontWeight:700}}>{task.task_id||''}</span>
          <TypeBadge type={task.task_type||'task'}/>
        </div>
        <div style={{display:'flex',gap:3}}>
          {onView&&<button style={{background:'none',border:'none',cursor:'pointer',padding:2,opacity:.5,color:'var(--text)'}} title="View details" onClick={onView}><Eye size={11}/></button>}
          {canEdit&&<button style={{background:'none',border:'none',cursor:'pointer',padding:2,opacity:.5,color:'var(--text)'}} onClick={onEdit}><Edit2 size={10}/></button>}
          {canDelete&&<button style={{background:'none',border:'none',cursor:'pointer',padding:2,opacity:.5,color:'var(--rose)'}} onClick={onDelete}><Trash2 size={10}/></button>}
        </div>
      </div>
      <div style={{fontSize:12,fontWeight:600,marginBottom:6,lineHeight:1.4,cursor:onView?'pointer':'default'}} onClick={onView}>{task.task_name}</div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:7}}>
        <span style={{fontSize:10}}>{PI[task.priority]} {task.priority}</span>
        {task.module_name&&<span style={{padding:'1px 6px',borderRadius:3,fontSize:10,background:'var(--bg-3)',color:'var(--text-muted)'}}>{task.module_name}</span>}
        {over&&<span style={{padding:'1px 6px',borderRadius:3,fontSize:10,background:'rgba(225,29,72,.1)',color:'var(--rose)',fontWeight:700}}>OVERDUE</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          {assignee&&<Ava name={assignee.full_name} size={18}/>}
          {task.estimated_hours&&<span style={{fontSize:10,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>{task.estimated_hours}h</span>}
        </div>
        {task.planned_end_date&&<span style={{fontSize:10,color:over?'var(--rose)':'var(--text-muted)',fontFamily:'var(--font-mono)'}}>{dateFmt(task.planned_end_date)}</span>}
      </div>
      {canChangeStatus&&<div style={{marginTop:7,display:'flex',gap:3}}>
        {STATUSES.filter(s=>s!==task.status).slice(0,3).map(s=>(
          <button key={s} onClick={()=>onStatus(s)}
            style={{flex:1,padding:'3px 4px',border:`1px solid ${SC[s]}30`,borderRadius:4,background:`${SC[s]}08`,cursor:'pointer',fontSize:9,color:SC[s],fontFamily:'inherit',fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
            onMouseEnter={e=>e.currentTarget.style.background=`${SC[s]}18`}
            onMouseLeave={e=>e.currentTarget.style.background=`${SC[s]}08`}>
            → {SL[s].split(' ')[0]}
          </button>
        ))}
      </div>}
    </div>
  )
}

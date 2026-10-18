import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, timeFmt, rupee } from '../lib/supabase'
import { sendNotif, notifyManagers } from '../lib/notifications'
import { Modal, Loader, Empty, Confirm, SearchBox } from '../components/ui'
import RichTextEditor, { RichTextView } from '../components/ui/RichTextEditor'
import { uploadTaskImage } from '../lib/taskAttachments'
import { diffTaskFields, logTaskChanges, listTaskHistory } from '../lib/taskHistory'
import { listFlows } from '../lib/departmentStatusFlows'
import { saveChecklistValues, uploadTaskEvidence } from '../lib/workExecution'
import { CHECKLIST_TYPES, createTaskTemplate } from '../lib/taskTemplates'
import { TASK_FIELD_CATALOG, listTaskFieldRules, fieldRulesToMap } from '../lib/taskFieldRules'
import { getTaskDetailViewStyle } from '../lib/taskViewSettings'
import { exportTaskReportExcel } from '../lib/taskReportExport'
import ExcelImport from '../components/ui/ExcelImport'
import CustomDashboardsPanel from '../components/CustomDashboardsPanel'
import AIDockedPanel from '../components/AIDockedPanel'
import { TaskActionsTab } from '../components/AIActionTabs'
import { DevicePicker, DeviceLink } from '../components/devices/DeviceParts'
import { Plus, Edit2, Trash2, LayoutGrid, List, BarChart2,
  Filter, X, Target, Zap, UserPlus, Shield, Save, ChevronDown, ChevronRight, Eye, Clock, TrendingUp, AlertTriangle, CheckCircle2, Upload, MessageSquare, Send, Sparkles, Map as MapIcon,
  Play, Calendar, Layers, FolderKanban, History, Bug, RefreshCw, BookOpen, Radio, ClipboardList, Share2, Copy, GitBranch, Download, Users, Rows3, Search } from 'lucide-react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

/* ─── Constants ─────────────────────────────────────────── */
const STATUSES=['backlog','todo','in_progress','delayed','qa','ready_for_demo','closed']
const SL={backlog:'Backlog',todo:'To Do',in_progress:'In Progress',delayed:'Delayed',qa:'QA Testing',ready_for_demo:'Ready for Demo',closed:'Closed'}
const SC={backlog:'#64748b',todo:'#3b82f6',in_progress:'#f59e0b',delayed:'#e11d48',qa:'#8b5cf6',ready_for_demo:'#10b981',closed:'#94a3b8'}
const PC={critical:'#e11d48',high:'#f59e0b',medium:'#3b82f6',low:'#10b981'}
const PI={critical:'🔴',high:'🟠',medium:'🔵',low:'🟢'}
const PRIOS=['critical','high','medium','low']
const TASK_TYPES=['task','bug','change_request','feature','improvement','iot_hardware','general']
// Task Management view switcher (?view= query param) — was previously
// only reachable by typing the URL by hand; nothing in the UI actually
// linked to Stories/Sprints/Reports.
const VIEW_TABS=[
  {key:'kanban',label:'Board',icon:LayoutGrid},
  {key:'list',label:'List',icon:List},
  {key:'stories',label:'Stories',icon:Target},
  {key:'sprints',label:'Sprints',icon:Zap},
  {key:'reports',label:'Reports',icon:BarChart2},
]
// Board tab layouts — picked per viewer (TasksPage boardLayout state).
const BOARD_LAYOUTS=[
  {key:'sections',label:'Sections',icon:Rows3,hint:'Collapsible status sections, one line per task'},
  {key:'kanban',label:'Kanban',icon:LayoutGrid,hint:'Classic columns with cards'},
  {key:'people',label:'People',icon:Users,hint:'Each person’s tasks by status — spot overload and idle people'},
  {key:'planner',label:'Week planner',icon:Calendar,hint:'Tasks on a calendar per person — empty days show gaps in the plan'},
]
const STORY_TYPES=['story','epic','bug','change_request','feature']
const TYPE_ICO={task:'📋',bug:'🐛',change_request:'🔄',feature:'✨',improvement:'⚡',story:'📖',epic:'🗺',iot_hardware:'📡',general:'🧩'}
const TYPE_CLR={task:'#3b82f6',bug:'#e11d48',change_request:'#f59e0b',feature:'#10b981',improvement:'#8b5cf6',story:'#3b82f6',epic:'#7c3aed',iot_hardware:'#06b6d4',general:'#64748b'}

// Kanban board column configuration — which task field a given grouping
// controls (drag-drop between columns writes to this field), and a
// deterministic fallback color for groupings with no fixed palette
// (assignee/department/module/sprint have as many distinct values as
// there are people/departments/etc., unlike the fixed STATUSES/PRIOS lists).
const KANBAN_GROUP_FIELD={status:'status',assignee:'assigned_to',department:'department_id',module:'module_name',priority:'priority',sprint:'sprint_id'}
const KANBAN_PALETTE=['#6366f1','#0ea5e9','#14b8a6','#f59e0b','#ec4899','#8b5cf6','#84cc16','#f43f5e','#06b6d4','#a855f7']
function colorForKanbanKey(key){
  let h=0; const s=String(key||'')
  for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0
  return KANBAN_PALETTE[h%KANBAN_PALETTE.length]
}
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
// 'lead' shown here as "Tech Lead" (its real label in the `roles` table,
// STEP195) rather than the raw role_key the row.replace(/_/g,' ') fallback
// below would otherwise print.
const ROLE_DISPLAY={lead:'Tech Lead'}

/* ─── Helpers ────────────────────────────────────────────── */
const Pill=({label,color,bg})=><span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:bg||`${color}18`,color,border:`1px solid ${color}28`,textTransform:'capitalize',whiteSpace:'nowrap'}}>{label?.replace(/_/g,' ')}</span>
const Ava=({name='?',size=24})=>{const i=(name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();return<div title={name} style={{width:size,height:size,borderRadius:Math.round(size*.3),background:'linear-gradient(135deg,var(--c1),#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:Math.round(size*.38),fontWeight:700,flexShrink:0}}>{i}</div>}
const Kpi=({label,v,color='var(--c1)',sub})=><div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,borderTop:`2px solid ${color}`,padding:'10px 14px',minWidth:0,overflow:'hidden'}}><div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:'clamp(16px,3vw,22px)',color,lineHeight:1.2,marginBottom:3,overflowWrap:'break-word',wordBreak:'break-word'}}>{v}</div><div style={{fontSize:10,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>{sub&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{sub}</div>}</div>
const KpiGroup=({title,children})=><div><div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{title}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(105px,1fr))',gap:10}}>{children}</div></div>
const StatusKpiCard=({status,label,tasks,color,onAdd,canAdd})=>{
  const est=tasks.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0)
  const act=tasks.reduce((s,t)=>s+(Number(t.actual_hours)||0),0)
  const [hover,setHover]=useState(false)
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,borderTop:`3px solid ${color}`,padding:'14px 16px',display:'flex',flexDirection:'column',gap:9,transition:'transform .18s, box-shadow .18s',transform:hover?'translateY(-2px)':'none',boxShadow:hover?'var(--shadow)':'var(--shadow-sm)',minWidth:0,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:10.5,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.05em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label??SL[status]}</span>
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

/* ─── Segmented status-distribution bar (Linear/Jira-style sprint burnup strip) ─── */
const SegmentedBar=({segments,total})=>{
  if(!total)return<div style={{height:6,borderRadius:3,background:'var(--bg-3)'}}/>
  return(
    <div style={{display:'flex',height:6,borderRadius:3,overflow:'hidden',background:'var(--bg-3)'}}>
      {segments.filter(s=>s.value>0).map(s=>(
        <div key={s.key} title={`${s.label}: ${s.value}`} style={{width:`${(s.value/total)*100}%`,background:s.color,transition:'width .3s'}}/>
      ))}
    </div>
  )
}

/* ─── Sprint Card (enterprise list view) ─── */
const SPRINT_STATUS_COLOR={planning:'#64748b',active:'#f59e0b',completed:'#10b981'}
function SprintCard({sprint:s,tasks:spTasks,stories:spSt,projectName,isMgr,onStart,onComplete,onEdit,stepsForDept}){
  const [hover,setHover]=useState(false)
  const sclr=SPRINT_STATUS_COLOR[s.status]||'#64748b'
  const pts=spSt.reduce((a,b)=>a+(b.story_points||0),0)
  const dv=spSt.reduce((a,b)=>a+(b.status==='done'?(b.story_points||0):0),0)
  // Per-task department flow, not a hardcoded 'closed' check — see
  // isTaskDone()'s comment in the parent component for why.
  const isDone=t=>!!stepsForDept(t.department_id).find(x=>x.status_key===t.status)?.is_closed
  const donePct=spTasks.length>0?Math.round((spTasks.filter(isDone).length/spTasks.length)*100):0
  const velPct=pts>0?Math.round((dv/pts)*100):0
  const today=new Date(); today.setHours(0,0,0,0)
  const daysLeft=s.end_date?Math.ceil((new Date(s.end_date)-today)/86400000):null
  const overdue=s.status==='active'&&daysLeft!=null&&daysLeft<0

  return(
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,borderTop:`3px solid ${sclr}`,
        padding:'18px 20px',marginBottom:14,transition:'transform .18s, box-shadow .18s',
        transform:hover?'translateY(-2px)':'none',boxShadow:hover?'var(--shadow)':'var(--shadow-sm)'}}>

      {/* Header row */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:14,flexWrap:'wrap',marginBottom:s.goal?8:12}}>
        <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap',minWidth:0}}>
          <Zap size={15} style={{color:sclr,flexShrink:0}}/>
          <span style={{fontWeight:800,fontSize:16,letterSpacing:'-.01em'}}>{s.name}</span>
          <Pill label={s.status} color={sclr}/>
          {projectName&&<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,color:'var(--text-muted)',background:'var(--bg-3)',padding:'2px 9px',borderRadius:20}}>
            <FolderKanban size={10}/> {projectName}</span>}
          {overdue&&<span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 9px',borderRadius:20,fontSize:10,fontWeight:700,background:'rgba(225,29,72,.1)',color:'var(--rose)'}}>
            <AlertTriangle size={10}/> {Math.abs(daysLeft)}d overdue</span>}
          {!overdue&&s.status==='active'&&daysLeft!=null&&daysLeft>=0&&<span style={{fontSize:10.5,fontWeight:700,color:'var(--text-muted)'}}>{daysLeft===0?'Ends today':`${daysLeft}d left`}</span>}
        </div>
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          {isMgr&&s.status==='planning'&&<button className="btn btn-primary btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={onStart}><Play size={12}/> Start</button>}
          {isMgr&&s.status==='active'&&<button className="btn btn-outline btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={onComplete}><CheckCircle2 size={12}/> Complete</button>}
          {isMgr&&<button className="btn btn-ghost btn-sm btn-icon" onClick={onEdit}><Edit2 size={12}/></button>}
        </div>
      </div>
      {s.goal&&<div style={{fontSize:12.5,color:'var(--text-muted)',marginBottom:12,lineHeight:1.4}}>{s.goal}</div>}

      {/* Meta row */}
      <div style={{display:'flex',gap:18,flexWrap:'wrap',fontSize:11.5,color:'var(--text-muted)',marginBottom:14}}>
        {(s.start_date||s.end_date)&&<span style={{display:'flex',alignItems:'center',gap:5}}>
          <Calendar size={12}/> {s.start_date?dateFmt(s.start_date):'—'} → {s.end_date?dateFmt(s.end_date):'—'}</span>}
        <span style={{display:'flex',alignItems:'center',gap:5}}><Target size={12}/> {spTasks.length} task{spTasks.length!==1?'s':''}</span>
        <span style={{display:'flex',alignItems:'center',gap:5}}><Layers size={12}/> {pts} pts{pts>0?` · ${dv} done`:''}</span>
      </div>

      {/* Progress */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16,marginBottom:spTasks.length>0?12:0}}>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10.5,fontWeight:700,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.04em'}}>
            <span>Task Completion</span><span style={{color:sclr,fontFamily:'var(--font-mono)'}}>{donePct}%</span></div>
          <ProgBar pct={donePct} color={sclr}/>
        </div>
        {pts>0&&<div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10.5,fontWeight:700,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.04em'}}>
            <span>Velocity</span><span style={{color:'#8b5cf6',fontFamily:'var(--font-mono)'}}>{dv}/{pts}pts</span></div>
          <ProgBar pct={velPct} color="#8b5cf6"/>
        </div>}
      </div>

      {/* Status distribution */}
      {spTasks.length>0&&(()=>{
        // Union of every distinct status actually in use among this
        // sprint's tasks, each labeled/colored via ITS OWN department's
        // flow — a hardcoded 7-status list mislabeled (or dropped
        // entirely) any status from a custom flow.
        const seen=new Map()
        spTasks.forEach(t=>{
          if(seen.has(t.status))return
          const step=stepsForDept(t.department_id).find(x=>x.status_key===t.status)
          seen.set(t.status,{label:step?.label||t.status,color:step?.color||'#94a3b8'})
        })
        const segs=[...seen.entries()].map(([key,v])=>({key,label:v.label,color:v.color,value:spTasks.filter(t=>t.status===key).length}))
        return<div>
          <SegmentedBar segments={segs} total={spTasks.length}/>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
            {segs.filter(x=>x.value>0).map(x=><span key={x.key} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:`${x.color}12`,color:x.color,border:`1px solid ${x.color}25`}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:x.color}}/>{x.label}: {x.value}</span>)}
          </div>
        </div>
      })()}
    </div>
  )
}

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
// `steps` (a department's flow, STEP198) is optional — when given, "done"
// is whichever step(s) that flow marks is_closed, not a hardcoded key;
// falls back to the pre-STEP198 literal 'closed' when steps aren't known
// at a given call site.
const isOverdue=(t,steps)=>{
  if(!t.planned_end_date)return false
  // Whole-day comparison, not exact-time — a task due TODAY must not read
  // as overdue just because it's already past midnight; it only becomes
  // overdue once the due date has actually been crossed (tomorrow).
  const today=new Date(); today.setHours(0,0,0,0)
  const due=new Date(t.planned_end_date); due.setHours(0,0,0,0)
  if(due>=today)return false
  if(steps){ const st=steps.find(s=>s.status_key===t.status); if(st)return !st.is_closed }
  return t.status!=='closed'
}
const todayStr=()=>new Date().toISOString().slice(0,10)
// Auto-stamp actual_start_date the first time a task's status ever changes, and
// actual_end_date the first time it reaches its flow's "Done" step — never
// overwrites a value that's already there (whether auto-set earlier or
// entered manually).
const autoActualDates=(task,newStatus,isClosedStatus)=>{
  const patch={}
  if(newStatus!==task.status&&!task.actual_start_date) patch.actual_start_date=todayStr()
  if(isClosedStatus&&!task.actual_end_date) patch.actual_end_date=todayStr()
  return patch
}
// Icon components for the enterprise Kanban redesign — the emoji in
// TYPE_ICO/PI still back <select> option text (native <option> can't
// render a React icon), but every actual rendered badge/card uses these
// instead, matching this app's flat, single-accent, no-emoji direction.
const TYPE_ICON={task:ClipboardList,bug:Bug,change_request:RefreshCw,feature:Sparkles,improvement:TrendingUp,story:BookOpen,epic:MapIcon,iot_hardware:Radio,general:Layers}
const TypeBadge=({type})=>{
  const c=TYPE_CLR[type]||'#3b82f6', Icon=TYPE_ICON[type]||ClipboardList
  return <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:5,fontSize:10,fontWeight:700,background:`${c}12`,color:c,border:`1px solid ${c}22`,whiteSpace:'nowrap'}}>
    <Icon size={10}/> {type?.replace(/_/g,' ')}
  </span>
}
// Enterprise priority pill — a colored dot + label (Linear/Jira
// convention), no emoji.
const PriorityBadge=({priority})=>{
  const c=PC[priority]||'#94a3b8'
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10.5,fontWeight:600,color:'var(--text-muted)',textTransform:'capitalize'}}>
    <span style={{width:7,height:7,borderRadius:'50%',background:c,flexShrink:0}}/>{priority}
  </span>
}

/* ─── Task Form ──────────────────────────────────────────── */
function TaskForm({form,setForm,projects,users,departments,stories,sprints,changReqs,workItems,tasks,projectId,isMgr,role,orgId,stepsForDept}) {
  const canEditActualDates=role!=='employee'
  // Status options follow the task's own department's flow (STEP198) —
  // changing Department resets Status to that flow's first step whenever
  // the current value doesn't exist in it (e.g. switching Application ->
  // Firmware when the task is on "Code Review", which both happen to
  // share, keeps it; switching to a flow without a matching key resets).
  const deptSteps=stepsForDept(form.department_id)
  function onDeptChange(deptId){
    const nextSteps=stepsForDept(deptId)
    const stillValid=nextSteps.some(s=>s.status_key===form.status)
    setForm(f=>({...f,department_id:deptId||null,status:stillValid?f.status:(nextSteps[0]?.status_key||f.status)}))
  }
  // Auto-fetch Department from whichever resource gets assigned — the
  // task's department should reflect the assignee's own team, not be
  // picked separately by hand. Clearing the assignee leaves Department
  // as-is (nothing to infer from "no one"); picking someone always
  // mirrors THEIR department, including back to Unassigned if that
  // person has none set.
  function onAssigneeChange(userId){
    setForm(f=>{
      if(!userId) return {...f,assigned_to:null}
      const u=users.find(x=>x.id===userId)
      const nextDept=u?.department_id||null
      const nextSteps=stepsForDept(nextDept)
      const stillValid=nextSteps.some(s=>s.status_key===f.status)
      return {...f,assigned_to:userId,department_id:nextDept,status:stillValid?f.status:(nextSteps[0]?.status_key||f.status)}
    })
  }
  return (
    <div style={{display:'grid',gap:12}}>
      {/* Quick-glance detail strip, JIRA-style — only meaningful once a
          task actually exists (task_id/created_at aren't set until save). */}
      {form.task_id&&<div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'8px 2px',borderBottom:'1px solid var(--border)',marginBottom:2}}>
        <span style={{fontFamily:'var(--font-mono)',fontSize:12,color:'var(--c1)',fontWeight:700}}>{form.task_id}</span>
        <TypeBadge type={form.task_type||'task'}/>
        <Pill label={form.priority} color={PC[form.priority]}/>
        <Pill label={deptSteps.find(s=>s.status_key===form.status)?.label||form.status} color={deptSteps.find(s=>s.status_key===form.status)?.color||'#94a3b8'}/>
        {form.created_at&&<span style={{fontSize:11,color:'var(--text-muted)',marginLeft:'auto'}}>Created {dateFmt(form.created_at)}</span>}
      </div>}
      {/* Project is optional (Industry-Adaptive Platform Phase 4) — the
          blank option IS "no project", not an unset placeholder. Never
          silently defaulted to some other project on save; see saveTask(). */}
      {!projectId&&<div className="form-group"><label className="form-label">Project</label>
        <select className="form-select" value={form.project_id||''} onChange={e=>setForm(f=>({...f,project_id:e.target.value,user_story_id:'',sprint_id:''}))}>
          <option value="">No Project (Direct Task)</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>}
      {workItems?.length>0&&<div className="form-group"><label className="form-label">Work Item</label>
        <select className="form-select" value={form.work_item_id||''} onChange={e=>setForm(f=>({...f,work_item_id:e.target.value||null}))}>
          <option value="">None</option>{workItems.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}
        </select></div>}
      {tasks?.length>0&&(()=>{
        // Only one level of nesting allowed — a subtask can't itself have
        // subtasks. So: (a) a task that's already a subtask (has its own
        // parent_task_id) can never be offered as someone else's parent,
        // and (b) a task that already HAS subtasks of its own can't be
        // turned into a subtask of something else either — both would
        // otherwise create a 2+ level chain.
        const hasOwnChildren=form.id&&tasks.some(t=>t.parent_task_id===form.id)
        if(hasOwnChildren) return (
          <div className="form-group"><label className="form-label">Parent Task</label>
            <div style={{fontSize:12,color:'var(--text-muted)',padding:'9px 12px',background:'var(--bg-3)',borderRadius:'var(--radius-sm)'}}>This task already has subtasks, so it can't become a subtask of another task.</div>
          </div>
        )
        const candidates=tasks.filter(t=>t.id!==form.id&&!t.parent_task_id&&(!form.project_id||t.project_id===form.project_id))
        return (
          <div className="form-group"><label className="form-label">Parent Task</label>
            <select className="form-select" value={form.parent_task_id||''} onChange={e=>setForm(f=>({...f,parent_task_id:e.target.value||null}))}>
              <option value="">None (top-level task)</option>
              {candidates.map(t=><option key={t.id} value={t.id}>{t.task_id?`[${t.task_id}] `:''}{t.task_name}</option>)}
            </select>
            <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Makes this a child task (subtask) of the selected task — only one level of nesting is allowed, so subtasks aren't listed here</div>
          </div>
        )
      })()}
      <div className="form-group"><label className="form-label">Device</label>
        <DevicePicker value={form.device_id||null} onChange={id=>setForm(f=>({...f,device_id:id}))}/>
        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Link the device this work is on — the task then shows, with its status, in that device's history</div>
      </div>
      {/* Full-width summary line, JIRA-style — a task name is the single
          most-read field here and was getting squeezed into a half-width
          column next to Type, cutting off longer names while editing. */}
      <div className="form-group"><label className="form-label">Task Name *</label>
        <input className="form-input" value={form.task_name||''} onChange={e=>setForm(f=>({...f,task_name:e.target.value}))}
          placeholder="e.g. Build login API" required style={{fontSize:15,fontWeight:600,padding:'10px 12px'}}/></div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Type</label>
          <select className="form-select" value={form.task_type||'task'} onChange={e=>setForm(f=>({...f,task_type:e.target.value}))}>
            {TASK_TYPES.map(t=><option key={t} value={t}>{TYPE_ICO[t]} {t.replace(/_/g,' ')}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Module</label>
          <input className="form-input" value={form.module_name||''} onChange={e=>setForm(f=>({...f,module_name:e.target.value}))} placeholder="e.g. Auth"/></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Priority</label>
          <select className="form-select" value={form.priority||'medium'} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
            {PRIOS.map(p=><option key={p} value={p}>{PI[p]} {p}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Assigned To</label>
          <select className="form-select" value={form.assigned_to||''} onChange={e=>onAssigneeChange(e.target.value)}>
            <option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
          </select>
          <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Department below auto-fills from whoever you assign here</div></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Status</label>
          <select className="form-select" value={form.status||deptSteps[0]?.status_key||'backlog'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
            {deptSteps.map(s=><option key={s.status_key} value={s.status_key}>{s.label}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Department</label>
          <select className="form-select" value={form.department_id||''} onChange={e=>onDeptChange(e.target.value)}>
            <option value="">Unassigned</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Status options above follow this department's configured flow (Settings → Task Status Flows)</div></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Planned Start</label>
          <input className="form-input" type="date" value={form.planned_start_date||''} onChange={e=>setForm(f=>({...f,planned_start_date:e.target.value}))}/></div>
        <div className="form-group"><label className="form-label">Planned End</label>
          <input className="form-input" type="date" value={form.planned_end_date||''} onChange={e=>setForm(f=>({...f,planned_end_date:e.target.value}))}/></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Actual Start</label>
          <input className="form-input" type="date" value={form.actual_start_date||''} disabled={!canEditActualDates}
            onChange={e=>setForm(f=>({...f,actual_start_date:e.target.value}))}/>
          <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Auto-set the day status first changes{!canEditActualDates?' — only managers can edit manually':''}</div></div>
        <div className="form-group"><label className="form-label">Actual End</label>
          <input className="form-input" type="date" value={form.actual_end_date||''} disabled={!canEditActualDates}
            onChange={e=>setForm(f=>({...f,actual_end_date:e.target.value}))}/>
          <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Auto-set when status becomes Closed{!canEditActualDates?' — only managers can edit manually':''}</div></div>
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
        <RichTextEditor value={form.description||''} onChange={html=>setForm(f=>({...f,description:html}))}
          onUploadImage={file=>uploadTaskImage(form.id,file,orgId)} placeholder="Task details, acceptance criteria…" minHeight={110}/></div>
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
                <td style={{padding:'9px 14px',fontWeight:600,textTransform:'capitalize'}}>{ROLE_DISPLAY[role]||role.replace(/_/g,' ')}</td>
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
function TaskDetail({task,projects,users,stories,sprints,changReqs,departments,canChangeStatus,onStatusChange,profile,onProgressUpdate,onCommentPosted,onChecklistUpdate,canEditChecklist,stepsForDept,tasks,onAddSubtask,onOpenTask}) {
  if(!task) return null
  const proj=projects.find(p=>p.id===task.project_id)
  const assignee=users.find(u=>u.id===task.assigned_to)
  const story=stories.find(s=>s.id===task.user_story_id)
  const sprint=sprints.find(s=>s.id===task.sprint_id)
  const cr=changReqs.find(c=>c.id===task.change_request_id)
  const mySteps=stepsForDept(task.department_id)
  const curStep=mySteps.find(s=>s.status_key===task.status)
  const over=isOverdue(task,mySteps)
  const parentTask=tasks?.find(t=>t.id===task.parent_task_id)
  const childTasks=tasks?.filter(t=>t.parent_task_id===task.id)||[]
  const childDone=t=>!!stepsForDept(t.department_id).find(s=>s.status_key===t.status)?.is_closed
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
          ? <select style={{background:`${curStep?.color||'#94a3b8'}12`,color:curStep?.color||'#94a3b8',border:`1px solid ${curStep?.color||'#94a3b8'}30`,borderRadius:5,padding:'4px 10px',fontSize:12,fontWeight:700,cursor:'pointer',outline:'none',fontFamily:'inherit'}}
              value={task.status} onChange={e=>onStatusChange&&onStatusChange(e.target.value)}>
              {!curStep&&task.status&&<option value={task.status}>{task.status} (not in current flow)</option>}
              {mySteps.map(s=><option key={s.status_key} value={s.status_key}>{s.label}</option>)}
            </select>
          : <Pill label={curStep?.label||task.status} color={curStep?.color||'#94a3b8'}/>}
      </Row>
      <Row label="Time Tracking"><TaskCheckInOut task={task} profile={profile}/></Row>
      <Row label="Project">{proj?.name}</Row>
      {parentTask&&<Row label="Parent Task"><button type="button" className="btn btn-ghost btn-sm" style={{padding:'2px 8px',fontSize:12}} onClick={()=>onOpenTask&&onOpenTask(parentTask)}><GitBranch size={11}/> {parentTask.task_id||parentTask.task_name}</button></Row>}
      {task.device_id&&<Row label="Device"><DeviceLink id={task.device_id}/></Row>}
      <Row label="Module">{task.module_name}</Row>
      <Row label="Assignee">{assignee?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ava name={assignee.full_name} size={20}/>{assignee.full_name}</span>:null}</Row>
      <Row label="Priority"><PriorityBadge priority={task.priority}/></Row>
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
      <Row label="Description"><RichTextView html={task.description}/></Row>
      {tasks&&<div style={{marginTop:6,marginBottom:6}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em'}}>
            Subtasks{childTasks.length>0&&` (${childTasks.filter(childDone).length}/${childTasks.length})`}
          </div>
          {/* Only one level of nesting allowed — a subtask (task.parent_task_id
              already set) can't have subtasks of its own. */}
          {onAddSubtask&&!task.parent_task_id&&<button type="button" className="btn btn-ghost btn-sm" onClick={()=>onAddSubtask(task)}><Plus size={12}/> Add Subtask</button>}
        </div>
        {childTasks.length===0
          ? <div style={{fontSize:12,color:'var(--text-muted)',fontStyle:'italic'}}>No subtasks yet</div>
          : childTasks.map(ct=>{
              const cStep=stepsForDept(ct.department_id).find(s=>s.status_key===ct.status)
              return (
                <div key={ct.id} onClick={()=>onOpenTask&&onOpenTask(ct)}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)',marginBottom:5,cursor:onOpenTask?'pointer':'default'}}>
                  <span style={{fontFamily:'var(--font-mono)',fontSize:10.5,color:'var(--text-muted)',flexShrink:0}}>{ct.task_id}</span>
                  <span style={{flex:1,fontSize:12.5,fontWeight:500,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ct.task_name}</span>
                  <Pill label={cStep?.label||ct.status} color={cStep?.color||'#94a3b8'}/>
                </div>
              )
            })}
      </div>}
      <TaskChecklist task={task} canEdit={canEditChecklist} onUpdate={checklist=>onChecklistUpdate&&onChecklistUpdate(task.id,checklist)}/>
      <TaskHistory taskId={task.id} users={users} departments={departments} sprints={sprints} stories={stories} statusSteps={mySteps}/>
      <TaskComments taskId={task.id} users={users} profile={profile} onProgress={pct=>onProgressUpdate&&onProgressUpdate(task.id,pct)} onPosted={()=>onCommentPosted&&onCommentPosted(task.id)}
        task={task} stepsForDept={stepsForDept} onStatusChange={onStatusChange}/>
    </div>
  )
}

/* ─── Task Detail: inline Check In / Check Out ─────────────
   Same time_logs + checkin_tasks session CheckInWidget.jsx (topbar) uses —
   lets you check in against THIS task without leaving its detail view,
   instead of opening the topbar widget and hunting for it in a list.
   Checkout only ever closes the session — it never changes task status
   (that's the Status row above, which is a separate, explicit action). */
function TaskCheckInOut({task,profile}) {
  const [activeLog,setActiveLog]   = useState(null)
  const [inSession,setInSession]   = useState(false)
  const [elapsed,setElapsed]       = useState('')
  const [loading,setLoading]       = useState(false)
  const timerRef = useRef(null)

  useEffect(()=>{ if(profile?.id&&task?.id) load() },[profile?.id,task?.id])

  useEffect(()=>{
    clearInterval(timerRef.current)
    if(activeLog?.check_in){
      timerRef.current=setInterval(()=>{
        const s=(Date.now()-new Date(activeLog.check_in))/1000
        const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60)
        setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`)
      },1000)
    }
    return ()=>clearInterval(timerRef.current)
  },[activeLog])

  async function load(){
    const today=new Date().toISOString().split('T')[0]
    const {data}=await supabase.from('time_logs').select('id,check_in').eq('employee_id',profile.id)
      .eq('work_date',today).is('check_out',null).order('check_in',{ascending:false}).limit(1)
    const log=data?.[0]||null
    setActiveLog(log)
    if(log){
      const {data:link}=await supabase.from('checkin_tasks').select('id').eq('checkin_log_id',log.id).eq('task_id',task.id).maybeSingle()
      setInSession(!!link)
    } else setInSession(false)
  }

  async function checkIn(){
    setLoading(true)
    try{
      const today=new Date().toISOString().split('T')[0]
      const {data:logData,error}=await supabase.from('time_logs').insert({
        employee_id:profile.id, project_id:task.project_id||null,
        work_date:today, check_in:new Date().toISOString(), comment:task.task_name||null,
      }).select().single()
      if(error) throw error
      await supabase.from('checkin_tasks').insert({checkin_log_id:logData.id,task_id:task.id,employee_id:profile.id,work_date:today})
      notifyManagers({type:'checkin',title:`🟢 ${profile.full_name} checked in`,body:task.task_name,link:'/tasks',senderId:profile.id})
      await load()
    }catch(e){ alert(e.message) }
    setLoading(false)
  }

  async function addToSession(){
    setLoading(true)
    try{
      const today=new Date().toISOString().split('T')[0]
      await supabase.from('checkin_tasks').insert({checkin_log_id:activeLog.id,task_id:task.id,employee_id:profile.id,work_date:today})
      await load()
    }catch(e){ alert(e.message) }
    setLoading(false)
  }

  async function checkOut(){
    setLoading(true)
    try{
      const now=new Date()
      const hrs=Math.round((now-new Date(activeLog.check_in))/3600000*100)/100
      await supabase.from('time_logs').update({check_out:now.toISOString(),hours_worked:hrs}).eq('id',activeLog.id)
      notifyManagers({type:'checkout',title:`🔴 ${profile.full_name} checked out`,body:`Session duration: ${elapsed||hrs+'h'}`,link:'/tasks',senderId:profile.id})
      await load()
    }catch(e){ alert(e.message) }
    setLoading(false)
  }

  const btnSm={padding:'4px 10px',fontSize:11,fontWeight:700,borderRadius:6,cursor:'pointer',fontFamily:'inherit',border:'none'}

  if(!activeLog){
    return <button style={{...btnSm,background:'var(--c1)',color:'#fff'}} disabled={loading} onClick={checkIn}>{loading?'Checking in…':'▶ Check In'}</button>
  }
  if(inSession){
    return (
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:13,color:'var(--c1)'}}>{elapsed||'00:00:00'}</span>
        <button style={{...btnSm,background:'#e11d48',color:'#fff'}} disabled={loading} onClick={checkOut}>{loading?'…':'⏹ Check Out'}</button>
      </div>
    )
  }
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <span style={{fontSize:11,color:'var(--text-muted)'}}>Checked in to another session</span>
      <button style={{...btnSm,background:'var(--surface-2)',color:'var(--text)',border:'1px solid var(--border)'}} disabled={loading} onClick={addToSession}>+ Add this task</button>
      <button style={{...btnSm,background:'#e11d48',color:'#fff'}} disabled={loading} onClick={checkOut}>{loading?'…':'⏹ Check Out'}</button>
    </div>
  )
}

/* ─── Task Detail: per-task checklist editor ───────────────
   Industry-Adaptive checklist shape ({id,label,type,required,value}) —
   same one project_tasks.checklist / MyWorkPage.jsx's completion flow and
   Settings → Task Templates already use. This is that same editor, scoped
   to ONE task's own checklist, so a manager can opt individual tasks into
   whichever of the universal checklist item types apply and mark each
   required/optional, without needing a template. */
const CHECKLIST_TYPE_LABELS={checkbox:'Checkbox',text:'Text Note',number:'Number',date:'Date',dropdown:'Dropdown',photo:'Photo Evidence',file:'File Attachment',signature:'Signature',measurement:'Measurement',pass_fail:'Pass / Fail'}
let taskChecklistItemSeq=0
function TaskChecklist({task,canEdit,onUpdate}) {
  const checklist=Array.isArray(task.checklist)?task.checklist:[]
  const [editing,setEditing]   = useState(false)
  const [draft,setDraft]       = useState([])
  const [saving,setSaving]     = useState(false)
  const [uploadingId,setUploadingId] = useState(null)

  function startEdit(){ setDraft(checklist.map(i=>({...i}))); setEditing(true) }
  function addItem(){
    taskChecklistItemSeq+=1
    setDraft(d=>[...d,{id:`chk_${Date.now()}_${taskChecklistItemSeq}`,label:'',type:'text',required:false,value:null}])
  }
  function patchItem(id,patch){ setDraft(d=>d.map(i=>i.id===id?{...i,...patch}:i)) }
  function removeItem(id){ setDraft(d=>d.filter(i=>i.id!==id)) }
  // Opt a universal checklist type in/out with one tick — ticking adds it
  // (pre-filled label = the type's name, editable below), unticking drops
  // every draft item of that type. One checkbox per type, not per item —
  // add a second item of the same type via "+ Add checklist item" below.
  function toggleType(type,checked){
    if(checked){
      taskChecklistItemSeq+=1
      setDraft(d=>[...d,{id:`chk_${Date.now()}_${taskChecklistItemSeq}`,label:CHECKLIST_TYPE_LABELS[type]||type,type,required:false,value:null}])
    } else {
      setDraft(d=>d.filter(i=>i.type!==type))
    }
  }

  async function save(){
    setSaving(true)
    try{ await saveChecklistValues(task.id,draft); onUpdate&&onUpdate(draft); setEditing(false) }
    catch(e){ alert(e.message) } finally{ setSaving(false) }
  }

  async function handleFill(itemId,patch){
    const next=checklist.map(i=>i.id===itemId?{...i,...patch}:i)
    try{ await saveChecklistValues(task.id,next); onUpdate&&onUpdate(next) }
    catch(e){ alert(e.message) }
  }
  async function handleEvidence(itemId,file){
    if(!file) return
    setUploadingId(itemId)
    try{ const url=await uploadTaskEvidence(task.id,file); await handleFill(itemId,{value:url}) }
    catch(e){ alert(e.message) } finally{ setUploadingId(null) }
  }

  return (
    <div style={{marginTop:6,marginBottom:6}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em'}}>
          Checklist{checklist.length>0&&` (${checklist.filter(i=>i.value).length}/${checklist.length})`}
        </div>
        {canEdit&&!editing&&<button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}><Edit2 size={12}/> {checklist.length?'Edit':'Add'} Checklist</button>}
      </div>

      {!editing&&checklist.length===0&&<div style={{fontSize:12,color:'var(--text-muted)',fontStyle:'italic'}}>No checklist items on this task</div>}

      {!editing&&checklist.length>0&&(
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {checklist.map(item=>(
            <div key={item.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)'}}>
              <span style={{flex:1,fontSize:12.5,fontWeight:500}}>{item.label||'(untitled)'}{item.required&&<span style={{color:'var(--rose)'}}> *</span>}</span>
              <span style={{fontSize:10,color:'var(--text-muted)',textTransform:'capitalize'}}>{item.type.replace('_',' ')}</span>
              {canEdit ? (
                <label style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap'}}>
                  <input type="checkbox" checked={!!item.required} onChange={e=>handleFill(item.id,{required:e.target.checked})}/> Required
                </label>
              ) : item.required && (
                <span style={{fontSize:10,fontWeight:700,color:'var(--rose)'}}>Required</span>
              )}
              {['photo','file','signature'].includes(item.type)?(
                <>
                  <input type="file" style={{fontSize:11,maxWidth:150}} disabled={uploadingId===item.id} onChange={e=>handleEvidence(item.id,e.target.files?.[0])}/>
                  {item.value&&<span style={{fontSize:10,color:'#10b981'}}>✓</span>}
                </>
              ):item.type==='pass_fail'?(
                <select className="form-select" style={{fontSize:11,padding:'3px 6px',width:100}} value={item.value||''} onChange={e=>handleFill(item.id,{value:e.target.value})}>
                  <option value="">Select…</option><option value="pass">Pass</option><option value="fail">Fail</option>
                </select>
              ):(
                <input className="form-input" style={{fontSize:11,padding:'3px 6px',width:120}}
                  type={item.type==='number'?'number':item.type==='date'?'date':'text'}
                  value={item.value||''} onChange={e=>handleFill(item.id,{value:e.target.value})}/>
              )}
            </div>
          ))}
        </div>
      )}

      {editing&&(
        <div>
          <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:6}}>Universal checklist options — tick to include</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'6px 16px',marginBottom:14,padding:'8px 10px',borderRadius:8,background:'var(--surface-2)'}}>
            {CHECKLIST_TYPES.map(type=>(
              <label key={type} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer'}}>
                <input type="checkbox" checked={draft.some(i=>i.type===type)} onChange={e=>toggleType(type,e.target.checked)}/>
                {CHECKLIST_TYPE_LABELS[type]||type}
              </label>
            ))}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:10}}>
            {draft.map(item=>(
              <div key={item.id} style={{display:'flex',gap:8,alignItems:'center'}}>
                <input className="form-input" placeholder="Item label" value={item.label} onChange={e=>patchItem(item.id,{label:e.target.value})} style={{flex:1,fontSize:12}}/>
                <select className="form-select" value={item.type} onChange={e=>patchItem(item.id,{type:e.target.value})} style={{maxWidth:140,fontSize:12}}>
                  {CHECKLIST_TYPES.map(t=><option key={t} value={t}>{t.replace('_',' ')}</option>)}
                </select>
                <label style={{display:'flex',alignItems:'center',gap:4,fontSize:11,whiteSpace:'nowrap'}}>
                  <input type="checkbox" checked={!!item.required} onChange={e=>patchItem(item.id,{required:e.target.checked})}/> Required
                </label>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{color:'#ef4444'}} onClick={()=>removeItem(item.id)}><Trash2 size={12}/></button>
              </div>
            ))}
            {draft.length===0&&<div style={{fontSize:12,color:'var(--text-muted)',fontStyle:'italic'}}>No items yet — add one of the universal checklist options below</div>}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}><Plus size={12}/> Add checklist item</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving?'Saving…':'Save Checklist'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

const isBlankHtml=html=>!html||!html.replace(/<[^>]*>/g,'').trim()

/* ─── Task Comments / Daily Updates ─────────────────────── */
function TaskComments({taskId,users,profile,onProgress,onPosted,task,stepsForDept,onStatusChange}) {
  const [comments,setComments]=useState([])
  const [loading,setLoading]=useState(true)
  const [text,setText]=useState('')
  const [pct,setPct]=useState('')
  const [posting,setPosting]=useState(false)
  const [editorKey,setEditorKey]=useState(0)
  const [editingId,setEditingId]=useState(null)
  const [editText,setEditText]=useState('')
  const [editPct,setEditPct]=useState('')
  const [savingEdit,setSavingEdit]=useState(false)

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

  // A daily update posted at 100% auto-advances the task to its own
  // department's "Done" step (Settings → Task Status Flows) and drops a
  // follow-up note in this same thread, so the status change is visible
  // right alongside the update that caused it — not only in Task History.
  // 100% does NOT jump straight to the closed step — it advances the
  // task to whatever step comes next in ITS OWN department's flow, same
  // as if someone had manually moved it forward one stage. Only when
  // that next step happens to BE the closed step (i.e. every step in
  // between has already been "followed") does it actually land on
  // Done/Closed. This mirrors a real pipeline — 100% on "Code Review"
  // should send it to "QA Testing" next, not skip QA entirely.
  // No-ops (silently) if the caller can't change status, the task's
  // current status isn't a recognized step in its flow, or it's already
  // on the last step — never blocks the update itself from saving.
  async function autoCloseIfComplete(progress_pct){
    if(progress_pct!==100||!task||!stepsForDept||!onStatusChange) return
    const steps=stepsForDept(task.department_id)
    const curIdx=steps.findIndex(s=>s.status_key===task.status)
    if(curIdx===-1||curIdx>=steps.length-1) return
    const nextStep=steps[curIdx+1]
    await onStatusChange(nextStep.status_key)
    const msg=nextStep.is_closed
      ? `<p>✅ Automatically marked as <strong>${nextStep.label}</strong> — 100% complete.</p>`
      : `<p>➡️ Automatically moved to <strong>${nextStep.label}</strong> — 100% complete on this step.</p>`
    await supabase.from('task_comments').insert({task_id:taskId,user_id:profile.id,comment:msg})
  }

  async function post(){
    if(isBlankHtml(text))return
    setPosting(true)
    try{
      const progress_pct = pct===''?null:Math.max(0,Math.min(100,parseInt(pct)||0))
      const {error}=await supabase.from('task_comments').insert({task_id:taskId,user_id:profile.id,comment:text,progress_pct})
      if(error) throw error
      if(progress_pct!=null){
        const {data:updRows,error:updErr}=await supabase.from('project_tasks').update({progress_pct}).eq('id',taskId).select('id')
        if(updErr) throw updErr
        if(!updRows||updRows.length===0) throw new Error('Progress was not saved — you may not have permission to update this task')
        onProgress&&onProgress(progress_pct)
        await autoCloseIfComplete(progress_pct)
      }
      setText(''); setPct(''); setEditorKey(k=>k+1)
      onPosted&&onPosted()
      load()
    }catch(e){ alert(e.message) } finally{ setPosting(false) }
  }

  function startEdit(c){
    setEditingId(c.id); setEditText(c.comment||''); setEditPct(c.progress_pct==null?'':String(c.progress_pct))
  }
  function cancelEdit(){ setEditingId(null); setEditText(''); setEditPct('') }
  async function saveEdit(c){
    if(isBlankHtml(editText))return
    setSavingEdit(true)
    try{
      const progress_pct=editPct===''?null:Math.max(0,Math.min(100,parseInt(editPct)||0))
      const {error}=await supabase.from('task_comments').update({comment:editText,progress_pct}).eq('id',c.id)
      if(error) throw error
      // Only push to the task's live progress if this is the MOST RECENT
      // update — editing an older one shouldn't override progress a
      // newer update already reported.
      const isLatest=comments[0]?.id===c.id
      if(isLatest&&progress_pct!=null){
        const {data:updRows,error:updErr}=await supabase.from('project_tasks').update({progress_pct}).eq('id',taskId).select('id')
        if(updErr) throw updErr
        if(updRows&&updRows.length>0){
          onProgress&&onProgress(progress_pct)
          await autoCloseIfComplete(progress_pct)
        }
      }
      cancelEdit()
      load()
    }catch(e){ alert(e.message) } finally{ setSavingEdit(false) }
  }

  return (
    <div style={{marginTop:18}}>
      <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',marginBottom:10,display:'flex',alignItems:'center',gap:6}}><MessageSquare size={13}/> Daily Updates</div>
      <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'flex-start'}}>
        <div style={{flex:1,minWidth:0}}>
          <RichTextEditor key={editorKey} value="" onChange={setText}
            onUploadImage={file=>uploadTaskImage(taskId,file,profile?.organization_id)}
            placeholder="Post a daily update… (paste or attach a screenshot)" minHeight={56}/>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:6,width:88,flexShrink:0}}>
          <input type="number" min={0} max={100} className="form-input" placeholder="%" value={pct} onChange={e=>setPct(e.target.value)} style={{fontSize:13,textAlign:'center'}}/>
          <button className="btn btn-primary btn-sm" onClick={post} disabled={posting||isBlankHtml(text)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Send size={11}/> Post</button>
        </div>
      </div>
      {loading?<Loader/>:comments.length===0?(
        <div style={{fontSize:12,color:'var(--text-muted)',textAlign:'center',padding:'14px 0'}}>No updates yet — post the first one above</div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:10,maxHeight:280,overflowY:'auto'}}>
          {comments.map(c=>{
            const commenter=users?.find(u=>u.id===c.user_id)
            const isMine=c.user_id===profile?.id
            const isEditing=editingId===c.id
            return (
            <div key={c.id} style={{padding:'10px 12px',borderRadius:10,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5,gap:8,flexWrap:'wrap'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:6,fontWeight:700,fontSize:12}}>
                  {commenter&&<Ava name={commenter.full_name} size={18}/>}
                  {commenter?.full_name||(isMine?profile.full_name:'Unknown')}
                </span>
                <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                  {c.progress_pct!=null&&<span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'#6366f118',color:'#6366f1'}}>{c.progress_pct}% completed</span>}
                  <span style={{fontSize:10,color:'var(--text-muted)'}}>{timeFmt(c.created_at)}</span>
                  {isMine&&!isEditing&&<button title="Edit update" onClick={()=>startEdit(c)} style={{background:'none',border:'none',cursor:'pointer',padding:2,borderRadius:4,color:'var(--text-muted)',display:'flex'}}><Edit2 size={11}/></button>}
                </div>
              </div>
              {isEditing?(
                <div>
                  <RichTextEditor value={editText} onChange={setEditText}
                    onUploadImage={file=>uploadTaskImage(taskId,file,profile?.organization_id)} minHeight={56}/>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
                    <input type="number" min={0} max={100} className="form-input" placeholder="%" value={editPct} onChange={e=>setEditPct(e.target.value)} style={{fontSize:13,textAlign:'center',width:70}}/>
                    <button className="btn btn-primary btn-sm" onClick={()=>saveEdit(c)} disabled={savingEdit||isBlankHtml(editText)}>{savingEdit?'Saving…':'Save'}</button>
                    <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ):<RichTextView html={c.comment} style={{fontSize:13}}/>}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

/* ─── Task History (complete change-verification audit trail, STEP197) ─── */
const HISTORY_FIELD_LABEL={
  task_name:'Task Name',task_type:'Type',status:'Status',priority:'Priority',assigned_to:'Assignee',
  department_id:'Department',module_name:'Module',planned_start_date:'Planned Start',planned_end_date:'Planned End',
  estimated_hours:'Est. Hours',actual_hours:'Actual Hours',sprint_id:'Sprint',user_story_id:'User Story',
}
function TaskHistory({taskId,users,departments,sprints,stories,statusSteps}) {
  const [rows,setRows]=useState([])
  const [loading,setLoading]=useState(true)
  // Open by default (and loaded on mount, not gated on the user clicking
  // it open first) — any recorded change should be visible immediately
  // above Daily Updates, not hidden behind an extra click.
  const [open,setOpen]=useState(true)

  useEffect(()=>{ if(taskId&&open) load() },[taskId,open])
  async function load(){ setLoading(true); setRows(await listTaskHistory(taskId)); setLoading(false) }

  function formatValue(field,v){
    if(v==null||v==='') return '—'
    if(field==='status') return statusSteps?.find(s=>s.status_key===v)?.label||v
    if(field==='task_type') return v.replace(/_/g,' ')
    if(field==='priority') return `${PI[v]||''} ${v}`.trim()
    if(field==='assigned_to') return users?.find(u=>u.id===v)?.full_name || 'Unknown'
    if(field==='department_id') return departments?.find(d=>d.id===v)?.name || 'Unknown'
    if(field==='sprint_id') return sprints?.find(s=>s.id===v)?.name || 'Unknown'
    if(field==='user_story_id') return stories?.find(s=>s.id===v)?.title || 'Unknown'
    if(field==='planned_start_date'||field==='planned_end_date') return dateFmt(v)
    if(field==='estimated_hours'||field==='actual_hours') return `${v}h`
    return v
  }

  // Nothing to show once loaded — hide the whole block rather than
  // cluttering every task with an empty "No changes recorded yet" panel
  // above Daily Updates.
  if(!loading&&rows.length===0) return null

  return (
    <div style={{marginTop:6,marginBottom:18}}>
      <button onClick={()=>setOpen(o=>!o)} style={{background:'none',border:'none',padding:0,cursor:'pointer',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',display:'flex',alignItems:'center',gap:6,marginBottom:open?10:0}}>
        {open?<ChevronDown size={13}/>:<ChevronRight size={13}/>} <History size={13}/> Task History{rows.length>0?` (${rows.length})`:''}
      </button>
      {open&&(loading?<Loader/>:(
        <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:280,overflowY:'auto'}}>
          {rows.map(r=>{
            const changer=users?.find(u=>u.id===r.changed_by)
            return (
              <div key={r.id} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'8px 10px',borderRadius:8,background:'var(--surface-2)',border:'1px solid var(--border)',fontSize:12}}>
                {changer&&<Ava name={changer.full_name} size={16}/>}
                <div style={{flex:1,minWidth:0}}>
                  <span style={{fontWeight:700}}>{changer?.full_name||'Someone'}</span> changed <strong>{HISTORY_FIELD_LABEL[r.field_name]||r.field_name}</strong> from{' '}
                  <span style={{color:'var(--text-muted)'}}>{formatValue(r.field_name,r.old_value)}</span> to{' '}
                  <span style={{fontWeight:700,color:'var(--c1)'}}>{formatValue(r.field_name,r.new_value)}</span>
                  <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{timeFmt(r.created_at)}</div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/* ─── Task Detail Drawer (STEP227 "Template 1") ─────────────
   Same open/onClose/title/children/footer/size prop shape as the shared
   <Modal> from components/ui, so TasksPage can pick either component for
   the Task Detail container without changing anything else — see
   DetailContainer below. Slides in from the right instead of the
   centered dialog; reuses .modal-header/.modal-body/.modal-footer for
   an identical internal look, only the positioning classes differ. */
function TaskDetailDrawer({open,onClose,title,children,footer}) {
  if(!open) return null
  return (
    <div className="drawer-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="drawer-panel">
        <div className="modal-header">
          <span>{title}</span>
          <button className="close-btn" onClick={onClose}><X size={14}/></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer&&<div className="modal-footer">{footer}</div>}
      </div>
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
  const [workItems, setWorkItems] = useState([]) // Industry-Adaptive Phase 4 — optional Task parent, org-wide (not project-scoped)
  const [tasks,     setTasks]     = useState([])
  const [stories,   setStories]   = useState([])
  const [sprints,   setSprints]   = useState([])
  const [epics,     setEpics]     = useState([])
  const [users,     setUsers]     = useState([])
  const [departments, setDepartments] = useState([])
  const [flows, setFlows] = useState([]) // per-department status pipelines (STEP198)
  const [fieldRules, setFieldRules] = useState({}) // STEP226 — required-on-create/edit per field
  const [detailViewStyle, setDetailViewStyle] = useState('modal') // STEP227 — 'modal' (default) or 'drawer' (Template 1)
  const usersRef    = useRef([])
  const [changReqs, setChangReqs] = useState([])
  const [commentCounts, setCommentCounts] = useState({})
  const [loading,   setLoading]   = useState(true)

  const [selProj,   setSelProj]  = useState('')
  const [selSprint, setSelSprint]= useState('')
  const [selModule, setSelModule]= useState('')
  const [selAssign, setSelAssign]= useState('')
  const [selDept,   setSelDept]  = useState('') // '' = all, '__none' = Unassigned, else a department id
  const [selStatus, setSelStatus]= useState('')
  const [selPrio,   setSelPrio]  = useState('')
  const [selType,   setSelType]  = useState('')
  const [search,    setSearch]   = useState('')
  const [searchParams,setSearchParams] = useSearchParams()
  const view = searchParams.get('view') || 'kanban'
  const [groupBy,   setGroupBy]  = useState('none')
  // Board tab layout — each viewer picks their own (remembered per browser).
  const [boardLayout,setBoardLayoutState]=useState(()=>{try{return BOARD_LAYOUTS.some(l=>l.key===localStorage.getItem('tasks-board-layout'))?localStorage.getItem('tasks-board-layout'):'sections'}catch{return 'sections'}})
  const setBoardLayout=k=>{setBoardLayoutState(k);try{localStorage.setItem('tasks-board-layout',k)}catch{}}
  const [boardShowClosed,setBoardShowClosed]=useState(false)
  const [boardEveryone,setBoardEveryone]=useState(false)
  const [plannerSpan,setPlannerSpan]=useState(10)
  const [plannerOffset,setPlannerOffset]=useState(0)
  const [plannerBacklog,setPlannerBacklog]=useState(true)

  const [showTask,   setShowTask]  = useState(false); const [editTask,  setEditTask]  = useState(null); const [taskForm,  setTaskForm]  = useState({}); const [subTask,  setSubTask]  = useState(false); const [delTask,  setDelTask]  = useState(null)

  // Prompt-based task actions (create / status update) — docked AI panel,
  // same TaskActionsTab component the AskBubble chat capability uses (see
  // AIActionTabs.jsx). AI only ever parses intent; nothing writes until
  // the user reviews a resolved confirm card and clicks Confirm.
  const [showAiPanel, setShowAiPanel] = useState(searchParams.get('ai') === '1')
  const [detailTask, setDetailTask]= useState(null)
  const openDetail=t=>setDetailTask(t)
  // "Save as Template" — turns the task currently open in Task Detail into
  // a reusable task_templates row (name/type/est.hours/checklist), same
  // table Settings → Task Templates manages. Lets a manager configure one
  // task's checklist fully (via TaskChecklist above) then feed it forward
  // as a template instead of rebuilding it from scratch in Settings.
  const [templateSource, setTemplateSource] = useState(null)
  const [templateName,   setTemplateName]   = useState('')
  const [savingTemplate,  setSavingTemplate] = useState(false)
  async function saveAsTemplate(){
    if(!templateSource||!templateName.trim()) return
    setSavingTemplate(true)
    try{
      await createTaskTemplate({
        name: templateName.trim(),
        taskType: templateSource.task_type||'',
        estimatedHours: templateSource.estimated_hours||'',
        requiresApproval: false,
        // Reset per-instance values — a template's checklist is a blank
        // preset (id/label/type/required), never carries this task's
        // already-filled-in answers forward.
        checklist: (templateSource.checklist||[]).map(i=>({...i,value:null})),
      }, profile.id)
      setTemplateSource(null); setTemplateName('')
    }catch(e){ alert(e.message) } finally{ setSavingTemplate(false) }
  }
  const [showStory,  setShowStory] = useState(false); const [editStory, setEditStory] = useState(null); const [storyForm, setStoryForm] = useState({}); const [subStory, setSubStory] = useState(false); const [delStory, setDelStory] = useState(null)
  const [showSprint, setShowSprint]= useState(false); const [editSprint,setEditSprint]= useState(null); const [sprintForm,setSprintForm]= useState({})
  const [showEpic,   setShowEpic]  = useState(false); const [editEpic,  setEditEpic]  = useState(null); const [epicForm,  setEpicForm]  = useState({})
  const [showAssign, setShowAssign]= useState(false); const [assignments,setAssignments]= useState([]); const [newAssign, setNewAssign] = useState({user_id:'',role:'member'})
  const [showPerms,  setShowPerms] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importProj, setImportProj] = useState('')

  const [shareTarget, setShareTarget]= useState(null)
  const [shareUserId, setShareUserId]= useState('')
  const [shareNote,   setShareNote]  = useState('')
  const [shareSent,   setShareSent]  = useState(false)
  const [linkCopied,  setLinkCopied] = useState(false)
  const [exportingReport, setExportingReport] = useState(false)
  const taskLinkFor=t=>`${window.location.origin}/tasks?taskId=${t.id}`
  function openShare(t){ setShareTarget(t); setShareUserId(''); setShareNote(''); setShareSent(false); setLinkCopied(false) }
  async function copyShareLink(){
    if(!shareTarget) return
    try{ await navigator.clipboard.writeText(taskLinkFor(shareTarget)); setLinkCopied(true); setTimeout(()=>setLinkCopied(false),2000) }catch(e){}
  }
  async function sendShare(){
    if(!shareTarget||!shareUserId) return
    await sendNotif(shareUserId,{type:'task_shared',title:`🔗 ${profile.full_name||'Someone'} shared a task with you`,body:`${shareTarget.task_name}${shareNote?` — "${shareNote}"`:''}`,link:`/tasks?taskId=${shareTarget.id}`,senderId:profile.id})
    setShareSent(true); setTimeout(()=>setShareTarget(null),1200)
  }

  // Deep-link: /tasks?taskId=<id> (from a shared link, or a notification's
  // link) opens that task's detail modal directly once its data has loaded.
  useEffect(()=>{
    const tid=searchParams.get('taskId')
    if(!tid||tasks.length===0) return
    const t=tasks.find(x=>x.id===tid)
    if(t){ setDetailTask(t); setSearchParams(prev=>{const p=new URLSearchParams(prev);p.delete('taskId');return p},{replace:true}) }
  },[tasks,searchParams])

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
    // Guards a real race: this effect re-fires on every profile?.id change
    // (see its useEffect below), including the brief moment during
    // sign-out/account-switch where `user` is still set but `profile` has
    // already cleared — without this, every query below that reads
    // profile.id/profile.organization_id throws on a null profile.
    if(!profile?.id) return
    setLoading(true)
    const [uR,pR,permR,deptR,wiR,flowsRes,fieldRulesRes,viewStyleRes] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role,department_id').order('full_name'),
      isMgr
        ? supabase.from('projects').select('id,name,code,status,goal').eq('status','active').order('name')
        : supabase.from('project_assignments').select('project:projects(id,name,code,status,goal)').eq('user_id',profile.id),
      supabase.from('task_role_permissions').select('*').is('project_id',null),
      supabase.from('departments').select('id,name').order('name'),
      // Industry-Adaptive Phase 4 — work_items are org-wide (RLS-scoped,
      // no project relationship at all), so this is one flat fetch
      // regardless of role, unlike the project-scoped queries below.
      supabase.from('work_items').select('id,title,work_type_key,status').eq('status','open').order('title'),
      listFlows(profile.organization_id).catch(()=>[]),
      listTaskFieldRules().catch(()=>[]),
      getTaskDetailViewStyle().catch(()=>'modal'),
    ])
    const us=uR.data||[]
    setUsers(us)
    setDepartments(deptR.data||[])
    setWorkItems(wiR.data||[])
    setFlows(flowsRes||[])
    setFieldRules(fieldRulesToMap(fieldRulesRes||[]))
    setDetailViewStyle(viewStyleRes||'modal')
    if(permR.data?.length>0){
      const dp={}
      permR.data.forEach(p=>{dp[p.role]={can_view:p.can_view,can_create:p.can_create,can_edit:p.can_edit,can_delete:p.can_delete,can_change_status:p.can_change_status}})
      setPerms({...DEF_PERMS,...dp})
    }

    if(isMgr) {
      // Managers see all active projects, all tasks in those projects,
      // AND all Direct Tasks (project_id IS NULL) org-wide — the fetch is
      // no longer gated on ps.length>0: an org that operates entirely
      // without Projects (Industry-Adaptive Phase 4) must still see its
      // Direct Tasks, not silently show none. `.in('project_id',ids)`
      // alone would never match a NULL project_id (standard SQL IN
      // semantics), hence the explicit `.or(...,project_id.is.null)`
      // rather than just adding project-less tasks as an afterthought.
      const ps=pR.data||[]
      setProjects(ps)
      const ids=ps.map(p=>p.id)
      const taskOrFilter = ids.length>0 ? `project_id.in.(${ids.join(',')}),project_id.is.null` : 'project_id.is.null'
      const tR = await supabase.from('project_tasks').select('*,assignee:profiles!assigned_to(id,full_name)').or(taskOrFilter).order('created_at',{ascending:false})
      setTasks(tR.data||[])
      loadCommentCounts((tR.data||[]).map(t=>t.id))
      if(ids.length>0){
        const [sR,spR,eR,crR]=await Promise.all([
          supabase.from('user_stories').select('*,assignee:profiles!assignee_id(id,full_name)').in('project_id',ids).order('created_at',{ascending:false}),
          supabase.from('sprints').select('*').in('project_id',ids).order('created_at',{ascending:false}),
          supabase.from('epics').select('*').in('project_id',ids),
          supabase.from('change_requests').select('*').in('project_id',ids).order('created_at',{ascending:false}),
        ])
        setStories(sR.data||[]); setSprints(spR.data||[])
        setEpics(eR.data||[]); setChangReqs(crR.data||[])
      } else {
        setStories([]); setSprints([]); setEpics([]); setChangReqs([])
      }
    } else {
      // Non-managers (employee, developer, lead, etc.):
      // Load tasks ASSIGNED TO THEM + tasks in any project they are formally assigned to.
      // This ensures employees always see their tasks even if not in project_assignments.
      const assignedProjects=(pR.data||[]).map(r=>r.project).filter(Boolean)
      const assignedProjIds=assignedProjects.map(p=>p.id)

      // 'employee' and 'developer' only ever see tasks assigned directly
      // to them — no department-wide or project-wide visibility into
      // teammates' tasks. 'lead' keeps the wider team view below (it runs
      // the department's board, so it needs to see the whole team's work).
      const narrowToOwnTasks = ['employee','developer'].includes(role)

      let taskQ=supabase.from('project_tasks')
        .select('*,assignee:profiles!assigned_to(id,full_name)')
        .order('created_at',{ascending:false})
      if(narrowToOwnTasks){
        // 'general' tasks are universal miscellaneous/check-in work items —
        // not personally assigned to anyone, so the narrow "only my tasks"
        // clause would otherwise hide them from every employee/developer.
        taskQ=taskQ.or(`assigned_to.eq.${profile.id},task_type.eq.general`)
      } else {
        // Build task query: directly assigned OR in their projects OR in
        // their own department — that last clause is what makes the
        // Kanban board actually show "the team's" flow for a lead (e.g.
        // Application), not just tasks individually assigned to them.
        // Widens visibility only; never drops anything previously
        // visible via the other two clauses.
        // Always include tasks THEY created — a lead delegating a task to
        // someone in another project/department they don't otherwise have
        // visibility into must still see their own creation afterward
        // (previously it could vanish from list/kanban the moment loadAll()
        // re-ran post-save, since none of the other clauses matched it).
        const orParts=[`assigned_to.eq.${profile.id}`,`created_by.eq.${profile.id}`,`task_type.eq.general`]
        if(assignedProjIds.length>0) orParts.push(`project_id.in.(${assignedProjIds.join(',')})`)
        if(profile.department_id) orParts.push(`department_id.eq.${profile.department_id}`)
        taskQ=taskQ.or(orParts.join(','))
      }
      const {data:taskData}=await taskQ
      let fetchedTasks=taskData||[]

      // Subtasks (and parent tasks) can fall outside every visibility
      // clause above — a different project/department/assignee than
      // this viewer — even though the PARENT (or child) task itself is
      // visible. Without this, a lead could open a visible task and see
      // an empty Subtasks section, or a subtask whose "Parent Task" link
      // resolves to nothing. Pull in whichever half is missing.
      {
        const knownIds=new Set(fetchedTasks.map(t=>t.id))
        const parentIdsNeeded=[...new Set(fetchedTasks.map(t=>t.parent_task_id).filter(id=>id&&!knownIds.has(id)))]
        const {data:childRows}=knownIds.size>0
          ? await supabase.from('project_tasks').select('id,parent_task_id').in('parent_task_id',[...knownIds])
          : {data:[]}
        const childIdsNeeded=(childRows||[]).map(r=>r.id).filter(id=>!knownIds.has(id))
        const extraTaskIds=[...new Set([...parentIdsNeeded,...childIdsNeeded])]
        if(extraTaskIds.length>0){
          const {data:extraTasks}=await supabase.from('project_tasks').select('*,assignee:profiles!assigned_to(id,full_name)').in('id',extraTaskIds)
          if(extraTasks?.length) fetchedTasks=[...fetchedTasks,...extraTasks]
        }
      }

      // Discover projects from task results that aren't already in assignedProjects
      const taskProjIds=[...new Set(fetchedTasks.map(t=>t.project_id).filter(Boolean))]
      const extraProjIds=taskProjIds.filter(id=>!assignedProjIds.includes(id))
      let allProjects=[...assignedProjects]
      if(extraProjIds.length>0){
        const {data:extraProjs}=await supabase.from('projects').select('id,name,code,status,goal').in('id',extraProjIds)
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

  // overrideForm (used by the AI-confirm path below) bypasses both the
  // taskForm state AND the editTask check — passed as a direct argument
  // rather than through setTaskForm()+await, since a just-called
  // setTaskForm() hasn't landed in this render's closure yet and reading
  // taskForm here would still see the stale pre-update value.
  async function saveTask(e, overrideForm) {
    e.preventDefault(); setSubTask(true)
    try {
      const src = overrideForm || taskForm
      const isEdit = !overrideForm && editTask
      // project_id: NEVER silently fall back to some other project (that
      // was the original "Project is mandatory" bug — Industry-Adaptive
      // Platform Phase 4). src.project_id||selProj covers the two cases
      // where a project genuinely IS intended (the form's own picker, or
      // an active project-filter context); anything else is an explicit
      // Direct Task and must save project_id:null, not projects[0].
      const p={task_name:src.task_name,task_type:src.task_type||'task',description:src.description||null,module_name:src.module_name||null,priority:src.priority||'medium',assigned_to:src.assigned_to||null,department_id:src.department_id||null,status:src.status||'backlog',planned_start_date:src.planned_start_date||null,planned_end_date:src.planned_end_date||null,actual_start_date:src.actual_start_date||null,actual_end_date:src.actual_end_date||null,estimated_hours:parseFloat(src.estimated_hours)||null,actual_hours:parseFloat(src.actual_hours)||null,user_story_id:src.user_story_id||null,sprint_id:src.sprint_id||null,change_request_id:src.change_request_id||null,project_id:src.project_id||selProj||null,work_item_id:src.work_item_id||null,parent_task_id:src.parent_task_id||null}
      // device link (STEP244) — only sent when set, or when clearing an existing link, so saving works before that step is run
      if(src.device_id||(isEdit&&editTask?.device_id)) p.device_id=src.device_id||null
      // STEP226 — Settings → Task Field Rules. Same rule can require a
      // field on create but not edit (or vice versa), hence the isEdit
      // branch picking which flag to check.
      const missingFields=TASK_FIELD_CATALOG.filter(f=>{
        const rule=fieldRules[f.key]
        const required=isEdit?rule?.required_on_edit:rule?.required_on_create
        if(!required) return false
        const v=p[f.key]
        return f.key==='description' ? isBlankHtml(v) : (v===null||v===undefined||v==='')
      })
      if(missingFields.length){
        alert(`Please fill in the following required field${missingFields.length>1?'s':''}: ${missingFields.map(f=>f.label).join(', ')}`)
        return false
      }
      if(isEdit){
        // Only auto-fill if the field's still empty — never override a
        // value a manager (or an earlier auto-stamp) already set.
        Object.assign(p, autoActualDates({...editTask, actual_start_date:p.actual_start_date, actual_end_date:p.actual_end_date}, p.status, stepsForDept(p.department_id).find(s=>s.status_key===p.status)?.is_closed))
        // Auto-assign to a Tech Lead when the edit form's Status is being
        // saved as Code Review — same rule as changing status directly
        // from the board/list, applied here too so it isn't bypassed by
        // editing the task instead.
        if(p.status!==editTask.status) Object.assign(p, autoAssignPatchForStatus(editTask,p.status))
        const wasAssignedTo = editTask.assigned_to
        const changes = diffTaskFields(editTask, p)
        // .select().maybeSingle() so a write RLS silently filtered out (0
        // rows affected) throws here instead of looking saved — a plain
        // .update() with no .select() returns no error either way.
        const {data:savedRow,error:saveErr}=await supabase.from('project_tasks').update(p).eq('id',editTask.id).select('id').maybeSingle()
        if(saveErr) throw saveErr
        if(!savedRow) throw new Error("Save didn't apply — you may not have write access to this task.")
        logTaskChanges(editTask.id, profile.id, changes)
        // Notify if assignee changed
        if(p.assigned_to && p.assigned_to !== wasAssignedTo && p.assigned_to !== profile.id){
          sendNotif(p.assigned_to,{type:'task_assigned',title:`📋 Task assigned to you`,body:`${p.task_name} — ${stepsForDept(p.department_id).find(s=>s.status_key===p.status)?.label||p.status}`,link:'/tasks',senderId:profile.id})
        }
      } else {
        const {error:insertErr}=await supabase.from('project_tasks').insert({...p,created_by:profile.id})
        if(insertErr) throw insertErr
        // Notify the assignee
        if(p.assigned_to && p.assigned_to !== profile.id){
          sendNotif(p.assigned_to,{type:'task_assigned',title:`📋 New task assigned to you`,body:`${p.task_name}`,link:'/tasks',senderId:profile.id})
        }
      }
      setShowTask(false);setEditTask(null);loadAll()
      return true
    }catch(e){alert(e.message);return false}finally{setSubTask(false)}
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

  async function saveEpic() {
    if(!epicForm.name?.trim()){alert('Name is required');return}
    const p={name:epicForm.name.trim(),project_id:epicForm.project_id||selProj||projects[0]?.id}
    try {
      if(editEpic)await supabase.from('epics').update(p).eq('id',editEpic.id).throwOnError()
      else await supabase.from('epics').insert({...p,created_by:profile.id}).throwOnError()
      setShowEpic(false);setEditEpic(null);loadAll()
    } catch(e){alert(e.message)}
  }

  async function loadCommentCounts(taskIds){
    if(!taskIds.length){ setCommentCounts({}); return }
    const {data}=await supabase.from('task_comments').select('task_id').in('task_id',taskIds)
    const counts={}
    ;(data||[]).forEach(c=>{counts[c.task_id]=(counts[c.task_id]||0)+1})
    setCommentCounts(counts)
  }
  // Generalized Kanban drop handler — `field` is whichever task column the
  // board is currently grouped by (status/assigned_to/department_id/...,
  // see KANBAN_GROUP_FIELD below), so dragging a card between columns
  // reassigns whatever that grouping represents, not always status.
  // `colOrKey` is the full column object for a Status column (may
  // represent several departments' equivalently-labeled steps merged
  // into one, via `col.keys` — see kanbanColumns), or a bare key string
  // for every other grouping mode.
  async function dropOnKanbanColumn(e,field,colOrKey){
    e.preventDefault();const tid=e.dataTransfer.getData('task_id');if(!tid)return
    const task=tasks.find(t=>t.id===tid);if(!task)return
    if(field==='status'){
      if(!myPerm.can_change_status)return
      const col=colOrKey
      // A merged column stands for several departments' own status_keys
      // that share the same label — use the label to find THIS task's
      // own department's real equivalent key, not just the column's
      // arbitrary first/representative one (which might not even exist
      // in this task's own flow).
      let colKey=col.key
      if(col.keys&&col.keys.length>1){
        const norm=(col.label||'').trim().toLowerCase()
        const ownStep=stepsForTask(task).find(s=>(s.label||'').trim().toLowerCase()===norm)
        colKey=ownStep?.status_key||col.key
      }
      const patch={status:colKey,...autoActualDates(task,colKey,stepsForTask(task).find(s=>s.status_key===colKey)?.is_closed),...autoAssignPatchForStatus(task,colKey)}
      const changes=diffTaskFields(task,patch)
      const {data,error}=await supabase.from('project_tasks').update(patch).eq('id',tid).select('id').maybeSingle()
      if(error){ alert(`Couldn't move task: ${error.message}`); return }
      if(!data){ alert("Couldn't move task — the update didn't apply (you may not have write access to it)."); return }
      logTaskChanges(tid,profile.id,changes)
      setTasks(p=>p.map(t=>t.id===tid?{...t,...patch}:t));setDetailTask(d=>d?.id===tid?{...d,...patch}:d)
      if(patch.assigned_to&&patch.assigned_to!==task.assigned_to&&patch.assigned_to!==profile.id){
        sendNotif(patch.assigned_to,{type:'task_assigned',title:`👀 Task ready for your review`,body:`${task.task_name} moved to Code Review`,link:'/tasks',senderId:profile.id})
      }
      return
    }
    // Reassigning developer/department/module/sprint via drag counts as an edit
    if(!myPerm.can_edit)return
    const rawKey=colOrKey.key
    const value=(rawKey==='__unassigned'||rawKey==='__none')?null:rawKey
    if(task[field]===value)return
    const patch={[field]:value}
    const changes=diffTaskFields(task,patch)
    {
      const {data,error}=await supabase.from('project_tasks').update(patch).eq('id',tid).select('id').maybeSingle()
      if(error){ alert(`Couldn't update task: ${error.message}`); return }
      if(!data){ alert("Couldn't update task — the update didn't apply (you may not have write access to it)."); return }
    }
    logTaskChanges(tid,profile.id,changes)
    setTasks(p=>p.map(t=>t.id===tid?{...t,...patch}:t));setDetailTask(d=>d?.id===tid?{...d,...patch}:d)
  }
  // People board drop: a cell is (person, status column) — reassign first
  // if the row changed, then move status if the column changed. Both reuse
  // dropOnKanbanColumn (same permission checks/history/notifications); the
  // task id is captured up front since dataTransfer is cleared after an await.
  async function dropOnPeopleCell(e,col,personKey){
    e.preventDefault();const tid=e.dataTransfer.getData('task_id');if(!tid)return
    const task=tasks.find(t=>t.id===tid);if(!task)return
    const fake={preventDefault(){},dataTransfer:{getData:()=>tid}}
    const personVal=personKey==='__unassigned'?null:personKey
    if((task.assigned_to||null)!==personVal) await dropOnKanbanColumn(fake,'assigned_to',{key:personKey})
    const inCol=col.keys?col.keys.includes(task.status):task.status===col.key
    if(!inCol) await dropOnKanbanColumn(fake,'status',col)
  }
  // Week planner drop: move a task to start on `day` (keeping its length in
  // calendar days) and, if dropped on another person's row, reassign it.
  async function rescheduleTask(tid,personKey,day){
    if(!myPerm.can_edit)return
    const task=tasks.find(t=>t.id===tid);if(!task)return
    const s=task.planned_start_date||task.planned_end_date, en=task.planned_end_date||task.planned_start_date
    const len=s&&en?Math.max(0,Math.round((new Date(en)-new Date(s))/86400000)):0
    const end=new Date(day+'T00:00:00');end.setDate(end.getDate()+len)
    const endStr=`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`
    const patch={planned_start_date:day,planned_end_date:endStr}
    const personVal=personKey==='__unassigned'?null:personKey
    if((task.assigned_to||null)!==personVal) patch.assigned_to=personVal
    const changes=diffTaskFields(task,patch)
    if(!changes.length)return
    const {data,error}=await supabase.from('project_tasks').update(patch).eq('id',tid).select('id').maybeSingle()
    if(error){ alert(`Couldn't reschedule task: ${error.message}`); return }
    if(!data){ alert("Couldn't reschedule task — the update didn't apply (you may not have write access to it)."); return }
    logTaskChanges(tid,profile.id,changes)
    setTasks(p=>p.map(t=>t.id===tid?{...t,...patch}:t));setDetailTask(d=>d?.id===tid?{...d,...patch}:d)
    if(patch.assigned_to&&patch.assigned_to!==profile.id){
      sendNotif(patch.assigned_to,{type:'task_assigned',title:'📋 Task assigned to you',body:`${task.task_name} — ${dateFmt(day)}`,link:'/tasks',senderId:profile.id})
    }
  }
  // Week planner quick-create (Backlog panel / slot popover). Same path as
  // the full New Task form via saveTask's override param, so Task Field
  // Rules, the assignee notification and the reload all still apply.
  async function quickCreateTask({title,hours,priority,personKey,day}){
    const dept=profile?.department_id||null
    return saveTask({preventDefault(){}},{
      task_name:title,task_type:'task',priority:priority||'medium',estimated_hours:hours||null,
      assigned_to:personKey&&personKey!=='__unassigned'?personKey:null,
      planned_start_date:day||null,planned_end_date:day||null,
      department_id:dept,status:stepsForDept(dept)[0]?.status_key||'backlog',project_id:selProj||null,
    })
  }
  async function changeStatus(id,st){
    if(!myPerm.can_change_status)return
    const task = tasks.find(t=>t.id===id)
    if(!task)return
    const patch={status:st,...autoActualDates(task,st,stepsForTask(task).find(s=>s.status_key===st)?.is_closed),...autoAssignPatchForStatus(task,st)}
    const changes = diffTaskFields(task, patch)
    // .select().maybeSingle() so a write RLS silently filtered out (0 rows
    // affected) surfaces as a real failure instead of a false "saved" — a
    // plain .update() with no .select() returns no error even when nothing
    // was actually written, which is exactly why this looked "reverted"
    // after a refresh: the UI updated optimistically below, the DB never did.
    const {data,error}=await supabase.from('project_tasks').update(patch).eq('id',id).select('id').maybeSingle()
    if(error){ alert(`Couldn't change status: ${error.message}`); return }
    if(!data){ alert("Couldn't change status — the update didn't apply (you may not have write access to this task's project/department). Refresh and check with an admin if this keeps happening."); return }
    logTaskChanges(id, profile.id, changes)
    setTasks(p=>p.map(t=>t.id===id?{...t,...patch}:t))
    setDetailTask(d=>d?.id===id?{...d,...patch}:d)
    // Notify the task creator/assignee about status change (if different from current user)
    if(task){
      const notifyId = task.assigned_to !== profile.id ? task.assigned_to : (task.created_by !== profile.id ? task.created_by : null)
      if(notifyId) sendNotif(notifyId,{type:'task_status',title:`🔄 Task status updated`,body:`${task.task_name} → ${stepsForTask(task).find(s=>s.status_key===st)?.label||st}`,link:'/tasks',senderId:profile.id})
    }
    // Notify the newly auto-assigned lead (Code Review hand-off), if different
    if(patch.assigned_to&&patch.assigned_to!==task.assigned_to&&patch.assigned_to!==profile.id){
      sendNotif(patch.assigned_to,{type:'task_assigned',title:`👀 Task ready for your review`,body:`${task.task_name} moved to Code Review`,link:'/tasks',senderId:profile.id})
    }
  }

  async function loadAssignments(pid){const{data}=await supabase.from('project_assignments').select('*,user:profiles(id,full_name,role)').eq('project_id',pid);setAssignments(data||[])}
  async function addAssignment(){if(!newAssign.user_id||!selProj)return;await supabase.from('project_assignments').upsert({project_id:selProj,user_id:newAssign.user_id,role:newAssign.role,assigned_by:profile.id});loadAssignments(selProj);setNewAssign({user_id:'',role:'member'})}
  async function removeAssignment(id){await supabase.from('project_assignments').delete().eq('id',id);loadAssignments(selProj)}

  const projTasks=useMemo(()=>tasks.filter(t=>{
    if(selProj&&t.project_id!==selProj)return false
    if(selSprint&&t.sprint_id!==selSprint)return false
    if(selModule&&t.module_name!==selModule)return false
    if(selAssign&&selAssign!=='__none'&&t.assigned_to!==selAssign)return false
    if(selAssign==='__none'&&t.assigned_to)return false
    if(selDept&&selDept!=='__none'&&t.department_id!==selDept)return false
    if(selDept==='__none'&&t.department_id)return false
    if(selStatus&&t.status!==selStatus)return false
    if(selPrio&&t.priority!==selPrio)return false
    if(selType&&t.task_type!==selType)return false
    if(search&&!t.task_name?.toLowerCase().includes(search.toLowerCase()))return false
    return true
  }),[tasks,selProj,selSprint,selModule,selAssign,selDept,selStatus,selPrio,selType,search])

  // Per-department status pipelines (STEP198) — `flows` holds every
  // department's flow (+ one for department_id=null, "Unassigned").
  // LEGACY_STEPS is the pre-STEP198 fallback (today's global 7-status
  // list) used only if a department genuinely has no flow row yet — e.g.
  // STEP198's migration hasn't been run — so status options are never
  // simply empty.
  const LEGACY_STEPS = useMemo(() => STATUSES.map(s=>({status_key:s,label:SL[s],color:SC[s],is_closed:s==='closed'})), [])
  const flowByDept = useMemo(() => {
    const m={}
    flows.forEach(f=>{
      // Defends against duplicate (flow_id, status_key) rows in the DB
      // (e.g. two migrations both seeding the same step) — without this,
      // every list using these steps as React keys (status dropdowns,
      // Kanban columns) throws a duplicate-key warning and can render
      // the same option twice.
      const seenKeys=new Set()
      m[f.department_id||'__none']=f.steps.filter(s=>seenKeys.has(s.status_key)?false:(seenKeys.add(s.status_key),true))
    })
    return m
  }, [flows])
  const stepsForDept = (deptId) => flowByDept[deptId||'__none'] || LEGACY_STEPS
  const stepsForTask = (task) => stepsForDept(task?.department_id)
  // "Done" per a task's OWN department flow (its is_closed step(s)) —
  // replaces every hardcoded `status==='closed'` completion check, which
  // only ever matched the legacy list and silently read as 0% complete
  // for any task on a custom flow (Application/Firmware/Hardware all use
  // 'done', not 'closed').
  const isTaskDone = (task) => !!stepsForTask(task).find(s=>s.status_key===task.status)?.is_closed

  // Weighted completion % for a task — prefers a manually-entered
  // project_tasks.progress_pct (set via a comment, TaskComments), else
  // falls back to that status step's configured progress_pct (Settings →
  // Task Status Flows, STEP203), else 100/0 by is_closed. Powers the
  // Reports tab's per-project weighted progress (as opposed to a flat
  // done/total ratio).
  const taskProgressPct = (task) => {
    if(task.progress_pct!=null) return task.progress_pct
    const step=stepsForTask(task).find(s=>s.status_key===task.status)
    if(step?.progress_pct!=null) return step.progress_pct
    return isTaskDone(task)?100:0
  }
  const weightedPct = (list) => list.length?Math.round(list.reduce((s,t)=>s+taskProgressPct(t),0)/list.length):0

  // Auto-assign to a Tech Lead the moment a task moves into Code Review —
  // picks a 'lead'-role user in the SAME department as the task (Tech
  // Leads review their own team's code); with more than one match, the
  // first alphabetically for determinism. Never overrides an existing
  // assignment to that same lead, and does nothing if the department has
  // no lead at all (status change still goes through either way).
  function autoAssignPatchForStatus(task,newStatus){
    if(newStatus!=='code_review')return{}
    const candidates=users.filter(u=>u.role==='lead'&&(u.department_id||null)===(task.department_id||null))
    const lead=[...candidates].sort((a,b)=>a.full_name.localeCompare(b.full_name))[0]
    if(!lead||lead.id===task.assigned_to)return{}
    return{assigned_to:lead.id}
  }
  // Cross-department "All Statuses" filter option list — every distinct
  // status_key across every department's flow, first label/color seen wins.
  const allStatusOptions = useMemo(() => {
    const seen = new Map()
    flows.forEach(f => f.steps.forEach(s => { if (!seen.has(s.status_key)) seen.set(s.status_key, s) }))
    if (seen.size === 0) LEGACY_STEPS.forEach(s => seen.set(s.status_key, s))
    return [...seen.values()]
  }, [flows, LEGACY_STEPS])

  // Kanban column configuration — reuses the same groupBy selector as the
  // List view (below), but a Kanban board always needs SOME column
  // dimension, so 'none' falls back to the original status-columns
  // behavior instead of rendering no columns at all.
  // People / Week planner layouts are always person × status/day, so they
  // always use status columns regardless of the Columns selector.
  const layoutUsesGroupBy = boardLayout==='sections'||boardLayout==='kanban'
  const kanbanGroupBy = (groupBy==='none'||!layoutUsesGroupBy) ? 'status' : groupBy

  const kanbanField = KANBAN_GROUP_FIELD[kanbanGroupBy] || 'status'
  const kanbanColumns = useMemo(() => {
    // Status columns are department-specific (STEP198) — each department
    // has its own pipeline. An explicit Department filter both narrows
    // the task list AND switches the columns to that one department's
    // flow. With NO Department filter, the visible tasks can span many
    // departments at once (a lead/manager's board, "All Departments") —
    // using only the viewer's own department here used to silently drop
    // any task whose status_key wasn't one of that single department's
    // steps. But a naive union of every department's distinct status_key
    // (allStatusOptions) instead produces a WORSE symptom: most orgs name
    // their steps the same thing ("Todo", "In Progress", "Done"...) across
    // departments, so every department added a visually-duplicate column
    // for the same-looking status. Fix: merge steps that share the same
    // LABEL (case/whitespace-insensitive) into ONE column, remembering
    // every underlying status_key it stands for (`keys`) so no task is
    // dropped — tasksForKanbanColumn and KanbanCard both check `keys`
    // first, falling back to a plain `key` match for every other groupBy.
    if (kanbanGroupBy==='status') {
      if (selDept) return stepsForDept(selDept==='__none'?null:selDept).map(s=>({key:s.status_key,label:s.label,color:s.color,closed:!!s.is_closed}))
      const deptIds=new Set(projTasks.map(t=>t.department_id||null))
      const merged=new Map() // normalized label -> {key,label,color,keys:[]}
      // A raw status_key can only ever belong to ONE column. Two
      // departments reusing the same status_key (e.g. both seeded with
      // 'release_candidate') but with labels that no longer match
      // exactly (one was renamed in Settings) used to fall through the
      // label-based merge above and open a SECOND column carrying that
      // same status_key — two sibling columns with the same `keys`
      // content, so `col.keys.join('_')` collided as a React key. Once a
      // status_key is claimed by a column, later sightings of it are
      // folded into that same column instead of ever starting a new one.
      const claimed=new Set()
      deptIds.forEach(id=>{
        stepsForDept(id).forEach(s=>{
          if(claimed.has(s.status_key))return
          claimed.add(s.status_key)
          const norm=(s.label||s.status_key).trim().toLowerCase()
          if(!merged.has(norm)) merged.set(norm,{key:s.status_key,label:s.label,color:s.color,keys:[s.status_key],closed:!!s.is_closed})
          else merged.get(norm).keys.push(s.status_key)
        })
      })
      return [...merged.values()]
    }
    if (kanbanGroupBy==='priority') return PRIOS.map(p=>({key:p,label:p.charAt(0).toUpperCase()+p.slice(1),color:PC[p]}))
    if (kanbanGroupBy==='assignee') {
      const ids=new Set(projTasks.map(t=>t.assigned_to||'__unassigned'))
      const cols=[...ids].filter(id=>id!=='__unassigned').map(id=>{
        const u=users.find(u=>u.id===id); return {key:id,label:u?.full_name||'Unknown',color:colorForKanbanKey(id)}
      }).sort((a,b)=>a.label.localeCompare(b.label))
      if(ids.has('__unassigned')) cols.push({key:'__unassigned',label:'Unassigned',color:'#94a3b8'})
      return cols
    }
    if (kanbanGroupBy==='department') {
      const ids=new Set(projTasks.map(t=>t.department_id||'__none'))
      const cols=[...ids].filter(id=>id!=='__none').map(id=>{
        const d=departments.find(d=>d.id===id); return {key:id,label:d?.name||'Unknown',color:colorForKanbanKey(id)}
      }).sort((a,b)=>a.label.localeCompare(b.label))
      if(ids.has('__none')) cols.push({key:'__none',label:'No Department',color:'#94a3b8'})
      return cols
    }
    if (kanbanGroupBy==='module') {
      const keys=new Set(projTasks.map(t=>t.module_name||'__none'))
      const cols=[...keys].filter(k=>k!=='__none').sort().map(k=>({key:k,label:k,color:colorForKanbanKey(k)}))
      if(keys.has('__none')) cols.push({key:'__none',label:'No Module',color:'#94a3b8'})
      return cols
    }
    if (kanbanGroupBy==='sprint') {
      const inScope=sprints.filter(s=>!selProj||s.project_id===selProj)
      const cols=inScope.map(s=>({key:s.id,label:s.name,color:colorForKanbanKey(s.id)}))
      if(projTasks.some(t=>!t.sprint_id)) cols.push({key:'__none',label:'No Sprint',color:'#94a3b8'})
      return cols
    }
    return STATUSES.map(s=>({key:s,label:SL[s],color:SC[s]}))
  }, [kanbanGroupBy,projTasks,users,departments,sprints,selProj,selDept,allStatusOptions,flows])

  function tasksForKanbanColumn(col) {
    return projTasks.filter(t=>{
      const v=t[kanbanField]
      if(col.keys) return col.keys.includes(v)
      return (col.key==='__unassigned'||col.key==='__none') ? !v : v===col.key
    })
  }

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
    closed:projTasks.filter(t=>t.status==='closed').length,overdue:projTasks.filter(t=>isOverdue(t,stepsForTask(t))).length,
    estHrs:projTasks.reduce((s,t)=>s+(t.estimated_hours||0),0),actHrs:projTasks.reduce((s,t)=>s+(t.actual_hours||0),0),
    crCount:projTasks.filter(t=>t.task_type==='change_request').length,
    crHrs:projTasks.filter(t=>t.task_type==='change_request').reduce((s,t)=>s+(t.actual_hours||0),0),
    bugs:projTasks.filter(t=>t.task_type==='bug').length,
  }),[projTasks,flows])

  const selProjData=projects.find(p=>p.id===selProj)
  if(loading)return <Loader/>

  const FilterBar=()=>(
    <div className="tb-filters">
      <Filter size={14} style={{color:'#94a3b8',flexShrink:0}}/>
      <select className={`form-select ${selProj?'active':''}`} value={selProj} onChange={e=>{setSelProj(e.target.value);setSelSprint('')}} style={{width:'auto',fontSize:12}}>
        <option value="">All Projects</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {sprints.filter(s=>!selProj||s.project_id===selProj).length>0&&
        <select className={`form-select ${selSprint?'active':''}`} value={selSprint} onChange={e=>setSelSprint(e.target.value)} style={{width:'auto',fontSize:12}}>
          <option value="">All Sprints</option>{sprints.filter(s=>!selProj||s.project_id===selProj).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>}
      {modules.length>0&&<select className={`form-select ${selModule?'active':''}`} value={selModule} onChange={e=>setSelModule(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Modules</option>{modules.map(m=><option key={m} value={m}>{m}</option>)}
      </select>}
      <select className={`form-select ${selAssign?'active':''}`} value={selAssign} onChange={e=>setSelAssign(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Assignees</option>
        <option value="__none">Unassigned</option>
        {users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
      {departments.length>0&&<select className={`form-select ${selDept?'active':''}`} value={selDept} onChange={e=>{setSelDept(e.target.value);setSelStatus('')}} style={{width:'auto',fontSize:12}}>
        <option value="">All Departments</option>
        <option value="__none">Unassigned</option>
        {departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
      </select>}
      <select className={`form-select ${selStatus?'active':''}`} value={selStatus} onChange={e=>setSelStatus(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Statuses</option>
        {(selDept ? stepsForDept(selDept==='__none'?null:selDept) : allStatusOptions).map(s=><option key={s.status_key} value={s.status_key}>{s.label}</option>)}
      </select>
      <select className={`form-select ${selPrio?'active':''}`} value={selPrio} onChange={e=>setSelPrio(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Priorities</option>{PRIOS.map(p=><option key={p} value={p}>{PI[p]} {p}</option>)}
      </select>
      <select className={`form-select ${selType?'active':''}`} value={selType} onChange={e=>setSelType(e.target.value)} style={{width:'auto',fontSize:12}}>
        <option value="">All Types</option>{TASK_TYPES.map(t=><option key={t} value={t}>{TYPE_ICO[t]} {t.replace(/_/g,' ')}</option>)}
      </select>
      <div style={{flex:1,minWidth:120}}><SearchBox value={search} onChange={setSearch} placeholder="Search tasks…"/></div>
      {(view==='list'||(view==='kanban'&&layoutUsesGroupBy))&&(
        <select className="form-select" value={groupBy} onChange={e=>setGroupBy(e.target.value)} style={{width:'auto',fontSize:12}} title={view==='kanban'?'Board columns':'Group rows by'}>
          <option value="none">{view==='kanban'?'Columns: Status (your department, default)':'No Grouping'}</option>
          {view==='list'&&<option value="status">Group by Status</option>}
          <option value="assignee">{view==='kanban'?'Columns: Developer':'Group by Assignee'}</option>
          <option value="department">{view==='kanban'?'Columns: Department':'Group by Department'}</option>
          <option value="module">{view==='kanban'?'Columns: Module':'Group by Module'}</option>
          <option value="priority">{view==='kanban'?'Columns: Priority':'Group by Priority'}</option>
          <option value="sprint">{view==='kanban'?'Columns: Sprint':'Group by Sprint'}</option>
        </select>
      )}
      {(selProj||selSprint||selModule||selAssign||selDept||selStatus||selPrio||selType||search)&&
        <button className="btn btn-ghost btn-sm" onClick={()=>{setSelProj('');setSelSprint('');setSelModule('');setSelAssign('');setSelDept('');setSelStatus('');setSelPrio('');setSelType('');setSearch('')}}><X size={11}/> Clear</button>}
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
          {myPerm.can_create&&<button className="btn btn-ghost btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setEditEpic(null);setEpicForm({project_id:selProj||projects[0]?.id,name:''});setShowEpic(true)}}><MapIcon size={13}/> Epic</button>}
          {myPerm.can_create&&<button className="btn btn-outline btn-sm" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setEditStory(null);setStoryForm({project_id:selProj||projects[0]?.id,priority:'medium',status:'open',story_points:0,story_type:'story'});setShowStory(true)}}><Target size={13}/> Story</button>}
          {myPerm.can_create&&<button className="btn btn-outline btn-sm" title="Bulk-import tasks from Excel/CSV" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setImportProj(selProj||projects[0]?.id||'');setShowImport(true)}}><Upload size={13}/> Import Tasks</button>}
          {(myPerm.can_create||myPerm.can_change_status)&&<button className="btn btn-outline btn-sm" style={{display:'flex',alignItems:'center',gap:5,background:'linear-gradient(135deg,#8b5cf611,#22d3ee11)',borderColor:'#8b5cf644'}} onClick={()=>setShowAiPanel(true)}><Sparkles size={13}/> AI Actions</button>}
          {myPerm.can_create&&<button className="btn btn-primary" style={{display:'flex',alignItems:'center',gap:5}} onClick={()=>{setEditTask(null);setTaskForm({project_id:selProj||'',priority:'medium',status:'backlog',task_type:'task'});setShowTask(true)}}><Plus size={14}/> New Task</button>}
        </div>
      </div>

      <div style={{display:'flex',gap:4,marginBottom:14,borderBottom:'1px solid var(--border)'}}>
        {VIEW_TABS.map(t=>{
          const active=view===t.key, Icon=t.icon
          return (
            <button key={t.key} type="button"
              onClick={()=>setSearchParams(prev=>{const n=new URLSearchParams(prev);n.set('view',t.key);return n})}
              style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',border:'none',borderBottom:active?'2px solid var(--c1)':'2px solid transparent',background:'none',cursor:'pointer',fontSize:13,fontWeight:active?700:600,color:active?'var(--c1)':'var(--text-muted)',marginBottom:-1,transition:'color .15s'}}>
              <Icon size={14}/> {t.label}
            </button>
          )
        })}
      </div>

      {FilterBar()}

          {/* KANBAN — one flat row of columns. When grouped by Status
              (the default), columns = the VIEWING employee's own
              department's flow (STEP198, whatever the admin configured
              for it) unless the Department filter above is explicitly
              set to something else. Every task shown buckets into these
              columns purely by its status value — a task's own
              department has no bearing on which column set is shown. */}
          {view==='kanban'&&(()=>{
            const shared={users,projects,commentCounts,stepsForTask,perm:myPerm,
              childCountOf:id=>tasks.filter(t=>t.parent_task_id===id).length,
              onView:openDetail,
              onEdit:task=>{setEditTask(task);setTaskForm({...task});setShowTask(true)},
              onDelete:task=>setDelTask(task.id),
              onShare:openShare,
              onStatus:(task,s)=>changeStatus(task.id,s)}
            const addFor=(extra)=>{setEditTask(null);setTaskForm({project_id:selProj||'',priority:'medium',task_type:'task',status:'backlog',department_id:profile?.department_id||null,...extra});setShowTask(true)}
            const addForCol=col=>addFor({[kanbanField]:col.key==='__unassigned'||col.key==='__none'?null:col.key})
            const plannerRange=(()=>{const d=plannerDays(plannerSpan,plannerOffset);return `${dateFmt(d[0])} – ${dateFmt(d[d.length-1])}`})()
            return (
              <div className="tb">
                <div className="tb-head">
                  <div className="tb-seg" role="tablist" aria-label="Board layout">
                    {BOARD_LAYOUTS.map(l=>{const Icon=l.icon;return(
                      <button key={l.key} type="button" role="tab" aria-selected={boardLayout===l.key} className={boardLayout===l.key?'on':''} onClick={()=>setBoardLayout(l.key)} title={l.hint}>
                        <Icon size={14}/> {l.label}
                      </button>
                    )})}
                  </div>
                  <span className="tb-meta"><b>{projTasks.length}</b> task{projTasks.length===1?'':'s'}</span>
                  <span className="tb-spacer"/>
                  {boardLayout==='people'&&<>
                    <label className="tb-check"><input type="checkbox" checked={boardShowClosed} onChange={e=>setBoardShowClosed(e.target.checked)}/> Show closed</label>
                    <label className="tb-check"><input type="checkbox" checked={boardEveryone} onChange={e=>setBoardEveryone(e.target.checked)}/> Include people with no tasks</label>
                  </>}
                  {boardLayout==='planner'&&<>
                    <button type="button" className={`tb-toggle ${plannerBacklog?'on':''}`} onClick={()=>setPlannerBacklog(v=>!v)} aria-pressed={plannerBacklog}><Layers size={14}/> Backlog</button>
                    <label className="tb-check"><input type="checkbox" checked={boardEveryone} onChange={e=>setBoardEveryone(e.target.checked)}/> Include people with no tasks</label>
                    <select className="form-select tb-mini-select" value={plannerSpan} onChange={e=>setPlannerSpan(Number(e.target.value))} aria-label="Weeks shown">
                      <option value={5}>1 week</option><option value={10}>2 weeks</option><option value={15}>3 weeks</option>
                    </select>
                    <div className="tb-seg">
                      <button type="button" title="Previous week" onClick={()=>setPlannerOffset(o=>o-1)}><ChevronRight size={14} style={{transform:'rotate(180deg)'}}/></button>
                      <button type="button" className={plannerOffset===0?'on':''} onClick={()=>setPlannerOffset(0)}>This week</button>
                      <button type="button" title="Next week" onClick={()=>setPlannerOffset(o=>o+1)}><ChevronRight size={14}/></button>
                    </div>
                    <span className="tb-meta" style={{minWidth:170,textAlign:'right'}}><b>{plannerRange}</b></span>
                  </>}
                </div>
                {boardLayout==='sections'&&(
                  <StatusSections {...shared} columns={kanbanColumns} groupBy={kanbanGroupBy} tasksFor={tasksForKanbanColumn}
                    onDrop={(e,col)=>dropOnKanbanColumn(e,kanbanField,col)} onAdd={addForCol}/>
                )}
                {boardLayout==='kanban'&&(
                  <KanbanColumns {...shared} columns={kanbanColumns} groupBy={kanbanGroupBy} tasksFor={tasksForKanbanColumn}
                    onDrop={(e,col)=>dropOnKanbanColumn(e,kanbanField,col)} onAdd={addForCol}/>
                )}
                {boardLayout==='people'&&(
                  <PeopleBoard {...shared} columns={kanbanColumns} tasks={projTasks} showClosed={boardShowClosed} everyone={boardEveryone}
                    onDrop={dropOnPeopleCell}
                    onAdd={(col,personKey)=>addFor({status:col.key,assigned_to:personKey==='__unassigned'?null:personKey})}/>
                )}
                {boardLayout==='planner'&&(
                  <WeekPlanner {...shared} tasks={projTasks} span={plannerSpan} offset={plannerOffset} everyone={boardEveryone} showBacklog={plannerBacklog}
                    onReschedule={rescheduleTask}
                    onQuickCreate={quickCreateTask}
                    onOpenFullForm={(personKey,day,title)=>addFor({task_name:title||'',assigned_to:personKey==='__unassigned'?null:personKey,planned_start_date:day,planned_end_date:day})}/>
                )}
              </div>
            )
          })()}

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
        const TaskRow=({t})=>{const proj=projects.find(p=>p.id===t.project_id),rowSteps=stepsForTask(t),rowStep=rowSteps.find(s=>s.status_key===t.status),over=isOverdue(t,rowSteps);return(
          <tr key={t.id} onClick={()=>openDetail(t)} style={{background:over?'rgba(225,29,72,.03)':'transparent',cursor:'pointer'}}>
            <td><span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--c1)',fontWeight:700}}>{t.task_id||'—'}</span></td>
            <td><TypeBadge type={t.task_type||'task'}/></td>
            <td><div style={{fontWeight:600,fontSize:13,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.task_name}</div>{over&&<div style={{fontSize:10,color:'var(--rose)'}}>⚠ Overdue</div>}</td>
            <td><span style={{fontSize:11,color:'var(--text-muted)'}}>{t.module_name||'—'}</span></td>
            <td><span style={{fontSize:11,color:'var(--text-muted)'}}>{proj?.name||'—'}</span></td>
            <td>{t.assignee?<div style={{display:'flex',alignItems:'center',gap:5}}><Ava name={t.assignee.full_name} size={20}/><span style={{fontSize:11}}>{t.assignee.full_name.split(' ')[0]}</span></div>:<span style={{color:'var(--text-muted)',fontSize:11}}>—</span>}</td>
            <td><PriorityBadge priority={t.priority}/></td>
            <td onClick={e=>e.stopPropagation()}>{myPerm.can_change_status
              ?<select style={{background:`${rowStep?.color||'#94a3b8'}12`,color:rowStep?.color||'#94a3b8',border:`1px solid ${rowStep?.color||'#94a3b8'}30`,borderRadius:5,padding:'3px 8px',fontSize:11,fontWeight:700,cursor:'pointer',outline:'none',fontFamily:'inherit'}} value={t.status} onChange={e=>changeStatus(t.id,e.target.value)}>
                  {!rowStep&&t.status&&<option value={t.status}>{t.status}</option>}
                  {rowSteps.map(s=><option key={s.status_key} value={s.status_key}>{s.label}</option>)}
                </select>
              :<Pill label={rowStep?.label||t.status} color={rowStep?.color||'#94a3b8'}/>}
            </td>
            <td><span style={{fontSize:11,color:over?'var(--rose)':'var(--text-muted)',fontFamily:'var(--font-mono)'}}>{dateFmt(t.planned_end_date)||'—'}</span></td>
            <td><span style={{fontFamily:'var(--font-mono)',fontSize:11}}>{t.estimated_hours||'—'}</span></td>
            <td><span style={{fontFamily:'var(--font-mono)',fontSize:11,color:t.actual_hours>t.estimated_hours?'var(--rose)':'var(--text)'}}>{t.actual_hours||'—'}</span></td>
            <td onClick={e=>e.stopPropagation()}><div style={{display:'flex',gap:4}}>
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
          if(groupBy==='department')return t.department_id||'__no_department'
          if(groupBy==='module')return t.module_name||'__no_module'
          if(groupBy==='priority')return t.priority||'medium'
          if(groupBy==='sprint')return t.sprint_id||'__no_sprint'
          return 'all'
        }
        const groupLabel=k=>{
          if(groupBy==='status')return allStatusOptions.find(s=>s.status_key===k)?.label||k
          if(groupBy==='assignee'){if(k==='__unassigned')return'Unassigned';const u=users.find(u=>u.id===k);return u?.full_name||k}
          if(groupBy==='department'){if(k==='__no_department')return'No Department';const d=departments.find(d=>d.id===k);return d?.name||k}
          if(groupBy==='module')return k==='__no_module'?'No Module':k
          if(groupBy==='priority')return k.charAt(0).toUpperCase()+k.slice(1)
          if(groupBy==='sprint'){if(k==='__no_sprint')return'No Sprint';const s=sprints.find(s=>s.id===k);return s?.name||k}
          return k
        }
        const groupColor=k=>{
          if(groupBy==='status')return allStatusOptions.find(s=>s.status_key===k)?.color||'var(--c1)'
          if(groupBy==='priority')return PC[k]
          return 'var(--c1)'
        }
        const groupOrder=groupBy==='status'?allStatusOptions.map(s=>s.status_key):groupBy==='priority'?PRIOS:null
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
        <StoriesTree epics={projEpics} stories={projStories} tasks={tasks} myPerm={myPerm} stepsForDept={stepsForDept}
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
            :[...sprints.filter(s=>!selProj||s.project_id===selProj)]
              .sort((a,b)=>{const order={active:0,planning:1,completed:2};return (order[a.status]??3)-(order[b.status]??3)||a.name.localeCompare(b.name)})
              .map(s=>(
                <SprintCard key={s.id} sprint={s}
                  tasks={tasks.filter(t=>t.sprint_id===s.id)}
                  stories={stories.filter(st=>st.sprint_id===s.id)}
                  projectName={!selProj?projects.find(p=>p.id===s.project_id)?.name:null}
                  isMgr={isMgr} stepsForDept={stepsForDept}
                  onStart={async()=>{await supabase.from('sprints').update({status:'active'}).eq('id',s.id);loadAll()}}
                  onComplete={async()=>{await supabase.from('sprints').update({status:'completed'}).eq('id',s.id);loadAll()}}
                  onEdit={()=>{setEditSprint(s);setSprintForm({...s});setShowSprint(true)}}/>
              ))
          }
        </div>
      )}

      {/* REPORTS */}
      {view==='reports'&&(()=>{
        const reportTasks=projTasks
        const reportProjects=projects.filter(p=>!selProj||p.id===selProj)
        const total=reportTasks.length
        const closed=reportTasks.filter(t=>isTaskDone(t)).length
        const completion=total>0?Math.round((closed/total)*100):0
        const estHrsAll=reportTasks.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0)
        const actHrsAll=reportTasks.reduce((s,t)=>s+(Number(t.actual_hours)||0),0)
        const onTimeClosed=reportTasks.filter(t=>isTaskDone(t)&&(!t.planned_end_date||!t.actual_end_date||new Date(t.actual_end_date)<=new Date(t.planned_end_date))).length
        const onTimeRate=closed>0?Math.round((onTimeClosed/closed)*100):0
        const overdueCount=reportTasks.filter(t=>isOverdue(t,stepsForTask(t))).length
        const activeProjects=reportProjects.filter(p=>reportTasks.some(t=>t.project_id===p.id)).length
        const deptProgress=departments.map(d=>{
          const dt=reportTasks.filter(t=>t.department_id===d.id)
          const done=dt.filter(t=>isTaskDone(t)).length
          return {dept:d,total:dt.length,done,pct:dt.length>0?Math.round((done/dt.length)*100):0,tasks:dt}
        }).filter(d=>d.total>0)
        const noDeptTasks=reportTasks.filter(t=>!t.department_id)
        if(noDeptTasks.length>0){
          const done=noDeptTasks.filter(t=>isTaskDone(t)).length
          deptProgress.push({dept:{id:'__none',name:'Unassigned'},total:noDeptTasks.length,done,pct:Math.round((done/noDeptTasks.length)*100),tasks:noDeptTasks})
        }

        const statusData=[...new Set(reportTasks.map(t=>t.status).filter(Boolean))].map(s=>{
          const def=allStatusOptions.find(o=>o.status_key===s)
          return {key:s,name:def?.label||s,value:reportTasks.filter(t=>t.status===s).length,color:def?.color||'#94a3b8'}
        }).filter(d=>d.value>0)
        const priorityData=PRIOS.map(p=>({name:p,value:reportTasks.filter(t=>t.priority===p).length,color:PC[p]}))
        const typeData=TASK_TYPES.map(t=>({key:t,name:t.replace(/_/g,' '),value:reportTasks.filter(x=>(x.task_type||'task')===t).length,color:TYPE_CLR[t]})).filter(d=>d.value>0)
        const weightedProgress=weightedPct(reportTasks)
        const singleProject=reportProjects.length===1?reportProjects[0]:null

        // Every active filter, in plain English — dropped into its own
        // sheet in the Excel export so the file is self-documenting about
        // exactly what slice of tasks it captures.
        const filterLabels=[
          selProj&&`Project: ${projects.find(p=>p.id===selProj)?.name||selProj}`,
          selSprint&&`Sprint: ${sprints.find(s=>s.id===selSprint)?.name||selSprint}`,
          selModule&&`Module: ${selModule}`,
          selAssign&&`Assignee: ${selAssign==='__none'?'Unassigned':(users.find(u=>u.id===selAssign)?.full_name||selAssign)}`,
          selDept&&`Department: ${selDept==='__none'?'Unassigned':(departments.find(d=>d.id===selDept)?.name||selDept)}`,
          selStatus&&`Status: ${allStatusOptions.find(s=>s.status_key===selStatus)?.label||selStatus}`,
          selPrio&&`Priority: ${selPrio}`,
          selType&&`Type: ${selType.replace(/_/g,' ')}`,
          search&&`Search: "${search}"`,
        ].filter(Boolean)

        async function handleExportExcel(){
          setExportingReport(true)
          try{
            await exportTaskReportExcel({
              tasks:reportTasks, projects:reportProjects.length?reportProjects:projects, departments,
              stepsForDept, isTaskDone, isOverdue,
              summary:[
                {Metric:'Total Tasks',Value:total},
                {Metric:'Closed',Value:closed},
                {Metric:'Completion Rate %',Value:completion},
                {Metric:'On-Time Delivery %',Value:onTimeRate},
                {Metric:'Overdue',Value:overdueCount},
                {Metric:'Hours Logged',Value:actHrsAll},
                {Metric:'Hours Estimated',Value:estHrsAll},
                {Metric:'Weighted Progress %',Value:weightedProgress},
                {Metric:'Active Projects',Value:activeProjects},
                {Metric:'Projects in Scope',Value:reportProjects.length},
              ],
              filterLabels:filterLabels.length?filterLabels:['No filters — all tasks in scope'],
            })
          }catch(e){ alert(e.message) } finally{ setExportingReport(false) }
        }

        return (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div style={{display:'flex',justifyContent:'flex-end'}}>
            <button className="btn btn-outline btn-sm" disabled={exportingReport||total===0} onClick={handleExportExcel}>
              <Download size={13}/> {exportingReport?'Exporting…':'Export to Excel'}
            </button>
          </div>
          {/* PROJECT SUMMARY — goal + weighted status progress, shown once a single project is selected via the filter bar */}
          {singleProject&&
          <ChartCard title={`🎯 ${singleProject.name}`} sub={singleProject.goal?'Project goal':'No goal set for this project yet'}>
            <div style={{display:'flex',gap:20,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:220}}>
                {singleProject.goal
                  ? <div style={{fontSize:13,color:'var(--text-soft)',lineHeight:1.6}}>{singleProject.goal}</div>
                  : <div style={{fontSize:12,color:'#94a3b8',fontStyle:'italic'}}>Add one from Projects → Edit Project.</div>}
              </div>
              <div style={{width:180,flexShrink:0}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                  <span style={{fontSize:10,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.05em'}}>Weighted Progress</span>
                  <span style={{fontSize:13,fontWeight:800,fontFamily:'ui-monospace,monospace',color:weightedProgress>=100?'#10b981':'#6366f1'}}>{weightedProgress}%</span>
                </div>
                <div style={{height:8,borderRadius:5,background:'#f1f5f9',overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${weightedProgress}%`,background:weightedProgress>=100?'#10b981':'#6366f1',borderRadius:5,transition:'width .3s'}}/>
                </div>
                <div style={{fontSize:10,color:'#94a3b8',marginTop:5}}>Based on each task's status (Settings → Task Status Flows)</div>
              </div>
            </div>
          </ChartCard>}

          {/* HERO STATS */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12}}>
            <ReportHero icon={<Target size={15}/>} label="Completion Rate" value={`${completion}%`} color="#10b981" sub={`${closed} of ${total} tasks closed`}/>
            <ReportHero icon={<TrendingUp size={15}/>} label="On-Time Delivery" value={`${onTimeRate}%`} color="#3b82f6" sub={`${onTimeClosed} of ${closed} on schedule`}/>
            <ReportHero icon={<AlertTriangle size={15}/>} label="Overdue" value={overdueCount} color="#e11d48" sub="Past planned end date"/>
            <ReportHero icon={<Clock size={15}/>} label="Hours Logged" value={`${actHrsAll}h`} color="#8b5cf6" sub={`of ${estHrsAll}h estimated`}/>
            <ReportHero icon={<BarChart2 size={15}/>} label="Active Projects" value={activeProjects} color="#f59e0b" sub={`${reportProjects.length} total`}/>
          </div>

          {/* CHARTS */}
          <div style={{display:'grid',gridTemplateColumns:'minmax(280px,1.1fr) minmax(260px,1fr)',gap:16}}>
            <ChartCard title="Status Distribution" sub={selProj?`${total} tasks in this project`:`${total} tasks across all active projects`}>
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

          {/* DEPARTMENT PROGRESS — manager's cross-department overview,
              by each department's OWN status flow (STEP198). Completion %
              uses that department's is_closed step(s); the strip below
              each bar shows the live distribution across its own steps,
              so "60% done" and "where the other 40% actually sit" are
              both visible without opening every department's board. */}
          {deptProgress.length>0&&
          <ChartCard title="🏢 Department Progress" sub={`${deptProgress.length} department${deptProgress.length!==1?'s':''} with active tasks`}>
            {[...deptProgress].sort((a,b)=>b.pct-a.pct).map(({dept,total:dTotal,done,pct,tasks:dTasks})=>{
              const dSteps=stepsForDept(dept.id==='__none'?null:dept.id)
              const segs=dSteps.map(s=>({key:s.status_key,label:s.label,color:s.color,value:dTasks.filter(t=>t.status===s.status_key).length}))
              const pclr=pct===100?'#10b981':pct>60?'#6366f1':pct>0?'#f59e0b':'#cbd5e1'
              return (
                <div key={dept.id||'__none'} style={{padding:'11px 0',borderBottom:'1px solid #f1f5f9'}}>
                  <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:8}}>
                    <span style={{width:150,fontWeight:600,fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flexShrink:0}}>{dept.name}</span>
                    <span style={{width:70,fontFamily:'ui-monospace,monospace',fontSize:11,color:'#94a3b8',flexShrink:0}}>{done}/{dTotal}</span>
                    <div style={{flex:1,height:7,borderRadius:4,background:'#f1f5f9',overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:pclr,borderRadius:4,transition:'width .3s'}}/></div>
                    <span style={{width:40,fontFamily:'ui-monospace,monospace',fontWeight:700,fontSize:12.5,textAlign:'right',color:pclr,flexShrink:0}}>{pct}%</span>
                  </div>
                  <SegmentedBar segments={segs} total={dTotal}/>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:6}}>
                    {segs.filter(s=>s.value>0).map(s=>(
                      <span key={s.key} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10.5,color:'#64748b'}}>
                        <span style={{width:7,height:7,borderRadius:'50%',background:s.color}}/>{s.label}: {s.value}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </ChartCard>}

          {/* PROJECT PROGRESS — weighted % from each task's status (Settings → Task Status Flows), not a flat done/total ratio */}
          <ChartCard title="📊 Project Progress" sub={`${activeProjects} of ${reportProjects.length} project${reportProjects.length!==1?'s':''} have activity`}>
            {reportProjects.length===0?<div style={{padding:'20px 0',color:'#94a3b8',fontSize:12,textAlign:'center'}}>No projects</div>
              :[...reportProjects].sort((a,b)=>{
                  const pa=reportTasks.filter(t=>t.project_id===a.id),pb=reportTasks.filter(t=>t.project_id===b.id)
                  return weightedPct(pb)-weightedPct(pa)
                }).map(p=>{const pt=reportTasks.filter(t=>t.project_id===p.id),done=pt.filter(t=>isTaskDone(t)).length,pct=weightedPct(pt),pclr=pct===100?'#10b981':pct>60?'#6366f1':pct>0?'#f59e0b':'#cbd5e1'
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
              const rows=users.filter(u=>reportTasks.some(t=>t.assigned_to===u.id)).map(u=>{
                const ut=reportTasks.filter(t=>t.assigned_to===u.id)
                return {u,total:ut.length,closed:ut.filter(t=>isTaskDone(t)).length,cr:ut.filter(t=>t.task_type==='change_request').length,
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
            const crByProj=reportProjects.map(p=>{
              const crTasks=reportTasks.filter(t=>t.project_id===p.id&&t.task_type==='change_request')
              return {p,crTasks,hrs:crTasks.reduce((s,t)=>s+(Number(t.actual_hours)||0),0),closed:crTasks.filter(t=>isTaskDone(t)).length}
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

      {/* Task Detail — container depends on Settings → Task Detail View
          (STEP227): "modal" (default, centered) or "drawer" (Template 1,
          slides in from the right). Same TaskDetail content either way. */}
      {(() => {
        const DetailContainer = detailViewStyle === 'drawer' ? TaskDetailDrawer : Modal
        return (
          <DetailContainer open={!!detailTask} onClose={()=>setDetailTask(null)}
            title={detailTask?.task_id||'Task Detail'} size="lg"
            footer={<>
              {detailTask&&<button className="btn btn-outline btn-sm" onClick={()=>openShare(detailTask)}><Share2 size={12}/> Share</button>}
              {isMgr&&detailTask&&<button className="btn btn-outline btn-sm" onClick={()=>{setTemplateSource(detailTask);setTemplateName(detailTask.task_name||'')}}><ClipboardList size={12}/> Save as Template</button>}
              {myPerm.can_edit&&detailTask&&<button className="btn btn-outline btn-sm" onClick={()=>{setEditTask(detailTask);setTaskForm({...detailTask});setDetailTask(null);setShowTask(true)}}><Edit2 size={12}/> Edit</button>}
              <button className="btn btn-ghost" onClick={()=>setDetailTask(null)}>Close</button>
            </>}>
            <TaskDetail task={detailTask} projects={projects} users={users} stories={stories}
              sprints={sprints} changReqs={changReqs} departments={departments} stepsForDept={stepsForDept}
              canChangeStatus={myPerm.can_change_status}
              onStatusChange={s=>changeStatus(detailTask.id,s)}
              profile={profile}
              onProgressUpdate={(id,pct)=>{setTasks(p=>p.map(t=>t.id===id?{...t,progress_pct:pct}:t));setDetailTask(d=>d?.id===id?{...d,progress_pct:pct}:d)}}
              onCommentPosted={id=>setCommentCounts(c=>({...c,[id]:(c[id]||0)+1}))}
              canEditChecklist={myPerm.can_edit}
              onChecklistUpdate={(id,checklist)=>{setTasks(p=>p.map(t=>t.id===id?{...t,checklist}:t));setDetailTask(d=>d?.id===id?{...d,checklist}:d)}}
              tasks={tasks}
              onOpenTask={t=>setDetailTask(t)}
              onAddSubtask={parent=>{setEditTask(null);setTaskForm({project_id:parent.project_id||'',department_id:parent.department_id||null,priority:parent.priority||'medium',status:parent.department_id?stepsForDept(parent.department_id)[0]?.status_key:'backlog',task_type:'task',parent_task_id:parent.id});setDetailTask(null);setShowTask(true)}}/>
          </DetailContainer>
        )
      })()}

      {/* Save as Template Modal */}
      <Modal open={!!templateSource} onClose={()=>{setTemplateSource(null);setTemplateName('')}} title="Save as Template" size="sm"
        footer={<>
          <button className="btn btn-ghost" onClick={()=>{setTemplateSource(null);setTemplateName('')}}>Cancel</button>
          <button className="btn btn-primary" disabled={!templateName.trim()||savingTemplate} onClick={saveAsTemplate}>{savingTemplate?'Saving…':'Save Template'}</button>
        </>}>
        {templateSource&&<div style={{display:'grid',gap:14}}>
          <div className="form-group">
            <label className="form-label">Template name</label>
            <input className="form-input" value={templateName} onChange={e=>setTemplateName(e.target.value)} autoFocus/>
          </div>
          <div style={{fontSize:12,color:'var(--text-muted)'}}>
            Copies this task's type ({templateSource.task_type||'task'}), estimated hours
            {templateSource.estimated_hours?` (${templateSource.estimated_hours}h)`:''} and
            {' '}{(templateSource.checklist||[]).length} checklist item{(templateSource.checklist||[]).length===1?'':'s'} into a new reusable
            template (Settings → Task Templates). Checklist item values are not copied — only the item definitions and their required/optional setting.
          </div>
        </div>}
      </Modal>

      {/* Share Task Modal */}
      <Modal open={!!shareTarget} onClose={()=>setShareTarget(null)} title={`Share ${shareTarget?.task_id||'Task'}`} size="sm"
        footer={<><button className="btn btn-ghost" onClick={()=>setShareTarget(null)}>Close</button><button className="btn btn-primary" disabled={!shareUserId||shareSent} onClick={sendShare}>{shareSent?'Sent!':'Notify'}</button></>}>
        {shareTarget&&<div style={{display:'grid',gap:14}}>
          <div style={{fontSize:13,fontWeight:600}}>{shareTarget.task_name}</div>
          <div className="form-group">
            <label className="form-label">Shareable link</label>
            <div style={{display:'flex',gap:8}}>
              <input className="form-input" readOnly value={taskLinkFor(shareTarget)} style={{flex:1,fontFamily:'var(--font-mono)',fontSize:11}} onFocus={e=>e.target.select()}/>
              <button type="button" className="btn btn-outline btn-sm" onClick={copyShareLink}><Copy size={12}/> {linkCopied?'Copied!':'Copy'}</button>
            </div>
            <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Opens this task directly for any teammate signed in to the app</div>
          </div>
          <div className="form-group">
            <label className="form-label">Notify a teammate</label>
            <select className="form-select" value={shareUserId} onChange={e=>setShareUserId(e.target.value)}>
              <option value="">Choose a person…</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Note (optional)</label>
            <textarea className="form-textarea" value={shareNote} onChange={e=>setShareNote(e.target.value)} placeholder="e.g. Can you take a look at this?" rows={2}/>
          </div>
        </div>}
      </Modal>

      <Modal open={showTask} onClose={()=>{setShowTask(false);setEditTask(null)}} title={editTask?`Edit ${editTask.task_id||'Task'}`:'New Task'} size="lg"
        footer={<><button className="btn btn-ghost" onClick={()=>{setShowTask(false);setEditTask(null)}}>Cancel</button><button className="btn btn-primary" onClick={saveTask} disabled={subTask}>{subTask?'Saving…':'Save Task'}</button></>}>
        <TaskForm form={taskForm} setForm={setTaskForm} projects={projects} users={users} departments={departments} workItems={workItems} tasks={tasks} isMgr={isMgr} role={role} orgId={profile?.organization_id} stepsForDept={stepsForDept}
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

      <Modal open={showEpic} onClose={()=>setShowEpic(false)} title={editEpic?'Edit Epic':'New Epic'} size="md"
        footer={<><button className="btn btn-ghost" onClick={()=>setShowEpic(false)}>Cancel</button><button className="btn btn-primary" onClick={saveEpic}>Save</button></>}>
        <div style={{display:'grid',gap:12}}>
          <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={epicForm.name||''} onChange={e=>setEpicForm(f=>({...f,name:e.target.value}))} required/></div>
          <div className="form-group"><label className="form-label">Project</label><select className="form-select" value={epicForm.project_id||''} onChange={e=>setEpicForm(f=>({...f,project_id:e.target.value}))}><option value="">Select…</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
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

      <AIDockedPanel open={showAiPanel} onClose={()=>setShowAiPanel(false)} title="Task Actions" subtitle="Create or update tasks by prompt">
        <TaskActionsTab profile={profile} onSaved={loadAll} />
      </AIDockedPanel>

      <Confirm open={!!delTask} message="Delete this task?" danger onConfirm={async()=>{await supabase.from('project_tasks').delete().eq('id',delTask);setDelTask(null);loadAll()}} onCancel={()=>setDelTask(null)}/>
      <Confirm open={!!delStory} message="Delete this story? Tasks remain." danger onConfirm={async()=>{await supabase.from('user_stories').delete().eq('id',delStory);setDelStory(null);loadAll()}} onCancel={()=>setDelStory(null)}/>
    </div>
  )
}

function KanbanCard({task,users,canEdit,canDelete,canChangeStatus,onView,onEdit,onDelete,onShare,onStatus,commentCount=0,steps=[],taskSteps,childCount=0}) {
  const [dragging,setDragging]=useState(false)
  const [hover,setHover]=useState(false)
  // `steps` (below) may be the current Kanban grouping's columns, which
  // don't carry `is_closed` when grouped by anything but Status — use the
  // task's OWN real department flow (always has is_closed) for overdue.
  const assignee=users.find(u=>u.id===task.assigned_to),over=isOverdue(task,taskSteps)
  const pct=task.progress_pct
  // `steps` comes in two shapes depending on the Kanban's grouping mode:
  // real flow steps ({status_key,label,color,is_closed}, from
  // stepsForTask) when grouped by anything other than Status, or plain
  // Kanban columns ({key,label,color}, from kanbanColumns) when grouped
  // by Status — normalize here so both work.
  const stepKey=s=>s.status_key??s.key
  const curStep=steps.find(s=>s.keys?s.keys.includes(task.status):stepKey(s)===task.status)
  const statusColor=curStep?.color||'#94a3b8'
  return (
    <div draggable
      onDragStart={e=>{setDragging(true);e.dataTransfer.setData('task_id',task.id)}}
      onDragEnd={()=>setDragging(false)}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      onClick={onView}
      style={{position:'relative',background:'var(--surface)',border:`1px solid ${over?'rgba(225,29,72,.3)':hover?'var(--c1)':'var(--border)'}`,borderRadius:10,padding:'13px 14px 13px 16px',cursor:onView?'pointer':'grab',opacity:dragging?.5:1,boxShadow:hover?'0 4px 16px rgba(15,23,42,.08)':'0 1px 2px rgba(15,23,42,.04)',transform:hover&&!dragging?'translateY(-1px)':'none',transition:'transform .15s, box-shadow .15s, border-color .15s'}}>
      <span style={{position:'absolute',left:0,top:10,bottom:10,width:3,borderRadius:2,background:statusColor}}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
        <div style={{display:'flex',alignItems:'center',gap:7,minWidth:0}}>
          <span style={{fontFamily:'var(--font-mono)',fontSize:10.5,color:'var(--text-muted)',fontWeight:600,letterSpacing:'.01em'}}>{task.task_id||''}</span>
          <TypeBadge type={task.task_type||'task'}/>
          {childCount>0&&<span title={`${childCount} subtask${childCount!==1?'s':''}`} style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:10,color:'var(--text-muted)',fontWeight:600}}><GitBranch size={10}/>{childCount}</span>}
        </div>
        <div style={{display:'flex',gap:1,flexShrink:0,opacity:hover?1:0,transition:'opacity .15s'}}>
          {onShare&&<button style={{background:'none',border:'none',cursor:'pointer',padding:4,borderRadius:5,color:'var(--text-muted)',display:'flex'}} onClick={e=>{e.stopPropagation();onShare()}}><Share2 size={11}/></button>}
          {canEdit&&<button style={{background:'none',border:'none',cursor:'pointer',padding:4,borderRadius:5,color:'var(--text-muted)',display:'flex'}} onClick={e=>{e.stopPropagation();onEdit()}}><Edit2 size={11}/></button>}
          {canDelete&&<button style={{background:'none',border:'none',cursor:'pointer',padding:4,borderRadius:5,color:'var(--text-muted)',display:'flex'}} onClick={e=>{e.stopPropagation();onDelete()}}><Trash2 size={11}/></button>}
        </div>
      </div>
      <div style={{fontSize:13,fontWeight:600,marginBottom:9,lineHeight:1.42,color:'var(--text)'}}>{task.task_name}</div>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:10}}>
        <PriorityBadge priority={task.priority}/>
        {task.module_name&&<span style={{fontSize:10.5,fontWeight:600,color:'var(--text-muted)'}}>{task.module_name}</span>}
        {over&&<span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 7px',borderRadius:5,fontSize:9.5,background:'rgba(225,29,72,.1)',color:'var(--rose)',fontWeight:700}}><AlertTriangle size={9}/> OVERDUE</span>}
      </div>
      {pct!=null&&<div style={{marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
          <span style={{fontSize:9,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Progress</span>
          <span style={{fontSize:10.5,fontWeight:700,color:pct>=100?'var(--emerald)':'var(--c1)',fontFamily:'var(--font-mono)'}}>{pct}%</span>
        </div>
        <ProgBar pct={pct} color={pct>=100?'var(--emerald)':'var(--c1)'}/>
      </div>}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6,paddingTop:9,borderTop:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
          {assignee&&<Ava name={assignee.full_name} size={20}/>}
          {task.estimated_hours&&<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:10.5,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}><Clock size={10}/>{task.estimated_hours}h</span>}
          {commentCount>0&&<span style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:10.5,color:'var(--text-muted)'}} title={`${commentCount} update${commentCount===1?'':'s'}`}><MessageSquare size={10}/>{commentCount}</span>}
        </div>
        {task.planned_end_date&&<span style={{fontSize:10.5,fontWeight:over?700:500,color:over?'var(--rose)':'var(--text-muted)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>{dateFmt(task.planned_end_date)}</span>}
      </div>
      {canChangeStatus&&steps.length>0&&<div style={{marginTop:9,display:'flex',gap:4}}>
        {steps.filter(s=>stepKey(s)!==task.status).slice(0,3).map(s=>(
          <button key={stepKey(s)} onClick={e=>{e.stopPropagation();onStatus(stepKey(s))}}
            style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:2,padding:'5px 4px',border:'1px solid var(--border)',borderRadius:6,background:'var(--surface-2)',cursor:'pointer',fontSize:9.5,color:'var(--text-muted)',fontFamily:'inherit',fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',transition:'background .15s, color .15s, border-color .15s'}}
            onMouseEnter={e=>{e.currentTarget.style.background=`${s.color}10`;e.currentTarget.style.color=s.color;e.currentTarget.style.borderColor=`${s.color}40`}}
            onMouseLeave={e=>{e.currentTarget.style.background='var(--surface-2)';e.currentTarget.style.color='var(--text-muted)';e.currentTarget.style.borderColor='var(--border)'}}>
            <ChevronRight size={10}/> {s.label.split(' ')[0]}
          </button>
        ))}
      </div>}
    </div>
  )
}

/* ─── Board atoms (enterprise styling — classes in index.css "TASK BOARD") ─── */
// Priority as signal bars (Linear/Jira convention): critical = red "!",
// high/medium/low = 3/2/1 filled bars. Neutral ink; only critical is coloured.
function PrioMark({priority,label=true}) {
  const p=priority||'medium'
  const icon=p==='critical'
    ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="1" y="1" width="12" height="12" rx="3" fill="#dc2626"/><rect x="6.2" y="3.5" width="1.6" height="4.6" rx=".8" fill="#fff"/><circle cx="7" cy="10.1" r=".95" fill="#fff"/></svg>
    : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>{[0,1,2].map(i=>{const on=i<({high:3,medium:2,low:1}[p]||2);return <rect key={i} x={1.5+i*4.2} y={9-i*3} width="2.6" height={3+i*3} rx=".8" fill={on?(p==='high'?'#d97706':'#475569'):'#e2e8f0'}/>})}</svg>
  return <span className="tb-prio" title={`Priority: ${p}`}>{icon}{label&&p}</span>
}
function TypeMark({type}) {
  const Icon=TYPE_ICON[type]||ClipboardList
  return <span className={`tb-type ${type==='bug'?'bug':''}`} title={(type||'task').replace(/_/g,' ')}><Icon size={13}/></span>
}
function StatusControl({task,steps,editable,onChange}) {
  const step=steps.find(s=>s.status_key===task.status)
  return (
    <span className={`tb-status ${editable?'editable':''}`} onClick={e=>e.stopPropagation()}>
      <span className="tb-dot" style={{background:step?.color||'#94a3b8'}}/>
      <span className="lbl">{step?.label||String(task.status||'—').replace(/_/g,' ')}</span>
      {editable&&<><ChevronDown size={12} className="caret"/>
        <select value={task.status} onChange={e=>onChange(e.target.value)} aria-label="Change status">
          {!step&&task.status&&<option value={task.status}>{task.status}</option>}
          {steps.map(s=><option key={s.status_key} value={s.status_key}>{s.label}</option>)}
        </select></>}
    </span>
  )
}
function Who({user,size=22}) {
  if(!user) return <span className="tb-who none"><span className="tb-avatar0" style={{width:size,height:size}}/>Unassigned</span>
  return <span className="tb-who"><Ava name={user.full_name} size={size}/><span>{user.full_name}</span></span>
}
const colIdOf=col=>col.keys?col.keys.join('_'):col.key
// Per-viewer collapse memory for grouped layouts (convenience only).
function useCollapseMemory(storeKey){
  const read=()=>{try{return JSON.parse(localStorage.getItem(storeKey)||'{}')}catch{return {}}}
  const [map,setMap]=useState(read)
  useEffect(()=>{setMap(read())},[storeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const save=n=>{setMap(n);try{localStorage.setItem(storeKey,JSON.stringify(n))}catch{}}
  return [map,save]
}
// Drag-over highlight that survives moving across child elements.
function useDropTarget(){
  const [target,setTarget]=useState(null)
  const bind=(key,onDrop,enabled=true)=>({
    onDragOver:e=>{if(!enabled)return;e.preventDefault();if(target!==key)setTarget(key)},
    onDragLeave:e=>{if(!e.currentTarget.contains(e.relatedTarget))setTarget(t=>t===key?null:t)},
    onDrop:e=>{setTarget(null);onDrop(e)},
  })
  return [target,bind,setTarget]
}

/* ─── Board: Status Sections ─────────────────────────────── */
// One grouped list (status by default, or whatever Columns groups by) with
// compact one-line rows. Drag a row onto another group to move it — same
// dropOnKanbanColumn handler as the Kanban, so permissions, auto-dates and
// notifications are unchanged. Closed/empty groups start collapsed.
const BOARD_PAGE=25
function StatusSections({columns,groupBy,tasksFor,users,projects,commentCounts,childCountOf,stepsForTask,perm,onDrop,onView,onEdit,onDelete,onShare,onStatus,onAdd}) {
  const [overrides,saveOverrides]=useCollapseMemory(`tasks-board-collapsed:${groupBy}`)
  const [shown,setShown]=useState({})
  const [target,bind]=useDropTarget()
  const sections=columns.map(col=>({col,rows:tasksFor(col)}))
  const isCollapsed=(col,count)=>overrides[colIdOf(col)]??(!!col.closed||count===0)
  const allCollapsed=sections.every(s=>isCollapsed(s.col,s.rows.length))
  const setAll=c=>saveOverrides(Object.fromEntries(sections.map(s=>[colIdOf(s.col),c])))

  return (
    <div className="tb-list"><div className="tb-list-scroll">
      <div className="tb-grid tb-colhead">
        <div>Task</div><div>Assignee</div><div>Priority</div><div>Status</div><div>Due</div><div className="r">Est.</div>
        <div className="r"><button className="tb-link" style={{padding:'2px 4px',fontSize:11.5}} onClick={()=>setAll(!allCollapsed)}>{allCollapsed?'Expand all':'Collapse all'}</button></div>
      </div>
      {sections.map(({col,rows})=>{
        const id=colIdOf(col),collapsed=isCollapsed(col,rows.length),limit=shown[id]||BOARD_PAGE
        return (
          <div key={id} className={`tb-group ${target===id?'drop':''}`} {...bind(id,e=>onDrop(e,col))}>
            <div className={`tb-section ${collapsed?'collapsed':''}`} onClick={()=>saveOverrides({...overrides,[id]:!collapsed})}>
              <ChevronDown size={15} className="chev"/>
              <span className="tb-dot" style={{background:col.color}}/>
              <span className="name">{col.label}</span>
              <span className="tb-count">{rows.length}</span>
              {target===id&&<span className="tb-drop-hint">Drop to move here</span>}
              {perm.can_create&&<button className="tb-iconbtn add" title={`Add task to ${col.label}`} onClick={e=>{e.stopPropagation();onAdd(col)}}><Plus size={15}/></button>}
            </div>
            {!collapsed&&<div className="tb-body">
              {rows.length===0
                ? <div className="tb-section-empty">No tasks. Drag one here or add a new task.</div>
                : rows.slice(0,limit).map(task=>(
                    <BoardRow key={task.id} task={task} users={users} projects={projects}
                      commentCount={commentCounts[task.id]||0} childCount={childCountOf(task.id)} steps={stepsForTask(task)} perm={perm}
                      onView={()=>onView(task)} onEdit={()=>onEdit(task)} onDelete={()=>onDelete(task)} onShare={()=>onShare(task)}
                      onStatus={s=>onStatus(task,s)}/>
                  ))}
              {rows.length>limit&&<button className="tb-more" onClick={()=>setShown(s=>({...s,[id]:limit+100}))}>Show {Math.min(100,rows.length-limit)} more</button>}
            </div>}
          </div>
        )
      })}
    </div></div>
  )
}

function BoardRow({task,users,projects,commentCount,childCount,steps,perm,onView,onEdit,onDelete,onShare,onStatus}) {
  const [dragging,setDragging]=useState(false)
  const assignee=users.find(u=>u.id===task.assigned_to)
  const proj=projects.find(p=>p.id===task.project_id)
  const over=isOverdue(task,steps)
  const sub=[task.module_name,proj?.name].filter(Boolean).join(' · ')
  return (
    <div draggable className={`tb-grid tb-row ${dragging?'dragging':''}`}
      onDragStart={e=>{setDragging(true);e.dataTransfer.setData('task_id',task.id)}}
      onDragEnd={()=>setDragging(false)} onClick={onView}>
      <div className="task">
        <TypeMark type={task.task_type}/>
        {task.task_id&&<span className="tb-id">{task.task_id}</span>}
        <span className="title" title={task.task_name}>{task.task_name}</span>
        {childCount>0&&<span className="tb-mi" title={`${childCount} subtask${childCount!==1?'s':''}`}><GitBranch size={11}/>{childCount}</span>}
        {commentCount>0&&<span className="tb-mi" title={`${commentCount} update${commentCount===1?'':'s'}`}><MessageSquare size={11}/>{commentCount}</span>}
        {sub&&<span className="sub">{sub}</span>}
      </div>
      <Who user={assignee}/>
      <PrioMark priority={task.priority}/>
      <StatusControl task={task} steps={steps} editable={perm.can_change_status} onChange={onStatus}/>
      <span className={`tb-due ${over?'over':''}`} title={over?'Overdue':'Planned end'}>{task.planned_end_date?dateFmt(task.planned_end_date):'—'}</span>
      <span className="tb-num">{task.progress_pct!=null?`${task.progress_pct}%`:task.estimated_hours?`${task.estimated_hours}h`:'—'}</span>
      <div className="actions" onClick={e=>e.stopPropagation()}>
        {onShare&&<button className="tb-iconbtn" title="Share" onClick={onShare}><Share2 size={13}/></button>}
        {perm.can_edit&&<button className="tb-iconbtn" title="Edit" onClick={onEdit}><Edit2 size={13}/></button>}
        {perm.can_delete&&<button className="tb-iconbtn danger" title="Delete" onClick={onDelete}><Trash2 size={13}/></button>}
      </div>
    </div>
  )
}

/* ─── Board: Kanban columns ──────────────────────────────── */
// Classic columns with compact cards. Closed columns collapse to a thin
// strip (still a drop target). No per-card quick-status buttons — drag,
// or open the task, to change status.
function KanbanColumns({columns,groupBy,tasksFor,users,commentCounts,childCountOf,stepsForTask,perm,onDrop,onView,onEdit,onDelete,onShare,onAdd}) {
  const [overrides,saveOverrides]=useCollapseMemory(`tasks-kanban-collapsed:${groupBy}`)
  const [target,bind]=useDropTarget()
  return (
    <div className="tb-kanban">
      {columns.map(col=>{
        const rows=tasksFor(col),id=colIdOf(col),narrow=overrides[id]??!!col.closed
        if(narrow) return (
          <div key={id} className={`tb-kcol-narrow ${target===id?'drop':''}`} {...bind(id,e=>onDrop(e,col))}
            onClick={()=>saveOverrides({...overrides,[id]:false})} title={`Expand ${col.label}`}>
            <span className="tb-dot" style={{background:col.color}}/>
            <span className="tb-count">{rows.length}</span>
            <span className="vlabel">{col.label}</span>
          </div>
        )
        return (
          <div key={id} className={`tb-kcol ${target===id?'drop':''}`} {...bind(id,e=>onDrop(e,col))}>
            <div className="tb-kcol-head">
              <span className="tb-dot" style={{background:col.color}}/>
              <span className="name">{col.label}</span>
              <span className="tb-count">{rows.length}</span>
              <span className="tools">
                <button className="tb-iconbtn" title="Collapse column" onClick={()=>saveOverrides({...overrides,[id]:true})}><ChevronRight size={14} style={{transform:'rotate(180deg)'}}/></button>
                {perm.can_create&&<button className="tb-iconbtn" title="Add task" onClick={()=>onAdd(col)}><Plus size={14}/></button>}
              </span>
            </div>
            <div className="tb-kcol-body">
              {rows.map(task=>(
                <BoardCard key={task.id} task={task} user={users.find(u=>u.id===task.assigned_to)} steps={stepsForTask(task)}
                  commentCount={commentCounts[task.id]||0} childCount={childCountOf(task.id)} perm={perm}
                  onView={()=>onView(task)} onEdit={()=>onEdit(task)} onDelete={()=>onDelete(task)} onShare={()=>onShare(task)}/>
              ))}
              {perm.can_create&&<button className="tb-kadd" onClick={()=>onAdd(col)}><Plus size={14}/> Add task</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BoardCard({task,user,steps,commentCount,childCount,perm,onView,onEdit,onDelete,onShare}) {
  const [dragging,setDragging]=useState(false)
  const over=isOverdue(task,steps)
  return (
    <div draggable className={`tb-card ${dragging?'dragging':''} ${over?'over':''}`}
      onDragStart={e=>{setDragging(true);e.dataTransfer.setData('task_id',task.id)}}
      onDragEnd={()=>setDragging(false)} onClick={onView}>
      <div className="top">
        <TypeMark type={task.task_type}/>
        {task.task_id&&<span className="tb-id">{task.task_id}</span>}
        {task.module_name&&<span className="tb-mi" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>· {task.module_name}</span>}
        <span className="actions" onClick={e=>e.stopPropagation()}>
          {onShare&&<button className="tb-iconbtn" title="Share" onClick={onShare}><Share2 size={12}/></button>}
          {perm.can_edit&&<button className="tb-iconbtn" title="Edit" onClick={onEdit}><Edit2 size={12}/></button>}
          {perm.can_delete&&<button className="tb-iconbtn danger" title="Delete" onClick={onDelete}><Trash2 size={12}/></button>}
        </span>
      </div>
      <div className="title" title={task.task_name}>{task.task_name}</div>
      {task.progress_pct!=null&&<div className="tb-progress" title={`${task.progress_pct}% complete`}><div style={{width:`${Math.min(100,task.progress_pct)}%`}}/></div>}
      <div className="foot">
        <PrioMark priority={task.priority} label={false}/>
        {task.planned_end_date&&<span className={`tb-due ${over?'over':''}`}>{dateFmt(task.planned_end_date)}</span>}
        <span className="right">
          {childCount>0&&<span className="tb-mi"><GitBranch size={11}/>{childCount}</span>}
          {commentCount>0&&<span className="tb-mi"><MessageSquare size={11}/>{commentCount}</span>}
          {task.estimated_hours&&<span className="tb-mi"><Clock size={11}/>{task.estimated_hours}h</span>}
          {user?<Ava name={user.full_name} size={22}/>:<span className="tb-avatar0" title="Unassigned"/>}
        </span>
      </div>
    </div>
  )
}

// Shared helpers for the person-based layouts (People board, Week planner).
function peopleRows(tasks,users,includeEveryone){
  const ids=new Set(tasks.map(t=>t.assigned_to||'__unassigned'))
  if(includeEveryone) users.forEach(u=>ids.add(u.id))
  const rows=[...ids].filter(id=>id!=='__unassigned').map(id=>({key:id,name:users.find(u=>u.id===id)?.full_name||'Unknown'}))
    .sort((a,b)=>a.name.localeCompare(b.name))
  if(ids.has('__unassigned')) rows.push({key:'__unassigned',name:'Unassigned'})
  return rows
}
const personOf=t=>t.assigned_to||'__unassigned'
function PersonCell({p,status,warn,gap,children}) {
  return (
    <div className="tb-person">
      {p.key==='__unassigned'?<span className="tb-avatar0" style={{width:26,height:26}}/>:<Ava name={p.name} size={26}/>}
      <div>
        <div className="nm" title={p.name}>{p.name}</div>
        <div className={`st ${warn?'warn':gap?'gap':''}`}>{status}</div>
        {children}
      </div>
    </div>
  )
}
function TaskChip({task,steps,onView,dim}) {
  const over=isOverdue(task,steps)
  return (
    <div draggable className={`tb-chip ${over?'over':''} ${dim?'dim':''}`}
      onDragStart={e=>e.dataTransfer.setData('task_id',task.id)} onClick={e=>{e.stopPropagation();onView(task)}}
      title={`${task.task_id||''} ${task.task_name}${task.planned_end_date?` · due ${dateFmt(task.planned_end_date)}`:''}${over?' · overdue':''}`}>
      <PrioMark priority={task.priority} label={false}/>
      {task.task_id&&<span className="tb-id">{task.task_id}</span>}
      <span className="t">{task.task_name}</span>
    </div>
  )
}

/* ─── Board: People (person × status) ────────────────────── */
function PeopleBoard({columns,tasks,users,stepsForTask,perm,onDrop,onView,onAdd,showClosed,everyone}) {
  const [expanded,setExpanded]=useState({})
  const [target,bind]=useDropTarget()
  const cols=columns.filter(c=>showClosed||!c.closed)
  const inCol=(t,col)=>col.keys?col.keys.includes(t.status):t.status===col.key
  const openCols=columns.filter(c=>!c.closed)
  const rows=peopleRows(tasks,users,everyone)
  const CAP=4
  const grid={gridTemplateColumns:`220px repeat(${cols.length},minmax(170px,1fr))`,minWidth:220+cols.length*170}
  return (
    <div className="tb-matrix">
      <div className="tb-mhead" style={grid}>
        <div>Resource</div>
        {cols.map(col=><div key={colIdOf(col)}><span className="tb-dot" style={{background:col.color}}/>{col.label}<span className="tb-count">{tasks.filter(t=>inCol(t,col)).length}</span></div>)}
      </div>
      {rows.length===0&&<div className="tb-empty">No tasks match these filters</div>}
      {rows.map(p=>{
        const mine=tasks.filter(t=>personOf(t)===p.key)
        const open=mine.filter(t=>openCols.some(c=>inCol(t,c)))
        const est=open.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0)
        const overdue=open.filter(t=>isOverdue(t,stepsForTask(t))).length
        const idle=p.key!=='__unassigned'&&open.length===0
        const status=idle?'No open tasks':[`${open.length} open`,est?`${Math.round(est*10)/10}h est.`:null,overdue?`${overdue} overdue`:null].filter(Boolean).join(' · ')
        return (
          <div key={p.key} className="tb-mrow" style={grid}>
            <PersonCell p={p} status={status} warn={idle||overdue>0}/>
            {cols.map(col=>{
              const key=`${p.key}|${colIdOf(col)}`,cell=mine.filter(t=>inCol(t,col)),isOpen=expanded[key]
              return (
                <div key={key} className={`tb-cell ${target===key?'drop':''}`} {...bind(key,e=>onDrop(e,col,p.key))}>
                  {(isOpen?cell:cell.slice(0,CAP)).map(t=><TaskChip key={t.id} task={t} steps={stepsForTask(t)} onView={onView} dim={col.closed}/>)}
                  {cell.length>CAP&&<button className="tb-chip-more" onClick={()=>setExpanded(x=>({...x,[key]:!isOpen}))}>{isOpen?'Show less':`+${cell.length-CAP} more`}</button>}
                  {cell.length===0&&perm.can_create&&<button className="add" title="Add task here" onClick={()=>onAdd(col,p.key)}><Plus size={14}/></button>}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ─── Board: Week planner (person × working day) ─────────── */
// Open tasks as bars across planned start..end over the visible working
// days. Planning works two ways, side by side:
//  • Backlog panel (right) — every open task with no dates, searchable,
//    with a quick-add box. Drag any item onto a person/day to schedule and
//    assign it in one move.
//  • Slot popover — click a Free slot (or double-click any day) to either
//    pick an existing task for that person/day or create a new one there
//    without leaving the planner.
// Bars can also be dragged to another day/person to reschedule/reassign.
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
function plannerDays(span,offset){
  const d=new Date();d.setHours(0,0,0,0)
  d.setDate(d.getDate()-((d.getDay()+6)%7)+offset*7) // Monday of the week
  const out=[]
  while(out.length<span){ if(d.getDay()!==0&&d.getDay()!==6) out.push(ymd(d)); d.setDate(d.getDate()+1) }
  return out
}
const isUnscheduled=t=>!t.planned_start_date&&!t.planned_end_date
const matchesQuery=(t,q)=>!q||`${t.task_id||''} ${t.task_name||''}`.toLowerCase().includes(q.toLowerCase())
const longDay=d=>new Date(d+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})

function WeekPlanner({tasks,users,stepsForTask,perm,onView,onReschedule,onQuickCreate,onOpenFullForm,span,offset,everyone,showBacklog}) {
  const today=ymd(new Date())
  const [drag,setDrag]=useState(null)
  const [target,bind,setTarget]=useDropTarget()
  const [slot,setSlot]=useState(null) // {personKey,name,day,x,y}
  const [backlogFor,setBacklogFor]=useState(null) // person filter on the backlog panel
  const days=useMemo(()=>plannerDays(span,offset),[span,offset])
  const first=days[0],last=days[days.length-1]
  const openTasks=tasks.filter(t=>!stepsForTask(t).find(s=>s.status_key===t.status)?.is_closed)
  const rows=peopleRows(openTasks,users,everyone)
  const isMon=d=>new Date(d+'T00:00:00').getDay()===1
  const place=t=>{
    const s=t.planned_start_date||t.planned_end_date, e=t.planned_end_date||t.planned_start_date
    if(!s||e<first||s>last)return null
    const a=days.findIndex(d=>d>=s), b=days.map(d=>d<=e).lastIndexOf(true)
    return a<0||b<a?null:{a,b,cutL:s<first,cutR:e>last}
  }
  const grid={gridTemplateColumns:`220px repeat(${days.length},minmax(88px,1fr))`,minWidth:220+days.length*88}
  const canDrag=perm.can_edit
  const canPlan=perm.can_edit||perm.can_create
  const dropOn=(personKey,day)=>e=>{e.preventDefault();setDrag(null);const tid=e.dataTransfer.getData('task_id');if(tid)onReschedule(tid,personKey,day)}
  const openSlot=(e,p,day)=>{
    if(!canPlan)return
    const r=e.currentTarget.getBoundingClientRect()
    setSlot({personKey:p.key,name:p.name,day,x:Math.min(r.left,window.innerWidth-356),y:Math.min(r.bottom+6,window.innerHeight-430)})
  }

  return (
    <div className="tb-planner">
      <div className="tb-matrix" style={{flex:1,minWidth:0}}>
        <div className="tb-mhead" style={grid}>
          <div>Resource</div>
          {days.map((d,i)=>{const x=new Date(d+'T00:00:00');return(
            <div key={d} className={`tb-day ${d===today?'today':''} ${i>0&&isMon(d)?'wk':''}`}>
              <span className="dw">{d===today?'Today':x.toLocaleDateString('en-IN',{weekday:'short'})}</span>
              <span className="dm">{x.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>
            </div>
          )})}
        </div>
        {rows.length===0&&<div className="tb-empty">No open tasks match these filters</div>}
        {rows.map(p=>{
          const mine=openTasks.filter(t=>personOf(t)===p.key)
          const unscheduled=mine.filter(isUnscheduled)
          const placed=mine.map(t=>({t,pos:place(t)})).filter(x=>x.pos).sort((x,y)=>x.pos.a-y.pos.a||y.pos.b-x.pos.b)
          // Greedy lane packing so overlapping tasks stack instead of colliding.
          const laneEnds=[]
          placed.forEach(x=>{let l=laneEnds.findIndex(end=>end<x.pos.a);if(l<0){l=laneEnds.length;laneEnds.push(-1)}laneEnds[l]=x.pos.b;x.lane=l})
          const lanes=Math.max(2,laneEnds.length) // 2 lanes min: name + status + backlog link must fit
          const covered=days.map((_,i)=>placed.some(x=>x.pos.a<=i&&i<=x.pos.b))
          const freeAhead=days.filter((d,i)=>d>=today&&!covered[i]).length
          const status=p.key==='__unassigned'?`${mine.length} open`:freeAhead?`${freeAhead} free day${freeAhead>1?'s':''} ahead`:'Fully planned'
          return (
            <div key={p.key} className="tb-mrow" style={{display:'block',minWidth:grid.minWidth}}>
              <div style={{...grid,display:'grid',gridTemplateRows:`repeat(${lanes},26px)`,rowGap:4,padding:'8px 0'}}>
                <div className="tb-sticky" style={{gridColumn:1,gridRow:`1 / span ${lanes}`,margin:'-8px 0'}}>
                  <PersonCell p={p} status={status} gap={p.key!=='__unassigned'&&freeAhead>0}>
                    {unscheduled.length>0&&<button className="tb-linkbtn" onClick={()=>setBacklogFor(backlogFor===p.key?null:p.key)}>
                      {backlogFor===p.key?'Showing':'Show'} {unscheduled.length} unscheduled
                    </button>}
                  </PersonCell>
                </div>
                {days.map((d,i)=>{
                  const key=`${p.key}|${d}`,free=!covered[i]&&d>=today&&p.key!=='__unassigned'
                  const isSlot=slot&&slot.personKey===p.key&&slot.day===d
                  return <div key={key} {...bind(key,dropOn(p.key,d),canDrag)} onDoubleClick={e=>openSlot(e,p,d)}
                    title={canPlan?'Double-click to plan this day':undefined}
                    className={`tb-pday ${d===today?'today':''} ${i>0&&isMon(d)?'wk':''} ${target===key||isSlot?'drop':''}`}
                    style={{gridColumn:i+2,gridRow:`1 / span ${lanes}`,margin:'-8px 0'}}>
                    {free&&<span className="tb-free" onClick={e=>openSlot(e,p,d)}>{canPlan?<><span className="a">Free</span><span className="b"><Plus size={12}/> Plan</span></>:'Free'}</span>}
                  </div>
                })}
                {placed.map(({t,pos,lane})=>{
                  const over=isOverdue(t,stepsForTask(t))
                  return (
                    <div key={t.id} draggable={canDrag}
                      onDragStart={e=>{e.dataTransfer.setData('task_id',t.id);setDrag(t.id)}}
                      onDragEnd={()=>{setDrag(null);setTarget(null)}}
                      onClick={()=>onView(t)}
                      className={`tb-bar ${over?'over':''} ${!over&&(t.priority==='critical'||t.priority==='high')?'hi-'+t.priority:''} ${pos.cutL?'cutl':''} ${pos.cutR?'cutr':''} ${drag===t.id?'dragging':''}`}
                      title={`${t.task_id||''} ${t.task_name}\n${dateFmt(t.planned_start_date||t.planned_end_date)} – ${dateFmt(t.planned_end_date||t.planned_start_date)}${t.estimated_hours?` · ${t.estimated_hours}h`:''}${over?' · overdue':''}`}
                      style={{gridColumn:`${pos.a+2} / ${pos.b+3}`,gridRow:lane+1,pointerEvents:drag&&drag!==t.id?'none':'auto',cursor:canDrag?'grab':'pointer'}}>
                      {t.task_id&&pos.b>pos.a&&<span className="tb-id">{t.task_id}</span>}
                      <span className="t">{t.task_name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {showBacklog&&(
        <BacklogPanel tasks={openTasks.filter(isUnscheduled)} users={users} stepsForTask={stepsForTask} perm={perm}
          personFilter={backlogFor} personName={rows.find(r=>r.key===backlogFor)?.name} onClearPerson={()=>setBacklogFor(null)}
          onView={onView} onDragState={setDrag} onQuickCreate={onQuickCreate}/>
      )}

      {slot&&(
        <SlotPopover slot={slot} tasks={openTasks} users={users} perm={perm}
          onClose={()=>setSlot(null)}
          onAssign={async t=>{await onReschedule(t.id,slot.personKey,slot.day);setSlot(null)}}
          onCreate={async form=>{const ok=await onQuickCreate({...form,personKey:slot.personKey,day:slot.day});if(ok)setSlot(null);return ok}}
          onMore={title=>{onOpenFullForm(slot.personKey,slot.day,title);setSlot(null)}}/>
      )}
    </div>
  )
}

// Right-hand panel: the pool of open tasks with no planned dates.
function BacklogPanel({tasks,users,stepsForTask,perm,personFilter,personName,onClearPerson,onView,onDragState,onQuickCreate}) {
  const [q,setQ]=useState('')
  const [title,setTitle]=useState('')
  const [busy,setBusy]=useState(false)
  const list=tasks.filter(t=>(!personFilter||personOf(t)===personFilter)&&matchesQuery(t,q))
    .sort((a,b)=>(personOf(a)==='__unassigned')-(personOf(b)==='__unassigned')||(PRIOS.indexOf(a.priority)-PRIOS.indexOf(b.priority)))
  async function add(e){
    e.preventDefault(); if(!title.trim()||busy)return
    setBusy(true)
    const ok=await onQuickCreate({title:title.trim(),personKey:personFilter||null,day:null})
    setBusy(false); if(ok)setTitle('')
  }
  return (
    <aside className="tb-backlog">
      <div className="hd">
        <span className="ttl">Backlog</span><span className="tb-count">{list.length}</span>
        <span className="hint">Unscheduled</span>
      </div>
      {perm.can_create&&(
        <form className="qa" onSubmit={add}>
          <Plus size={14} style={{color:'#94a3b8',flexShrink:0}}/>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder={personName?`New task for ${personName}…`:'New task, press Enter…'} disabled={busy}/>
        </form>
      )}
      <div className="search"><Search size={13} className="ic"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search backlog…" aria-label="Search backlog"/></div>
      {personFilter&&<div className="flt">For <b>{personName||'Unassigned'}</b><button className="tb-iconbtn" title="Show everyone" onClick={onClearPerson}><X size={12}/></button></div>}
      <div className="lst" onDragStart={()=>onDragState('backlog')} onDragEnd={()=>onDragState(null)}>
        {list.length===0&&<div className="tb-empty" style={{padding:'24px 12px'}}>{q?'No matching tasks':'Nothing unscheduled. Add a task above.'}</div>}
        {list.map(t=>{
          const u=users.find(x=>x.id===t.assigned_to)
          return (
            <div key={t.id} className="it">
              <TaskChip task={t} steps={stepsForTask(t)} onView={onView}/>
              <span className="who">{u?u.full_name:'Unassigned'}{t.estimated_hours?` · ${t.estimated_hours}h`:''}</span>
            </div>
          )
        })}
      </div>
      {(perm.can_edit)&&list.length>0&&<div className="ft">Drag a task onto a person’s day to schedule it</div>}
    </aside>
  )
}

// Popover for one person/day: pick an existing task, or create one there.
function SlotPopover({slot,tasks,users,perm,onClose,onAssign,onCreate,onMore}) {
  const [tab,setTab]=useState(perm.can_edit?'existing':'new')
  const [q,setQ]=useState('')
  const [form,setForm]=useState({title:'',hours:'',priority:'medium'})
  const [busy,setBusy]=useState(false)
  const ref=useRef(null)
  useEffect(()=>{
    const onDown=e=>{if(ref.current&&!ref.current.contains(e.target))onClose()}
    const onKey=e=>{if(e.key==='Escape')onClose()}
    const t=setTimeout(()=>document.addEventListener('mousedown',onDown),0)
    document.addEventListener('keydown',onKey)
    return ()=>{clearTimeout(t);document.removeEventListener('mousedown',onDown);document.removeEventListener('keydown',onKey)}
  },[onClose])
  // Unscheduled first (this person's, then unassigned, then others), then
  // already-scheduled tasks — picking one of those moves it to this day.
  const rank=t=>(isUnscheduled(t)?0:3)+(personOf(t)===slot.personKey?0:personOf(t)==='__unassigned'?1:2)
  const candidates=tasks.filter(t=>matchesQuery(t,q)).sort((a,b)=>rank(a)-rank(b)).slice(0,40)
  async function create(e){
    e.preventDefault(); if(!form.title.trim()||busy)return
    setBusy(true); await onCreate({title:form.title.trim(),hours:form.hours,priority:form.priority}); setBusy(false)
  }
  return (
    <div ref={ref} className="tb-pop" style={{left:slot.x,top:slot.y}} role="dialog" aria-label={`Plan ${slot.name} on ${longDay(slot.day)}`}>
      <div className="hd">
        <div><div className="ttl">{slot.name}</div><div className="sub">{longDay(slot.day)}</div></div>
        <button className="tb-iconbtn" title="Close" onClick={onClose}><X size={14}/></button>
      </div>
      <div className="tabs">
        {perm.can_edit&&<button className={tab==='existing'?'on':''} onClick={()=>setTab('existing')}>Assign existing</button>}
        {perm.can_create&&<button className={tab==='new'?'on':''} onClick={()=>setTab('new')}>Create new</button>}
      </div>
      {tab==='existing'?(
        <>
          <div className="search"><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search tasks by name or ID…"/></div>
          <div className="lst">
            {candidates.length===0&&<div className="tb-empty" style={{padding:'20px 12px'}}>No matching open tasks</div>}
            {candidates.map(t=>{
              const u=users.find(x=>x.id===t.assigned_to)
              return (
                <button key={t.id} className="opt" onClick={()=>onAssign(t)}>
                  <PrioMark priority={t.priority} label={false}/>
                  <span className="tb-id">{t.task_id||''}</span>
                  <span className="t">{t.task_name}</span>
                  <span className="m">{isUnscheduled(t)?'Unscheduled':dateFmt(t.planned_start_date||t.planned_end_date)}{personOf(t)!==slot.personKey?` · ${u?u.full_name.split(' ')[0]:'Unassigned'}`:''}</span>
                </button>
              )
            })}
          </div>
        </>
      ):(
        <form className="new" onSubmit={create}>
          <label>Task name<input autoFocus value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="What needs to be done?"/></label>
          <div className="row">
            <label>Est. hours<input type="number" min="0" step="0.5" value={form.hours} onChange={e=>setForm(f=>({...f,hours:e.target.value}))} placeholder="8"/></label>
            <label>Priority<select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>{PRIOS.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}</select></label>
          </div>
          <div className="act">
            <button type="button" className="tb-link" onClick={()=>onMore(form.title)}>More fields…</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!form.title.trim()||busy}>{busy?'Creating…':'Create task'}</button>
          </div>
        </form>
      )}
    </div>
  )
}

/* ─── Stories Tree View ──────────────────────────────────── */
function StoriesTree({epics,stories,tasks,myPerm,onEditStory,onDeleteStory,onAddTask,onViewTask,stepsForDept}) {
  const [collapsed,setCollapsed]=useState(()=>new Set())
  // Per-task department flow, not a hardcoded 'closed' check — a custom
  // flow's done step is often named something else entirely (e.g. 'done'),
  // so `status==='closed'` silently under-counted every completion here.
  const isDone=t=>!!stepsForDept(t.department_id).find(s=>s.status_key===t.status)?.is_closed
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
        const doneTasks=epicStories.reduce((a,s)=>a+tasks.filter(t=>t.user_story_id===s.id&&isDone(t)).length,0)
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
                  const done=stTasks.filter(isDone).length
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
                            const tSteps=stepsForDept(t.department_id)
                            const tStep=tSteps.find(x=>x.status_key===t.status)
                            const over=isOverdue(t,tSteps)
                            return (
                              <div key={t.id} onClick={()=>onViewTask(t)}
                                style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',borderRadius:7,cursor:'pointer',fontSize:11.5,flexWrap:'wrap'}}
                                onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                <span style={{flexShrink:0}}>{TYPE_ICO[t.task_type||'task']}</span>
                                <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--c1)',fontWeight:700,flexShrink:0}}>{t.task_id}</span>
                                <span style={{flex:1,minWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.task_name}</span>
                                <Pill label={tStep?.label||t.status} color={tStep?.color||'#94a3b8'}/>
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

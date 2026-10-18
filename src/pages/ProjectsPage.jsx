import { useState, useEffect, useMemo } from 'react'
import ProjectDocuments from '../components/ei/DocumentFiling'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Modal, Loader, Empty, Confirm, SearchBox, StatusBadge, Alert } from '../components/ui'
import AllocationGantt from '../components/AllocationGantt'
import GanttChart from '../components/GanttChart'
import { recomputeForProject, getActualCostSnapshot, getBurnRate, resolveHourlyRate } from '../lib/actualCost'
import { MARGIN_VISIBLE_ROLES, recomputeMargin, getMargin } from '../lib/profitMargin'
import { findOpportunityForProject, recomputeSalesProfitAttribution } from '../lib/salesFinance'
import { findCampaignForOpportunity, recomputeCampaignResult } from '../lib/marketingCampaigns'
import { getFindings } from '../lib/spendAnalyzer'
import { getWarrantyCostSummaryForProject } from '../lib/warrantyCost'
import { listProposalsForProject } from '../lib/roiProposals'
import { listProjectDepartments, addProjectDepartment, removeProjectDepartment, signOffDepartment, undoSignOffDepartment, closeFundFlow, reopenFundFlow } from '../lib/projectClosure'
import { checkAllocationConflict, submitAllocationRequest, updateAllocation, deleteAllocation, getRemainingCapacityPct } from '../lib/allocations'
import { Plus, Edit2, Trash2, FolderOpen, Eye, ArrowLeft, RefreshCw, AlertTriangle, TrendingDown, Percent, Radar, Lock, Unlock, UserCheck } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

/* ─── constants ─────────────────────────────────────── */
const SC   = { active:'#10b981', on_hold:'#f59e0b', completed:'#3b82f6', cancelled:'#e11d48' }
const MSC  = { pending:'#94a3b8', in_progress:'#d97706', completed:'#059669', delayed:'#e11d48' }
const TSC  = { backlog:'#64748b', todo:'#3b82f6', in_progress:'#f59e0b', delayed:'#e11d48', qa:'#8b5cf6', ready_for_demo:'#10b981', closed:'#94a3b8' }
const MOS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// month is 1-12, matching project_resource_alloc.month — used to amortize
// that table's whole-month allocated_hours into an hrs/week figure.
const daysInMonth=(month,year)=>new Date(year,month,0).getDate()
const CCLR = ['#3b82f6','#10b981','#f59e0b','#e11d48','#8b5cf6','#14b8a6','#f43f5e','#a855f7']
const SW0  = ['server','third_party','saas','license','other']
const HW0  = ['component','iot_device','logistics','assembly','other']
const SUP0 = ['device_logger','support_expense','maintenance','other']
const PI   = {critical:'🔴',high:'🟠',medium:'🔵',low:'🟢'}
const PRIOS= ['critical','high','medium','low']
const CR_ST= ['draft','submitted','under_review','approved','rejected','implemented']
const iP   = ()=>({name:'',description:'',goal:'',budget:'',reserved_budget:'',start_date:'',end_date:'',status:'active',customer_id:'',department_id:'',project_type:'',involvedDeptIds:[]})
const iMS  = ()=>({title:'',description:'',start_date:'',due_date:'',actual_start:'',actual_end:'',budget:'',status:'pending'})
const iCR  = ()=>({title:'',description:'',reason:'',priority:'medium',status:'draft',estimated_hours:'',actual_hours:'',estimated_cost:'',actual_cost:''})

/* ─── helpers ───────────────────────────────────────── */
const Pill=(({s,map=SC})=>{const c=map[s]||'#94a3b8';return <span style={{padding:'2px 9px',borderRadius:4,fontSize:10,fontWeight:700,textTransform:'capitalize',background:`${c}15`,color:c}}>{s?.replace(/_/g,' ')}</span>})
const TH=({c,s={}})=><th style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap',...s}}>{c}</th>
const TD=({c,s={}})=><td style={{padding:'8px 14px',borderBottom:'1px solid var(--border)',verticalAlign:'middle',...s}}>{c}</td>
const MTD=({v,color='var(--text)'})=><td style={{padding:'8px 14px',borderBottom:'1px solid var(--border)',fontFamily:'var(--font-mono)',fontWeight:700,color}}>{rupee(v||0)}</td>
const SCard=({label,value,color})=>{
  const [hover,setHover]=useState(false)
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{padding:'11px 16px',borderRadius:10,background:`${color}0d`,border:`1px solid ${color}25`,minWidth:130,
        boxShadow:hover?'0 6px 16px rgba(0,0,0,.08)':'none',transform:hover?'translateY(-2px)':'none',transition:'transform .15s, box-shadow .15s'}}>
      <div style={{fontSize:9,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>
      <div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:16,color,marginTop:3,overflowWrap:'break-word',wordBreak:'break-word'}}>{value}</div>
    </div>
  )
}
const MiniKpi=({label,value,color})=>{
  const [hover,setHover]=useState(false)
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,borderTop:`3px solid ${color}`,padding:'10px 14px',minWidth:0,overflow:'hidden',
        boxShadow:hover?'var(--shadow-md)':'var(--shadow-sm)',transform:hover?'translateY(-2px)':'none',transition:'transform .15s, box-shadow .15s'}}>
      <div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:16,color,lineHeight:1,marginBottom:3,overflowWrap:'break-word',wordBreak:'break-word'}}>{value}</div>
      <div style={{fontSize:9,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>
    </div>
  )
}
const EmptyRow=({colSpan,icon,text})=>(
  <tr><td colSpan={colSpan} style={{padding:'44px 20px',textAlign:'center'}}>
    <div style={{fontSize:30,marginBottom:8,opacity:.45}}>{icon}</div>
    <div style={{color:'var(--text-muted)',fontSize:13,fontWeight:600}}>{text}</div>
  </td></tr>
)

/* ─── KPI engine ────────────────────────────────────── */
function computeKPIs(dd) {
  if (!dd) return {}
  const {sw=[],hw=[],sup=[],ra=[],rates=[],timelogs:allLogs=[],expenses=[],milestones=[],changereqs=[]}=dd
  // support-visit check-ins are billed on the Support tab (STEP248), so HR cost counts ordinary work only
  const timelogs=allLogs.filter(l=>l.visit_type!=='SUPPORT'),supportHrs=allLogs.filter(l=>l.visit_type==='SUPPORT').reduce((s,l)=>s+(l.hours_worked||0),0)
  const swCo=sw.reduce((s,r)=>s+(r.cost_company||0),0),swCl=sw.reduce((s,r)=>s+(r.cost_client||0),0),swPr=sw.reduce((s,r)=>s+(r.proposal_cost||0),0)
  const hwCo=hw.reduce((s,r)=>s+(r.cost_company||0),0),hwCl=hw.reduce((s,r)=>s+(r.cost_client||0),0),hwPr=hw.reduce((s,r)=>s+(r.proposal_cost||0),0)
  const spCo=sup.reduce((s,r)=>s+(r.cost_company||0),0),spCl=sup.reduce((s,r)=>s+(r.cost_client||0),0),spPr=sup.reduce((s,r)=>s+(r.proposal_cost||0),0)
  const expOk=expenses.filter(e=>e.status==='approved').reduce((s,e)=>s+(e.total_amount||e.amount||0),0)
  const totalHrs=timelogs.reduce((s,l)=>s+(l.hours_worked||0),0)
  const avgRate=rates.length>0?rates.reduce((s,r)=>s+(r.hourly_rate||r.monthly_salary/(22*8)),0)/rates.length:0
  const hrCost=rates.reduce((s,r)=>{const eh=timelogs.filter(l=>l.employee?.id===r.employee_id).reduce((a,l)=>a+(l.hours_worked||0),0);return s+eh*(r.hourly_rate||r.monthly_salary/(22*8))},0)
  const wtyCo=dd.warranty?.totalWarrantyCost||0,wtyClaimCount=dd.warranty?.claimCount||0
  const totalCo=hrCost+swCo+hwCo+spCo+expOk+wtyCo,totalCl=swCl+hwCl+spCl,totalPr=swPr+hwPr+spPr
  const msBudget=milestones.reduce((s,m)=>s+(m.budget||0),0)
  const msSpent=milestones.reduce((s,m)=>{
    const msHrs=m.start_date&&m.due_date?timelogs.filter(l=>l.work_date>=m.start_date&&l.work_date<=m.due_date).reduce((a,l)=>a+(l.hours_worked||0),0):0
    return s+msHrs*avgRate+sw.filter(r=>r.milestone_id===m.id).reduce((a,r)=>a+(r.cost_company||0),0)+hw.filter(r=>r.milestone_id===m.id).reduce((a,r)=>a+(r.cost_company||0),0)+sup.filter(r=>r.milestone_id===m.id).reduce((a,r)=>a+(r.cost_company||0),0)
  },0)
  const msByHrs=milestones.map(m=>({id:m.id,title:m.title,budget:m.budget||0,logged:m.start_date&&m.due_date?timelogs.filter(l=>l.work_date>=m.start_date&&l.work_date<=m.due_date).reduce((s,l)=>s+(l.hours_worked||0),0):0,allocated:ra.filter(r=>r.milestone_id===m.id).reduce((s,r)=>s+(r.allocated_hours||0),0)}))
  const expByMonth=MOS.map((mn,mi)=>({month:mn,expenses:expenses.filter(e=>new Date(e.expense_date||e.created_at).getMonth()===mi).reduce((s,e)=>s+(e.total_amount||e.amount||0),0),hrCost:timelogs.filter(l=>new Date(l.work_date).getMonth()===mi).reduce((s,l)=>s+(l.hours_worked||0),0)*avgRate}))
  const crCount=changereqs.length,crHrs=changereqs.reduce((s,r)=>s+(r.actual_hours||0),0),crCost=changereqs.reduce((s,r)=>s+(r.actual_cost||0),0)
  return {supportHrs,swCo,swCl,swPr,hwCo,hwCl,hwPr,spCo,spCl,spPr,expOk,wtyCo,wtyClaimCount,totalHrs,hrCost,totalCo,totalCl,totalPr,msBudget,msSpent,msByHrs,expByMonth,crCount,crHrs,crCost}
}

/* ─── category manager widget ───────────────────────── */
function CatMgr({cats,setCats,label}) {
  const [v,setV]=useState('')
  return (
    <div style={{marginBottom:12,padding:'10px 12px',borderRadius:8,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
      <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{label}</div>
      <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:8}}>
        {cats.map(c=><span key={c} style={{display:'flex',alignItems:'center',gap:3,padding:'2px 9px',borderRadius:999,background:'var(--c1-soft)',color:'var(--c1)',fontSize:11,fontWeight:600}}>{c}<button onClick={()=>setCats(p=>p.filter(x=>x!==c))} style={{background:'none',border:'none',cursor:'pointer',color:'var(--rose)',fontSize:13,lineHeight:1,padding:'0 0 0 2px'}}>×</button></span>)}
      </div>
      <div style={{display:'flex',gap:6}}>
        <input className="form-input" style={{flex:1,fontSize:12}} value={v} onChange={e=>setV(e.target.value)} placeholder="Add category…" onKeyDown={e=>{if(e.key==='Enter'&&v.trim()){setCats(p=>[...p,v.trim().toLowerCase()]);setV('')}}}/>
        <button className="btn btn-primary btn-sm" onClick={()=>{if(v.trim()){setCats(p=>[...p,v.trim().toLowerCase()]);setV('')}}}>Add</button>
      </div>
    </div>
  )
}

/* ─── cost forms ────────────────────────────────────── */
function SWForm({form,setForm,cats,setCats,ms}) {
  function auto(co){const v=parseFloat(co)||0;setForm(f=>({...f,cost_company:co,cost_client:f.cost_client||String((v*1.3).toFixed(0)),proposal_cost:f.proposal_cost||String((v*1.5).toFixed(0))}))}
  function qty(q,up){const co=(q*up).toFixed(0);setForm(f=>({...f,qty:String(q),unit_price:String(up),cost_company:co,cost_client:String((q*up*1.3).toFixed(0)),proposal_cost:String((q*up*1.5).toFixed(0))}))}
  return (<><CatMgr cats={cats} setCats={setCats} label="SW Categories"/>
    <div style={{padding:'10px 12px',border:'1.5px solid var(--border)',borderRadius:8,marginBottom:12,background:form.per_seat?'var(--c1-soft)':'transparent'}}>
      <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13,fontWeight:600}}><input type="checkbox" checked={!!form.per_seat} onChange={e=>setForm(f=>({...f,per_seat:e.target.checked}))}/> Priced per user (seat)</label>
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>Cost follows the people who check in to this project: one seat per person per billing period in which they checked in.</div>
      {form.per_seat&&<div className="form-group" style={{marginTop:8,marginBottom:0}}><label className="form-label">Price per user per billing cycle (₹)</label><input className="form-input" type="number" min="0" value={form.seat_price||''} onChange={e=>setForm(f=>({...f,seat_price:e.target.value}))} placeholder="e.g. 800"/></div>}
    </div>
    <div className="form-row"><div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/></div><div className="form-group"><label className="form-label">Category</label><select className="form-select" value={form.category||cats[0]||'other'} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{cats.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}</select></div></div>
    {!form.per_seat&&<>
    <div className="form-row"><div className="form-group"><label className="form-label">Qty</label><input className="form-input" type="number" min="1" value={form.qty||1} onChange={e=>{const q=parseFloat(e.target.value)||1,up=parseFloat(form.unit_price)||0;up>0?qty(q,up):setForm(f=>({...f,qty:e.target.value}))}}/></div><div className="form-group"><label className="form-label">Unit Price (₹)</label><input className="form-input" type="number" value={form.unit_price||''} onChange={e=>{const up=parseFloat(e.target.value)||0,q=parseFloat(form.qty)||1;up>0?qty(q,up):setForm(f=>({...f,unit_price:e.target.value}))}}/></div></div>
    {parseFloat(form.unit_price)>0&&<div style={{padding:'5px 10px',borderRadius:5,background:'var(--c1-soft)',fontSize:12,fontWeight:600,color:'var(--c1)',marginBottom:8}}>Total: {rupee((parseFloat(form.qty)||1)*(parseFloat(form.unit_price)||0))}</div>}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
      <div className="form-group"><label className="form-label">Cost Company (₹)</label><input className="form-input" type="number" value={form.cost_company||''} onChange={e=>auto(e.target.value)}/></div>
      <div className="form-group"><label className="form-label">Cost Client ×1.3</label><input className="form-input" type="number" value={form.cost_client||''} onChange={e=>setForm(f=>({...f,cost_client:e.target.value}))}/></div>
      <div className="form-group"><label className="form-label">Proposal ×1.5</label><input className="form-input" type="number" value={form.proposal_cost||''} onChange={e=>setForm(f=>({...f,proposal_cost:e.target.value}))}/></div>
    </div>
    </>}
    <div className="form-row"><div className="form-group"><label className="form-label">Billing</label><select className="form-select" value={form.billing_cycle||'monthly'} onChange={e=>setForm(f=>({...f,billing_cycle:e.target.value}))}>{['monthly','yearly','quarterly','one_time'].map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}</select></div><div className="form-group"><label className="form-label">Milestone</label><select className="form-select" value={form.milestone_id||''} onChange={e=>setForm(f=>({...f,milestone_id:e.target.value}))}><option value="">—</option>{ms.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></div></div>
    <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div></>)
}
function HWForm({form,setForm,cats,setCats,ms}) {
  function qty(q,up){const co=(q*up).toFixed(0);setForm(f=>({...f,qty:String(q),unit_price:String(up),cost_company:co,cost_client:String((q*up*1.3).toFixed(0)),proposal_cost:String((q*up*1.5).toFixed(0))}))}
  return (<><CatMgr cats={cats} setCats={setCats} label="HW Categories"/>
    <div className="form-row"><div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/></div><div className="form-group"><label className="form-label">Category</label><select className="form-select" value={form.category||cats[0]||'other'} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{cats.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}</select></div></div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
      <div className="form-group"><label className="form-label">Qty *</label><input className="form-input" type="number" min="1" value={form.qty||'1'} onChange={e=>qty(parseFloat(e.target.value)||1,parseFloat(form.unit_price)||0)}/></div>
      <div className="form-group"><label className="form-label">Unit Price (₹) *</label><input className="form-input" type="number" value={form.unit_price||''} onChange={e=>qty(parseFloat(form.qty)||1,parseFloat(e.target.value)||0)}/></div>
      <div className="form-group"><label className="form-label">Auto Total</label><input className="form-input" value={rupee((parseFloat(form.qty)||1)*(parseFloat(form.unit_price)||0))} readOnly style={{background:'var(--bg-3)',opacity:.8}}/></div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
      <div className="form-group"><label className="form-label">Cost Company</label><input className="form-input" type="number" value={form.cost_company||''} onChange={e=>setForm(f=>({...f,cost_company:e.target.value}))}/></div>
      <div className="form-group"><label className="form-label">Cost Client ×1.3</label><input className="form-input" type="number" value={form.cost_client||''} onChange={e=>setForm(f=>({...f,cost_client:e.target.value}))}/></div>
      <div className="form-group"><label className="form-label">Proposal ×1.5</label><input className="form-input" type="number" value={form.proposal_cost||''} onChange={e=>setForm(f=>({...f,proposal_cost:e.target.value}))}/></div>
    </div>
    <div className="form-row"><div className="form-group"><label className="form-label">Vendor</label><input className="form-input" value={form.vendor||''} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))}/></div><div className="form-group"><label className="form-label">Milestone</label><select className="form-select" value={form.milestone_id||''} onChange={e=>setForm(f=>({...f,milestone_id:e.target.value}))}><option value="">—</option>{ms.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></div></div>
    <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div></>)
}
function SupForm({form,setForm,cats,setCats,ms}) {
  function auto(co){const v=parseFloat(co)||0;setForm(f=>({...f,cost_company:co,cost_client:f.cost_client||String((v*1.3).toFixed(0)),proposal_cost:f.proposal_cost||String((v*1.5).toFixed(0))}))}
  return (<><CatMgr cats={cats} setCats={setCats} label="Support Categories"/>
    <div className="form-row"><div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/></div><div className="form-group"><label className="form-label">Category</label><select className="form-select" value={form.category||cats[0]||'other'} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{cats.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}</select></div></div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
      <div className="form-group"><label className="form-label">Cost Company</label><input className="form-input" type="number" value={form.cost_company||''} onChange={e=>auto(e.target.value)}/></div>
      <div className="form-group"><label className="form-label">Cost Client ×1.3</label><input className="form-input" type="number" value={form.cost_client||''} onChange={e=>setForm(f=>({...f,cost_client:e.target.value}))}/></div>
      <div className="form-group"><label className="form-label">Proposal ×1.5</label><input className="form-input" type="number" value={form.proposal_cost||''} onChange={e=>setForm(f=>({...f,proposal_cost:e.target.value}))}/></div>
    </div>
    <div className="form-row"><div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={form.date||''} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div><div className="form-group"><label className="form-label">Milestone</label><select className="form-select" value={form.milestone_id||''} onChange={e=>setForm(f=>({...f,milestone_id:e.target.value}))}><option value="">—</option>{ms.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></div></div>
    <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div></>)
}

/* ─── budget config panel ───────────────────────────── */
function ROISummaryCard({projectId}) {
  const [proposals,setProposals]=useState(null)
  useEffect(()=>{ listProposalsForProject(projectId).then(setProposals).catch(()=>setProposals([])) },[projectId])
  const latest = proposals?.[0]
  return (
    <div className="card">
      <div className="card-header"><span className="card-title">📈 ROI Planning</span></div>
      <div className="card-body">
        {proposals===null ? <div style={{fontSize:12,color:'var(--text-muted)'}}>Loading…</div> : proposals.length===0 ? (
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <div style={{fontSize:12,color:'var(--text-muted)'}}>No ROI proposals for this project yet</div>
            <Link to={`/roi-planning?project=${projectId}`} className="btn btn-outline btn-sm">Create ROI Proposal</Link>
          </div>
        ) : (
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:14}}>
            <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
              <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Proposals</div><div style={{fontSize:18,fontWeight:800}}>{proposals.length}</div></div>
              <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Latest</div><div style={{fontSize:14,fontWeight:700}}>{latest.name}</div></div>
              <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Status</div><StatusBadge status={latest.status}/></div>
            </div>
            <Link to={`/roi-planning?project=${projectId}`} className="btn btn-primary btn-sm">Open ROI Planning</Link>
          </div>
        )}
      </div>
    </div>
  )
}

function BudgetPanel({detail,kpi,dd}) {
  const key=`budcfg_${detail?.id}`
  const [cfg,setCfg]=useState(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')||{cm:30,pm:50,incExp:true,incHr:true}}catch{return{cm:30,pm:50,incExp:true,incHr:true}}})
  const [saved,setSaved]=useState(false)
  if(!dd||!kpi)return null
  const base=(cfg.incHr?(kpi.hrCost||0):0)+(kpi.swCo||0)+(kpi.hwCo||0)+(kpi.spCo||0)+(cfg.incExp?(kpi.expOk||0):0)
  const cl=base*(1+(cfg.cm||0)/100),prop=base*(1+(cfg.pm||0)/100),margin=cl>0?((cl-base)/cl*100).toFixed(1):0
  function save(){localStorage.setItem(key,JSON.stringify(cfg));setSaved(true);setTimeout(()=>setSaved(false),2500)}
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
      <div className="card hover-lift"><div className="card-header"><span className="card-title">⚙️ Markup Config</span></div>
        <div className="card-body">
          <div className="form-group"><label className="form-label">Client Markup (%)</label><div style={{display:'flex',alignItems:'center',gap:10}}><input className="form-input" type="number" min="0" value={cfg.cm} onChange={e=>setCfg(c=>({...c,cm:parseFloat(e.target.value)||0}))} style={{width:90}}/><span style={{fontSize:11,color:'var(--text-muted)'}}>× {((cfg.cm||0)/100+1).toFixed(2)}</span></div></div>
          <div className="form-group"><label className="form-label">Proposal Markup (%)</label><div style={{display:'flex',alignItems:'center',gap:10}}><input className="form-input" type="number" min="0" value={cfg.pm} onChange={e=>setCfg(c=>({...c,pm:parseFloat(e.target.value)||0}))} style={{width:90}}/><span style={{fontSize:11,color:'var(--text-muted)'}}>× {((cfg.pm||0)/100+1).toFixed(2)}</span></div></div>
          <div style={{display:'flex',flexDirection:'column',gap:9,marginTop:12}}>
            {[['incExp','Include approved expenses'],['incHr','Include hour cost']].map(([k,l])=>(
              <label key={k} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13}}><input type="checkbox" checked={cfg[k]} onChange={e=>setCfg(c=>({...c,[k]:e.target.checked}))} style={{accentColor:'var(--c1)',width:15,height:15}}/>{l}</label>
            ))}
          </div>
          {saved&&<div className="alert alert-success" style={{marginTop:10}}>✓ Saved!</div>}
          <button className="btn btn-primary" style={{marginTop:12,width:'100%'}} onClick={save}>Save Config</button>
        </div>
      </div>
      <div className="card hover-lift"><div className="card-header"><span className="card-title">📊 Totals</span></div>
        {[{l:'Base (Cost to Co.)',v:base,c:'#e11d48'},{l:`Client (+${cfg.cm}%)`,v:cl,c:'#059669'},{l:`Proposal (+${cfg.pm}%)`,v:prop,c:'#7c3aed'},{l:'Gross Profit',v:cl-base,c:'#059669'}].map((r,i)=>(
          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'12px 16px',borderBottom:'1px solid var(--border)',background:i===3?'var(--bg-3)':'transparent'}}>
            <span style={{fontWeight:i===3?700:500,fontSize:13}}>{r.l}</span>
            <span style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:16,color:r.c}}>{rupee(r.v)}</span>
          </div>
        ))}
        <div style={{padding:'8px 16px',fontSize:12,color:'var(--text-muted)',textAlign:'center'}}>Gross Margin: <strong style={{color:'#059669'}}>{margin}%</strong></div>
      </div>
    </div>
  )
}

/* ─── project form ──────────────────────────────────── */
function ProjForm({form,setForm,customers=[],departments=[],isNew=false}) {
  const avail=Math.max(0,(parseFloat(form.budget)||0)-(parseFloat(form.reserved_budget)||0))
  // Only while CREATING a new project — auto-include the primary
  // Department in Departments Involved too, so it doesn't have to be
  // checked twice. Never applied on Edit: an existing project's involved
  // list may have deliberately diverged from its primary department
  // since (e.g. that department already signed off and was removed).
  function onDeptChange(deptId){
    setForm(f=>{
      const next={...f,department_id:deptId}
      if(isNew&&deptId&&!(f.involvedDeptIds||[]).includes(deptId)){
        next.involvedDeptIds=[...(f.involvedDeptIds||[]),deptId]
      }
      return next
    })
  }
  return (<>
    <div className="form-row">
      <div className="form-group"><label className="form-label">Project Name *</label><input className="form-input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/></div>
      <div className="form-group"><label className="form-label">Customer</label><select className="form-select" value={form.customer_id||''} onChange={e=>setForm(f=>({...f,customer_id:e.target.value}))}><option value="">No customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    </div>
    <div className="form-row">
      <div className="form-group"><label className="form-label">Department</label><select className="form-select" value={form.department_id||''} onChange={e=>onDeptChange(e.target.value)}><option value="">Unassigned</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Powers company-wide Spend Analyzer department rollups{isNew&&' — auto-added to Departments Involved below'}</div></div>
      <div className="form-group"><label className="form-label">Project Type</label><input className="form-input" list="project-types" value={form.project_type||''} onChange={e=>setForm(f=>({...f,project_type:e.target.value}))} placeholder="e.g. IoT Deployment, Internal Tool"/><div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Used to compare similar projects in Benchmarking</div></div>
    </div>
    <div className="form-group">
      <label className="form-label">Departments Involved (multiple)</label>
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        {departments.map(d=>{
          const checked=(form.involvedDeptIds||[]).includes(d.id)
          return (
            <label key={d.id} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:20,border:'1.5px solid var(--border)',background:checked?'var(--c1-soft)':'var(--surface)',cursor:'pointer',fontSize:12,fontWeight:checked?700:500,color:checked?'var(--c1)':'inherit'}}>
              <input type="checkbox" checked={checked} style={{accentColor:'var(--c1)'}}
                onChange={e=>setForm(f=>{const cur=f.involvedDeptIds||[];return {...f,involvedDeptIds:e.target.checked?[...cur,d.id]:cur.filter(id=>id!==d.id)}})}/>
              {d.name}
            </label>
          )
        })}
        {departments.length===0&&<span style={{fontSize:12,color:'var(--text-muted)'}}>No departments configured — add some in Settings → Departments.</span>}
      </div>
      <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Each department checked here must sign off (Fund Flow tab) before this project's fund flow can close</div>
    </div>
    <div className="form-row">
      <div className="form-group"><label className="form-label">Status</label><select className="form-select" value={form.status||'active'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{['active','on_hold','completed','cancelled'].map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></div>
      <div className="form-group"><label className="form-label">Total Budget (₹)</label><input className="form-input" type="number" value={form.budget||''} onChange={e=>setForm(f=>({...f,budget:e.target.value}))} placeholder="0"/></div>
    </div>
    <div className="form-row">
      <div className="form-group"><label className="form-label">Reserved Budget (₹)</label><input className="form-input" type="number" value={form.reserved_budget||''} onChange={e=>setForm(f=>({...f,reserved_budget:e.target.value}))} placeholder="Contingency"/><div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Committed but not yet spent</div></div>
      <div className="form-group"><label className="form-label">Available Now</label><div style={{padding:'9px 12px',borderRadius:'var(--radius-sm)',background:'var(--bg-3)',border:'1px solid var(--border)',fontFamily:'var(--font-mono)',fontWeight:700,fontSize:14,color:avail>0?'var(--emerald)':'var(--rose)'}}>{rupee(avail)}</div><div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Total − Reserved</div></div>
    </div>
    <div className="form-row">
      <div className="form-group"><label className="form-label">Start Date</label><input className="form-input" type="date" value={form.start_date||''} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))}/></div>
      <div className="form-group"><label className="form-label">End Date</label><input className="form-input" type="date" value={form.end_date||''} min={form.start_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))}/></div>
    </div>
    <div className="form-group"><label className="form-label">Goal</label><textarea className="form-textarea" value={form.goal||''} onChange={e=>setForm(f=>({...f,goal:e.target.value}))} placeholder="What this project is trying to achieve…" rows={2}/><div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Shown as a summary on this project's report</div></div>
    <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Scope, notes…"/></div>
    <datalist id="project-types"><option value="IoT Deployment"/><option value="Internal Tool"/><option value="Client Services"/><option value="R&D"/></datalist>
  </>)
}

/* ══ MAIN ══════════════════════════════════════════════════ */
export default function ProjectsPage() {
  const { profile } = useAuth()
  const role    = profile?.role||'employee'
  const canEdit = ['admin','ceo','manager','finance','department_head'].includes(role)
  const canBill = ['admin','ceo','finance'].includes(role)
  const navigate = useNavigate()

  // list
  const [projects,setProjects]=useState([]);const [loading,setLoading]=useState(true)
  const [customers,setCustomers]=useState([])
  const [departments,setDepartments]=useState([])
  const [companyContext,setCompanyContext]=useState(null)
  const [search,setSearch]=useState('');const [statusF,setStatusF]=useState('')
  const [dateRange,setDateRange]=useState({from:'',to:''})
  const [showPM,setShowPM]=useState(false);const [editP,setEditP]=useState(null)
  const [pForm,setPForm]=useState(iP());const [subP,setSubP]=useState(false)
  const [delP,setDelP]=useState(null)

  // detail
  const [detail,setDetail]=useState(null);const [dd,setDD]=useState(null)
  const [ddLoad,setDDLoad]=useState(false)
  const [searchParams,setSearchParams]=useSearchParams()
  const tab=searchParams.get('view')||'overview'
  const [ganttWindow,setGanttWindow]=useState(()=>new Date())
  const [financeLoading,setFinanceLoading]=useState(false)
  const [financeLoaded,setFinanceLoaded]=useState(false)
  const [closureLoading,setClosureLoading]=useState(false)
  const [closureLoaded,setClosureLoaded]=useState(false)
  const [closureDepts,setClosureDepts]=useState([])
  const [addDeptId,setAddDeptId]=useState('')

  // MS
  const [showMS,setShowMS]=useState(false);const [editMS,setEditMS]=useState(null)
  const [msForm,setMsForm]=useState(iMS());const [subMS,setSubMS]=useState(false)
  // SW/HW/Sup/RA
  const [showSW,setShowSW]=useState(false);const [editSW,setEditSW]=useState(null);const [swForm,setSwForm]=useState({})
  const [showHW,setShowHW]=useState(false);const [editHW,setEditHW]=useState(null);const [hwForm,setHwForm]=useState({})
  // STEP246 — hardware lines generated from Device Instances (devices + fitted sensors)
  const [autoHW,setAutoHW]=useState(null);const [hwSyncing,setHwSyncing]=useState(false)
  async function resyncHW(){
    setHwSyncing(true)
    try{const {error}=await supabase.rpc('sync_project_device_hardware',{p_project:detail.id});if(error)throw error;openDetail(detail)}
    catch(e){alert(/does not exist|schema cache/i.test(e.message)?'Run sql/STEP246_project_hardware_from_devices.sql in the Supabase SQL Editor first.':e.message)}
    finally{setHwSyncing(false)}
  }
  async function saveAutoHW(){
    setSubCost(true)
    try{
      const q=Number(autoHW.qty)||0,override=!autoHW.useCatalogue,up=override?(parseFloat(autoHW.unit_price)||0):Number(autoHW.row.unit_price)||0,co=Math.round(q*up*100)/100
      const {error}=await supabase.from('project_hardware_costs').update({price_override:override,unit_price:up,total_price:co,cost_company:co,cost_client:parseFloat(autoHW.cost_client)||co*1.3,proposal_cost:parseFloat(autoHW.proposal_cost)||co*1.5}).eq('id',autoHW.row.id)
      if(error)throw error
      await supabase.rpc('sync_project_device_hardware',{p_project:detail.id})
      setAutoHW(null);openDetail(detail)
    }catch(e){alert(e.message)}finally{setSubCost(false)}
  }
  const [showSup,setShowSup]=useState(false);const [editSup,setEditSup]=useState(null);const [supForm,setSupForm]=useState({})
  const [showRA,setShowRA]=useState(false);const [editRA,setEditRA]=useState(null);const [raForm,setRaForm]=useState({})
  const [subCost,setSubCost]=useState(false);const [delItem,setDelItem]=useState(null)
  // %-based Allocations (the `allocations` table, approval-workflow) —
  // create/edit directly from the Resourcing tab instead of only from the
  // separate Allocations page. Deliberately a distinct state set from
  // showRA/editRA/raForm above (the legacy hours-per-month modal) — the
  // two write to different tables with different shapes.
  const [showAlloc,setShowAlloc]=useState(false);const [editAlloc,setEditAlloc]=useState(null)
  const [allocForm,setAllocForm]=useState({employee_id:'',allocation_percent:50,role_on_project:'',start_date:'',end_date:'',override:false,override_justification:''})
  const [allocConflict,setAllocConflict]=useState(null);const [subAlloc,setSubAlloc]=useState(false);const [delAlloc,setDelAlloc]=useState(null)
  const [allocRemainingPct,setAllocRemainingPct]=useState(null) // this employee's capacity left, company-wide — same definition as "Still Available"
  // CR
  const [showCR,setShowCR]=useState(false);const [editCR,setEditCR]=useState(null)
  const [crForm,setCrForm]=useState(iCR());const [subCR,setSubCR]=useState(false)
  // cats
  const [swCats,setSwCats]=useState(SW0);const [hwCats,setHwCats]=useState(HW0);const [supCats,setSupCats]=useState(SUP0)

  useEffect(()=>{loadList()},[])

  async function loadList() {
    setLoading(true)
    const[{data},{data:custData},{data:deptData}]=await Promise.all([
      supabase.from('projects').select('*').order('created_at',{ascending:false}),
      supabase.from('customers').select('id,name').eq('status','active').order('name'),
      supabase.from('departments').select('id,name').order('name'),
    ])
    setProjects(data||[]);setCustomers(custData||[]);setDepartments(deptData||[]);setLoading(false)
  }

  async function openDetail(proj) {
    setDetail(proj);setDDLoad(true);setDD(null);setFinanceLoaded(false);setClosureLoaded(false);setClosureDepts([])
    setSearchParams(prev=>{const p=new URLSearchParams(prev);p.set('pname',proj.name);p.set('pid',proj.id);if(!p.get('view'))p.set('view','overview');return p},{replace:true})
    try {
      const[eR,lR,mR,swR,hwR,suR,raR,rtR,emR,crR,alR,invR,warrantySummary,tkR,spR,rrR]=await Promise.all([
        supabase.from('expense_requests').select('amount,total_amount,status,expense_date,category,requester:profiles!requested_by(full_name)').eq('project_id',proj.id),
        supabase.from('time_logs').select('*,employee:profiles!employee_id(id,full_name)').eq('project_id',proj.id),
        supabase.from('project_milestones').select('*').eq('project_id',proj.id).order('due_date'),
        supabase.from('project_software_costs').select('*').eq('project_id',proj.id).order('created_at',{ascending:false}),
        supabase.from('project_hardware_costs').select('*').eq('project_id',proj.id).order('created_at',{ascending:false}),
        supabase.from('project_support_costs').select('*').eq('project_id',proj.id).order('created_at',{ascending:false}),
        supabase.from('project_resource_alloc').select('*,employee:profiles!employee_id(id,full_name,role,designation,default_weekly_capacity_hours),milestone:project_milestones(title)').eq('project_id',proj.id),
        supabase.from('resource_rates').select('*'),
        supabase.from('profiles').select('id,full_name,role').order('full_name'),
        supabase.from('change_requests').select('*,requester:profiles!requested_by(full_name)').eq('project_id',proj.id).order('created_at',{ascending:false}),
        supabase.from('allocations').select('*,employee:profiles!employee_id(full_name,role,designation)').eq('project_id',proj.id).order('start_date'),
        supabase.from('invoices').select('*,vendor:vendors(name)').eq('project_id',proj.id).order('created_at',{ascending:false}),
        getWarrantyCostSummaryForProject(proj.id).catch(()=>null),
        supabase.from('project_tasks').select('id,task_name,status,planned_start_date,planned_end_date,progress_pct,sprint_id,assignee:profiles!assigned_to(full_name)').eq('project_id',proj.id),
        supabase.from('sprints').select('id,name').eq('project_id',proj.id).order('start_date'),
        supabase.from('role_rates').select('*'),
      ])
      // Company-wide (every project, not just this one) committed capacity
      // per employee — needed to show "how much capacity does this resource
      // still have left" for the people allocated to THIS project; their
      // availability depends on ALL their allocations, not just this one.
      // Two disconnected allocation systems exist in this app (the newer
      // %-based `allocations` table, and the legacy hours-per-month
      // `project_resource_alloc` table tied to a milestone) — a resource
      // fully booked via the legacy system on some OTHER project must still
      // reduce what this view reports as their availability, so both are
      // queried company-wide and combined below.
      const now=new Date(); const curMonth=now.getMonth()+1, curYear=now.getFullYear()
      const allocatedEmployeeIds=[...new Set([...(alR.data||[]),...(raR.data||[])].map(a=>a.employee_id).filter(Boolean))]
      const [allAllocR,allLegacyAllocR]=allocatedEmployeeIds.length
        ? await Promise.all([
            supabase.from('allocations').select('employee_id,allocation_percent,status').in('employee_id',allocatedEmployeeIds).in('status',['approved','active']),
            supabase.from('project_resource_alloc').select('employee_id,allocated_hours,employee:profiles!employee_id(default_weekly_capacity_hours)').in('employee_id',allocatedEmployeeIds).eq('month',curMonth).eq('year',curYear),
          ])
        : [{data:[]},{data:[]}]
      setDD({expenses:eR.data||[],timelogs:lR.data||[],milestones:mR.data||[],sw:swR.data||[],hw:hwR.data||[],sup:suR.data||[],ra:raR.data||[],rates:rtR.data||[],employees:emR.data||[],changereqs:crR.data||[],allocations:alR.data||[],invoices:invR.data||[],warranty:warrantySummary,tasks:tkR.data||[],sprints:spR.data||[],roleRates:rrR.data||[],allEmployeeAllocations:allAllocR.data||[],allEmployeeLegacyAllocations:allLegacyAllocR.data||[],curMonth,curYear})
    }catch(e){console.error(e)}
    setDDLoad(false)
  }

  async function loadFinance(projectId, forceRecompute) {
    setFinanceLoading(true)
    try {
      if (forceRecompute || !financeLoaded) await recomputeForProject(projectId)
      const canViewMargin = MARGIN_VISIBLE_ROLES.includes(role)
      if (canViewMargin && (forceRecompute || !financeLoaded)) {
        await recomputeMargin(projectId, profile.id)
        // If this project originated from the Sales CRM (Opportunity ->
        // Convert to Proposal -> Project), keep SalesProfitAttribution in
        // sync with the same recompute this triggers — same call site
        // recomputeMargin() itself is invoked from, not a separate trigger.
        const opportunityId = await findOpportunityForProject(projectId)
        if (opportunityId) {
          await recomputeSalesProfitAttribution(opportunityId)
          // Marketing's CampaignResult.revenue_attributed_realized reads the
          // same sales_profit_attribution row just recomputed above — keep
          // it in sync here too, at the one place this recompute actually
          // fires, rather than a marketingCampaigns.js <-> salesFinance.js
          // circular import.
          const campaignId = await findCampaignForOpportunity(opportunityId)
          if (campaignId) await recomputeCampaignResult(campaignId)
        }
      }
      const [snap, burn, margin, allFindings, warranty] = await Promise.all([
        getActualCostSnapshot(projectId), getBurnRate(projectId),
        canViewMargin ? getMargin(projectId) : Promise.resolve(null),
        getFindings().catch(() => []),
        getWarrantyCostSummaryForProject(projectId).catch(() => null),
      ])
      const projectFindings = (allFindings || []).filter(f => (f.related_project_ids || []).includes(projectId) && f.status !== 'dismissed')
      setDD(prev => prev && ({ ...prev, actualCost: snap, burnRate: burn, margin, warranty }))
      setCompanyContext({ findings: projectFindings })
      setFinanceLoaded(true)
    } catch (e) { console.error(e) } finally { setFinanceLoading(false) }
  }

  useEffect(() => {
    if (tab === 'finance' && detail?.id && !financeLoaded && !financeLoading) loadFinance(detail.id)
  }, [tab, detail?.id])

  async function loadClosure(projectId) {
    setClosureLoading(true)
    try { setClosureDepts(await listProjectDepartments(projectId)) }
    catch (e) { console.error(e) } finally { setClosureLoading(false); setClosureLoaded(true) }
  }

  useEffect(() => {
    if (tab === 'closure' && detail?.id && !closureLoaded && !closureLoading) loadClosure(detail.id)
  }, [tab, detail?.id])

  async function handleAddDept() {
    if (!addDeptId || !detail?.id) return
    try { await addProjectDepartment(detail.id, addDeptId); setAddDeptId(''); await loadClosure(detail.id) }
    catch (e) { alert(e.message) }
  }
  async function handleRemoveDept(id) {
    try { await removeProjectDepartment(id); await loadClosure(detail.id) }
    catch (e) { alert(e.message) }
  }
  async function handleSignOff(id) {
    try { await signOffDepartment(id, profile.id); await loadClosure(detail.id) }
    catch (e) { alert(e.message) }
  }
  async function handleUndoSignOff(id) {
    try { await undoSignOffDepartment(id); await loadClosure(detail.id) }
    catch (e) { alert(e.message) }
  }
  async function handleCloseFundFlow() {
    try { await closeFundFlow(detail.id, profile.id); const {data}=await supabase.from('projects').select('*').eq('id',detail.id).single(); if(data)setDetail(data); await loadClosure(detail.id) }
    catch (e) { alert(e.message) }
  }
  async function handleReopenFundFlow() {
    try { await reopenFundFlow(detail.id); const {data}=await supabase.from('projects').select('*').eq('id',detail.id).single(); if(data)setDetail(data) }
    catch (e) { alert(e.message) }
  }

  // Sidebar "Switch Project" sets ?pid=<id> — open that project once it's available
  useEffect(()=>{
    const pid=searchParams.get('pid')
    if(!pid||pid===detail?.id||projects.length===0)return
    const proj=projects.find(p=>p.id===pid)
    if(proj)openDetail(proj)
  },[searchParams,projects])

  async function openEditProject(proj) {
    setEditP(proj)
    let involvedDeptIds=[]
    try { involvedDeptIds=(await listProjectDepartments(proj.id)).map(d=>d.department_id) } catch(e){ console.error(e) }
    setPForm({name:proj.name,description:proj.description||'',goal:proj.goal||'',budget:proj.budget||'',reserved_budget:proj.reserved_budget||'',start_date:proj.start_date||'',end_date:proj.end_date||'',status:proj.status,customer_id:proj.customer_id||'',department_id:proj.department_id||'',project_type:proj.project_type||'',involvedDeptIds})
    setShowPM(true)
  }

  async function saveProject(e) {
    e.preventDefault();setSubP(true)
    try {
      const p={name:pForm.name,description:pForm.description||null,goal:pForm.goal||null,budget:parseFloat(pForm.budget)||0,reserved_budget:parseFloat(pForm.reserved_budget)||0,start_date:pForm.start_date||null,end_date:pForm.end_date||null,status:pForm.status,customer_id:pForm.customer_id||null,department_id:pForm.department_id||null,project_type:pForm.project_type||null}
      let projectId=editP?.id
      if(editP){await supabase.from('projects').update(p).eq('id',editP.id);if(detail?.id===editP.id)setDetail(d=>({...d,...p}))}
      else {
        const {data}=await supabase.from('projects').insert({...p,code:'PRJ-'+Date.now().toString().slice(-6),created_by:profile.id}).select().single()
        projectId=data?.id
      }
      if(projectId){
        const current=await listProjectDepartments(projectId)
        const wanted=pForm.involvedDeptIds||[]
        for(const id of wanted) if(!current.some(c=>c.department_id===id)) await addProjectDepartment(projectId,id)
        for(const c of current) if(!wanted.includes(c.department_id)) await removeProjectDepartment(c.id)
        if(detail?.id===projectId) loadClosure(projectId)
      }
      setShowPM(false);loadList()
    }catch(e){alert(e.message)}finally{setSubP(false)}
  }

  async function saveMS(e) {
    e.preventDefault();setSubMS(true)
    try {
      const p={title:msForm.title,description:msForm.description||null,start_date:msForm.start_date||null,due_date:msForm.due_date||null,actual_start:msForm.actual_start||null,actual_end:msForm.actual_end||null,budget:parseFloat(msForm.budget)||0,status:msForm.status,project_id:detail.id}
      editMS?await supabase.from('project_milestones').update(p).eq('id',editMS.id):await supabase.from('project_milestones').insert({...p,created_by:profile.id})
      setShowMS(false);setEditMS(null);setMsForm(iMS());openDetail(detail)
    }catch(e){alert(e.message)}finally{setSubMS(false)}
  }

  async function saveCost(table,payload,editItem,closeFn) {
    setSubCost(true)
    try {
      const p={...payload,project_id:detail.id}
      editItem?await supabase.from(table).update(p).eq('id',editItem.id):await supabase.from(table).insert({...p,created_by:profile.id})
      if(closeFn)closeFn();openDetail(detail)
    }catch(e){alert(e.message)}finally{setSubCost(false)}
  }

  // %-based Allocations, created/edited directly from the Resourcing tab.
  // Conflict re-checked live as the form changes, same overlap rule the
  // Allocations page itself uses (src/lib/allocations.js) — a project
  // owner staffing from here sees the exact same over-allocation warning
  // a request from that separate page would.
  useEffect(() => {
    (async () => {
      if (showAlloc && allocForm.employee_id && allocForm.start_date && allocForm.allocation_percent) {
        const c = await checkAllocationConflict(allocForm.employee_id, allocForm.allocation_percent, allocForm.start_date, allocForm.end_date, editAlloc?.id)
        setAllocConflict(c)
      } else setAllocConflict(null)
    })()
  }, [showAlloc, allocForm.employee_id, allocForm.start_date, allocForm.end_date, allocForm.allocation_percent, editAlloc])

  // Shows (and caps the % field at) how much capacity this person has
  // left, company-wide — same figure as "Still Available" in the table
  // below, so it never disagrees with what shows up there afterward.
  // Excludes the allocation being edited from its own total.
  useEffect(() => {
    if (!showAlloc || !allocForm.employee_id) { setAllocRemainingPct(null); return }
    let cancelled = false
    getRemainingCapacityPct(allocForm.employee_id, editAlloc?.id).then(pct => {
      if (cancelled) return
      setAllocRemainingPct(pct)
      setAllocForm(f => (Number(f.allocation_percent) > pct ? { ...f, allocation_percent: Math.max(0, pct) } : f))
    })
    return () => { cancelled = true }
  }, [showAlloc, allocForm.employee_id, editAlloc])

  function openAddAlloc() {
    setEditAlloc(null)
    setAllocForm({employee_id:'',allocation_percent:50,role_on_project:'',start_date:'',end_date:'',override:false,override_justification:''})
    setAllocConflict(null); setShowAlloc(true)
  }
  function openEditAlloc(a) {
    setEditAlloc(a)
    setAllocForm({employee_id:a.employee_id,allocation_percent:a.allocation_percent,role_on_project:a.role_on_project||'',start_date:a.start_date||'',end_date:a.end_date||'',override:false,override_justification:''})
    setAllocConflict(null); setShowAlloc(true)
  }

  async function submitAllocForm(e) {
    e.preventDefault()
    if (allocConflict && !allocForm.override) { alert('Resolve the over-allocation warning first — check the override box to proceed.'); return }
    setSubAlloc(true)
    try {
      const employee = (dd?.employees||[]).find(u=>u.id===allocForm.employee_id)
      // Employees fetched for this project's pickers don't carry
      // reporting_manager_id/default_weekly_capacity_hours — fetch fresh
      // rather than assume every caller of openDetail() widens that select.
      const {data:empFull} = await supabase.from('profiles').select('id,full_name,reporting_manager_id,default_weekly_capacity_hours').eq('id',allocForm.employee_id).maybeSingle()
      if (editAlloc) {
        await updateAllocation(editAlloc.id, {
          percent: allocForm.allocation_percent, roleOnProject: allocForm.role_on_project,
          startDate: allocForm.start_date, endDate: allocForm.end_date, weeklyCapacity: empFull?.default_weekly_capacity_hours,
        })
      } else {
        await submitAllocationRequest({
          employeeId: allocForm.employee_id, projectId: detail.id, percent: allocForm.allocation_percent,
          roleOnProject: allocForm.role_on_project, startDate: allocForm.start_date, endDate: allocForm.end_date,
          requestedBy: profile.id, weeklyCapacity: empFull?.default_weekly_capacity_hours,
          conflict: allocConflict, overrideJustification: allocForm.override_justification,
          reportingManagerId: empFull?.reporting_manager_id, employeeName: employee?.full_name, projectName: detail.name,
        })
      }
      setShowAlloc(false); setEditAlloc(null); openDetail(detail)
      if (!editAlloc) alert(empFull?.reporting_manager_id ? 'Request submitted for approval.' : 'Request saved — but this employee has no reporting manager set, so it cannot be approved until one is assigned on the Users page.')
    } catch (e) { alert(e.message) } finally { setSubAlloc(false) }
  }

  async function removeAlloc(id) {
    try { await deleteAllocation(id); setDelAlloc(null); openDetail(detail) }
    catch (e) { alert(e.message) }
  }

  async function saveCR(e) {
    e.preventDefault();setSubCR(true)
    try {
      const p={title:crForm.title,description:crForm.description||null,reason:crForm.reason||null,priority:crForm.priority||'medium',status:crForm.status||'draft',estimated_hours:parseFloat(crForm.estimated_hours)||null,actual_hours:parseFloat(crForm.actual_hours)||null,estimated_cost:parseFloat(crForm.estimated_cost)||null,actual_cost:parseFloat(crForm.actual_cost)||null,project_id:detail.id,requested_by:profile.id}
      editCR?await supabase.from('change_requests').update(p).eq('id',editCR.id):await supabase.from('change_requests').insert(p)
      setShowCR(false);setEditCR(null);setCrForm(iCR());openDetail(detail)
    }catch(e){alert(e.message)}finally{setSubCR(false)}
  }

  const kpi=useMemo(()=>computeKPIs(dd),[dd])
  const filtered=projects.filter(p=>{
    if(search&&!p.name?.toLowerCase().includes(search.toLowerCase()))return false
    if(statusF&&p.status!==statusF)return false
    if(dateRange.from&&p.start_date&&p.start_date<dateRange.from)return false
    if(dateRange.to&&p.end_date&&p.end_date>dateRange.to)return false
    return true
  })

  const EBtn=({onClick})=><button className="btn btn-ghost btn-sm btn-icon" onClick={onClick}><Edit2 size={11}/></button>
  const DBtn=({t,id})=><button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} onClick={()=>setDelItem({table:t,id})}><Trash2 size={11}/></button>
  const MsSel=({val,set})=><select className="form-select" value={val||''} onChange={e=>set(e.target.value)}><option value="">—</option>{(dd?.milestones||[]).map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select>

  /* ════════════════════════════ DETAIL VIEW ════════════════ */
  if (detail) {
    const ms=dd?.milestones||[]
    const realSpent=kpi.totalCo||0
    const realPct=detail.budget>0?Math.min(100,Math.round((realSpent/detail.budget)*100)):0
    const avail=Math.max(0,(detail.budget||0)-(detail.reserved_budget||0)-realSpent)

    return (
      <div>
        {/* ── PROJECT HEADER ── */}
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderTop:`4px solid ${SC[detail.status]||'#94a3b8'}`,borderRadius:16,padding:'18px 22px',marginBottom:16,boxShadow:'var(--shadow-sm)'}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:220}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>{setDetail(null);setSearchParams(prev=>{const p=new URLSearchParams(prev);p.delete('pname');p.delete('pid');p.delete('view');return p},{replace:true})}}
                style={{display:'flex',alignItems:'center',gap:5,padding:'2px 0',marginBottom:10,color:'var(--text-muted)',fontSize:12}}>
                <ArrowLeft size={13}/> All Projects
              </button>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--font-head)',fontWeight:800,fontSize:24,lineHeight:1.2}}>{detail.name}</span>
                <Pill s={detail.status} map={SC}/>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:8,fontSize:12,color:'var(--text-muted)'}}>
                <span style={{fontFamily:'var(--font-mono)'}}>{detail.code}</span>
                {detail.customer_id&&<span style={{padding:'2px 10px',borderRadius:20,background:'var(--c1-soft)',color:'var(--c1)',fontWeight:700,fontSize:11}}>🏢 {customers.find(c=>c.id===detail.customer_id)?.name||'Customer'}</span>}
                {(detail.start_date||detail.end_date)&&<span>📅 {dateFmt(detail.start_date)||'—'} → {dateFmt(detail.end_date)||'—'}</span>}
              </div>
              {detail.goal&&<div style={{marginTop:12,padding:'10px 14px',borderRadius:10,background:'var(--c1-soft)',maxWidth:680}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--c1)',marginBottom:3}}>🎯 Goal</div>
                <div style={{fontSize:13,color:'var(--text-soft)',lineHeight:1.5}}>{detail.goal}</div>
              </div>}
              {detail.description&&<div style={{marginTop:12,fontSize:13,color:'var(--text-soft)',maxWidth:680,lineHeight:1.5}}>{detail.description}</div>}
            </div>
            {canEdit&&<div style={{display:'flex',gap:8,flexShrink:0}}>
              <button className="btn btn-outline btn-sm" onClick={()=>openEditProject(detail)}><Edit2 size={12}/> Edit</button>
              <button className="btn btn-primary btn-sm" onClick={()=>{setEditMS(null);setMsForm(iMS());setShowMS(true)}}><Plus size={12}/> Milestone</button>
            </div>}
          </div>
        </div>

        {/* ── TWO BUDGET CARDS (Overview only) ── */}
        {dd&&tab==='overview'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
            {/* Card 1: Allocated vs Spent */}
            <div className="hover-lift" style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,boxShadow:'var(--shadow-sm)'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
                <div><div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--text-muted)'}}>ALLOCATED</div><div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:26,color:'var(--c1)',lineHeight:1.1,marginTop:4}}>{rupee(detail.budget)}</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--text-muted)'}}>SPENT</div><div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:26,color:realPct>100?'var(--rose)':'var(--amber)',lineHeight:1.1,marginTop:4}}>{rupee(realSpent)}</div></div>
              </div>
              <div style={{height:10,borderRadius:99,background:'var(--bg-3)',overflow:'hidden',display:'flex',marginBottom:8}}>
                {detail.budget>0&&[{v:kpi.hrCost,c:'#3b82f6'},{v:kpi.swCo,c:'#8b5cf6'},{v:kpi.hwCo,c:'#f59e0b'},{v:kpi.spCo,c:'#14b8a6'},{v:kpi.expOk,c:'#e11d48'}].map((seg,i)=>{const w=Math.min(100,(seg.v||0)/detail.budget*100);return w>0?<div key={i} style={{width:`${w}%`,background:seg.c,height:'100%',minWidth:2}} title={rupee(seg.v)}/>:null})}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',fontSize:10,color:'var(--text-muted)',marginBottom:8}}>
                {[{c:'#3b82f6',l:'HR',v:kpi.hrCost},{c:'#8b5cf6',l:'SW',v:kpi.swCo},{c:'#f59e0b',l:'HW',v:kpi.hwCo},{c:'#14b8a6',l:'Support',v:kpi.spCo},{c:'#e11d48',l:'Exp',v:kpi.expOk}].map(s=>(
                  <span key={s.l} style={{display:'flex',alignItems:'center',gap:3}}><span style={{width:7,height:7,borderRadius:2,background:s.c}}/>{s.l}: <strong style={{color:'var(--text)'}}>{rupee(s.v)}</strong></span>
                ))}
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontWeight:600}}>
                <span style={{color:'var(--text-muted)'}}>Available: <span style={{color:avail>0?'var(--emerald)':'var(--rose)',fontFamily:'var(--font-mono)'}}>{rupee(avail)}</span></span>
                <span style={{color:realPct>100?'var(--rose)':'var(--text-muted)'}}>{realPct}%{realPct>100?' ⚠':''}</span>
              </div>
            </div>
            {/* Card 2: Milestone */}
            <div className="hover-lift" style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:20,boxShadow:'var(--shadow-sm)'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
                <div><div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--text-muted)'}}>MS BUDGET</div><div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:26,color:'#7c3aed',lineHeight:1.1,marginTop:4}}>{rupee(kpi.msBudget||0)}</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--text-muted)'}}>MS SPENT</div><div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:26,color:'var(--amber)',lineHeight:1.1,marginTop:4}}>{rupee(kpi.msSpent||0)}</div></div>
              </div>
              <div style={{height:8,borderRadius:99,background:'var(--bg-3)',overflow:'hidden',marginBottom:10}}>
                <div style={{height:'100%',width:`${kpi.msBudget>0?Math.min(100,((kpi.msSpent||0)/kpi.msBudget)*100):0}%`,background:'#7c3aed',borderRadius:99}}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:5}}>
                {(kpi.msByHrs||[]).slice(0,5).map(m=>(
                  <div key={m.id} style={{display:'flex',alignItems:'center',gap:8,fontSize:11}}>
                    <span style={{width:6,height:6,borderRadius:'50%',background:'#7c3aed',flexShrink:0}}/>
                    <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--text-soft)'}}>{m.title}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--c1)'}}>{m.logged.toFixed(1)}h</span>
                    <span style={{color:'var(--text-muted)'}}>/{m.allocated}h</span>
                  </div>
                ))}
                {ms.length===0&&<div style={{fontSize:11,color:'var(--text-muted)',fontStyle:'italic'}}>No milestones yet</div>}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB-SCOPED KPI STRIP ── */}
        {dd&&(()=>{
          const msDone=ms.filter(m=>m.status==='completed').length
          const msDelayed=ms.filter(m=>m.status==='delayed').length
          const msActive=ms.filter(m=>m.status==='in_progress').length
          const expList=dd.expenses||[]
          const expApproved=expList.filter(e=>e.status==='approved').length
          const expPending=expList.filter(e=>!['approved','rejected','closed'].includes(e.status)).length
          const expTotalAmt=expList.reduce((s,e)=>s+(e.total_amount||e.amount||0),0)
          const crList=dd.changereqs||[]
          const crDone=crList.filter(c=>['approved','implemented'].includes(c.status)).length
          const crPending=crList.filter(c=>['draft','submitted','under_review'].includes(c.status)).length
          const raList=dd.ra||[]
          const raEmployees=new Set(raList.map(r=>r.employee_id||r.employee?.id)).size

          // Forward-looking weekly cost of the CURRENT active/approved team —
          // resolveHourlyRate falls back through role_rates (by designation)
          // to resource_rates, the same chain computePeopleCostForProject
          // uses for the to-date Finance-tab rollup, so this snapshot and
          // that rollup never silently disagree on what a designation costs.
          const activeAllocsForCost=(dd.allocations||[]).filter(a=>['approved','active'].includes(a.status))
          const weeklyResourcingCost=activeAllocsForCost.reduce((s,a)=>{
            const hr=resolveHourlyRate({designation:a.employee?.designation,employeeId:a.employee_id,roleRates:dd.roleRates,resourceRates:dd.rates})
            return s+(a.allocation_hours_per_week||0)*hr
          },0)
          // Average weeks/month (365.25/12/7), not a flat ×4 — a flat
          // multiplier understates most months and silently drifts further
          // every leap year.
          const monthlyResourcingCost=weeklyResourcingCost*(365.25/12/7)
          // Legacy system (project_resource_alloc — hours for a specific
          // month/milestone, no approval workflow) has no clean weekly
          // figure of its own, but allocated_hours IS already a whole
          // month's hours, so it folds straight into the monthly total —
          // this is what makes "Monthly Cost Run-Rate" match the unified
          // Resourcing table below instead of silently excluding anyone
          // only allocated the legacy way (see openDetail()'s comment).
          const legacyMonthlyCost=(dd.ra||[]).reduce((s,r)=>{
            const hr=resolveHourlyRate({designation:r.employee?.designation,employeeId:r.employee_id,roleRates:dd.roleRates,resourceRates:dd.rates})
            return s+(Number(r.allocated_hours)||0)*hr
          },0)
          // Same legacy rows, but divided back down to a weekly figure
          // using THAT row's own actual month (28-31 days ÷ 7), not the
          // flat average factor above — so "Wk Cost Run-Rate ×
          // weeks-in-that-month" reconciles exactly back to
          // legacyMonthlyCost for every legacy allocation, instead of
          // introducing rounding drift for the one source where the exact
          // month is already known.
          const legacyWeeklyCost=(dd.ra||[]).reduce((s,r)=>{
            const hr=resolveHourlyRate({designation:r.employee?.designation,employeeId:r.employee_id,roleRates:dd.roleRates,resourceRates:dd.rates})
            const weeks=daysInMonth(r.month,r.year)/7
            const hrsWk=weeks>0?(Number(r.allocated_hours)||0)/weeks:0
            return s+hrsWk*hr
          },0)
          const unifiedWeeklyCost=weeklyResourcingCost+legacyWeeklyCost
          const unifiedMonthlyCost=monthlyResourcingCost+legacyMonthlyCost
          const unifiedActiveTeamCount=new Set([...activeAllocsForCost.map(a=>a.employee_id),...(dd.ra||[]).map(r=>r.employee_id)]).size

          const KPI_SETS={
            overview:[
              {l:'Hours Logged',   v:`${Math.round(kpi.totalHrs||0)}h`,c:'#3b82f6'},
              {l:'Cost to Co.',    v:rupee(kpi.totalCo||0),            c:'var(--rose)'},
              {l:'Cost to Client', v:rupee(kpi.totalCl||0),            c:'var(--emerald)'},
              {l:'Proposal',       v:rupee(kpi.totalPr||0),            c:'#7c3aed'},
              {l:'Available',      v:rupee(avail),                      c:avail>0?'var(--emerald)':'var(--rose)'},
              {l:'Utilization',    v:`${realPct}%`,                    c:realPct>100?'var(--rose)':'var(--c1)'},
            ],
            milestones:[
              {l:'Total',          v:ms.length,                        c:'#6366f1'},
              {l:'Completed',      v:msDone,                           c:'#059669'},
              {l:'In Progress',    v:msActive,                         c:'#d97706'},
              {l:'Delayed',        v:msDelayed,                        c:'#e11d48'},
              {l:'MS Budget',      v:rupee(kpi.msBudget||0),           c:'#7c3aed'},
              {l:'MS Spent',       v:rupee(kpi.msSpent||0),            c:'var(--amber)'},
            ],
            resources:[
              {l:'Hours Logged',   v:`${Math.round(kpi.totalHrs||0)}h`,c:'#3b82f6'},
              {l:'Hour Cost',      v:rupee(kpi.hrCost||0),             c:'#8b5cf6'},
              {l:'Allocations',    v:raList.length,                    c:'#0891b2'},
              {l:'Employees',      v:raEmployees,                      c:'#6366f1'},
            ],
            resourcing:[
              {l:'Active Team',    v:unifiedActiveTeamCount, c:'#6366f1'},
              {l:'Requested',      v:(dd.allocations||[]).filter(a=>a.status==='requested').length, c:'#f59e0b'},
              {l:'Wk Cost Run-Rate', v:rupee(unifiedWeeklyCost), c:'var(--rose)'},
              {l:'Monthly Cost Run-Rate', v:rupee(unifiedMonthlyCost), c:'var(--rose)'},
            ],
            software:[
              {l:'SW Items',       v:(dd.sw||[]).length,               c:'#7c3aed'},
              {l:'Cost to Co.',    v:rupee(kpi.swCo||0),               c:'var(--rose)'},
              {l:'Cost to Client', v:rupee(kpi.swCl||0),               c:'var(--emerald)'},
              {l:'Proposal',       v:rupee(kpi.swPr||0),               c:'#7c3aed'},
            ],
            hardware:[
              {l:'HW Items',       v:(dd.hw||[]).length,               c:'#f59e0b'},
              {l:'Cost to Co.',    v:rupee(kpi.hwCo||0),               c:'var(--rose)'},
              {l:'Cost to Client', v:rupee(kpi.hwCl||0),               c:'var(--emerald)'},
              {l:'Proposal',       v:rupee(kpi.hwPr||0),               c:'#7c3aed'},
            ],
            support:[
              {l:'Support Items',  v:(dd.sup||[]).length,              c:'#14b8a6'},
              {l:'Cost to Co.',    v:rupee(kpi.spCo||0),               c:'var(--rose)'},
              {l:'Cost to Client', v:rupee(kpi.spCl||0),               c:'var(--emerald)'},
              {l:'Proposal',       v:rupee(kpi.spPr||0),               c:'#7c3aed'},
            ],
            expenses:[
              {l:'Total',          v:expList.length,                   c:'#6366f1'},
              {l:'Approved',       v:expApproved,                      c:'#10b981'},
              {l:'Pending',        v:expPending,                       c:'#f59e0b'},
              {l:'Approved Amt.',  v:rupee(kpi.expOk||0),              c:'var(--rose)'},
              {l:'Total Amt.',     v:rupee(expTotalAmt),               c:'#3b82f6'},
            ],
            changes:[
              {l:'CR Count',       v:kpi.crCount||0,                   c:'#f59e0b'},
              {l:'Approved/Impl.', v:crDone,                           c:'#10b981'},
              {l:'In Review',      v:crPending,                        c:'#3b82f6'},
              {l:'CR Hours',       v:`${kpi.crHrs||0}h`,               c:'#8b5cf6'},
              {l:'CR Cost',        v:rupee(kpi.crCost||0),             c:'var(--rose)'},
            ],
            budget:[
              {l:'Allocated',      v:rupee(detail.budget||0),          c:'#3b82f6'},
              {l:'Reserved',       v:rupee(detail.reserved_budget||0), c:'#8b5cf6'},
              {l:'Spent',          v:rupee(realSpent),                 c:realPct>100?'var(--rose)':'var(--amber)'},
              {l:'Available',      v:rupee(avail),                      c:avail>0?'var(--emerald)':'var(--rose)'},
              {l:'Utilization',    v:`${realPct}%`,                    c:realPct>100?'var(--rose)':'var(--c1)'},
            ],
            finance:[
              {l:'People Cost',    v:rupee(dd.actualCost?.people_cost||0),   c:'#8b5cf6'},
              {l:'Hardware Cost',  v:rupee(dd.actualCost?.hardware_cost||0), c:'#f59e0b'},
              {l:'Total Actual',   v:rupee(dd.actualCost?.total_actual_cost||0), c:'var(--rose)'},
              {l:'Spend vs Budget',v:dd.burnRate?.budgetAllocated>0?`${dd.burnRate.spendPct}%`:'—', c:(dd.burnRate?.willExceedBudget)?'var(--rose)':'var(--c1)'},
            ],
            closure:[
              {l:'Status',         v:detail.fund_flow_status==='closed'?'Closed':'Open', c:detail.fund_flow_status==='closed'?'var(--rose)':'#059669'},
              {l:'Tasks Closed',   v:`${(dd.tasks||[]).filter(t=>t.status==='closed').length}/${(dd.tasks||[]).length}`, c:'#3b82f6'},
              {l:'Depts Signed Off', v:`${closureDepts.filter(d=>d.status==='signed_off').length}/${closureDepts.length}`, c:'#8b5cf6'},
            ],
          }
          const activeKpis=KPI_SETS[tab]||KPI_SETS.overview
          return (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
              {activeKpis.map(s=><MiniKpi key={s.l} label={s.l} value={s.v} color={s.c}/>)}
            </div>
          )
        })()}

        {ddLoad&&<div style={{display:'flex',justifyContent:'center',padding:50}}><div className="spinner"/></div>}

        {/* ── OVERVIEW ── */}
        {!ddLoad&&tab==='overview'&&dd&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div className="card">
              <div className="card-header"><span className="card-title">📈 Monthly Cost Trend</span></div>
              <div className="card-body">
                {(kpi.expByMonth||[]).every(d=>d.expenses===0&&d.hrCost===0)
                  ?<div style={{textAlign:'center',padding:'30px 0',color:'var(--text-muted)',fontSize:12}}>No cost data yet</div>
                  :<ResponsiveContainer width="100%" height={210}>
                    <BarChart data={kpi.expByMonth} barSize={9} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                      <XAxis dataKey="month" tick={{fontSize:10,fill:'var(--text-muted)'}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
                      <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:8,fontSize:12,background:'var(--surface)',border:'1px solid var(--border)'}}/>
                      <Legend iconSize={8} wrapperStyle={{fontSize:11}}/>
                      <Bar dataKey="expenses" name="Expenses" fill="#e11d48" radius={[3,3,0,0]}/>
                      <Bar dataKey="hrCost"   name="HR Cost"  fill="#3b82f6" radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title">💰 Full Cost Summary</span></div>
              <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:460}}>
                <thead><tr style={{background:'var(--surface-2)'}}><TH c="Category"/><TH c="Items"/><TH c="Cost (Co.)"/><TH c="Cost (Client)"/><TH c="Proposal"/></tr></thead>
                <tbody>
                  {[{cat:'⏱ HR Cost',n:`${Math.round(kpi.totalHrs||0)}h`,co:kpi.hrCost,cl:kpi.hrCost,pr:kpi.hrCost},
                    {cat:'💻 Software',n:dd.sw?.length||0,co:kpi.swCo,cl:kpi.swCl,pr:kpi.swPr},
                    {cat:'🔧 Hardware',n:dd.hw?.length||0,co:kpi.hwCo,cl:kpi.hwCl,pr:kpi.hwPr},
                    {cat:'🛡 Warranty',n:kpi.wtyClaimCount||0,co:kpi.wtyCo,cl:null,pr:null},
                    {cat:'🛠 Support', n:dd.sup?.length||0,co:kpi.spCo,cl:kpi.spCl,pr:kpi.spPr},
                    {cat:'🧾 Expenses',n:dd.expenses?.filter(e=>e.status==='approved').length||0,co:kpi.expOk,cl:kpi.expOk,pr:kpi.expOk},
                  ].map((r,i)=>(
                    <tr key={i} onMouseEnter={e=>e.currentTarget.style.background='var(--bg-3)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <TD c={<span style={{fontWeight:600}}>{r.cat}</span>}/>
                      <TD c={<span style={{color:'var(--text-muted)',fontFamily:'var(--font-mono)',fontSize:11}}>{r.n}</span>}/>
                      <MTD v={r.co} color="#e11d48"/>
                      {r.cl===null ? <TD c={<span style={{color:'var(--text-muted)'}}>—</span>}/> : <MTD v={r.cl} color="#059669"/>}
                      {r.pr===null ? <TD c={<span style={{color:'var(--text-muted)'}}>—</span>}/> : <MTD v={r.pr} color="#7c3aed"/>}
                    </tr>
                  ))}
                  <tr style={{background:'var(--bg-3)',borderTop:'2px solid var(--border)'}}>
                    <td colSpan={2} style={{padding:'10px 14px',fontSize:13,fontWeight:800}}>TOTAL</td>
                    <td style={{padding:'10px 14px',fontFamily:'var(--font-mono)',fontWeight:800,color:'#e11d48'}}>{rupee(kpi.totalCo)}</td>
                    <td style={{padding:'10px 14px',fontFamily:'var(--font-mono)',fontWeight:800,color:'#059669'}}>{rupee(kpi.totalCl)}</td>
                    <td style={{padding:'10px 14px',fontFamily:'var(--font-mono)',fontWeight:800,color:'#7c3aed'}}>{rupee(kpi.totalPr)}</td>
                  </tr>
                </tbody>
              </table></div>
            </div>
          </div>
        )}

        {/* ── MILESTONES ── */}
        {!ddLoad&&tab==='gantt'&&(()=>{
          const tasks=dd?.tasks||[]
          const sprints=dd?.sprints||[]
          const msRows=ms.map(m=>({id:m.id,label:m.title,start:m.start_date||m.due_date,end:m.due_date||m.start_date,progress:m.status==='completed'?100:m.status==='in_progress'?50:0,color:MSC[m.status]||'#94a3b8'}))
          const taskRows=t=>t.map(x=>({id:x.id,label:x.task_name,sub:x.assignee?.full_name,start:x.planned_start_date,end:x.planned_end_date,progress:x.progress_pct||0,color:TSC[x.status]||'#64748b'}))
          const groups=[
            {title:'Milestones',rows:msRows},
            ...sprints.map(s=>({title:`Sprint: ${s.name}`,rows:taskRows(tasks.filter(x=>x.sprint_id===s.id))})),
            {title:'Backlog / No Sprint',rows:taskRows(tasks.filter(x=>!x.sprint_id))},
          ]
          return <GanttChart groups={groups}/>
        })()}

        {!ddLoad&&tab==='milestones'&&(
          <div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
              {canEdit&&<button className="btn btn-primary btn-sm" onClick={()=>{setEditMS(null);setMsForm(iMS());setShowMS(true)}}><Plus size={12}/> Add</button>}
            </div>
            {ms.length===0?<Empty icon="🏁" title="No milestones" desc="Add a milestone to track project phases"/>
              :ms.map(m=>{const mc=MSC[m.status]||'#94a3b8';const mh=(kpi.msByHrs||[]).find(x=>x.id===m.id)
                const hrsPct=mh&&mh.allocated>0?Math.min(100,Math.round((mh.logged/mh.allocated)*100)):null
                return (<div key={m.id} className="hover-lift" style={{background:'var(--surface)',border:`1px solid ${mc}25`,borderLeft:`4px solid ${mc}`,borderRadius:10,padding:'14px 18px',marginBottom:10,boxShadow:'var(--shadow-sm)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                    <div style={{flex:1,minWidth:220}}>
                      <div style={{fontWeight:700,fontSize:14,marginBottom:5}}>{m.title}</div>
                      {m.description&&<div style={{fontSize:12,color:'var(--text-muted)',marginBottom:7}}>{m.description}</div>}
                      <div style={{display:'flex',gap:14,fontSize:11,color:'var(--text-muted)',flexWrap:'wrap'}}>
                        {(m.start_date||m.due_date)&&<span>📅 {dateFmt(m.start_date)||'—'} → {dateFmt(m.due_date)||'—'}</span>}
                        {m.actual_start&&<span style={{color:'var(--emerald)'}}>✓ {dateFmt(m.actual_start)}{m.actual_end?` → ${dateFmt(m.actual_end)}`:''}</span>}
                        {m.budget>0&&<span style={{color:'var(--c1)',fontFamily:'var(--font-mono)',fontWeight:700}}>{rupee(m.budget)}</span>}
                      </div>
                      {mh&&mh.allocated>0&&(
                        <div style={{marginTop:9,maxWidth:260}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-muted)',marginBottom:3}}>
                            <span>Hours logged</span><span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:hrsPct>100?'var(--rose)':'var(--text)'}}>{mh.logged.toFixed(1)}h / {mh.allocated}h</span>
                          </div>
                          <div style={{height:5,borderRadius:99,background:'var(--bg-3)',overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${hrsPct}%`,background:hrsPct>100?'var(--rose)':'#3b82f6',borderRadius:99,transition:'width .3s'}}/>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:7,flexShrink:0}}>
                      <Pill s={m.status} map={MSC}/>
                      {m.billing_status&&m.billing_status!=='not_invoiced'&&<span style={{padding:'2px 8px',borderRadius:999,fontSize:10,fontWeight:700,background:'#ede9fe',color:'#6d28d9',textTransform:'capitalize'}}>{m.billing_status.replace('_',' ')}</span>}
                      {canBill&&(!m.billing_status||m.billing_status==='not_invoiced')&&<button className="btn btn-outline btn-sm" onClick={()=>navigate(`/customer-invoices?project_id=${detail.id}&milestone_id=${m.id}`)}>💰 Bill</button>}
                      {canEdit&&<><EBtn onClick={()=>{setEditMS(m);setMsForm({title:m.title,description:m.description||'',start_date:m.start_date||'',due_date:m.due_date||'',actual_start:m.actual_start||'',actual_end:m.actual_end||'',budget:m.budget||'',status:m.status||'pending'});setShowMS(true)}}/><DBtn t="project_milestones" id={m.id}/></>}
                    </div>
                  </div>
                </div>)
              })
            }
          </div>
        )}

        {/* ── RESOURCES ── */}
        {!ddLoad&&tab==='resources'&&(
          <div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
              {canEdit&&<button className="btn btn-primary btn-sm" onClick={()=>{setEditRA(null);setRaForm({employee_id:'',milestone_id:'',allocated_hours:'',idle_hours:'',month:new Date().getMonth()+1,year:new Date().getFullYear(),notes:''});setShowRA(true)}}><Plus size={12}/> Allocate</button>}
            </div>
            <div className="table-wrap"><table>
              <thead><tr><TH c="Employee"/><TH c="Milestone"/><TH c="Alloc.Hrs"/><TH c="Idle Hrs"/><TH c="Est.Cost"/><TH c="Month"/>{canEdit&&<TH c=""/>}</tr></thead>
              <tbody>
                {(dd?.ra||[]).length===0?<EmptyRow colSpan={7} icon="👥" text="No resource allocations yet"/>
                  :(dd?.ra||[]).map(r=>{const rt=(dd?.rates||[]).find(x=>x.employee_id===r.employee_id);const hr=rt?rt.hourly_rate||rt.monthly_salary/(22*8):0
                    return <tr key={r.id}>
                      <TD c={<div><div style={{fontWeight:600}}>{r.employee?.full_name||'—'}</div><div style={{fontSize:10,color:'var(--text-muted)',textTransform:'capitalize'}}>{r.employee?.role}</div></div>}/>
                      <TD c={<span style={{fontSize:11,color:'var(--text-muted)'}}>{r.milestone?.title||'—'}</span>}/>
                      <TD c={<span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--c1)'}}>{r.allocated_hours}h</span>}/>
                      <TD c={<span style={{fontFamily:'var(--font-mono)',color:'var(--amber)'}}>{r.idle_hours||0}h</span>}/>
                      <TD c={<span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'#e11d48'}}>{rupee((r.allocated_hours||0)*hr)}</span>}/>
                      <TD c={<span style={{fontSize:11,color:'var(--text-muted)'}}>{r.month?MOS[r.month-1]:''} {r.year||''}</span>}/>
                      {canEdit&&<TD c={<div style={{display:'flex',gap:4}}><EBtn onClick={()=>{setEditRA(r);setRaForm({employee_id:r.employee_id,milestone_id:r.milestone_id||'',allocated_hours:r.allocated_hours||'',idle_hours:r.idle_hours||'',month:r.month||new Date().getMonth()+1,year:r.year||new Date().getFullYear(),notes:r.notes||''});setShowRA(true)}}/><DBtn t="project_resource_alloc" id={r.id}/></div>}/>}
                    </tr>
                  })
                }
              </tbody>
            </table></div>
          </div>
        )}

        {/* ── RESOURCING (Phase 1 allocations table — staffing %/dates/approval; distinct from legacy Resources above) ── */}
        {!ddLoad&&tab==='resourcing'&&(()=>{
          const activeAllocs=(dd?.allocations||[]).filter(a=>['approved','active'].includes(a.status))
          const ganttRows=activeAllocs.map(a=>({id:a.id,label:a.employee?.full_name||'—',segments:[{start:a.start_date,end:a.end_date,color:'#6366f1',label:`${a.allocation_percent}%${a.role_on_project?' '+a.role_on_project:''}`}]}))
          const monthlyFactor=365.25/12/7

          // Company-wide committed % per employee, combining BOTH allocation
          // systems this app has (see openDetail()'s comment) — "still
          // available" must reflect everything a person is booked on,
          // whichever system it was entered through, not just one.
          const committedPctByEmp={}
          ;(dd?.allEmployeeAllocations||[]).forEach(a=>{committedPctByEmp[a.employee_id]=(committedPctByEmp[a.employee_id]||0)+(Number(a.allocation_percent)||0)})
          ;(dd?.allEmployeeLegacyAllocations||[]).forEach(a=>{
            const weeklyCap=a.employee?.default_weekly_capacity_hours||40
            const weeks=daysInMonth(dd.curMonth,dd.curYear)/7
            const pct=weeks>0&&weeklyCap>0?((Number(a.allocated_hours)||0)/weeks)/weeklyCap*100:0
            committedPctByEmp[a.employee_id]=(committedPctByEmp[a.employee_id]||0)+pct
          })

          // Actual hours logged this month per employee, ON THIS PROJECT —
          // dd.timelogs is already loaded for the whole project, so no new
          // fetch needed. Lets each row show planned vs actual instead of
          // just the plan.
          const now=new Date(), curMonthStart=new Date(now.getFullYear(),now.getMonth(),1)
          const actualHoursByEmp={}
          ;(dd?.timelogs||[]).forEach(t=>{
            if(!t.work_date||new Date(t.work_date)<curMonthStart) return
            const eid=t.employee?.id; if(!eid) return
            actualHoursByEmp[eid]=(actualHoursByEmp[eid]||0)+(Number(t.hours_worked)||0)
          })

          // Merge both sources into one list — % / hrs-per-week / monthly
          // cost are computed consistently regardless of source; legacy
          // rows have no date range or approval status, just a month/year
          // + milestone, shown as "Period" and a plain "Legacy" tag instead.
          // Only `allocations`-table rows (allocId set) can be edited/
          // deleted from here — legacy rows still only come from the
          // Resources tab.
          let totalMonthlyCost=0
          const rows=[
            ...(dd?.allocations||[]).map(a=>{
              const isActive=['approved','active'].includes(a.status)
              const hourlyRate=isActive?resolveHourlyRate({designation:a.employee?.designation,employeeId:a.employee_id,roleRates:dd.roleRates,resourceRates:dd.rates}):0
              const monthlyCost=isActive?(a.allocation_hours_per_week||0)*hourlyRate*monthlyFactor:0
              if(isActive) totalMonthlyCost+=monthlyCost
              return {key:`alloc-${a.id}`,allocId:a.id,raw:a,employee:a.employee,employeeId:a.employee_id,percent:a.allocation_percent,hrsWk:a.allocation_hours_per_week,
                monthlyCost,isActive,noRate:isActive&&hourlyRate===0,period:`${dateFmt(a.start_date)} → ${a.end_date?dateFmt(a.end_date):'Ongoing'}`,status:a.status}
            }),
            ...(dd?.ra||[]).map(r=>{
              const weeklyCap=r.employee?.default_weekly_capacity_hours||40
              const weeks=daysInMonth(r.month,r.year)/7
              const hrsWk=weeks>0?(Number(r.allocated_hours)||0)/weeks:0
              const percent=weeklyCap>0?Math.round((hrsWk/weeklyCap)*100):0
              const hourlyRate=resolveHourlyRate({designation:r.employee?.designation,employeeId:r.employee_id,roleRates:dd.roleRates,resourceRates:dd.rates})
              const monthlyCost=(Number(r.allocated_hours)||0)*hourlyRate
              totalMonthlyCost+=monthlyCost
              return {key:`legacy-${r.id}`,allocId:null,raw:r,employee:r.employee,employeeId:r.employee_id,percent,hrsWk:Math.round(hrsWk*10)/10,
                monthlyCost,isActive:true,noRate:hourlyRate===0,period:`${MOS[r.month-1]||r.month} ${r.year}${r.milestone?.title?' · '+r.milestone.title:''}`,status:null}
            }),
          ]

          return (
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{display:'flex',justifyContent:'flex-end'}}>
                {canEdit&&<button className="btn btn-primary btn-sm" onClick={openAddAlloc}><Plus size={13}/> Add Allocation</button>}
              </div>
              <AllocationGantt rows={ganttRows} windowStart={ganttWindow} weeks={10}
                onShiftWindow={delta=>setGanttWindow(w=>{const n=new Date(w);n.setDate(n.getDate()+delta*7);return n})}/>
              <div className="table-wrap"><table>
                <thead><tr><TH c="Employee"/><TH c="Role"/><TH c="%"/><TH c="Hrs/Wk"/><TH c="Actual (Mo.)"/><TH c="Monthly Cost"/><TH c="Still Available"/><TH c="Period"/><TH c="Source"/>{canEdit&&<TH c=""/>}</tr></thead>
                <tbody>
                  {rows.length===0?<EmptyRow colSpan={canEdit?10:9} icon="📅" text="No allocations for this project yet — click Add Allocation above, or allocate hours from the Resources tab"/>
                    :rows.map(a=>{
                      const committedPct=committedPctByEmp[a.employeeId]||0
                      const availablePct=Math.round(100-committedPct)
                      const actualHrs=actualHoursByEmp[a.employeeId]||0
                      const plannedThisMonth=a.hrsWk?a.hrsWk*(daysInMonth(now.getMonth()+1,now.getFullYear())/7):0
                      const variancePct=plannedThisMonth>0?Math.round((actualHrs/plannedThisMonth)*100):null
                      return (
                      <tr key={a.key}>
                        <TD c={<div><div style={{fontWeight:600}}>{a.employee?.full_name||'—'}</div><div style={{fontSize:10,color:'var(--text-muted)',textTransform:'capitalize'}}>{a.employee?.role}</div></div>}/>
                        <TD c={a.employee?.role||'—'}/>
                        <TD c={<span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--c1)'}}>{a.percent}%</span>}/>
                        <TD c={<span style={{fontFamily:'var(--font-mono)'}}>{a.hrsWk??'—'}h</span>}/>
                        <TD c={<div><span style={{fontFamily:'var(--font-mono)',fontWeight:700}}>{actualHrs.toFixed(1)}h</span>{variancePct!=null&&<div style={{fontSize:9.5,color:variancePct<70?'var(--rose)':variancePct>130?'var(--amber)':'var(--text-muted)'}}>{variancePct}% of plan</div>}</div>}/>
                        <TD c={!a.isActive?<span style={{color:'var(--text-muted)'}}>—</span>:a.noRate?<span title="No rate configured for this designation or employee — set one in Settings → Role Rates, or on this person in the Resources tab" style={{fontSize:11,fontWeight:700,color:'#f59e0b'}}>⚠ No rate</span>:<span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--rose)'}}>{rupee(a.monthlyCost)}</span>}/>
                        <TD c={<span title="Across every project and system this person is allocated in, not just this one" style={{fontFamily:'var(--font-mono)',fontWeight:700,color:availablePct<0?'var(--rose)':availablePct<20?'var(--amber)':'var(--emerald)'}}>{availablePct<0?`⚠ Over by ${Math.abs(availablePct)}%`:`${availablePct}%`}</span>}/>
                        <TD c={<span style={{fontSize:11.5}}>{a.period}</span>}/>
                        <TD c={a.status?<StatusBadge status={a.status}/>:<span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:'#f1f5f9',color:'#64748b'}}>Legacy (hrs)</span>}/>
                        {canEdit&&<TD c={a.allocId?<div style={{display:'flex',gap:3}}><button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={()=>openEditAlloc(a.raw)}><Edit2 size={12}/></button><button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} title="Delete" onClick={()=>setDelAlloc(a.allocId)}><Trash2 size={12}/></button></div>:<span style={{fontSize:10,color:'var(--text-muted)'}}>—</span>}/>}
                      </tr>
                      )
                    })}
                </tbody>
                {rows.length>0&&<tfoot><tr>
                  <td colSpan={5} style={{padding:'8px 14px',fontWeight:700,fontSize:12,textAlign:'right',borderTop:'2px solid var(--border)'}}>This Month's Resource Cost</td>
                  <td style={{padding:'8px 14px',fontWeight:800,fontFamily:'var(--font-mono)',color:'var(--rose)',borderTop:'2px solid var(--border)'}}>{rupee(totalMonthlyCost)}</td>
                  <td colSpan={canEdit?4:3} style={{borderTop:'2px solid var(--border)'}}/>
                </tr></tfoot>}
              </table></div>
              <div style={{fontSize:11,color:'var(--text-muted)'}}>Combines both allocation systems this app has — the %-based Allocations (Gantt above only shows this one) and the legacy hours-per-month Resources tab. "Still Available" is each person's remaining capacity across every project and system they're booked in. "Actual (Mo.)" is hours logged this calendar month via check-in/timesheets on this project, vs. their planned hrs/wk × weeks elapsed this month.</div>
            </div>
          )
        })()}

        {/* ── SOFTWARE ── */}
        {!ddLoad&&tab==='software'&&(
          <div>
            <div style={{display:'flex',gap:10,justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><SCard label="Cost (Co.)" value={rupee(kpi.swCo||0)} color="#e11d48"/><SCard label="Cost (Client)" value={rupee(kpi.swCl||0)} color="#059669"/><SCard label="Proposal" value={rupee(kpi.swPr||0)} color="#7c3aed"/></div>
              {canEdit&&<button className="btn btn-primary btn-sm" onClick={()=>{setEditSW(null);setSwForm({name:'',category:swCats[0],qty:1,unit_price:'',cost_company:'',cost_client:'',proposal_cost:'',billing_cycle:'monthly',notes:'',milestone_id:''});setShowSW(true)}}><Plus size={12}/> Add SW</button>}
            </div>
            <div className="table-wrap"><table>
              <thead><tr><TH c="Name"/><TH c="Cat"/><TH c="Qty"/><TH c="Unit"/><TH c="Cost(Co.)"/><TH c="Cost(Cl.)"/><TH c="Proposal"/><TH c="Billing"/><TH c="Milestone"/>{canEdit&&<TH c=""/>}</tr></thead>
              <tbody>{(dd?.sw||[]).length===0?<EmptyRow colSpan={10} icon="💻" text="No software costs recorded"/>:(dd?.sw||[]).map(r=><tr key={r.id}><TD c={<div><span style={{fontWeight:600}}>{r.name}</span>{r.per_seat&&<><span className="badge badge-info" style={{fontSize:9.5,marginLeft:6}}>Per seat</span><div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>{rupee(r.seat_price||0)} / user / {String(r.billing_cycle||'monthly').replace(/ly$/,'').replace('one_time','project')} · {r.qty||0} checked in this period · {r.seat_periods||0} seat-period{r.seat_periods===1?'':'s'} to date</div></>}</div>}/><TD c={<span className="badge badge-info" style={{fontSize:10}}>{r.category}</span>}/><TD c={<span style={{fontFamily:'var(--font-mono)'}}>{r.qty||1}</span>}/><TD c={<span style={{fontFamily:'var(--font-mono)'}}>{rupee(r.unit_price||0)}</span>}/><MTD v={r.cost_company} color="#e11d48"/><MTD v={r.cost_client} color="#059669"/><MTD v={r.proposal_cost} color="#7c3aed"/><TD c={<span style={{fontSize:10,color:'var(--text-muted)'}}>{r.billing_cycle?.replace(/_/g,' ')}</span>}/><TD c={<span style={{fontSize:10,color:'var(--text-muted)'}}>{ms.find(m=>m.id===r.milestone_id)?.title||'—'}</span>}/>{canEdit&&<TD c={<div style={{display:'flex',gap:3}}><EBtn onClick={()=>{setEditSW(r);setSwForm({name:r.name,category:r.category,qty:r.qty||1,unit_price:r.unit_price||'',cost_company:r.cost_company||'',cost_client:r.cost_client||'',proposal_cost:r.proposal_cost||'',billing_cycle:r.billing_cycle||'monthly',notes:r.notes||'',milestone_id:r.milestone_id||'',per_seat:!!r.per_seat,seat_price:r.seat_price||''});setShowSW(true)}}/><DBtn t="project_software_costs" id={r.id}/></div>}/>}</tr>)}</tbody>
            </table></div>
          </div>
        )}

        {/* ── HARDWARE ── */}
        {!ddLoad&&tab==='hardware'&&(
          <div>
            <div style={{display:'flex',gap:10,justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><SCard label="Cost (Co.)" value={rupee(kpi.hwCo||0)} color="#e11d48"/><SCard label="Cost (Client)" value={rupee(kpi.hwCl||0)} color="#059669"/><SCard label="Proposal" value={rupee(kpi.hwPr||0)} color="#7c3aed"/></div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {canEdit&&<button className="btn btn-ghost btn-sm" disabled={hwSyncing} onClick={resyncHW} title="Rebuild the automatic lines from the devices and sensors assigned to this project"><RefreshCw size={12}/> {hwSyncing?'Syncing…':'Resync from devices'}</button>}
                {canEdit&&<button className="btn btn-primary btn-sm" onClick={()=>{setEditHW(null);setHwForm({name:'',category:hwCats[0],qty:'1',unit_price:'',cost_company:'',cost_client:'',proposal_cost:'',vendor:'',notes:'',milestone_id:''});setShowHW(true)}}><Plus size={12}/> Add HW</button>}
              </div>
            </div>
            {(()=>{
              const auto=(dd?.hw||[]).filter(r=>r.source==='DEVICE_REGISTER')
              if(!auto.length) return <div className="alert alert-info" style={{fontSize:12.5,marginBottom:12}}>Devices assigned to this project in Device Instances, and the sensors fitted on them, appear here automatically as <strong>Auto</strong> lines priced from the product catalog. None are assigned yet{canEdit?' — or press Resync from devices':''}.</div>
              const dev=auto.filter(r=>r.category==='device').reduce((n,r)=>n+Number(r.qty||0),0),sen=auto.filter(r=>r.category==='sensor').reduce((n,r)=>n+Number(r.qty||0),0)
              const unpriced=auto.filter(r=>!Number(r.unit_price))
              const lc=x=>String(x||'').toLowerCase()
              const dupes=(dd?.hw||[]).filter(r=>r.source!=='DEVICE_REGISTER'&&auto.some(a=>{const part=(a.source_key||'').startsWith('device:')?a.source_key.slice(7):null;return (part&&lc(r.name).includes(lc(part)))||lc(r.name)===lc(a.name.replace(/\s*\(.*\)$/,''))}))
              return (
                <div className="alert alert-info" style={{fontSize:12.5,marginBottom:12}}>
                  <strong>{dev} device{dev===1?'':'s'} and {sen} sensor{sen===1?'':'s'}</strong> from Device Instances are included as <strong>Auto</strong> lines ({rupee(auto.reduce((n,r)=>n+Number(r.cost_company||0),0))}). They update when devices or sensors are assigned, moved or removed, or when catalog prices change.
                  {unpriced.length>0&&<div style={{marginTop:6,color:'#b45309'}}>{unpriced.length} line{unpriced.length===1?' has':'s have'} no price: {unpriced.map(r=>r.name).join(', ')} — set a standard cost in Products or a unit cost in the Sensor catalog, or override the price on the line.</div>}
                  {dupes.length>0&&<div style={{marginTop:6,color:'#b45309'}}>Possible double count: manual line{dupes.length===1?'':'s'} {dupes.map(r=>`“${r.name}”`).join(', ')} may duplicate an Auto line — delete {dupes.length===1?'it':'them'} if so.</div>}
                </div>
              )
            })()}
            <div className="table-wrap"><table>
              <thead><tr><TH c="Name"/><TH c="Type"/><TH c="Qty"/><TH c="Unit"/><TH c="Total"/><TH c="Cost(Co.)"/><TH c="Cost(Cl.)"/><TH c="Proposal"/><TH c="Vendor"/>{canEdit&&<TH c=""/>}</tr></thead>
              <tbody>{(dd?.hw||[]).length===0?<EmptyRow colSpan={10} icon="🔧" text="No hardware costs recorded"/>:(dd?.hw||[]).map(r=>r.source==='DEVICE_REGISTER'?(
                <tr key={r.id} style={{background:'#fafbff'}}>
                  <TD c={<div><span style={{fontWeight:600}}>{r.name}</span> <span className="badge badge-info" style={{fontSize:9.5,marginLeft:4}}>Auto</span>{r.price_override&&<span className="badge badge-warning" style={{fontSize:9.5,marginLeft:4}}>Price override</span>}<div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2,maxWidth:340,whiteSpace:'normal'}}>{r.notes}</div></div>}/>
                  <TD c={<span className="badge badge-warning" style={{fontSize:10}}>{r.category}</span>}/><TD c={<span style={{fontFamily:'var(--font-mono)'}}>{r.qty}</span>}/><MTD v={r.unit_price}/><MTD v={r.total_price} color="var(--amber)"/><MTD v={r.cost_company} color="#e11d48"/><MTD v={r.cost_client} color="#059669"/><MTD v={r.proposal_cost} color="#7c3aed"/>
                  <TD c={<span style={{fontSize:11,color:'var(--text-muted)'}}>Device register</span>}/>
                  {canEdit&&<TD c={<EBtn onClick={()=>setAutoHW({row:r,qty:r.qty,useCatalogue:!r.price_override,unit_price:r.unit_price||'',cost_client:r.cost_client||'',proposal_cost:r.proposal_cost||''})}/>}/>}
                </tr>
              ):<tr key={r.id}><TD c={<span style={{fontWeight:600}}>{r.name}</span>}/><TD c={<span className="badge badge-warning" style={{fontSize:10}}>{r.category}</span>}/><TD c={<span style={{fontFamily:'var(--font-mono)'}}>{r.qty}</span>}/><MTD v={r.unit_price}/><MTD v={r.total_price} color="var(--amber)"/><MTD v={r.cost_company} color="#e11d48"/><MTD v={r.cost_client} color="#059669"/><MTD v={r.proposal_cost} color="#7c3aed"/><TD c={<span style={{fontSize:11,color:'var(--text-muted)'}}>{r.vendor||'—'}</span>}/>{canEdit&&<TD c={<div style={{display:'flex',gap:3}}><EBtn onClick={()=>{setEditHW(r);setHwForm({name:r.name,category:r.category,qty:r.qty||'1',unit_price:r.unit_price||'',cost_company:r.cost_company||'',cost_client:r.cost_client||'',proposal_cost:r.proposal_cost||'',vendor:r.vendor||'',notes:r.notes||'',milestone_id:r.milestone_id||''});setShowHW(true)}}/><DBtn t="project_hardware_costs" id={r.id}/></div>}/>}</tr>)}</tbody>
            </table></div>
          </div>
        )}

        {/* ── SUPPORT ── */}
        {!ddLoad&&tab==='support'&&(
          <div>
            {(()=>{
              const auto=(dd?.sup||[]).filter(r=>r.source==='SUPPORT_VISITS')
              const hrsBilled=auto.reduce((n,r)=>n+Number(r.hours||0),0)
              return (
                <div className="alert alert-info" style={{fontSize:12.5,marginBottom:12,display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
                  <div style={{flex:'1 1 320px'}}>
                    <strong>Support visits</strong> (Check-In → Support / site visit, or “Check in here” on a device) are billed here automatically, one line per month{auto.length?<> — <strong>{Math.round(hrsBilled*10)/10} h</strong> so far</>:''}. Cost = hours × each engineer's rate; client = hours × the support rate{detail.support_hourly_rate?'':' (not set — billed at cost × 1.3)'}. These hours are left out of HR cost so they aren't counted twice.
                  </div>
                  {canEdit&&<div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:600}}>Support rate ₹/h</span>
                    <input className="form-input" type="number" min="0" style={{width:110,padding:'5px 8px'}} defaultValue={detail.support_hourly_rate??''} key={detail.id+'-'+(detail.support_hourly_rate??'')}
                      onBlur={async e=>{const v=e.target.value===''?null:Number(e.target.value);if(v===(detail.support_hourly_rate??null))return;const {error}=await supabase.from('projects').update({support_hourly_rate:v}).eq('id',detail.id);if(error){alert(/support_hourly_rate|schema cache/i.test(error.message)?'Run sql/STEP248_support_visits.sql in the Supabase SQL Editor first.':error.message);return};openDetail({...detail,support_hourly_rate:v})}}/>
                    <button className="btn btn-ghost btn-sm" title="Rebuild the monthly support-visit lines" onClick={async()=>{const {error}=await supabase.rpc('sync_project_support_visits',{p_project:detail.id});if(error)alert(/does not exist|schema cache/i.test(error.message)?'Run sql/STEP248_support_visits.sql first.':error.message);else openDetail(detail)}}><RefreshCw size={12}/> Resync</button>
                  </div>}
                </div>
              )
            })()}
            <div style={{display:'flex',gap:10,justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><SCard label="Cost (Co.)" value={rupee(kpi.spCo||0)} color="#e11d48"/><SCard label="Cost (Client)" value={rupee(kpi.spCl||0)} color="#059669"/><SCard label="Proposal" value={rupee(kpi.spPr||0)} color="#7c3aed"/></div>
              {canEdit&&<button className="btn btn-primary btn-sm" onClick={()=>{setEditSup(null);setSupForm({name:'',category:supCats[0],cost_company:'',cost_client:'',proposal_cost:'',date:'',notes:'',milestone_id:''});setShowSup(true)}}><Plus size={12}/> Add</button>}
            </div>
            <div className="table-wrap"><table>
              <thead><tr><TH c="Name"/><TH c="Category"/><TH c="Cost(Co.)"/><TH c="Cost(Cl.)"/><TH c="Proposal"/><TH c="Date"/><TH c="Milestone"/>{canEdit&&<TH c=""/>}</tr></thead>
              <tbody>{(dd?.sup||[]).length===0?<EmptyRow colSpan={8} icon="🛠" text="No support costs recorded"/>:(dd?.sup||[]).map(r=>r.source==='SUPPORT_VISITS'?(
                <tr key={r.id} style={{background:'#fafbff'}}>
                  <TD c={<div><span style={{fontWeight:600}}>{r.name}</span> <span className="badge badge-info" style={{fontSize:9.5,marginLeft:4}}>Auto · visits</span><div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>{r.notes}</div></div>}/>
                  <TD c={<span className="badge badge-teal" style={{fontSize:10}}>support visits</span>}/><MTD v={r.cost_company} color="#e11d48"/><MTD v={r.cost_client} color="#059669"/><MTD v={r.proposal_cost} color="#7c3aed"/>
                  <TD c={<span style={{fontSize:11}}>{r.date?dateFmt(r.date):'—'}</span>}/><TD c={<span style={{fontSize:10,color:'var(--text-muted)'}}>{r.hours!=null?`${r.hours} h`:'—'}</span>}/>{canEdit&&<TD c=""/>}
                </tr>
              ):<tr key={r.id}><TD c={<span style={{fontWeight:600}}>{r.name}</span>}/><TD c={<span className="badge badge-teal" style={{fontSize:10}}>{r.category?.replace(/_/g,' ')}</span>}/><MTD v={r.cost_company} color="#e11d48"/><MTD v={r.cost_client} color="#059669"/><MTD v={r.proposal_cost} color="#7c3aed"/><TD c={<span style={{fontSize:11,color:'var(--text-muted)'}}>{dateFmt(r.date)}</span>}/><TD c={<span style={{fontSize:11,color:'var(--text-muted)'}}>{ms.find(m=>m.id===r.milestone_id)?.title||'—'}</span>}/>{canEdit&&<TD c={<div style={{display:'flex',gap:3}}><EBtn onClick={()=>{setEditSup(r);setSupForm({name:r.name,category:r.category,cost_company:r.cost_company||'',cost_client:r.cost_client||'',proposal_cost:r.proposal_cost||'',date:r.date||'',notes:r.notes||'',milestone_id:r.milestone_id||''});setShowSup(true)}}/><DBtn t="project_support_costs" id={r.id}/></div>}/>}</tr>)}</tbody>
            </table></div>
          </div>
        )}

        {/* ── EXPENSES ── */}
        {!ddLoad&&tab==='expenses'&&(
          <div className="table-wrap"><table>
            <thead><tr><TH c="Requester"/><TH c="Category"/><TH c="Amount"/><TH c="Status"/><TH c="Date"/></tr></thead>
            <tbody>{(dd?.expenses||[]).length===0?<EmptyRow colSpan={5} icon="🧾" text="No linked expenses"/>:(dd?.expenses||[]).map((e,i)=><tr key={i}><TD c={<span style={{fontWeight:600}}>{e.requester?.full_name||'—'}</span>}/><TD c={<span className="badge badge-info">{e.category}</span>}/><MTD v={e.total_amount||e.amount} color="var(--c1)"/><TD c={<span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,textTransform:'uppercase',background:e.status==='approved'?'#dcfce7':e.status==='rejected'?'#fee2e2':'#fef3c7',color:e.status==='approved'?'#15803d':e.status==='rejected'?'#b91c1c':'#92400e'}}>{e.status}</span>}/><TD c={<span style={{fontSize:12,color:'var(--text-muted)'}}>{dateFmt(e.expense_date)}</span>}/></tr>)}</tbody>
          </table></div>
        )}

        {/* ── CHANGE REQUESTS ── */}
        {!ddLoad&&tab==='changes'&&dd&&(
          <div>
            {/* CR KPI strip */}
            {(()=>{const crs=dd.changereqs||[];const crApp=crs.filter(r=>['approved','implemented'].includes(r.status)).length;const crHrs=crs.reduce((s,r)=>s+(r.actual_hours||0),0);const crCost=crs.reduce((s,r)=>s+(r.actual_cost||0),0)
              return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:16}}>
                {[{l:'Total CRs',v:crs.length,c:'#f59e0b'},{l:'Approved',v:crApp,c:'var(--emerald)'},{l:'Pending',v:crs.filter(r=>['draft','submitted','under_review'].includes(r.status)).length,c:'var(--amber)'},{l:'Rejected',v:crs.filter(r=>r.status==='rejected').length,c:'var(--rose)'},{l:'CR Hours',v:`${crHrs}h`,c:'#8b5cf6'},{l:'CR Cost',v:rupee(crCost),c:'var(--rose)'}].map(s=>
                  <MiniKpi key={s.l} label={s.l} value={s.v} color={s.c}/>
                )}
              </div>
            })()}
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
              {canEdit&&<button className="btn btn-primary btn-sm" onClick={()=>{setEditCR(null);setCrForm(iCR());setShowCR(true)}}><Plus size={12}/> New CR</button>}
            </div>
            <div className="table-wrap"><table>
              <thead><tr><TH c="CR ID"/><TH c="Title"/><TH c="Priority"/><TH c="Status"/><TH c="Est.Hrs"/><TH c="Act.Hrs"/><TH c="Est.Cost"/><TH c="Act.Cost"/><TH c="By"/>{canEdit&&<TH c=""/>}</tr></thead>
              <tbody>{(dd?.changereqs||[]).length===0?<EmptyRow colSpan={10} icon="🔄" text="No change requests yet"/>:(dd?.changereqs||[]).map(r=>{
                const stclr={draft:'#64748b',submitted:'#3b82f6',under_review:'#f59e0b',approved:'#10b981',rejected:'#e11d48',implemented:'#8b5cf6'}[r.status]||'#64748b'
                return <tr key={r.id}>
                  <TD c={<span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'#f59e0b',fontWeight:700}}>{r.cr_id||'—'}</span>}/>
                  <TD c={<div><div style={{fontWeight:600,fontSize:12,maxWidth:180}}>{r.title}</div>{r.reason&&<div style={{fontSize:11,color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:180}}>{r.reason}</div>}</div>}/>
                  <TD c={<span style={{fontSize:11}}>{PI[r.priority]||'🔵'} {r.priority}</span>}/>
                  <TD c={<span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:`${stclr}15`,color:stclr,border:`1px solid ${stclr}25`,textTransform:'capitalize'}}>{r.status?.replace(/_/g,' ')}</span>}/>
                  <TD c={<span style={{fontFamily:'var(--font-mono)',fontSize:11}}>{r.estimated_hours||'—'}</span>}/>
                  <TD c={<span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--c1)'}}>{r.actual_hours||'—'}</span>}/>
                  <MTD v={r.estimated_cost} color="var(--amber)"/>
                  <MTD v={r.actual_cost} color="var(--rose)"/>
                  <TD c={<span style={{fontSize:11,color:'var(--text-muted)'}}>{r.requester?.full_name||'—'}</span>}/>
                  {canEdit&&<TD c={<div style={{display:'flex',gap:3}}><EBtn onClick={()=>{setEditCR(r);setCrForm({...r});setShowCR(true)}}/><DBtn t="change_requests" id={r.id}/></div>}/>}
                </tr>
              })}</tbody>
            </table></div>
          </div>
        )}

        {/* ── BUDGET CONFIG ── */}
        {!ddLoad&&tab==='budget'&&<BudgetPanel detail={detail} kpi={kpi} dd={dd}/>}

        {/* ── FINANCE (Actual Cost rollup + Burn Rate) ── */}
        {!ddLoad&&tab==='finance'&&(()=>{
          const ac = dd.actualCost, br = dd.burnRate
          const openInvoices = (dd.invoices||[]).filter(i=>!['paid','rejected'].includes(i.status))
          return (
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              <div style={{display:'flex',justifyContent:'flex-end'}}>
                <button className="btn btn-outline btn-sm" disabled={financeLoading} onClick={()=>loadFinance(detail.id,true)}>
                  <RefreshCw size={13} style={{marginRight:5}}/> {financeLoading?'Recomputing…':'Recompute Now'}
                </button>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title">💰 Budget vs Actual</span></div>
                <div className="card-body">
                  {!ac ? <div style={{textAlign:'center',padding:'20px 0',color:'var(--text-muted)',fontSize:12}}>{financeLoading?'Computing…':'No data yet — click Recompute Now'}</div> : (
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:14}}>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Budget Allocated</div><div style={{fontSize:20,fontWeight:800,color:'#3b82f6'}}>{rupee(br?.budgetAllocated||0)}</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>People Cost</div><div style={{fontSize:20,fontWeight:800,color:'#8b5cf6'}}>{rupee(ac.people_cost)}</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Hardware Cost</div><div style={{fontSize:20,fontWeight:800,color:'#f59e0b'}}>{rupee(ac.hardware_cost)}</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Warranty Cost</div><div style={{fontSize:20,fontWeight:800,color:'#e11d48'}}>{rupee(ac.warranty_cost)}</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Total Actual Cost</div><div style={{fontSize:20,fontWeight:800,color:'var(--rose)'}}>{rupee(ac.total_actual_cost)}</div></div>
                    </div>
                  )}
                </div>
              </div>

              <ROISummaryCard projectId={detail.id}/>

              {br && br.elapsedPct!=null && (
                <div className="card">
                  <div className="card-header"><span className="card-title">🔥 Burn Rate</span></div>
                  <div className="card-body">
                    <div style={{display:'flex',gap:24,flexWrap:'wrap',marginBottom:12}}>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Time Elapsed</div><div style={{fontSize:18,fontWeight:800}}>{br.elapsedPct}%</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Budget Spent</div><div style={{fontSize:18,fontWeight:800,color:br.willExceedBudget?'var(--rose)':'inherit'}}>{br.spendPct}%</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Daily Burn</div><div style={{fontSize:18,fontWeight:800}}>{rupee(br.dailyBurnRate)}/day</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Projected Exhaustion</div><div style={{fontSize:14,fontWeight:700}}>{br.projectedExhaustionDate?dateFmt(br.projectedExhaustionDate):'—'}</div></div>
                    </div>
                    {br.willExceedBudget && <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 12px',borderRadius:8,background:'#fef2f2',color:'#dc2626',fontSize:12,fontWeight:600,marginBottom:6}}><AlertTriangle size={14}/> Spending faster than the project timeline pace — over-burning risk.</div>}
                    {br.willExceedTimeline && <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 12px',borderRadius:8,background:'#fef2f2',color:'#dc2626',fontSize:12,fontWeight:600}}><TrendingDown size={14}/> Projected to exhaust budget before the project's scheduled end date.</div>}
                  </div>
                </div>
              )}

              {MARGIN_VISIBLE_ROLES.includes(role) && dd.margin && (
                <div className="card">
                  <div className="card-header"><span className="card-title"><Percent size={14} style={{verticalAlign:'-2px',marginRight:4}}/> Profit Margin</span></div>
                  <div className="card-body">
                    <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Revenue Recognized</div><div style={{fontSize:18,fontWeight:800,color:'#3b82f6'}}>{rupee(dd.margin.revenue_recognized)}</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Gross Margin</div><div style={{fontSize:18,fontWeight:800,color:dd.margin.gross_margin>=0?'var(--emerald)':'var(--rose)'}}>{rupee(dd.margin.gross_margin)}</div></div>
                      <div><div style={{fontSize:11,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>Margin %</div><div style={{fontSize:18,fontWeight:800,color:dd.margin.margin_percent>=0?'var(--emerald)':'var(--rose)'}}>{dd.margin.margin_percent}%</div></div>
                    </div>
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-header"><span className="card-title">🧾 Open Invoices</span></div>
                <div className="card-body">
                  {openInvoices.length===0 ? <div style={{textAlign:'center',padding:'16px 0',color:'var(--text-muted)',fontSize:12}}>No open vendor invoices</div> : (
                    <div className="table-wrap"><table>
                      <thead><tr><TH c="Invoice #"/><TH c="Vendor"/><TH c="Amount"/><TH c="Due"/><TH c="Status"/></tr></thead>
                      <tbody>{openInvoices.map(i=>(
                        <tr key={i.id}>
                          <TD c={<span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--c1)'}}>{i.invoice_number}</span>}/>
                          <TD c={i.vendor?.name||i.vendor_name||'—'}/>
                          <TD c={<span style={{fontWeight:700}}>{rupee(i.total_amount)}</span>}/>
                          <TD c={dateFmt(i.due_date)}/>
                          <TD c={<StatusBadge status={i.status}/>}/>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </div>
              </div>

              {/* Project-scoped mirror of the enterprise Spend Analyzer — same
                  findings engine (src/lib/spendAnalyzer.js), filtered to this
                  project, so a PM sees "where does MY project stand" without
                  needing access to the company-wide page. */}
              {['admin','ceo','finance','manager','department_head'].includes(role) && (
                <div className="card">
                  <div className="card-header"><span className="card-title"><Radar size={14} style={{verticalAlign:'-2px',marginRight:4}}/> Company Context</span></div>
                  <div className="card-body">
                    {!companyContext ? (
                      <div style={{textAlign:'center',padding:'16px 0',color:'var(--text-muted)',fontSize:12}}>Loading…</div>
                    ) : companyContext.findings.length===0 ? (
                      <div style={{textAlign:'center',padding:'16px 0',color:'var(--text-muted)',fontSize:12}}>No open enterprise-level findings flag this project</div>
                    ) : (
                      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:10}}>
                        {companyContext.findings.map(f=>(
                          <div key={f.id} style={{padding:'8px 12px',borderRadius:8,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
                            <div style={{fontSize:12,fontWeight:700,marginBottom:2}}>{f.title}</div>
                            <div style={{fontSize:11,color:'var(--text-muted)'}}>{f.description}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Link to="/spend-analyzer?view=benchmark" style={{fontSize:12,fontWeight:700,color:'var(--c1)',textDecoration:'none'}}>See how this project's type benchmarks company-wide →</Link>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {!ddLoad&&tab==='documents'&&<ProjectDocuments project={detail}/>}
        {!ddLoad&&tab==='closure'&&(()=>{
          const allTasks=dd?.tasks||[]
          const tasksClosed=allTasks.filter(t=>t.status==='closed').length
          const tasksTotal=allTasks.length
          const tasksAllDone=tasksTotal>0&&tasksClosed===tasksTotal
          const openTasks=allTasks.filter(t=>t.status!=='closed')
          const allSignedOff=closureDepts.length>0&&closureDepts.every(d=>d.status==='signed_off')
          const canClose=tasksAllDone&&allSignedOff&&detail.fund_flow_status!=='closed'
          const availableDepts=departments.filter(dp=>!closureDepts.some(cd=>cd.department_id===dp.id))
          const isClosed=detail.fund_flow_status==='closed'
          const canSignOffRow=d=>['admin','ceo'].includes(role)||(['department_head','manager'].includes(role)&&profile?.department_id===d.department_id)
          return (
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              <div className="card">
                <div className="card-header"><span className="card-title">{isClosed?<Lock size={14} style={{verticalAlign:'-2px',marginRight:4}}/>:<Unlock size={14} style={{verticalAlign:'-2px',marginRight:4}}/>} Fund Flow Status</span></div>
                <div className="card-body" style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
                  <div>
                    <span style={{padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:700,background:isClosed?'#fef2f2':'#ecfdf5',color:isClosed?'#dc2626':'#059669'}}>{isClosed?'Closed':'Open'}</span>
                    {isClosed&&detail.fund_flow_closed_at&&<span style={{marginLeft:10,fontSize:12,color:'var(--text-muted)'}}>Closed {dateFmt(detail.fund_flow_closed_at)}</span>}
                  </div>
                  {closureLoading?<div style={{fontSize:12,color:'var(--text-muted)'}}>Loading…</div>:isClosed?(
                    ['admin','ceo','finance'].includes(role)&&<button className="btn btn-outline btn-sm" onClick={handleReopenFundFlow}><Unlock size={13}/> Reopen</button>
                  ):(
                    <button className="btn btn-primary btn-sm" disabled={!canClose} onClick={handleCloseFundFlow} title={!canClose?'All tasks must be closed and every department signed off first':''}><Lock size={13}/> Close Fund Flow</button>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title">📋 Tasks</span></div>
                <div className="card-body">
                  <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>{tasksClosed}/{tasksTotal} tasks closed {tasksAllDone&&tasksTotal>0&&<span style={{color:'#059669'}}>✓</span>}</div>
                  {openTasks.length>0&&(
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      {openTasks.slice(0,8).map(t=>(
                        <div key={t.id} style={{fontSize:12,color:'var(--text-soft)',display:'flex',justifyContent:'space-between'}}>
                          <span>{t.task_name}</span><span style={{color:'var(--text-muted)'}}>{t.status?.replace(/_/g,' ')}</span>
                        </div>
                      ))}
                      {openTasks.length>8&&<div style={{fontSize:11,color:'var(--text-muted)',fontStyle:'italic'}}>+{openTasks.length-8} more</div>}
                    </div>
                  )}
                  {tasksTotal===0&&<div style={{fontSize:12,color:'var(--text-muted)',fontStyle:'italic'}}>No tasks yet on this project</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title"><UserCheck size={14} style={{verticalAlign:'-2px',marginRight:4}}/> Department Sign-off</span></div>
                <div className="card-body">
                  {closureDepts.length===0?(
                    <div style={{fontSize:12,color:'var(--text-muted)',fontStyle:'italic',marginBottom:12}}>No departments added to this project yet.</div>
                  ):(
                    <div className="table-wrap" style={{marginBottom:12}}>
                      <table>
                        <thead><tr><TH c="Department"/><TH c="Status"/><TH c=""/></tr></thead>
                        <tbody>
                          {closureDepts.map(d=>(
                            <tr key={d.id}>
                              <TD c={d.department?.name||'—'}/>
                              <TD c={<span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:700,background:d.status==='signed_off'?'#ecfdf5':'#fffbeb',color:d.status==='signed_off'?'#059669':'#d97706'}}>{d.status==='signed_off'?'Signed off':'Pending'}</span>}/>
                              <TD c={<div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                                {d.status==='signed_off'?(
                                  canSignOffRow(d)&&!isClosed&&<button className="btn btn-ghost btn-sm" onClick={()=>handleUndoSignOff(d.id)}>Undo</button>
                                ):(
                                  canSignOffRow(d)&&!isClosed&&<button className="btn btn-outline btn-sm" onClick={()=>handleSignOff(d.id)}><UserCheck size={12}/> Sign Off</button>
                                )}
                                {canEdit&&!isClosed&&<DBtn t="project_departments" id={d.id}/>}
                              </div>}/>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {canEdit&&!isClosed&&availableDepts.length>0&&(
                    <div style={{display:'flex',gap:8}}>
                      <select className="form-select" value={addDeptId} onChange={e=>setAddDeptId(e.target.value)} style={{maxWidth:260}}>
                        <option value="">Select department…</option>
                        {availableDepts.map(dp=><option key={dp.id} value={dp.id}>{dp.name}</option>)}
                      </select>
                      <button className="btn btn-primary btn-sm" disabled={!addDeptId} onClick={handleAddDept}><Plus size={13}/> Add Department</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {/* ════ ALL MODALS ════ */}
        {/* Milestone */}
        <Modal open={showMS} onClose={()=>setShowMS(false)} title={editMS?'Edit Milestone':'Add Milestone'} size="lg"
          footer={<><button className="btn btn-ghost" onClick={()=>setShowMS(false)}>Cancel</button><button className="btn btn-primary" onClick={saveMS} disabled={subMS}>{subMS?'Saving…':'Save'}</button></>}>
          <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={msForm.title} onChange={e=>setMsForm(f=>({...f,title:e.target.value}))} required/></div>
          <div className="form-row"><div className="form-group"><label className="form-label">Planned Start</label><input className="form-input" type="date" value={msForm.start_date} onChange={e=>setMsForm(f=>({...f,start_date:e.target.value}))}/></div><div className="form-group"><label className="form-label">Planned End</label><input className="form-input" type="date" value={msForm.due_date} onChange={e=>setMsForm(f=>({...f,due_date:e.target.value}))}/></div></div>
          <div className="form-row"><div className="form-group"><label className="form-label">Actual Start</label><input className="form-input" type="date" value={msForm.actual_start} onChange={e=>setMsForm(f=>({...f,actual_start:e.target.value}))}/></div><div className="form-group"><label className="form-label">Actual End</label><input className="form-input" type="date" value={msForm.actual_end} onChange={e=>setMsForm(f=>({...f,actual_end:e.target.value}))}/></div></div>
          <div className="form-row"><div className="form-group"><label className="form-label">Budget (₹)</label><input className="form-input" type="number" value={msForm.budget} onChange={e=>setMsForm(f=>({...f,budget:e.target.value}))}/></div><div className="form-group"><label className="form-label">Status</label><select className="form-select" value={msForm.status} onChange={e=>setMsForm(f=>({...f,status:e.target.value}))}>{['pending','in_progress','completed','delayed'].map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></div></div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={msForm.description} onChange={e=>setMsForm(f=>({...f,description:e.target.value}))}/></div>
        </Modal>
        {/* SW */}
        <Modal open={showSW} onClose={()=>setShowSW(false)} title={editSW?'Edit Software':'Add Software'} size="lg"
          footer={<><button className="btn btn-ghost" onClick={()=>setShowSW(false)}>Cancel</button><button className="btn btn-primary" onClick={()=>saveCost('project_software_costs',{name:swForm.name,category:swForm.category,qty:parseFloat(swForm.qty)||1,unit_price:parseFloat(swForm.unit_price)||0,cost_company:parseFloat(swForm.cost_company)||0,cost_client:parseFloat(swForm.cost_client)||0,proposal_cost:parseFloat(swForm.proposal_cost)||0,billing_cycle:swForm.billing_cycle||'monthly',notes:swForm.notes||null,milestone_id:swForm.milestone_id||null,...(swForm.per_seat||editSW?.per_seat?{per_seat:!!swForm.per_seat,seat_price:parseFloat(swForm.seat_price)||0}:{})},editSW,()=>{setShowSW(false);setEditSW(null)})} disabled={subCost}>{subCost?'Saving…':'Save'}</button></>}>
          <SWForm form={swForm} setForm={setSwForm} cats={swCats} setCats={setSwCats} ms={dd?.milestones||[]}/>
        </Modal>
        {/* HW */}
        <Modal open={!!autoHW} onClose={()=>setAutoHW(null)} title={`Auto line · ${autoHW?.row?.name||''}`}
          footer={<><button className="btn btn-ghost" onClick={()=>setAutoHW(null)}>Cancel</button><button className="btn btn-primary" disabled={subCost} onClick={saveAutoHW}>{subCost?'Saving…':'Save'}</button></>}>
          {autoHW&&<div>
            <p style={{fontSize:12.5,color:'var(--text-muted)',marginTop:0}}>Quantity comes from Device Instances ({autoHW.qty}) and can't be edited here. {autoHW.row.notes}</p>
            <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13,marginBottom:10}}><input type="checkbox" checked={autoHW.useCatalogue} onChange={e=>setAutoHW(a=>({...a,useCatalogue:e.target.checked}))}/> Use the catalog price (product standard cost / sensor unit cost)</label>
            {!autoHW.useCatalogue&&<div className="form-group"><label className="form-label">Unit price for this project (₹)</label><input type="number" min={0} className="form-input" value={autoHW.unit_price} onChange={e=>setAutoHW(a=>({...a,unit_price:e.target.value}))}/></div>}
            <div className="form-row">
              <div className="form-group"><label className="form-label">Cost to client (₹)</label><input type="number" min={0} className="form-input" value={autoHW.cost_client} onChange={e=>setAutoHW(a=>({...a,cost_client:e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">Proposal cost (₹)</label><input type="number" min={0} className="form-input" value={autoHW.proposal_cost} onChange={e=>setAutoHW(a=>({...a,proposal_cost:e.target.value}))}/></div>
            </div>
            <div style={{fontSize:11,color:'var(--text-muted)'}}>The client and proposal mark-up you set here is kept as a ratio when the quantity or price changes.</div>
          </div>}
        </Modal>
        <Modal open={showHW} onClose={()=>setShowHW(false)} title={editHW?'Edit Hardware':'Add Hardware'} size="lg"
          footer={<><button className="btn btn-ghost" onClick={()=>setShowHW(false)}>Cancel</button><button className="btn btn-primary" onClick={()=>{const q=parseFloat(hwForm.qty)||1,up=parseFloat(hwForm.unit_price)||0,co=parseFloat(hwForm.cost_company)||(q*up);saveCost('project_hardware_costs',{name:hwForm.name,category:hwForm.category,qty:q,unit_price:up,total_price:q*up,cost_company:co,cost_client:parseFloat(hwForm.cost_client)||(co*1.3),proposal_cost:parseFloat(hwForm.proposal_cost)||(co*1.5),vendor:hwForm.vendor||null,notes:hwForm.notes||null,milestone_id:hwForm.milestone_id||null},editHW,()=>{setShowHW(false);setEditHW(null)})}} disabled={subCost}>{subCost?'Saving…':'Save'}</button></>}>
          <HWForm form={hwForm} setForm={setHwForm} cats={hwCats} setCats={setHwCats} ms={dd?.milestones||[]}/>
        </Modal>
        {/* Support */}
        <Modal open={showSup} onClose={()=>setShowSup(false)} title={editSup?'Edit Support':'Add Support'} size="lg"
          footer={<><button className="btn btn-ghost" onClick={()=>setShowSup(false)}>Cancel</button><button className="btn btn-primary" onClick={()=>saveCost('project_support_costs',{name:supForm.name,category:supForm.category,cost_company:parseFloat(supForm.cost_company)||0,cost_client:parseFloat(supForm.cost_client)||0,proposal_cost:parseFloat(supForm.proposal_cost)||0,date:supForm.date||null,notes:supForm.notes||null,milestone_id:supForm.milestone_id||null},editSup,()=>{setShowSup(false);setEditSup(null)})} disabled={subCost}>{subCost?'Saving…':'Save'}</button></>}>
          <SupForm form={supForm} setForm={setSupForm} cats={supCats} setCats={setSupCats} ms={dd?.milestones||[]}/>
        </Modal>
        {/* Resource alloc */}
        <Modal open={showRA} onClose={()=>setShowRA(false)} title={editRA?'Edit Allocation':'Allocate Resource'} size="lg"
          footer={<><button className="btn btn-ghost" onClick={()=>setShowRA(false)}>Cancel</button><button className="btn btn-primary" onClick={()=>saveCost('project_resource_alloc',{employee_id:raForm.employee_id,milestone_id:raForm.milestone_id||null,allocated_hours:parseFloat(raForm.allocated_hours)||0,idle_hours:parseFloat(raForm.idle_hours)||0,month:parseInt(raForm.month)||null,year:parseInt(raForm.year)||new Date().getFullYear(),notes:raForm.notes||null},editRA,()=>{setShowRA(false);setEditRA(null)})} disabled={subCost}>{subCost?'Saving…':'Save'}</button></>}>
          <div className="form-row"><div className="form-group"><label className="form-label">Employee *</label><select className="form-select" value={raForm.employee_id||''} onChange={e=>setRaForm(f=>({...f,employee_id:e.target.value}))} required><option value="">Select…</option>{(dd?.employees||[]).map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}</select></div><div className="form-group"><label className="form-label">Milestone</label><MsSel val={raForm.milestone_id} set={v=>setRaForm(f=>({...f,milestone_id:v}))}/></div></div>
          <div className="form-row"><div className="form-group"><label className="form-label">Allocated Hrs *</label><input className="form-input" type="number" step="0.5" value={raForm.allocated_hours||''} onChange={e=>setRaForm(f=>({...f,allocated_hours:e.target.value}))} required/></div><div className="form-group"><label className="form-label">Idle Hrs</label><input className="form-input" type="number" step="0.5" value={raForm.idle_hours||''} onChange={e=>setRaForm(f=>({...f,idle_hours:e.target.value}))}/></div></div>
          {raForm.employee_id&&raForm.allocated_hours&&(()=>{const rt=(dd?.rates||[]).find(r=>r.employee_id===raForm.employee_id);if(!rt)return<div className="alert alert-warning" style={{marginBottom:8}}>⚠ No rate configured for this employee</div>;const hr=rt.hourly_rate||rt.monthly_salary/(22*8);return<div style={{padding:'8px 12px',borderRadius:8,background:'var(--c1-soft)',fontSize:12,fontWeight:600,color:'var(--c1)',marginBottom:8}}>💰 Est: {rupee(Math.round(parseFloat(raForm.allocated_hours)*hr))} @ ₹{hr.toFixed(0)}/hr</div>})()}
          <div className="form-row"><div className="form-group"><label className="form-label">Month</label><select className="form-select" value={raForm.month||new Date().getMonth()+1} onChange={e=>setRaForm(f=>({...f,month:e.target.value}))}>{MOS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}</select></div><div className="form-group"><label className="form-label">Year</label><input className="form-input" type="number" value={raForm.year||new Date().getFullYear()} onChange={e=>setRaForm(f=>({...f,year:e.target.value}))}/></div></div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} value={raForm.notes||''} onChange={e=>setRaForm(f=>({...f,notes:e.target.value}))}/></div>
        </Modal>
        {/* %-based Allocation (allocations table) — create/edit without leaving the project */}
        <Modal open={showAlloc} onClose={()=>setShowAlloc(false)} title={editAlloc?'Edit Allocation':'Add Allocation'} size="lg"
          footer={<><button className="btn btn-ghost" onClick={()=>setShowAlloc(false)}>Cancel</button><button className="btn btn-primary" onClick={submitAllocForm} disabled={subAlloc||(allocConflict&&(!allocForm.override||!allocForm.override_justification.trim()))}>{subAlloc?'Saving…':editAlloc?'Save Changes':'Submit Request'}</button></>}>
          <div className="form-group"><label className="form-label">Employee *</label>
            <select className="form-select" value={allocForm.employee_id} onChange={e=>setAllocForm(f=>({...f,employee_id:e.target.value}))} disabled={!!editAlloc} required>
              <option value="">Select employee…</option>{(dd?.employees||[]).map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
            </select>
            {editAlloc&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Employee can't be changed on an existing allocation — delete and create a new one instead.</div>}
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Allocation % *</label>
              <input className="form-input" type="number" min={1} max={allocRemainingPct!=null?Math.max(1,allocRemainingPct):100} value={allocForm.allocation_percent} onChange={e=>setAllocForm(f=>({...f,allocation_percent:e.target.value}))} required/>
              {allocRemainingPct!=null&&(
                <div style={{fontSize:11,marginTop:3,fontWeight:600,color:allocRemainingPct<=0?'#dc2626':allocRemainingPct<20?'#b45309':'#16a34a'}}>
                  {allocRemainingPct<=0?`⚠ Fully booked (${Math.abs(allocRemainingPct)}% over) across their other allocations`:`${allocRemainingPct}% available — everything else they're on already uses ${100-allocRemainingPct}%`}
                </div>
              )}
            </div>
            <div className="form-group"><label className="form-label">Role on Project</label><input className="form-input" value={allocForm.role_on_project} onChange={e=>setAllocForm(f=>({...f,role_on_project:e.target.value}))} placeholder="e.g. Firmware Engineer"/></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Start Date *</label><input className="form-input" type="date" value={allocForm.start_date} onChange={e=>setAllocForm(f=>({...f,start_date:e.target.value}))} required/></div>
            <div className="form-group"><label className="form-label">End Date</label><input className="form-input" type="date" value={allocForm.end_date} min={allocForm.start_date} onChange={e=>setAllocForm(f=>({...f,end_date:e.target.value}))}/>
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>Leave blank for an open-ended allocation</div>
            </div>
          </div>
          {!editAlloc&&<div style={{fontSize:11,color:'var(--text-muted)',marginBottom:10}}>New allocations still go through the same approval workflow as the Allocations page — this saves as "Requested" until the employee's manager approves it.</div>}
          {allocConflict&&(
            <div style={{marginBottom:14}}>
              <Alert type="warning" message={
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:6,fontWeight:700,marginBottom:6}}><AlertTriangle size={14}/> Over-allocation warning</div>
                  <div style={{fontSize:12.5,marginBottom:6}}>Already committed {allocConflict.committedPct}% for overlapping dates — this would bring total to <strong>{allocConflict.projectedTotal}%</strong>:</div>
                  <ul style={{margin:'0 0 8px',paddingLeft:18,fontSize:12}}>
                    {allocConflict.overlapping.map(o=><li key={o.id}>{o.project?.name} — {o.allocation_percent}% ({dateFmt(o.start_date)} → {o.end_date?dateFmt(o.end_date):'ongoing'})</li>)}
                  </ul>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12.5,fontWeight:600,marginBottom:6}}>
                    <input type="checkbox" checked={allocForm.override} onChange={e=>setAllocForm(f=>({...f,override:e.target.checked}))}/> Override and proceed anyway
                  </label>
                  {allocForm.override&&<textarea className="form-textarea" placeholder="Justification for override…" value={allocForm.override_justification} onChange={e=>setAllocForm(f=>({...f,override_justification:e.target.value}))} style={{minHeight:50,fontSize:12.5}} required/>}
                </div>
              }/>
            </div>
          )}
        </Modal>
        <Confirm open={!!delAlloc} message="Delete this allocation? This does not affect any hours already logged." danger
          onConfirm={()=>removeAlloc(delAlloc)} onCancel={()=>setDelAlloc(null)}/>
        {/* Change Request */}
        <Modal open={showCR} onClose={()=>setShowCR(false)} title={editCR?`Edit ${editCR.cr_id||'CR'}`:'New Change Request'} size="lg"
          footer={<><button className="btn btn-ghost" onClick={()=>setShowCR(false)}>Cancel</button><button className="btn btn-primary" onClick={saveCR} disabled={subCR}>{subCR?'Saving…':'Save CR'}</button></>}>
          <div style={{display:'grid',gap:14}}>
            <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={crForm.title||''} onChange={e=>setCrForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Add analytics dashboard module" required/></div>
            <div className="form-row"><div className="form-group"><label className="form-label">Priority</label><select className="form-select" value={crForm.priority||'medium'} onChange={e=>setCrForm(f=>({...f,priority:e.target.value}))}>{PRIOS.map(p=><option key={p} value={p}>{PI[p]} {p}</option>)}</select></div><div className="form-group"><label className="form-label">Status</label><select className="form-select" value={crForm.status||'draft'} onChange={e=>setCrForm(f=>({...f,status:e.target.value}))}>{CR_ST.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></div></div>
            <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" rows={2} value={crForm.description||''} onChange={e=>setCrForm(f=>({...f,description:e.target.value}))} placeholder="What needs to change…"/></div>
            <div className="form-group"><label className="form-label">Reason / Business Impact</label><textarea className="form-textarea" rows={2} value={crForm.reason||''} onChange={e=>setCrForm(f=>({...f,reason:e.target.value}))} placeholder="Why and business value…"/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10}}>
              <div className="form-group"><label className="form-label">Est. Hours</label><input className="form-input" type="number" step="0.5" value={crForm.estimated_hours||''} onChange={e=>setCrForm(f=>({...f,estimated_hours:e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">Act. Hours</label><input className="form-input" type="number" step="0.5" value={crForm.actual_hours||''} onChange={e=>setCrForm(f=>({...f,actual_hours:e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">Est. Cost (₹)</label><input className="form-input" type="number" value={crForm.estimated_cost||''} onChange={e=>setCrForm(f=>({...f,estimated_cost:e.target.value}))}/></div>
              <div className="form-group"><label className="form-label">Act. Cost (₹)</label><input className="form-input" type="number" value={crForm.actual_cost||''} onChange={e=>setCrForm(f=>({...f,actual_cost:e.target.value}))}/></div>
            </div>
          </div>
        </Modal>
        {/* Project edit */}
        <Modal open={showPM} onClose={()=>setShowPM(false)} title={editP?'Edit Project':'New Project'}
          footer={<><button className="btn btn-ghost" onClick={()=>setShowPM(false)}>Cancel</button><button className="btn btn-primary" onClick={saveProject} disabled={subP}>{subP?'Saving…':editP?'Update':'Create'}</button></>}>
          <ProjForm form={pForm} setForm={setPForm} customers={customers} departments={departments} isNew={!editP}/>
        </Modal>
        <Confirm open={!!delItem} message="Delete this item permanently?" danger
          onConfirm={async()=>{if(!delItem)return;await supabase.from(delItem.table).delete().eq('id',delItem.id);setDelItem(null);if(delItem.table==='project_departments'){loadClosure(detail.id)}else{openDetail(detail)}}}
          onCancel={()=>setDelItem(null)}/>
      </div>
    )
  }

  /* ════════════════════════════ LIST VIEW ══════════════════ */
  if (loading) return <Loader/>
  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Projects</div><div className="page-subtitle">Full cost visibility per project</div></div>
        {canEdit&&<button className="btn btn-primary" onClick={()=>{setEditP(null);setPForm(iP());setShowPM(true)}}><Plus size={14}/> New Project</button>}
      </div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:20}}>
        {[{l:'Total',v:filtered.length,c:'var(--c1)',sub:`${projects.length} projects`},{l:'Active',v:projects.filter(p=>p.status==='active').length,c:'var(--emerald)',sub:'running'},{l:'Total Budget',v:rupee(filtered.reduce((s,p)=>s+(p.budget||0),0)),c:'var(--sky)',sub:'allocated'},{l:'On Hold',v:projects.filter(p=>p.status==='on_hold').length,c:'#f59e0b',sub:'paused'},{l:'Completed',v:projects.filter(p=>p.status==='completed').length,c:'#3b82f6',sub:'done'},{l:'Over Budget',v:projects.filter(p=>p.budget>0&&(p.spent||0)>p.budget).length,c:'var(--rose)',sub:'exceeded'}].map(s=>(
          <div key={s.l} className="stat-card" style={{borderTopColor:s.c}}><div className="stat-value" style={{color:s.c}}>{s.v}</div><div className="stat-label">{s.l}</div><div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{s.sub}</div></div>
        ))}
      </div>
      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:18,flexWrap:'wrap',alignItems:'center'}}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search projects…"/>
        <select className="form-select" value={statusF} onChange={e=>setStatusF(e.target.value)} style={{width:'auto'}}>
          <option value="">All Statuses</option>{['active','on_hold','completed','cancelled'].map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <input type="date" className="form-input" value={dateRange.from} onChange={e=>setDateRange(r=>({...r,from:e.target.value}))} style={{width:'auto'}}/>
          <span style={{color:'var(--text-muted)',fontSize:12}}>→</span>
          <input type="date" className="form-input" value={dateRange.to} onChange={e=>setDateRange(r=>({...r,to:e.target.value}))} style={{width:'auto'}}/>
        </div>
        {(statusF||dateRange.from)&&<button className="btn btn-ghost btn-sm" onClick={()=>{setStatusF('');setDateRange({from:'',to:''})}}>✕ Clear</button>}
      </div>
      {/* Project cards */}
      {filtered.length===0?<Empty icon="📁" title="No projects" desc={search||statusF?'No matches':'Create your first project'}/>
        :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:16}}>
          {filtered.map((p,idx)=>{
            const color=CCLR[idx%CCLR.length],pct=p.budget>0?Math.min(100,Math.round(((p.spent||0)/p.budget)*100)):0,over=p.budget>0&&(p.spent||0)>p.budget,avail2=Math.max(0,(p.budget||0)-(p.reserved_budget||0)-(p.spent||0))
            return (
              <div key={p.id} style={{background:'var(--surface)',borderRadius:14,border:'1px solid var(--border)',overflow:'hidden',boxShadow:'var(--shadow-sm)',transition:'all .2s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=color;e.currentTarget.style.boxShadow=`0 0 0 3px ${color}12,var(--shadow)`}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.boxShadow='var(--shadow-sm)'}}>
                <div style={{height:4,background:`linear-gradient(90deg,${color},${color}99)`}}/>
                <div style={{padding:'16px 18px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:40,height:40,borderRadius:10,background:`${color}12`,border:`1.5px solid ${color}25`,display:'flex',alignItems:'center',justifyContent:'center',color,flexShrink:0}}><FolderOpen size={18}/></div>
                      <div><div style={{fontFamily:'var(--font-head)',fontWeight:800,fontSize:14,lineHeight:1.2}}>{p.name}</div>{p.code&&<div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',marginTop:1}}>{p.code}</div>}</div>
                    </div>
                    <div style={{display:'flex',gap:4,alignItems:'center',flexShrink:0}}>
                      <Pill s={p.status} map={SC}/>
                      {canEdit&&<><button className="btn btn-ghost btn-sm btn-icon" onClick={e=>{e.stopPropagation();openEditProject(p)}}><Edit2 size={11}/></button><button className="btn btn-ghost btn-sm btn-icon" style={{color:'var(--rose)'}} onClick={e=>{e.stopPropagation();setDelP(p.id)}}><Trash2 size={11}/></button></>}
                    </div>
                  </div>
                  {p.description&&<div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12,lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{p.description}</div>}
                  <div style={{marginBottom:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:5}}><span style={{fontWeight:600,color:'var(--text-soft)'}}>Utilization</span><span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:over?'var(--rose)':color}}>{pct}%{over?' ⚠':''}</span></div>
                    <div style={{height:7,borderRadius:99,background:'var(--bg-3)',overflow:'hidden',display:'flex'}}>
                      {p.budget>0&&<><div style={{width:`${pct}%`,background:over?'var(--rose)':pct>75?'var(--amber)':color,transition:'width .3s',borderRadius:'99px 0 0 99px'}}/>{(p.reserved_budget||0)>0&&<div style={{width:`${Math.min(100-pct,((p.reserved_budget||0)/p.budget)*100)}%`,background:`${color}40`}}/>}</>}
                    </div>
                    <div style={{display:'flex',gap:10,marginTop:4,fontSize:10,color:'var(--text-muted)',flexWrap:'wrap'}}>
                      <span>Spent: <strong style={{fontFamily:'var(--font-mono)'}}>{rupee(p.spent||0)}</strong></span>
                      {(p.reserved_budget||0)>0&&<span>Reserved: <strong style={{fontFamily:'var(--font-mono)'}}>{rupee(p.reserved_budget)}</strong></span>}
                      <span>Budget: <strong style={{fontFamily:'var(--font-mono)'}}>{rupee(p.budget)}</strong></span>
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:7,marginBottom:12}}>
                    {[{l:'Available',v:rupee(avail2),c:avail2>0?'var(--emerald)':'var(--rose)'},{l:'HW',v:rupee(0),c:'var(--amber)'},{l:'SW',v:rupee(0),c:'#7c3aed'}].map(s=>(
                      <div key={s.l} style={{padding:'7px 9px',borderRadius:7,background:'var(--surface-2)',border:'1px solid var(--border)',textAlign:'center'}}>
                        <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:12,color:s.c}}>{s.v}</div>
                        <div style={{fontSize:9,color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginTop:1}}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                  {(p.start_date||p.end_date)&&<div style={{fontSize:11,color:'var(--text-muted)',marginBottom:10,display:'flex',gap:10}}>{p.start_date&&<span>📅 {p.start_date}</span>}{p.end_date&&<span>🏁 {p.end_date}</span>}</div>}
                  <button className="btn btn-ghost btn-sm" style={{width:'100%',justifyContent:'center',borderColor:`${color}30`,color,fontWeight:700}} onClick={()=>openDetail(p)}>
                    <Eye size={12}/> View Cost Breakdown
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      }
      {/* Modals */}
      <Modal open={showPM} onClose={()=>setShowPM(false)} title={editP?'Edit Project':'New Project'}
        footer={<><button className="btn btn-ghost" onClick={()=>setShowPM(false)}>Cancel</button><button className="btn btn-primary" onClick={saveProject} disabled={subP}>{subP?'Saving…':editP?'Update':'Create Project'}</button></>}>
        <ProjForm form={pForm} setForm={setPForm} customers={customers} departments={departments} isNew={!editP}/>
      </Modal>
      <Confirm open={!!delP} message="Delete this project and all linked milestones, costs and tasks? Expenses and timelogs will be retained." danger
        onConfirm={async()=>{try{const{error}=await supabase.from('projects').delete().eq('id',delP);if(error)throw error;setDelP(null);loadList()}catch(e){setDelP(null);alert('Delete failed: '+e.message+'\n\nRun STEP19-task-fixes.sql in Supabase SQL Editor.')}}}
        onCancel={()=>setDelP(null)}/>
    </div>
  )
}

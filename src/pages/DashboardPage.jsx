import { useEffect, useState, useRef, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Loader } from '../components/ui'
import CheckInWidget from '../components/CheckInWidget'
import { listBurnRateWatchlist } from '../lib/actualCost'
import { getInventorySummary } from '../lib/inventory'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  Receipt, Users, FolderOpen, Box, TrendingUp, Clock,
  DollarSign, Plane, FileText, ShoppingCart, ArrowRight,
  CheckCircle, AlertCircle, Briefcase, Target, BarChart2, Flame
} from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COLORS  = ['#6366f1','#10b981','#f59e0b','#ec4899','#3b82f6','#8b5cf6','#ef4444','#14b8a6']
const PERIOD_LABEL = { D:'Today', W:'This Week', M:'This Month', Y:'This Year' }

// Shared elevation tokens — reused across KPI/ChartCard/DepartmentCard/etc so
// every card on the dashboard reads as one consistent, "richer" visual system
// instead of each component inventing its own shadow values.
const CARD_SHADOW       = '0 1px 2px rgba(15,23,42,.03), 0 6px 18px -10px rgba(15,23,42,.10)'
const CARD_SHADOW_HOVER = '0 2px 6px rgba(15,23,42,.05), 0 20px 36px -16px rgba(99,102,241,.28)'

function getPeriodRange(period) {
  const now = new Date()
  let start
  if (period==='D') start = new Date(now.getFullYear(),now.getMonth(),now.getDate())
  else if (period==='W') { const day=now.getDay(); const diff=day===0?-6:1-day; start=new Date(now.getFullYear(),now.getMonth(),now.getDate()+diff) }
  else if (period==='M') start = new Date(now.getFullYear(),now.getMonth(),1)
  else start = new Date(now.getFullYear(),0,1)
  return { start, end: now }
}

// ─── Mini KPI card ────────────────────────────────────────────
function KPI({ label, value, sub, color='#6366f1', icon, trend, href }) {
  const [hover, setHover] = useState(false)
  const content = (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{ position:'relative', background:`linear-gradient(155deg, #fff 0%, #fff 55%, ${color}09 100%)`,
        borderRadius:16, padding:'18px 18px 16px', border:`1px solid ${color}22`,
        boxShadow: hover ? `0 2px 6px rgba(15,23,42,.04), 0 20px 36px -14px ${color}55` : `0 1px 2px rgba(15,23,42,.03), 0 8px 20px -10px rgba(15,23,42,.12)`,
        height:'100%', minWidth:0, overflow:'hidden',
        transform: hover ? 'translateY(-4px)' : 'none', transition:'transform .2s ease, box-shadow .2s ease' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3.5, background:`linear-gradient(90deg, ${color}, ${color}80)` }}/>
      <div style={{ position:'absolute', top:-30, right:-30, width:90, height:90, borderRadius:'50%', background:`${color}0d`, pointerEvents:'none' }}/>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, gap:8, position:'relative' }}>
        <div style={{ width:38, height:38, borderRadius:11, background:`radial-gradient(circle at 30% 30%, ${color}30, ${color}12)`, display:'flex', alignItems:'center', justifyContent:'center', color, flexShrink:0, boxShadow:`0 4px 10px ${color}22` }}>{icon}</div>
        {trend != null && (
          <span style={{ fontSize:11, fontWeight:700, color: trend>=0?'#10b981':'#ef4444', background: trend>=0?'#dcfce7':'#fee2e2', padding:'2px 7px', borderRadius:999, flexShrink:0 }}>
            {trend>=0?'▲':'▼'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div style={{ fontSize:'clamp(16px,3vw,24px)', fontWeight:800, color, lineHeight:1.2, marginBottom:4, overflowWrap:'break-word', wordBreak:'break-word', position:'relative' }}>{value}</div>
      <div style={{ fontSize:12, color:'#64748b', fontWeight:600, position:'relative' }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:3, position:'relative' }}>{sub}</div>}
    </div>
  )
  return href ? <Link to={href} style={{ textDecoration:'none', display:'block' }}>{content}</Link> : content
}

// ─── Section header ───────────────────────────────────────────
function SectionHeader({ title, sub, action }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14, gap:12 }}>
      <div>
        <h2 style={{ fontSize:15, fontWeight:800, color:'#1e293b', margin:0 }}>{title}</h2>
        {sub && <div style={{ fontSize:12, color:'#94a3b8', marginTop:2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  )
}

// ─── Burn Rate Watchlist — top at-risk active projects (spending faster than
// their elapsed timeline pace, past the finance_settings warning threshold) ──
function BurnRateWatchlist() {
  const [rows, setRows] = useState(null)
  useEffect(() => { listBurnRateWatchlist(5).then(setRows).catch(() => setRows([])) }, [])
  if (rows === null) return null
  return (
    <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden', boxShadow:CARD_SHADOW }}>
      <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', gap:8, background:'linear-gradient(180deg,#fff7f7,#fff)' }}>
        <Flame size={15} style={{ color:'#ef4444' }}/>
        <div style={{ fontWeight:700, fontSize:14 }}>Burn Rate Watchlist</div>
        <div style={{ fontSize:11, color:'#94a3b8', marginLeft:'auto' }}>Spending faster than timeline pace</div>
      </div>
      <div style={{ padding: rows.length===0 ? '20px' : '8px 0' }}>
        {rows.length===0 ? (
          <div style={{ textAlign:'center', color:'#94a3b8', fontSize:12 }}>No projects currently over-burning 🎉</div>
        ) : rows.map(r => (
          <Link key={r.project_id} to="/projects" className="dash-list-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 20px', textDecoration:'none', color:'inherit' }}>
            <span style={{ fontWeight:600, fontSize:13 }}>{r.name}</span>
            <span style={{ fontSize:11, color:'#64748b' }}>{r.spendPct}% spent · {r.elapsedPct}% elapsed</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Chart card ───────────────────────────────────────────────
function ChartCard({ title, sub, children, height=220 }) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden',
        boxShadow: hover ? CARD_SHADOW_HOVER : CARD_SHADOW,
        transform: hover ? 'translateY(-2px)' : 'none', transition:'transform .2s ease, box-shadow .2s ease' }}>
      <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', background:'linear-gradient(180deg,#fafbff,#fff)' }}>
        <div style={{ fontWeight:700, fontSize:14 }}>{title}</div>
        {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{sub}</div>}
      </div>
      <div style={{ padding:'16px 20px' }}>
        <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Period filter ────────────────────────────────────────────
function PeriodFilter({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:4 }}>
      {['D','W','M','Y'].map(p=>(
        <button key={p} onClick={()=>onChange(p)}
          style={{ padding:'4px 10px', borderRadius:8, border:'none', cursor:'pointer', fontSize:11, fontWeight:700,
            background:value===p?'#1e293b':'#f1f5f9', color:value===p?'#fff':'#475569' }}>
          {p==='D'?'Day':p==='W'?'Week':p==='M'?'Month':'Year'}
        </button>
      ))}
    </div>
  )
}

// Long dynamic labels (e.g. real project names in Resource Flow) can run
// past the SVG's fixed viewBox edge and get visually clipped since SVG
// <text> never wraps or truncates on its own — clip safely with an ellipsis
// before it ever reaches the renderer instead.
function truncateLabel(label, max=20) {
  if (!label) return ''
  return label.length > max ? label.slice(0, max-1) + '…' : label
}

// ─── Flow diagram: one source flowing into N targets, curved ribbons ──
function FlowSplit({ title, sub, source, targets, fmt=(v)=>v, height=210 }) {
  const total = targets.reduce((s,t)=>s+(Math.max(0,t.value)||0),0) || 1
  const W = 500, H = height, pad = 14, gapPx = 5
  const leftX = pad+16, rightX = W-170
  const usableH = (H-pad*2) - gapPx*(targets.length-1)
  let srcCum = pad, tgtCum = pad
  const bands = targets.map(t=>{
    const val = Math.max(0,t.value)
    const h = total>0 ? (val/total)*usableH : 0
    const b = { ...t, value:val, srcY0:srcCum, srcY1:srcCum+h, tgtY0:tgtCum, tgtY1:tgtCum+h, h }
    srcCum += h; tgtCum += h+gapPx
    return b
  })
  const midX = (leftX+rightX)/2
  return (
    <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden', boxShadow:CARD_SHADOW }}>
      <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', background:'linear-gradient(180deg,#fafbff,#fff)' }}>
        <div style={{ fontWeight:700, fontSize:14 }}>{title}</div>
        {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{sub}</div>}
      </div>
      <div style={{ padding:'16px 20px', overflowX:'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ minWidth:340, display:'block' }}>
          {bands.filter(b=>b.value>0).map((b,i)=>(
            <path key={i}
              d={`M ${leftX},${b.srcY0} C ${midX},${b.srcY0} ${midX},${b.tgtY0} ${rightX},${b.tgtY0}
                  L ${rightX},${b.tgtY1} C ${midX},${b.tgtY1} ${midX},${b.srcY1} ${leftX},${b.srcY1} Z`}
              fill={b.color} opacity={0.24}>
              <title>{`${b.label}: ${fmt(b.value)}`}</title>
            </path>
          ))}
          <rect x={pad} y={pad} width={12} height={H-pad*2} rx={4} fill={source.color}/>
          <text x={pad-8} y={H/2-6} textAnchor="end" fontSize="11" fontWeight="700" fill="#334155">{truncateLabel(source.label)}</text>
          <text x={pad-8} y={H/2+9} textAnchor="end" fontSize="10" fill="#94a3b8">{fmt(source.value)}</text>
          {bands.map((b,i)=> b.value>0 && (
            <g key={i}>
              <rect x={rightX} y={b.tgtY0} width={12} height={Math.max(1,b.h)} rx={3} fill={b.color}/>
              <text x={rightX+18} y={(b.tgtY0+b.tgtY1)/2-4} fontSize="11" fontWeight="700" fill="#334155">{truncateLabel(b.label)}<title>{b.label}</title></text>
              <text x={rightX+18} y={(b.tgtY0+b.tgtY1)/2+10} fontSize="10" fill="#94a3b8">{fmt(b.value)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

// ─── Ring gauge: compact circular progress indicator ─────────────
function RingGauge({ pct, color, size=68, label, sub }) {
  const r = size/2-7
  const c = 2*Math.PI*r
  const clamped = Math.min(100,Math.max(0,pct))
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, minWidth:0, width:size+40 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={7}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${(clamped/100)*c} ${c}`} transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition:'stroke-dasharray .4s', filter:`drop-shadow(0 2px 3px ${color}55)` }}/>
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="800" fill="#1e293b">{pct}%</text>
      </svg>
      {/* 2-line clamp instead of single-line ellipsis — real project names were
          getting cut off after ~12-14 chars with the old nowrap+ellipsis rule */}
      {label && (
        <div title={label} style={{ fontSize:11, fontWeight:600, textAlign:'center', lineHeight:1.3,
          display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
          {label}
        </div>
      )}
      {sub && <div style={{ fontSize:9, color:'#94a3b8', textTransform:'capitalize' }}>{sub}</div>}
    </div>
  )
}

// ─── Department scorecard: health ring + headcount/hours/pending chips ──
function DepartmentCard({ name, pct, health, headcount, hours, pending, hasBudget }) {
  const c = health==='over'?'#ef4444':health==='risk'?'#f59e0b':health==='unknown'?'#94a3b8':'#10b981'
  const label = health==='over'?'Over Budget':health==='risk'?'At Risk':health==='unknown'?'No Budget Set':'Healthy'
  const [hover,setHover] = useState(false)
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{ position:'relative', background:`linear-gradient(155deg, #fff 0%, #fff 60%, ${c}08 100%)`, borderRadius:14, border:`1px solid ${c}25`, padding:'14px 16px',
        width:'100%', minWidth:0, boxSizing:'border-box', boxShadow: hover?CARD_SHADOW_HOVER:CARD_SHADOW,
        transform: hover?'translateY(-3px)':'none', transition:'transform .18s, box-shadow .18s', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3.5, background:`linear-gradient(90deg, ${c}, ${c}80)` }}/>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
        <RingGauge pct={hasBudget?pct:0} color={c} size={56}/>
        <div style={{ minWidth:0 }}>
          <div title={name} style={{ fontWeight:700, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
          <div style={{ fontSize:10, color:c, fontWeight:700, textTransform:'uppercase', letterSpacing:'.03em' }}>{label}</div>
        </div>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <span style={{ fontSize:10, padding:'3px 8px', borderRadius:6, background:'#f1f5f9', color:'#475569', fontWeight:600 }}>👥 {headcount}</span>
        <span style={{ fontSize:10, padding:'3px 8px', borderRadius:6, background:'#f1f5f9', color:'#475569', fontWeight:600 }}>⏱ {hours}h</span>
        {pending>0 && <span style={{ fontSize:10, padding:'3px 8px', borderRadius:6, background:'#fef3c7', color:'#b45309', fontWeight:700 }}>⚠ {pending} pending</span>}
      </div>
    </div>
  )
}

// ─── Hero banner ──────────────────────────────────────────────
const HERO = {
  admin:    { bg:'linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#ec4899 100%)', emoji:'👑', title:'Admin Control Center' },
  ceo:      { bg:'linear-gradient(135deg,#991b1b 0%,#dc2626 50%,#f97316 100%)', emoji:'🏛️', title:'CEO Executive Dashboard' },
  manager:  { bg:'linear-gradient(135deg,#0c4a6e 0%,#0284c7 50%,#06b6d4 100%)', emoji:'📋', title:'Manager Dashboard' },
  department_head: { bg:'linear-gradient(135deg,#0c4a6e 0%,#0284c7 50%,#06b6d4 100%)', emoji:'🧭', title:'Department Dashboard' },
  finance:  { bg:'linear-gradient(135deg,#064e3b 0%,#059669 50%,#34d399 100%)', emoji:'💰', title:'Finance Dashboard' },
  hr:       { bg:'linear-gradient(135deg,#164e63 0%,#0891b2 50%,#22d3ee 100%)', emoji:'🧑‍💼', title:'HR & People Dashboard' },
  employee: { bg:'linear-gradient(135deg,#78350f 0%,#d97706 50%,#fbbf24 100%)', emoji:'👤', title:'My Workspace' },
  procurement_lead: { bg:'linear-gradient(135deg,#0e7490 0%,#0891b2 50%,#22d3ee 100%)', emoji:'🧾', title:'Procurement Command Center' },
  pm:       { bg:'linear-gradient(135deg,#5b21b6 0%,#7c3aed 50%,#a78bfa 100%)', emoji:'📐', title:'Project & Procurement Overview' },
  cto:      { bg:'linear-gradient(135deg,#881337 0%,#be123c 50%,#fb7185 100%)', emoji:'🖥️', title:'Technology Overview' },
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const role     = profile?.role || 'employee'
  const hero     = HERO[role] || HERO.employee
  const isEmp    = role === 'employee'
  const isMgr    = ['admin','ceo','manager','department_head'].includes(role)
  const isFin    = ['admin','ceo','finance'].includes(role)
  const isHR     = ['admin','ceo','hr'].includes(role)
  const isCEO    = ['admin','ceo'].includes(role)
  const isProcurementLead = role==='procurement_lead'
  const isPM     = role==='pm'
  const isCTO    = role==='cto'

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState('M')
  const rawRef = useRef({ exp:[], inv:[], logs:[], users:[] })

  const greeting = new Date().getHours()<12?'Good morning':new Date().getHours()<18?'Good afternoon':'Good evening'
  const today = new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})

  useEffect(() => { load() }, [role, profile?.id])

  async function load() {
    setLoading(true)
    try {
      const [expR, trvR, venR, prjR, astR, prR, invR, logsR, leaveR, ratesR, usersR, devR, prodR, custR, budR, deptR, invSummary] = await Promise.all([
        supabase.from('expense_requests').select('id,amount,total_amount,status,created_at,requested_by,expense_date,category,project_id'),
        supabase.from('travel_requests').select('id,status,requested_by,estimated_cost'),
        supabase.from('vendors').select('id,status'),
        supabase.from('projects').select('id,name,status,budget,spent'),
        supabase.from('assets').select('id,status,purchase_value'),
        supabase.from('purchase_requisitions').select('id,status,estimated_amount,estimated_total'),
        supabase.from('invoices').select('id,status,total_amount,created_at'),
        supabase.from('time_logs').select('hours_worked,work_date,employee_id,project_id'),
        supabase.from('leave_requests').select('id,status,employee_id,leave_type'),
        supabase.from('resource_rates').select('employee_id,monthly_salary,hourly_rate'),
        supabase.from('profiles').select('id,full_name,role,is_active,created_at,department_id'),
        supabase.from('device_instances').select('id,status,warranty_end'),
        supabase.from('products').select('id,status'),
        supabase.from('customers').select('id,status'),
        supabase.from('budgets').select('id,allocated,committed_amount,spent,department_id'),
        supabase.from('departments').select('id,name,code'),
        // Same getInventorySummary() the Inventory page and Spend Analyzer's
        // Inventory tab call — reused here rather than re-derived, so this
        // dashboard KPI can never drift from what those pages show.
        getInventorySummary(),
      ])

      const allExp  = expR.data  || []
      const allTrv  = trvR.data  || []
      const allVen  = venR.data  || []
      const allPrj  = prjR.data  || []
      const allAst  = astR.data  || []
      const allPR   = prR.data   || []
      const allInv  = invR.data  || []
      const allLogs = logsR.data || []
      const allLeave= leaveR.data|| []
      const allRates= ratesR.data|| []
      const allUsers= usersR.data|| []
      const allDevices = devR.data || []
      const allProducts = prodR.data || []
      const allCustomers = custR.data || []
      const allBudgets = budR.data || []
      const allDepartments = deptR.data || []

      const myExp = isEmp ? allExp.filter(e=>e.requested_by===profile?.id) : allExp
      const myTrv = isEmp ? allTrv.filter(t=>t.requested_by===profile?.id) : allTrv
      const myLogs  = allLogs.filter(l=>l.employee_id===profile?.id)
      const myLeave = allLeave.filter(l=>l.employee_id===profile?.id)
      const hoursByMonth = MONTHS.map((m,mi)=>({
        month: m, hours: Math.round(myLogs.filter(l=>new Date(l.work_date).getMonth()===mi).reduce((s,l)=>s+(l.hours_worked||0),0))
      }))
      const thisMonth = new Date().getMonth()
      const myHoursThisMonth = hoursByMonth[thisMonth]?.hours || 0

      // Monthly trend
      const expByMonth = MONTHS.map((m,mi)=>({
        month: m,
        amount: allExp.filter(e=>new Date(e.created_at).getMonth()===mi).reduce((s,e)=>s+(e.total_amount||e.amount||0),0),
        invoiced: allInv.filter(i=>new Date(i.created_at).getMonth()===mi).reduce((s,i)=>s+(i.total_amount||0),0),
      }))

      // 3-month forecast (simple avg)
      const last3 = expByMonth.slice(-4,-1).map(m=>m.amount)
      const avgLast3 = last3.reduce((s,v)=>s+v,0)/(last3.length||1)
      const FORECAST_MONTHS = ['Next','2nd','3rd']
      const forecastData = [...expByMonth.slice(-3), ...FORECAST_MONTHS.map((f,i)=>({ month:f, forecast:Math.round(avgLast3*(1+i*0.05)) }))]

      // Resource hours
      const hrsByUser = {}
      allLogs.forEach(l=>{ hrsByUser[l.employee_id]=(hrsByUser[l.employee_id]||0)+(l.hours_worked||0) })
      const totalMonthlyPayroll = allRates.reduce((s,r)=>s+(r.monthly_salary||0),0)
      const totalHoursLogged = allLogs.reduce((s,l)=>s+(l.hours_worked||0),0)

      // Budget utilization per project
      const projectBudgetData = allPrj.map(p=>({
        name: p.name.slice(0,12),
        budget: p.budget||0, spent: p.spent||0,
        remaining: Math.max(0,(p.budget||0)-(p.spent||0))
      })).sort((a,b)=>b.budget-a.budget).slice(0,6)

      // Project health: budget utilization % + status, worst-first
      const projectHealth = allPrj.map(p=>{
        const pct = p.budget>0 ? Math.round(((p.spent||0)/p.budget)*100) : 0
        const health = pct>100 ? 'over' : pct>=70 ? 'risk' : 'healthy'
        return { id:p.id, name:p.name, status:p.status, pct, health }
      }).sort((a,b)=>{
        const rank = { over:0, risk:1, healthy:2 }
        return rank[a.health]-rank[b.health] || b.pct-a.pct
      }).slice(0,8)

      // Department bird's-eye: headcount, hours, pending work & budget health per department
      const empDeptMap = {}
      allUsers.forEach(u=>{ if(u.department_id) empDeptMap[u.id]=u.department_id })
      const PENDING_STATUSES = ['submitted','manager_review','ceo_review','finance_review','procurement_lead_review','pm_review','cto_review']
      const departmentHealth = allDepartments.map(dept=>{
        const deptUsers = allUsers.filter(u=>u.department_id===dept.id)
        const deptBudgets = allBudgets.filter(b=>b.department_id===dept.id)
        const allocated = deptBudgets.reduce((s,b)=>s+(b.allocated||0),0)
        const spent = deptBudgets.reduce((s,b)=>s+(b.spent||0),0)
        const hasBudget = deptBudgets.length>0 && allocated>0
        const pct = hasBudget ? Math.round((spent/allocated)*100) : 0
        const health = !hasBudget ? 'unknown' : pct>100 ? 'over' : pct>=70 ? 'risk' : 'healthy'
        const hours = Math.round(allLogs.filter(l=>empDeptMap[l.employee_id]===dept.id).reduce((s,l)=>s+(l.hours_worked||0),0))
        const pendingExpCount = allExp.filter(e=>empDeptMap[e.requested_by]===dept.id && PENDING_STATUSES.includes(e.status)).length
        const pendingLeaveCount = allLeave.filter(l=>empDeptMap[l.employee_id]===dept.id && l.status==='pending').length
        return { id:dept.id, name:dept.name, headcount:deptUsers.length, hasBudget, pct, health, hours, pending: pendingExpCount+pendingLeaveCount }
      }).sort((a,b)=>{
        const rank = { over:0, risk:1, unknown:2, healthy:3 }
        return rank[a.health]-rank[b.health] || b.pct-a.pct
      })

      // Resource flow: team hours split across top projects
      const hrsByProject = {}
      allLogs.forEach(l=>{ if(l.project_id) hrsByProject[l.project_id]=(hrsByProject[l.project_id]||0)+(l.hours_worked||0) })
      const topProjectsByHours = Object.entries(hrsByProject)
        .map(([id,hrs])=>({ id, hrs:Math.round(hrs), name: allPrj.find(p=>p.id===id)?.name || 'Unknown' }))
        .sort((a,b)=>b.hrs-a.hrs).slice(0,5)
      const topProjectsHoursSum = topProjectsByHours.reduce((s,p)=>s+p.hrs,0)
      const otherProjectHours = Math.max(0, Math.round(totalHoursLogged) - topProjectsHoursSum)

      // Pending approvals
      const pendingExp = allExp.filter(e=>['submitted','manager_review','ceo_review','finance_review'].includes(e.status)).length
      const pendingTrv = allTrv.filter(t=>['submitted','manager_review','ceo_review','finance_review'].includes(t.status)).length
      const prAt = st => allPR.filter(p=>p.status===st).length
      const pendingPR  = prAt('submitted') + prAt('manager_review') +
        prAt('procurement_lead_review') + prAt('pm_review') + prAt('cto_review') + prAt('finance_review') + prAt('ceo_review')

      // Procurement flow: current requests grouped by outcome bucket
      const prDraft = prAt('draft')
      const prInReview = pendingPR
      const prApproved = prAt('approved')
      const prRejected = prAt('rejected')
      const prCancelled = prAt('cancelled')

      // Payment flow: org-wide budget lifecycle (Allocated → Committed → Spent)
      const totalAllocated = allBudgets.reduce((s,b)=>s+(b.allocated||0),0)
      const totalCommitted = allBudgets.reduce((s,b)=>s+(b.committed_amount||0),0)
      const totalBudgetSpent = allBudgets.reduce((s,b)=>s+(b.spent||0),0)
      const availableBudget = Math.max(0, totalAllocated-totalCommitted)
      const committedUnspent = Math.max(0, totalCommitted-totalBudgetSpent)

      // Device warranty window
      const warrantyDays = d => d ? (new Date(d) - new Date()) / 86400000 : null
      const devicesWarrantySoon = allDevices.filter(x => { const days = warrantyDays(x.warranty_end); return days != null && days >= 0 && days <= 30 }).length

      // Invoice breakdown
      const invPaid     = allInv.filter(i=>i.status==='paid').reduce((s,i)=>s+(i.total_amount||0),0)
      const invPending  = allInv.filter(i=>i.status!=='paid'&&i.status!=='rejected').reduce((s,i)=>s+(i.total_amount||0),0)
      const invTotal    = allInv.reduce((s,i)=>s+(i.total_amount||0),0)

      rawRef.current = { exp: allExp, inv: allInv, logs: allLogs, users: allUsers }

      setData({
        // Expenses
        myExpenses: myExp.length, myExpAmt: myExp.reduce((s,e)=>s+(e.total_amount||e.amount||0),0),
        pendingExp, approvedExp: allExp.filter(e=>e.status==='approved').length,
        expTotal: allExp.reduce((s,e)=>s+(e.total_amount||e.amount||0),0),
        // Travel
        myTravel: myTrv.length, myTrvAmt: myTrv.reduce((s,t)=>s+(t.estimated_cost||0),0), pendingTrv,
        // My hours & leave (personal)
        hoursByMonth, myHoursThisMonth, myHoursTotal: Math.round(myLogs.reduce((s,l)=>s+(l.hours_worked||0),0)),
        myLeavePending: myLeave.filter(l=>l.status==='pending').length,
        myLeaveApproved: myLeave.filter(l=>l.status==='approved').length,
        // Projects
        totalProjects: allPrj.length, activeProjects: allPrj.filter(p=>p.status==='active').length,
        totalBudget: allPrj.reduce((s,p)=>s+(p.budget||0),0), totalSpent: allPrj.reduce((s,p)=>s+(p.spent||0),0),
        projectBudgetData,
        // Vendors & Assets
        activeVendors: allVen.filter(v=>v.status==='active').length, totalVendors: allVen.length,
        totalAssets: allAst.length, assetValue: allAst.reduce((s,a)=>s+(a.purchase_value||0),0),
        // Invoices
        invTotal, invPaid, invPending, totalInvoices: allInv.length,
        paidInvoices: allInv.filter(i=>i.status==='paid').length,
        // PRs
        pendingPR, totalPR: allPR.length,
        prValue: allPR.filter(p=>p.status==='approved').reduce((s,p)=>s+(p.estimated_total||p.estimated_amount||0),0),
        pendingProcLead: prAt('procurement_lead_review'), pendingPM: prAt('pm_review'), pendingCTO: prAt('cto_review'),
        pendingFinanceReview: prAt('finance_review'), pendingCEOReview: prAt('ceo_review'),
        approvedPR: allPR.filter(p=>p.status==='approved').length,
        prDraft, prInReview, prApproved, prRejected, prCancelled,
        // Payment flow
        totalAllocated, totalCommitted, totalBudgetSpent, availableBudget, committedUnspent,
        // Project health & resource flow
        projectHealth, topProjectsByHours, otherProjectHours,
        departmentHealth,
        // Procurement module (devices/products/customers)
        totalDevices: allDevices.length, devicesDeployed: allDevices.filter(x=>x.status==='deployed').length,
        devicesInStorage: allDevices.filter(x=>x.status==='in_storage').length,
        devicesAttention: allDevices.filter(x=>['faulty','replaced'].includes(x.status)).length,
        devicesDecommissioned: allDevices.filter(x=>x.status==='decommissioned').length,
        devicesWarrantySoon,
        totalProducts: allProducts.length, activeCustomers: allCustomers.filter(c=>c.status==='active').length,
        inventoryStockValue: invSummary.totalStockValue, inventoryLowStockCount: invSummary.lowStockCount,
        // Resources
        totalEmployees: allUsers.length,
        activeEmployees: allUsers.filter(u=>u.is_active!==false).length,
        totalMonthlyPayroll, totalHoursLogged, ratesSet: allRates.length,
        // Leave
        pendingLeaves: allLeave.filter(l=>l.status==='pending').length,
        approvedLeaves: allLeave.filter(l=>l.status==='approved').length,
        // Charts
        expByMonth, forecastData,
        // HR
        usersByRole: Object.fromEntries(Object.entries(allUsers.reduce((acc,u)=>{acc[u.role]=(acc[u.role]||0)+1;return acc},{})).map(([k,v])=>([k,v]))),
        leaveByType: Object.fromEntries(['sick','casual','personal','permission'].map(t=>[t,allLeave.filter(l=>l.leave_type===t).length])),
      })
    } catch(err) { console.error(err) }
    finally { setLoading(false) }
  }

  const periodStats = useMemo(() => {
    const { start, end } = getPeriodRange(period)
    const inRange = dt => { if (!dt) return false; const t = new Date(dt).getTime(); return t >= start.getTime() && t <= end.getTime() }
    const { exp, inv, logs, users } = rawRef.current
    const periodExpTotal = exp.filter(e => inRange(e.expense_date || e.created_at)).reduce((s,e) => s + (e.total_amount || e.amount || 0), 0)
    const periodInvTotal = inv.filter(i => inRange(i.created_at)).reduce((s,i) => s + (i.total_amount || 0), 0)
    const hrsByUser = {}
    let periodHoursLogged = 0
    logs.filter(l => inRange(l.work_date)).forEach(l => { hrsByUser[l.employee_id] = (hrsByUser[l.employee_id]||0) + (l.hours_worked||0); periodHoursLogged += (l.hours_worked||0) })
    const periodTopContributors = Object.entries(hrsByUser)
      .map(([id,hrs]) => ({ id, hrs: Math.round(hrs), name: users.find(u=>u.id===id)?.full_name || 'Unknown' }))
      .sort((a,b) => b.hrs-a.hrs).slice(0,5)
    return { periodExpTotal, periodInvTotal, periodHoursLogged: Math.round(periodHoursLogged), periodTopContributors }
  }, [period, data])

  if (loading||!data) return <Loader />
  const d = data

  // ─── EMPLOYEE DASHBOARD ──────────────────────────────────────
  if (isEmp) return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today} />
      <CheckInWidget variant="card" />
      <SectionHeader title="💼 My Overview"/>
      <div className="stats-grid">
        <KPI label="My Expenses" value={d.myExpenses} color="#6366f1" icon={<Receipt size={18}/>} href="/expenses"/>
        <KPI label="Total Claimed" value={rupee(d.myExpAmt)} color="#ec4899" icon={<DollarSign size={18}/>}/>
        <KPI label="Pending" value={d.pendingExp} sub="awaiting approval" color="#f59e0b" icon={<Clock size={18}/>} href="/expenses"/>
        <KPI label="Approved" value={d.approvedExp} color="#10b981" icon={<CheckCircle size={18}/>}/>
        <KPI label="Travel Requests" value={d.myTravel} color="#3b82f6" icon={<Plane size={18}/>} href="/travel"/>
        <KPI label="Hours This Month" value={`${d.myHoursThisMonth}h`} color="#8b5cf6" icon={<Clock size={18}/>} href="/timesheet"/>
        <KPI label="Leave Pending" value={d.myLeavePending} color="#f97316" icon={<AlertCircle size={18}/>} href="/leave"/>
      </div>
      <div className="dash-grid-2-1">
        <ChartCard title="My Expense Trend" sub="Monthly spend">
          <AreaChart data={d.expByMonth}>
            <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
            <Tooltip formatter={v=>[rupee(v),'Expenses']} contentStyle={{borderRadius:10,fontSize:12}}/>
            <Area type="monotone" dataKey="amount" stroke="#6366f1" fill="url(#g1)" strokeWidth={2.5} dot={false}/>
          </AreaChart>
        </ChartCard>
        <QuickActions role={role} isMgr={isMgr} isFin={isFin}/>
      </div>
      <div className="dash-grid-2-1">
        <ChartCard title="⏱ My Hours Logged" sub="Monthly timesheet total">
          <BarChart data={d.hoursByMonth} barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>`${v}h`} axisLine={false} tickLine={false}/>
            <Tooltip formatter={v=>[`${v}h`,'Hours']} contentStyle={{borderRadius:10,fontSize:12}}/>
            <Bar dataKey="hours" fill="#8b5cf6" radius={[6,6,0,0]}/>
          </BarChart>
        </ChartCard>
        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>🌴 My Leave Status</div>
          {[
            { label:'Pending', value:d.myLeavePending, c:'#f97316' },
            { label:'Approved', value:d.myLeaveApproved, c:'#10b981' },
          ].map(item=>(
            <Link key={item.label} to="/leave" className="dash-list-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:10, background:`${item.c}08`, border:`1px solid ${item.c}25`, textDecoration:'none', color:'inherit', marginBottom:8 }}>
              <span style={{ fontWeight:600, fontSize:13 }}>{item.label}</span>
              <span style={{ fontWeight:800, fontSize:18, color:item.c }}>{item.value}</span>
            </Link>
          ))}
          <div style={{ marginTop:4, padding:'10px 14px', borderRadius:10, background:'#f8fafc', border:'1px solid #e2e8f0' }}>
            <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>Total Hours (all time)</div>
            <div style={{ fontSize:18, fontWeight:800, color:'#1e293b', marginTop:2 }}>{d.myHoursTotal}h</div>
          </div>
        </div>
      </div>
    </div>
  )

  // ─── HR DASHBOARD ─────────────────────────────────────────────
  if (role==='hr') return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <CheckInWidget variant="card" />
      <SectionHeader title="👥 People & HR Overview"/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12 }}>
        <KPI label="Total Employees" value={d.totalEmployees} color="#6366f1" icon={<Users size={18}/>} href="/users"/>
        <KPI label="Active" value={d.activeEmployees} color="#10b981" icon={<CheckCircle size={18}/>}/>
        <KPI label="Pending Leaves" value={d.pendingLeaves} color="#f59e0b" icon={<Clock size={18}/>} href="/approvals"/>
        <KPI label="Approved Leaves" value={d.approvedLeaves} color="#ec4899" icon={<Calendar size={18}/>}/>
        <KPI label="Total Hours Logged" value={`${Math.round(d.totalHoursLogged)}h`} color="#3b82f6" icon={<Clock size={18}/>} href="/resources"/>
        <KPI label="Monthly Payroll" value={rupee(d.totalMonthlyPayroll)} color="#8b5cf6" icon={<DollarSign size={18}/>}/>
        <KPI label="Rates Configured" value={`${d.ratesSet}/${d.totalEmployees}`} color="#0891b2" icon={<Target size={18}/>}/>
      </div>
      <div className="dash-grid-1-1">
        <ChartCard title="Staff by Role">
          <PieChart>
            <Pie data={Object.entries(d.usersByRole).map(([k,v])=>({name:k,value:v}))} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" paddingAngle={3}>
              {Object.keys(d.usersByRole).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
            </Pie>
            <Legend iconSize={9} formatter={v=><span style={{fontSize:11,textTransform:'capitalize'}}>{v}</span>}/>
            <Tooltip/>
          </PieChart>
        </ChartCard>
        <ChartCard title="Leave by Type">
          <BarChart data={Object.entries(d.leaveByType).map(([k,v])=>({type:k,count:v}))} barSize={30}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="type" tick={{fontSize:11,textTransform:'capitalize'}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:11}} axisLine={false} tickLine={false}/>
            <Tooltip/>
            <Bar dataKey="count" fill="#0891b2" radius={[6,6,0,0]}>
              {Object.keys(d.leaveByType).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
            </Bar>
          </BarChart>
        </ChartCard>
      </div>
      <QuickActions role={role} isMgr={isMgr} isFin={isFin}/>
    </div>
  )

  // ─── PROCUREMENT LEAD DASHBOARD ────────────────────────────────
  if (isProcurementLead) return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <CheckInWidget variant="card" />
      <SectionHeader title="🧾 Procurement Overview" action={<Link to="/procurement" style={{ fontSize:12, color:'#0891b2', fontWeight:700, textDecoration:'none' }}>Open Requests →</Link>}/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))', gap:12 }}>
        <KPI label="Awaiting My Review" value={d.pendingProcLead} color="#0891b2" icon={<AlertCircle size={18}/>} href="/procurement"/>
        <KPI label="Total Requests" value={d.totalPR} color="#6366f1" icon={<ShoppingCart size={18}/>} href="/procurement"/>
        <KPI label="Approved" value={d.approvedPR} color="#10b981" icon={<CheckCircle size={18}/>}/>
        <KPI label="Approved Value" value={rupee(d.prValue)} color="#3b82f6" icon={<DollarSign size={18}/>}/>
        <KPI label="Active Vendors" value={d.activeVendors} color="#8b5cf6" icon={<Briefcase size={18}/>} href="/vendors"/>
        <KPI label="Products in Catalog" value={d.totalProducts} color="#f59e0b" icon={<Box size={18}/>} href="/products"/>
        <KPI label="Devices Needing Attention" value={d.devicesAttention} color="#ef4444" icon={<AlertCircle size={18}/>} href="/devices"/>
        <KPI label="Warranty ≤30 Days" value={d.devicesWarrantySoon} color="#f97316" icon={<Clock size={18}/>} href="/devices"/>
      </div>
      <div className="dash-grid-2-1">
        <ChartCard title="🔄 Requests in Pipeline" sub="Awaiting review at each approval stage">
          <BarChart data={[
            { stage:'Proc. Lead', count:d.pendingProcLead },
            { stage:'PM', count:d.pendingPM },
            { stage:'CTO', count:d.pendingCTO },
            { stage:'Finance', count:d.pendingFinanceReview },
            { stage:'CEO', count:d.pendingCEOReview },
          ]} barSize={30}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="stage" tick={{fontSize:11}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:11}} allowDecimals={false} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{borderRadius:10,fontSize:12}}/>
            <Bar dataKey="count" fill="#0891b2" radius={[6,6,0,0]}>
              {[0,1,2,3,4].map(i=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
            </Bar>
          </BarChart>
        </ChartCard>
        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>📡 Device Fleet</div>
          {[
            { label:'Deployed', value:d.devicesDeployed, c:'#10b981' },
            { label:'In Storage', value:d.devicesInStorage, c:'#3b82f6' },
            { label:'Needing Attention', value:d.devicesAttention, c:'#ef4444' },
            { label:'Decommissioned', value:d.devicesDecommissioned, c:'#94a3b8' },
          ].map(item=>(
            <Link key={item.label} to="/devices" className="dash-list-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:10, background:`${item.c}08`, border:`1px solid ${item.c}25`, textDecoration:'none', color:'inherit', marginBottom:8 }}>
              <span style={{ fontWeight:600, fontSize:13 }}>{item.label}</span>
              <span style={{ fontWeight:800, fontSize:18, color:item.c }}>{item.value}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )

  // ─── PM DASHBOARD ───────────────────────────────────────────────
  if (isPM) return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <CheckInWidget variant="card" />
      <SectionHeader title="📐 Projects & Procurement" action={<Link to="/projects" style={{ fontSize:12, color:'#7c3aed', fontWeight:700, textDecoration:'none' }}>View Projects →</Link>}/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))', gap:12 }}>
        <KPI label="Awaiting My Review" value={d.pendingPM} color="#7c3aed" icon={<AlertCircle size={18}/>} href="/procurement"/>
        <KPI label="Active Projects" value={d.activeProjects} color="#6366f1" icon={<FolderOpen size={18}/>} href="/projects"/>
        <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#3b82f6" icon={<DollarSign size={18}/>}/>
        <KPI label="Total Spent" value={rupee(d.totalSpent)} color="#f59e0b" sub={`${d.totalBudget>0?Math.round(d.totalSpent/d.totalBudget*100):0}% of budget`}/>
        <KPI label="Team Hours" value={`${Math.round(d.totalHoursLogged)}h`} color="#ec4899" icon={<Clock size={18}/>} href="/resources"/>
        <KPI label="Devices Deployed" value={d.devicesDeployed} color="#10b981" icon={<Box size={18}/>} href="/devices"/>
      </div>
      <div className="dash-grid-2-1">
        <ChartCard title="📁 Project Budget vs Actual Spend" sub="Top projects by budget allocation">
          <BarChart data={d.projectBudgetData} barSize={16} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="name" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>`₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false}/>
            <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
            <Legend iconSize={9} wrapperStyle={{fontSize:12}}/>
            <Bar dataKey="budget" name="Budget" fill="#7c3aed" radius={[4,4,0,0]}/>
            <Bar dataKey="spent" name="Spent" fill="#f59e0b" radius={[4,4,0,0]}/>
            <Bar dataKey="remaining" name="Remaining" fill="#10b981" radius={[4,4,0,0]}/>
          </BarChart>
        </ChartCard>
        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>⚡ Pending Actions</div>
          {[
            { label:'Procurement Reviews', value:d.pendingPM, c:'#7c3aed', href:'/procurement' },
            { label:'Active Projects', value:d.activeProjects, c:'#6366f1', href:'/projects' },
          ].map(item=>(
            <Link key={item.label} to={item.href} className="dash-list-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:10, background:item.value>0?`${item.c}08`:'#f8fafc', border:`1px solid ${item.value>0?item.c+'25':'#e2e8f0'}`, textDecoration:'none', color:'inherit', marginBottom:8 }}>
              <span style={{ fontWeight:600, fontSize:13 }}>{item.label}</span>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontWeight:800, fontSize:18, color:item.value>0?item.c:'#94a3b8' }}>{item.value}</span>
                <ArrowRight size={13} style={{ color:'#94a3b8' }}/>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )

  // ─── CTO DASHBOARD ──────────────────────────────────────────────
  if (isCTO) return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <CheckInWidget variant="card" />
      <SectionHeader title="🖥️ Technology & Delivery" action={<Link to="/devices" style={{ fontSize:12, color:'#be123c', fontWeight:700, textDecoration:'none' }}>View Devices →</Link>}/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))', gap:12 }}>
        <KPI label="Awaiting My Review" value={d.pendingCTO} color="#be123c" icon={<AlertCircle size={18}/>} href="/procurement"/>
        <KPI label="Active Projects" value={d.activeProjects} color="#6366f1" icon={<FolderOpen size={18}/>} href="/projects"/>
        <KPI label="Devices Deployed" value={d.devicesDeployed} color="#10b981" icon={<Box size={18}/>} href="/devices"/>
        <KPI label="Needing Attention" value={d.devicesAttention} color="#ef4444" icon={<AlertCircle size={18}/>} href="/devices"/>
        <KPI label="Warranty ≤30 Days" value={d.devicesWarrantySoon} color="#f97316" icon={<Clock size={18}/>} href="/devices"/>
        <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#3b82f6" icon={<DollarSign size={18}/>}/>
      </div>
      <div className="dash-grid-1-1">
        <ChartCard title="📡 Device Fleet Status">
          <PieChart>
            <Pie data={[
              { name:'Deployed', value:d.devicesDeployed },
              { name:'In Storage', value:d.devicesInStorage },
              { name:'Needing Attention', value:d.devicesAttention },
              { name:'Decommissioned', value:d.devicesDecommissioned },
            ]} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" paddingAngle={3}>
              {[0,1,2,3].map(i=><Cell key={i} fill={['#10b981','#3b82f6','#ef4444','#94a3b8'][i]}/>)}
            </Pie>
            <Legend iconSize={9} formatter={v=><span style={{fontSize:11}}>{v}</span>}/>
            <Tooltip/>
          </PieChart>
        </ChartCard>
        <ChartCard title="📁 Project Budget Utilization">
          <BarChart data={d.projectBudgetData.slice(0,6)} layout="vertical" barSize={12} barGap={3}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false}/>
            <XAxis type="number" tick={{fontSize:9}} tickFormatter={v=>`₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false}/>
            <YAxis type="category" dataKey="name" tick={{fontSize:9}} width={70} axisLine={false} tickLine={false}/>
            <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
            <Bar dataKey="spent" name="Spent" fill="#be123c" radius={[0,3,3,0]}/>
            <Bar dataKey="remaining" name="Remaining" fill="#10b981" radius={[0,3,3,0]}/>
          </BarChart>
        </ChartCard>
      </div>
    </div>
  )

  // ─── MANAGER / DEPARTMENT HEAD DASHBOARD ──────────────────────
  if (role==='manager' || role==='department_head') return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <CheckInWidget variant="card" />
      <BurnRateWatchlist/>
      <SectionHeader title="📋 Operations Overview" action={<PeriodFilter value={period} onChange={setPeriod}/>}/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))', gap:12 }}>
        <KPI label="Pending Approvals" value={d.pendingExp+d.pendingTrv+d.pendingPR} color="#f59e0b" icon={<AlertCircle size={18}/>} href="/approvals"/>
        <KPI label="Active Projects" value={d.activeProjects} color="#6366f1" icon={<FolderOpen size={18}/>} href="/projects"/>
        <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#3b82f6" icon={<DollarSign size={18}/>}/>
        <KPI label="Total Spent" value={rupee(d.totalSpent)} color="#f59e0b" sub={`${d.totalBudget>0?Math.round(d.totalSpent/d.totalBudget*100):0}% of budget`}/>
        <KPI label="Active Vendors" value={d.activeVendors} color="#10b981" icon={<Briefcase size={18}/>} href="/vendors"/>
        <KPI label="Total Assets" value={d.totalAssets} color="#8b5cf6" icon={<Box size={18}/>} href="/assets"/>
        <KPI label="Asset Value" value={rupee(d.assetValue)} color="#0891b2" icon={<DollarSign size={18}/>}/>
        <KPI label="Team Hours" value={`${periodStats.periodHoursLogged}h`} sub={PERIOD_LABEL[period]} color="#ec4899" icon={<Clock size={18}/>} href="/resources"/>
      </div>
      <div className="dash-grid-2-1">
        <ChartCard title="📊 Expense Trend — Month by Month" sub="All team expenses">
          <AreaChart data={d.expByMonth}>
            <defs>
              <linearGradient id="mg1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
              <linearGradient id="mg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={.2}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
            <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
            <Legend iconSize={9} wrapperStyle={{fontSize:12}}/>
            <Area type="monotone" dataKey="amount" name="Expenses" stroke="#3b82f6" fill="url(#mg1)" strokeWidth={2.5} dot={false}/>
            <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke="#10b981" fill="url(#mg2)" strokeWidth={2} dot={false}/>
          </AreaChart>
        </ChartCard>
        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>⚡ Pending Actions</div>
          {[
            { label:'Expense Approvals', value:d.pendingExp, c:'#6366f1', href:'/approvals' },
            { label:'Travel Approvals', value:d.pendingTrv, c:'#ec4899', href:'/approvals' },
            { label:'PR Approvals', value:d.pendingPR, c:'#f59e0b', href:'/procurement' },
          ].map(item=>(
            <Link key={item.label} to={item.href} className="dash-list-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:10, background:item.value>0?`${item.c}08`:'#f8fafc', border:`1px solid ${item.value>0?item.c+'25':'#e2e8f0'}`, textDecoration:'none', color:'inherit', marginBottom:8 }}>
              <span style={{ fontWeight:600, fontSize:13 }}>{item.label}</span>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontWeight:800, fontSize:18, color:item.value>0?item.c:'#94a3b8' }}>{item.value}</span>
                <ArrowRight size={13} style={{ color:'#94a3b8' }}/>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <ChartCard title="📁 Project Budget vs Actual Spend" sub="Top projects by budget allocation" height={240}>
        <BarChart data={d.projectBudgetData} barSize={16} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
          <XAxis dataKey="name" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
          <YAxis tick={{fontSize:10}} tickFormatter={v=>`₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false}/>
          <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
          <Legend iconSize={9} wrapperStyle={{fontSize:12}}/>
          <Bar dataKey="budget" name="Budget" fill="#6366f1" radius={[4,4,0,0]}/>
          <Bar dataKey="spent" name="Spent" fill="#f59e0b" radius={[4,4,0,0]}/>
          <Bar dataKey="remaining" name="Remaining" fill="#10b981" radius={[4,4,0,0]}/>
        </BarChart>
      </ChartCard>
      <div className="dash-grid-1-1">
        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:2 }}>🏆 Top Contributors — Hours Logged</div>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:14 }}>{PERIOD_LABEL[period]}</div>
          {periodStats.periodTopContributors.length===0
            ? <div style={{ fontSize:12, color:'#94a3b8' }}>No hours logged {PERIOD_LABEL[period].toLowerCase()}</div>
            : periodStats.periodTopContributors.map((c,i)=>{
              const max = periodStats.periodTopContributors[0]?.hrs || 1
              return (
                <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                  <div style={{ width:20, fontSize:11, fontWeight:800, color: i<3?'#f59e0b':'#94a3b8', flexShrink:0 }}>#{i+1}</div>
                  <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>
                    {(c.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
                    <div style={{ height:5, borderRadius:3, background:'#f1f5f9', overflow:'hidden', marginTop:3 }}>
                      <div style={{ height:'100%', width:`${(c.hrs/max)*100}%`, background:'#6366f1', borderRadius:3 }}/>
                    </div>
                  </div>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'#6366f1', flexShrink:0 }}>{c.hrs}h</div>
                </div>
              )
            })}
        </div>
        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>📡 Devices & Assets</div>
          {[
            { label:'Devices Deployed', value:d.devicesDeployed, c:'#10b981', href:'/devices' },
            { label:'Needing Attention', value:d.devicesAttention, c:'#ef4444', href:'/devices' },
            { label:'Total Assets', value:d.totalAssets, c:'#8b5cf6', href:'/assets' },
          ].map(item=>(
            <Link key={item.label} to={item.href} className="dash-list-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:10, background:`${item.c}08`, border:`1px solid ${item.c}25`, textDecoration:'none', color:'inherit', marginBottom:8 }}>
              <span style={{ fontWeight:600, fontSize:13 }}>{item.label}</span>
              <span style={{ fontWeight:800, fontSize:18, color:item.c }}>{item.value}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )

  // ─── FINANCE DASHBOARD ────────────────────────────────────────
  if (role==='finance') return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <CheckInWidget variant="card" />
      <BurnRateWatchlist/>
      <SectionHeader title="💰 Financial Overview" action={<PeriodFilter value={period} onChange={setPeriod}/>}/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))', gap:12 }}>
        <KPI label="Invoice Value" value={rupee(periodStats.periodInvTotal)} sub={PERIOD_LABEL[period]} color="#059669" icon={<FileText size={18}/>} href="/invoices"/>
        <KPI label="Paid" value={rupee(d.invPaid)} sub={`${d.paidInvoices} invoices`} color="#10b981" icon={<CheckCircle size={18}/>}/>
        <KPI label="Pending Payment" value={rupee(d.invPending)} color="#f59e0b" icon={<Clock size={18}/>}/>
        <KPI label="Expenses" value={rupee(periodStats.periodExpTotal)} sub={PERIOD_LABEL[period]} color="#6366f1" icon={<Receipt size={18}/>} href="/expenses"/>
        <KPI label="PR Value Approved" value={rupee(d.prValue)} color="#8b5cf6" icon={<ShoppingCart size={18}/>}/>
        <KPI label="Monthly Payroll" value={rupee(d.totalMonthlyPayroll)} color="#ec4899" icon={<Users size={18}/>}/>
        <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#3b82f6" icon={<Target size={18}/>}/>
        <KPI label="Total Spent" value={rupee(d.totalSpent)} color="#0891b2" sub={`${d.totalBudget>0?Math.round(d.totalSpent/d.totalBudget*100):0}% utilized`}/>
      </div>

      {/* Invoice breakdown pie */}
      <div className="dash-grid-1-1">
        <ChartCard title="💳 Invoice Payment Status">
          <PieChart>
            <Pie data={[{name:'Paid',value:d.invPaid},{name:'Pending',value:d.invPending}]} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" paddingAngle={4}>
              <Cell fill="#10b981"/><Cell fill="#f59e0b"/>
            </Pie>
            <Legend iconSize={9} formatter={v=><span style={{fontSize:11}}>{v}</span>}/>
            <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
          </PieChart>
        </ChartCard>
        <ChartCard title="📈 Revenue vs Expenses">
          <BarChart data={d.expByMonth.slice(-6)} barSize={14} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:10}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
            <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
            <Legend iconSize={9} wrapperStyle={{fontSize:12}}/>
            <Bar dataKey="invoiced" name="Invoiced" fill="#10b981" radius={[4,4,0,0]}/>
            <Bar dataKey="amount" name="Expenses" fill="#6366f1" radius={[4,4,0,0]}/>
          </BarChart>
        </ChartCard>
      </div>

      {/* 3-month forecast */}
      <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden', boxShadow:CARD_SHADOW }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontWeight:700, fontSize:14 }}>📊 3-Month Spend Forecast</div>
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>Based on 3-month rolling average</div>
          </div>
          <div style={{ padding:'4px 12px', borderRadius:999, background:'#fef3c7', color:'#b45309', fontSize:11, fontWeight:700 }}>Projected</div>
        </div>
        <div style={{ padding:'16px 20px' }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.forecastData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
              <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
              <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
              <Legend iconSize={9} wrapperStyle={{fontSize:12}}/>
              <Line type="monotone" dataKey="amount" name="Actual" stroke="#6366f1" strokeWidth={2.5} dot={{r:3}} connectNulls={false}/>
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#f59e0b" strokeWidth={2} dot={{r:3}} strokeDasharray="6 3" connectNulls={false}/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginTop:16 }}>
            {d.forecastData.slice(-3).map((f,i)=>(
              <div key={i} style={{ padding:'10px 14px', borderRadius:10, background:`${COLORS[(i+2)%COLORS.length]}08`, border:`1px solid ${COLORS[(i+2)%COLORS.length]}20` }}>
                <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>{f.month}</div>
                <div style={{ fontSize:18, fontWeight:800, color:COLORS[(i+2)%COLORS.length], marginTop:4 }}>{rupee(f.forecast||f.amount)}</div>
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{f.forecast?'Forecast':'Actual'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  // ─── CEO / ADMIN DASHBOARD ────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>

      {/* Process Command Center */}
      <div>
        <SectionHeader title="🎯 Process Command Center" sub="Live view of how every department, project, payment, resource and procurement request is moving"/>

        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', marginBottom:16, boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>🏢 Department Bird's-Eye View</div>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:14 }}>Sorted worst-first — the department needing attention is always on the left</div>
          {d.departmentHealth.length===0 ? <div style={{ fontSize:12, color:'#94a3b8' }}>No departments configured yet — add them in Settings</div> : (
            <div className="dash-dept-grid">
              {d.departmentHealth.map(dept=>(
                <Link key={dept.id} to="/budget" style={{ textDecoration:'none', color:'inherit' }}>
                  <DepartmentCard {...dept}/>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', marginBottom:16, boxShadow:CARD_SHADOW }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>🩺 Project Health</div>
          {d.projectHealth.length===0 ? <div style={{ fontSize:12, color:'#94a3b8' }}>No projects yet</div> : (
            <div style={{ display:'flex', gap:20, overflowX:'auto', paddingBottom:4 }}>
              {d.projectHealth.map(p=>{
                const c = p.health==='over'?'#ef4444':p.health==='risk'?'#f59e0b':'#10b981'
                return (
                  <Link key={p.id} to="/projects" style={{ textDecoration:'none', color:'inherit', flexShrink:0 }}>
                    <RingGauge pct={p.pct} color={c} label={p.name} sub={p.status?.replace(/_/g,' ')}/>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16, marginBottom:16 }}>
          <FlowSplit title="💳 Payment Flow — Allocation" sub="Total budget allocated across departments & projects"
            fmt={rupee}
            source={{ label:'Allocated', value:d.totalAllocated, color:'#3b82f6' }}
            targets={[
              { label:'Committed', value:d.totalCommitted, color:'#8b5cf6' },
              { label:'Available', value:d.availableBudget, color:'#10b981' },
            ]}/>
          <FlowSplit title="💳 Payment Flow — Settlement" sub="Committed budget moving toward actual spend"
            fmt={rupee}
            source={{ label:'Committed', value:d.totalCommitted, color:'#8b5cf6' }}
            targets={[
              { label:'Spent', value:d.totalBudgetSpent, color:'#f59e0b' },
              { label:'Still Committed', value:d.committedUnspent, color:'#94a3b8' },
            ]}/>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16 }}>
          <FlowSplit title="👥 Resource Flow" sub="Where team hours are going — top projects by hours logged"
            fmt={v=>`${v}h`}
            source={{ label:'Team Hours', value:Math.round(d.totalHoursLogged), color:'#0891b2' }}
            targets={[
              ...d.topProjectsByHours.map((p,i)=>({ label:p.name, value:p.hrs, color:COLORS[i%COLORS.length] })),
              ...(d.otherProjectHours>0 ? [{ label:'Other Projects', value:d.otherProjectHours, color:'#cbd5e1' }] : []),
            ]}/>
          <FlowSplit title="🔄 Procurement Flow" sub="Every request, by current outcome"
            fmt={v=>v}
            source={{ label:'Total Requests', value:d.totalPR, color:'#6366f1' }}
            targets={[
              { label:'Draft', value:d.prDraft, color:'#94a3b8' },
              { label:'In Review', value:d.prInReview, color:'#f59e0b' },
              { label:'Approved', value:d.prApproved, color:'#10b981' },
              { label:'Rejected', value:d.prRejected, color:'#ef4444' },
              { label:'Cancelled', value:d.prCancelled, color:'#64748b' },
            ]}/>
        </div>
      </div>

      {/* People & HR */}
      <div>
        <SectionHeader title="👥 People & HR" action={<Link to="/users" style={{ fontSize:12, color:'#6366f1', fontWeight:700, textDecoration:'none' }}>View All →</Link>}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:14 }}>
          <KPI label="Total Employees" value={d.totalEmployees} color="#6366f1" icon={<Users size={16}/>} href="/users"/>
          <KPI label="Active" value={d.activeEmployees} color="#10b981" icon={<CheckCircle size={16}/>}/>
          <KPI label="Pending Leaves" value={d.pendingLeaves} color="#f59e0b" icon={<Clock size={16}/>} href="/approvals"/>
          <KPI label="Monthly Payroll" value={rupee(d.totalMonthlyPayroll)} color="#8b5cf6" icon={<DollarSign size={16}/>}/>
          <KPI label="Hours Logged" value={`${Math.round(d.totalHoursLogged)}h`} color="#0891b2" icon={<Clock size={16}/>} href="/resources"/>
        </div>
        <div className="dash-grid-1-1">
          <ChartCard title="Staff by Role" height={200}>
            <PieChart>
              <Pie data={Object.entries(d.usersByRole).map(([k,v])=>({name:k,value:v}))} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
                {Object.keys(d.usersByRole).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Pie>
              <Legend iconSize={9} formatter={v=><span style={{fontSize:11,textTransform:'capitalize'}}>{v}</span>}/>
              <Tooltip/>
            </PieChart>
          </ChartCard>
          <ChartCard title="Leave by Type" height={200}>
            <BarChart data={Object.entries(d.leaveByType).map(([k,v])=>({type:k,count:v}))} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
              <XAxis dataKey="type" tick={{fontSize:10,textTransform:'capitalize'}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10}} allowDecimals={false} axisLine={false} tickLine={false}/>
              <Tooltip/>
              <Bar dataKey="count" fill="#0891b2" radius={[6,6,0,0]}>
                {Object.keys(d.leaveByType).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ChartCard>
        </div>
      </div>

      {/* Finance */}
      <div>
        <SectionHeader title="💰 Finance" action={<Link to="/fundflow" style={{ fontSize:12, color:'#059669', fontWeight:700, textDecoration:'none' }}>View Fund Flow →</Link>}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:14 }}>
          <KPI label="Total Expense" value={rupee(d.expTotal)} color="#6366f1" icon={<Receipt size={16}/>} href="/expenses"/>
          <KPI label="Invoice Value" value={rupee(d.invTotal)} color="#059669" icon={<FileText size={16}/>} href="/invoices"/>
          <KPI label="Paid Invoices" value={rupee(d.invPaid)} color="#10b981" icon={<CheckCircle size={16}/>}/>
          <KPI label="Pending Payments" value={rupee(d.invPending)} color="#f59e0b" icon={<Clock size={16}/>}/>
          <KPI label="Total Payroll" value={rupee(d.totalMonthlyPayroll)} color="#ec4899" icon={<DollarSign size={16}/>}/>
        </div>
        <div className="dash-grid-2-1">
          <ChartCard title="Approved vs Forecast vs Actual Expenses" sub="Full year overview" height={220}>
            <LineChart data={d.forecastData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
              <XAxis dataKey="month" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
              <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
              <Legend iconSize={9} wrapperStyle={{fontSize:12}}/>
              <Line type="monotone" dataKey="amount" name="Actual" stroke="#6366f1" strokeWidth={2.5} dot={{r:3}}/>
              <Line type="monotone" dataKey="invoiced" name="Invoiced" stroke="#10b981" strokeWidth={2} dot={{r:3}}/>
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={{r:3}}/>
            </LineChart>
          </ChartCard>
          <ChartCard title="Invoice Payment Status" height={220}>
            <PieChart>
              <Pie data={[{name:'Paid',value:d.invPaid},{name:'Pending',value:d.invPending}]} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={4}>
                <Cell fill="#10b981"/><Cell fill="#f59e0b"/>
              </Pie>
              <Legend iconSize={9} formatter={v=><span style={{fontSize:11}}>{v}</span>}/>
              <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
            </PieChart>
          </ChartCard>
        </div>
      </div>

      {/* Operations & Procurement */}
      <div>
        <SectionHeader title="📋 Operations & Procurement" action={<Link to="/projects" style={{ fontSize:12, color:'#3b82f6', fontWeight:700, textDecoration:'none' }}>View Projects →</Link>}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:14 }}>
          <KPI label="Active Projects" value={d.activeProjects} color="#3b82f6" icon={<FolderOpen size={16}/>} href="/projects"/>
          <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#6366f1" icon={<Target size={16}/>}/>
          <KPI label="Total Spent" value={rupee(d.totalSpent)} color="#f59e0b" sub={`${d.totalBudget>0?Math.round(d.totalSpent/d.totalBudget*100):0}%`}/>
          <KPI label="Active Vendors" value={d.activeVendors} color="#10b981" icon={<Briefcase size={16}/>} href="/vendors"/>
          <KPI label="Pending Approvals" value={d.pendingExp+d.pendingTrv+d.pendingPR} color="#ef4444" icon={<AlertCircle size={16}/>} href="/approvals"/>
        </div>
        <div className="dash-grid-1-1">
          <ChartCard title="Project Budget Utilization" height={200}>
            <BarChart data={d.projectBudgetData.slice(0,5)} layout="vertical" barSize={10} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false}/>
              <XAxis type="number" tick={{fontSize:9}} tickFormatter={v=>`₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" tick={{fontSize:9}} width={70} axisLine={false} tickLine={false}/>
              <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
              <Bar dataKey="spent" name="Spent" fill="#f59e0b" radius={[0,3,3,0]}/>
              <Bar dataKey="remaining" name="Remaining" fill="#10b981" radius={[0,3,3,0]}/>
            </BarChart>
          </ChartCard>
          <ChartCard title="🔄 Procurement Pipeline" sub="Requests awaiting each approval stage" height={200}>
            <BarChart data={[
              { stage:'Proc. Lead', count:d.pendingProcLead },
              { stage:'PM', count:d.pendingPM },
              { stage:'CTO', count:d.pendingCTO },
              { stage:'Finance', count:d.pendingFinanceReview },
              { stage:'CEO', count:d.pendingCEOReview },
            ]} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
              <XAxis dataKey="stage" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10}} allowDecimals={false} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{borderRadius:10,fontSize:12}}/>
              <Bar dataKey="count" fill="#8b5cf6" radius={[6,6,0,0]}>
                {[0,1,2,3,4].map(i=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ChartCard>
        </div>
      </div>

      {/* Technology & Delivery */}
      <div>
        <SectionHeader title="🖥️ Technology & Delivery" action={<Link to="/devices" style={{ fontSize:12, color:'#be123c', fontWeight:700, textDecoration:'none' }}>View Devices →</Link>}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:14 }}>
          <KPI label="Devices Deployed" value={d.devicesDeployed} color="#10b981" icon={<Box size={16}/>} href="/devices"/>
          <KPI label="Needing Attention" value={d.devicesAttention} color="#ef4444" icon={<AlertCircle size={16}/>} href="/devices"/>
          <KPI label="Warranty ≤30 Days" value={d.devicesWarrantySoon} color="#f97316" icon={<Clock size={16}/>} href="/devices"/>
          <KPI label="Products in Catalog" value={d.totalProducts} color="#8b5cf6" icon={<Box size={16}/>} href="/products"/>
          <KPI label="Active Customers" value={d.activeCustomers} color="#0891b2" icon={<Briefcase size={16}/>} href="/customers"/>
          <KPI label="Inventory Stock Value" value={rupee(d.inventoryStockValue)} color="#0ea5e9" icon={<DollarSign size={16}/>} href="/inventory"/>
          <KPI label="Low Stock Alerts" value={d.inventoryLowStockCount} color="#ef4444" icon={<AlertCircle size={16}/>} href="/inventory?view=components"/>
        </div>
        <ChartCard title="📡 Device Fleet Status" height={200}>
          <PieChart>
            <Pie data={[
              { name:'Deployed', value:d.devicesDeployed },
              { name:'In Storage', value:d.devicesInStorage },
              { name:'Needing Attention', value:d.devicesAttention },
              { name:'Decommissioned', value:d.devicesDecommissioned },
            ]} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
              {[0,1,2,3].map(i=><Cell key={i} fill={['#10b981','#3b82f6','#ef4444','#94a3b8'][i]}/>)}
            </Pie>
            <Legend iconSize={9} formatter={v=><span style={{fontSize:11}}>{v}</span>}/>
            <Tooltip/>
          </PieChart>
        </ChartCard>
      </div>

      <QuickActions role={role} isMgr={true} isFin={true}/>
    </div>
  )
}

function HeroBanner({ hero, name, greeting, today }) {
  return (
    <div style={{ background:hero.bg, borderRadius:22, padding:'30px 34px', color:'#fff', position:'relative', overflow:'hidden',
      boxShadow:'0 20px 44px -18px rgba(15,23,42,.35)' }}>
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(115deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 42%)', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', right:-40, top:-40, width:220, height:220, borderRadius:'50%', background:'rgba(255,255,255,.08)' }}/>
      <div style={{ position:'absolute', right:80, bottom:-70, width:150, height:150, borderRadius:'50%', background:'rgba(255,255,255,.06)' }}/>
      <div style={{ position:'absolute', left:'40%', top:-60, width:120, height:120, borderRadius:'50%', background:'rgba(255,255,255,.05)' }}/>
      <div style={{ position:'relative' }}>
        <div style={{ fontSize:13, opacity:.85, marginBottom:6, fontWeight:600 }}>{hero.emoji} {greeting}</div>
        <div style={{ fontSize:30, fontWeight:800, marginBottom:10, fontFamily:"'Playfair Display',serif", letterSpacing:'-.01em' }}>{name||'User'}</div>
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:12.5, fontWeight:600, background:'rgba(255,255,255,.16)', padding:'5px 13px', borderRadius:999 }}>
          {hero.title} <span style={{ opacity:.6 }}>·</span> {today}
        </div>
      </div>
    </div>
  )
}

function Calendar({ size }) { return <Clock size={size}/> }

function QuickActions({ role, isMgr, isFin }) {
  const actions = [
    { label:'+ New Expense', href:'/expenses', color:'#6366f1' },
    { label:'✈ Travel Request', href:'/travel', color:'#ec4899' },
    ...(isMgr?[{ label:'✓ Approvals', href:'/approvals', color:'#f59e0b' }]:[]),
    ...(isFin?[{ label:'💸 Fund Flow', href:'/fundflow', color:'#10b981' }]:[]),
    ...(isMgr?[{ label:'🛒 Procurement', href:'/procurement', color:'#8b5cf6' }]:[]),
    { label:'📊 Reports', href:'/reports', color:'#3b82f6' },
    { label:'⏱ Time Tracking', href:'/resources', color:'#0891b2' },
    { label:'📅 Leave', href:'/leave', color:'#ec4899' },
  ]
  return (
    <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', padding:'18px 20px', boxShadow:CARD_SHADOW }}>
      <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>⚡ Quick Actions</div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        {actions.map(a=>(
          <Link key={a.href} to={a.href} className="dash-quick-action" style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:10, background:`${a.color}10`, color:a.color, fontSize:13, fontWeight:700, textDecoration:'none', border:`1.5px solid ${a.color}20` }}>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

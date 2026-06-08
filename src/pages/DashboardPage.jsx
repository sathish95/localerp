import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Loader } from '../components/ui'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  Receipt, Users, FolderOpen, Box, TrendingUp, Clock,
  DollarSign, Plane, FileText, ShoppingCart, ArrowRight,
  CheckCircle, AlertCircle, Briefcase, Target, BarChart2
} from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COLORS  = ['#6366f1','#10b981','#f59e0b','#ec4899','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

// ─── Mini KPI card ────────────────────────────────────────────
function KPI({ label, value, sub, color='#6366f1', icon, trend, href }) {
  const content = (
    <div style={{ background:'#fff', borderRadius:16, padding:'16px 18px', border:`1.5px solid ${color}18`, borderTop:`4px solid ${color}`, boxShadow:'0 1px 6px rgba(0,0,0,.05)', height:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:`${color}12`, display:'flex', alignItems:'center', justifyContent:'center', color }}>{icon}</div>
        {trend != null && (
          <span style={{ fontSize:11, fontWeight:700, color: trend>=0?'#10b981':'#ef4444', background: trend>=0?'#dcfce7':'#fee2e2', padding:'2px 7px', borderRadius:999 }}>
            {trend>=0?'▲':'▼'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: typeof value==='string'&&value.length>8?18:24, fontWeight:800, color, lineHeight:1.1, marginBottom:4 }}>{value}</div>
      <div style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{sub}</div>}
    </div>
  )
  return href ? <Link to={href} style={{ textDecoration:'none', display:'block' }}>{content}</Link> : content
}

// ─── Section header ───────────────────────────────────────────
function SectionHeader({ title, action }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
      <h2 style={{ fontSize:15, fontWeight:800, color:'#1e293b', margin:0 }}>{title}</h2>
      {action}
    </div>
  )
}

// ─── Chart card ───────────────────────────────────────────────
function ChartCard({ title, sub, children, height=220 }) {
  return (
    <div style={{ background:'#fff', borderRadius:16, border:'1.5px solid #e2e8f0', overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
      <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9' }}>
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

// ─── Hero banner ──────────────────────────────────────────────
const HERO = {
  admin:    { bg:'linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#ec4899 100%)', emoji:'👑', title:'Admin Control Center' },
  ceo:      { bg:'linear-gradient(135deg,#991b1b 0%,#dc2626 50%,#f97316 100%)', emoji:'🏛️', title:'CEO Executive Dashboard' },
  manager:  { bg:'linear-gradient(135deg,#0c4a6e 0%,#0284c7 50%,#06b6d4 100%)', emoji:'📋', title:'Manager Dashboard' },
  finance:  { bg:'linear-gradient(135deg,#064e3b 0%,#059669 50%,#34d399 100%)', emoji:'💰', title:'Finance Dashboard' },
  hr:       { bg:'linear-gradient(135deg,#164e63 0%,#0891b2 50%,#22d3ee 100%)', emoji:'🧑‍💼', title:'HR & People Dashboard' },
  employee: { bg:'linear-gradient(135deg,#78350f 0%,#d97706 50%,#fbbf24 100%)', emoji:'👤', title:'My Workspace' },
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

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState('M')

  const greeting = new Date().getHours()<12?'Good morning':new Date().getHours()<18?'Good afternoon':'Good evening'
  const today = new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})

  useEffect(() => { load() }, [role, profile?.id])

  async function load() {
    setLoading(true)
    try {
      const [expR, trvR, venR, prjR, astR, prR, invR, logsR, leaveR, ratesR, usersR] = await Promise.all([
        supabase.from('expense_requests').select('id,amount,total_amount,status,created_at,requested_by,expense_date,category,project_id'),
        supabase.from('travel_requests').select('id,status,requested_by,estimated_cost'),
        supabase.from('vendors').select('id,status'),
        supabase.from('projects').select('id,name,status,budget,spent'),
        supabase.from('assets').select('id,status,purchase_value'),
        supabase.from('purchase_requisitions').select('id,status,estimated_amount'),
        supabase.from('invoices').select('id,status,total_amount,created_at'),
        supabase.from('time_logs').select('hours_worked,work_date,employee_id'),
        supabase.from('leave_requests').select('id,status,employee_id,leave_type'),
        supabase.from('resource_rates').select('employee_id,monthly_salary,hourly_rate'),
        supabase.from('profiles').select('id,role,is_active,created_at'),
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

      const myExp = isEmp ? allExp.filter(e=>e.requested_by===profile?.id) : allExp
      const myTrv = isEmp ? allTrv.filter(t=>t.requested_by===profile?.id) : allTrv

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

      // Pending approvals
      const pendingExp = allExp.filter(e=>['submitted','manager_review','ceo_review','finance_review'].includes(e.status)).length
      const pendingTrv = allTrv.filter(t=>['submitted','manager_review','ceo_review','finance_review'].includes(t.status)).length
      const pendingPR  = allPR.filter(p=>['submitted','manager_review'].includes(p.status)).length

      // Invoice breakdown
      const invPaid     = allInv.filter(i=>i.status==='paid').reduce((s,i)=>s+(i.total_amount||0),0)
      const invPending  = allInv.filter(i=>i.status!=='paid'&&i.status!=='rejected').reduce((s,i)=>s+(i.total_amount||0),0)
      const invTotal    = allInv.reduce((s,i)=>s+(i.total_amount||0),0)

      setData({
        // Expenses
        myExpenses: myExp.length, myExpAmt: myExp.reduce((s,e)=>s+(e.total_amount||e.amount||0),0),
        pendingExp, approvedExp: allExp.filter(e=>e.status==='approved').length,
        expTotal: allExp.reduce((s,e)=>s+(e.total_amount||e.amount||0),0),
        // Travel
        myTravel: myTrv.length, myTrvAmt: myTrv.reduce((s,t)=>s+(t.estimated_cost||0),0), pendingTrv,
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
        prValue: allPR.filter(p=>p.status==='approved').reduce((s,p)=>s+(p.estimated_amount||0),0),
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

  if (loading||!data) return <Loader />
  const d = data

  // ─── EMPLOYEE DASHBOARD ──────────────────────────────────────
  if (isEmp) return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today} />
      <div className="stats-grid">
        <KPI label="My Expenses" value={d.myExpenses} color="#6366f1" icon={<Receipt size={18}/>} href="/expenses"/>
        <KPI label="Total Claimed" value={rupee(d.myExpAmt)} color="#ec4899" icon={<DollarSign size={18}/>}/>
        <KPI label="Pending" value={d.pendingExp} sub="awaiting approval" color="#f59e0b" icon={<Clock size={18}/>} href="/expenses"/>
        <KPI label="Approved" value={d.approvedExp} color="#10b981" icon={<CheckCircle size={18}/>}/>
        <KPI label="Travel Requests" value={d.myTravel} color="#3b82f6" icon={<Plane size={18}/>} href="/travel"/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
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
    </div>
  )

  // ─── HR DASHBOARD ─────────────────────────────────────────────
  if (role==='hr') return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <SectionHeader title="👥 People & HR Overview"/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12 }}>
        <KPI label="Total Employees" value={d.totalEmployees} color="#6366f1" icon={<Users size={18}/>} href="/users"/>
        <KPI label="Active" value={d.activeEmployees} color="#10b981" icon={<CheckCircle size={18}/>}/>
        <KPI label="Pending Leaves" value={d.pendingLeaves} color="#f59e0b" icon={<Clock size={18}/>} href="/approvals"/>
        <KPI label="Approved Leaves" value={d.approvedLeaves} color="#ec4899" icon={<Calendar size={18}/>}/>
        <KPI label="Total Hours Logged" value={`${Math.round(d.totalHoursLogged)}h`} color="#3b82f6" icon={<Clock size={18}/>} href="/resources"/>
        <KPI label="Monthly Payroll" value={rupee(d.totalMonthlyPayroll)} color="#8b5cf6" icon={<DollarSign size={18}/>}/>
        <KPI label="Rates Configured" value={`${d.ratesSet}/${d.totalEmployees}`} color="#0891b2" icon={<Target size={18}/>}/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
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

  // ─── MANAGER DASHBOARD ────────────────────────────────────────
  if (role==='manager') return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <SectionHeader title="📋 Operations Overview" action={<PeriodFilter value={period} onChange={setPeriod}/>}/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))', gap:12 }}>
        <KPI label="Pending Approvals" value={d.pendingExp+d.pendingTrv+d.pendingPR} color="#f59e0b" icon={<AlertCircle size={18}/>} href="/approvals"/>
        <KPI label="Active Projects" value={d.activeProjects} color="#6366f1" icon={<FolderOpen size={18}/>} href="/projects"/>
        <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#3b82f6" icon={<DollarSign size={18}/>}/>
        <KPI label="Total Spent" value={rupee(d.totalSpent)} color="#f59e0b" sub={`${d.totalBudget>0?Math.round(d.totalSpent/d.totalBudget*100):0}% of budget`}/>
        <KPI label="Active Vendors" value={d.activeVendors} color="#10b981" icon={<Briefcase size={18}/>} href="/vendors"/>
        <KPI label="Total Assets" value={d.totalAssets} color="#8b5cf6" icon={<Box size={18}/>} href="/assets"/>
        <KPI label="Asset Value" value={rupee(d.assetValue)} color="#0891b2" icon={<DollarSign size={18}/>}/>
        <KPI label="Team Hours" value={`${Math.round(d.totalHoursLogged)}h`} color="#ec4899" icon={<Clock size={18}/>} href="/resources"/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
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
        <div style={{ background:'#fff', borderRadius:16, border:'1.5px solid #e2e8f0', padding:'16px 20px' }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>⚡ Pending Actions</div>
          {[
            { label:'Expense Approvals', value:d.pendingExp, c:'#6366f1', href:'/approvals' },
            { label:'Travel Approvals', value:d.pendingTrv, c:'#ec4899', href:'/approvals' },
            { label:'PR Approvals', value:d.pendingPR, c:'#f59e0b', href:'/procurement' },
          ].map(item=>(
            <Link key={item.label} to={item.href} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:10, background:item.value>0?`${item.c}08`:'#f8fafc', border:`1px solid ${item.value>0?item.c+'25':'#e2e8f0'}`, textDecoration:'none', color:'inherit', marginBottom:8 }}>
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
    </div>
  )

  // ─── FINANCE DASHBOARD ────────────────────────────────────────
  if (role==='finance') return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <HeroBanner hero={hero} name={profile?.full_name} greeting={greeting} today={today}/>
      <SectionHeader title="💰 Financial Overview" action={<PeriodFilter value={period} onChange={setPeriod}/>}/>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))', gap:12 }}>
        <KPI label="Total Invoice Value" value={rupee(d.invTotal)} color="#059669" icon={<FileText size={18}/>} href="/invoices"/>
        <KPI label="Paid" value={rupee(d.invPaid)} sub={`${d.paidInvoices} invoices`} color="#10b981" icon={<CheckCircle size={18}/>}/>
        <KPI label="Pending Payment" value={rupee(d.invPending)} color="#f59e0b" icon={<Clock size={18}/>}/>
        <KPI label="Total Expenses" value={rupee(d.expTotal)} color="#6366f1" icon={<Receipt size={18}/>} href="/expenses"/>
        <KPI label="PR Value Approved" value={rupee(d.prValue)} color="#8b5cf6" icon={<ShoppingCart size={18}/>}/>
        <KPI label="Monthly Payroll" value={rupee(d.totalMonthlyPayroll)} color="#ec4899" icon={<Users size={18}/>}/>
        <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#3b82f6" icon={<Target size={18}/>}/>
        <KPI label="Total Spent" value={rupee(d.totalSpent)} color="#0891b2" sub={`${d.totalBudget>0?Math.round(d.totalSpent/d.totalBudget*100):0}% utilized`}/>
      </div>

      {/* Invoice breakdown pie */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
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
      <div style={{ background:'#fff', borderRadius:16, border:'1.5px solid #e2e8f0', overflow:'hidden' }}>
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

      {/* Employee KPIs */}
      <div>
        <SectionHeader title="👥 People & HR" action={<Link to="/users" style={{ fontSize:12, color:'#6366f1', fontWeight:700, textDecoration:'none' }}>View All →</Link>}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:10 }}>
          <KPI label="Total Employees" value={d.totalEmployees} color="#6366f1" icon={<Users size={16}/>} href="/users"/>
          <KPI label="Active" value={d.activeEmployees} color="#10b981" icon={<CheckCircle size={16}/>}/>
          <KPI label="Pending Leaves" value={d.pendingLeaves} color="#f59e0b" icon={<Clock size={16}/>} href="/approvals"/>
          <KPI label="Monthly Payroll" value={rupee(d.totalMonthlyPayroll)} color="#8b5cf6" icon={<DollarSign size={16}/>}/>
          <KPI label="Hours Logged" value={`${Math.round(d.totalHoursLogged)}h`} color="#0891b2" icon={<Clock size={16}/>} href="/resources"/>
        </div>
      </div>

      {/* Finance KPIs */}
      <div>
        <SectionHeader title="💰 Finance" action={<Link to="/fundflow" style={{ fontSize:12, color:'#059669', fontWeight:700, textDecoration:'none' }}>View Fund Flow →</Link>}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:10 }}>
          <KPI label="Total Expense" value={rupee(d.expTotal)} color="#6366f1" icon={<Receipt size={16}/>} href="/expenses"/>
          <KPI label="Invoice Value" value={rupee(d.invTotal)} color="#059669" icon={<FileText size={16}/>} href="/invoices"/>
          <KPI label="Paid Invoices" value={rupee(d.invPaid)} color="#10b981" icon={<CheckCircle size={16}/>}/>
          <KPI label="Pending Payments" value={rupee(d.invPending)} color="#f59e0b" icon={<Clock size={16}/>}/>
          <KPI label="Total Payroll" value={rupee(d.totalMonthlyPayroll)} color="#ec4899" icon={<DollarSign size={16}/>}/>
        </div>
      </div>

      {/* Manager/Operations KPIs */}
      <div>
        <SectionHeader title="📋 Operations" action={<Link to="/projects" style={{ fontSize:12, color:'#3b82f6', fontWeight:700, textDecoration:'none' }}>View Projects →</Link>}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:10 }}>
          <KPI label="Active Projects" value={d.activeProjects} color="#3b82f6" icon={<FolderOpen size={16}/>} href="/projects"/>
          <KPI label="Total Budget" value={rupee(d.totalBudget)} color="#6366f1" icon={<Target size={16}/>}/>
          <KPI label="Total Spent" value={rupee(d.totalSpent)} color="#f59e0b" sub={`${d.totalBudget>0?Math.round(d.totalSpent/d.totalBudget*100):0}%`}/>
          <KPI label="Active Vendors" value={d.activeVendors} color="#10b981" icon={<Briefcase size={16}/>} href="/vendors"/>
          <KPI label="Pending Approvals" value={d.pendingExp+d.pendingTrv+d.pendingPR} color="#ef4444" icon={<AlertCircle size={16}/>} href="/approvals"/>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
        <ChartCard title="Approved vs Forecast vs Actual Expenses" sub="Full year overview" height={240}>
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
        <ChartCard title="Project Budget Utilization">
          <BarChart data={d.projectBudgetData.slice(0,5)} layout="vertical" barSize={10} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false}/>
            <XAxis type="number" tick={{fontSize:9}} tickFormatter={v=>`₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false}/>
            <YAxis type="category" dataKey="name" tick={{fontSize:9}} width={70} axisLine={false} tickLine={false}/>
            <Tooltip formatter={v=>[rupee(v)]} contentStyle={{borderRadius:10,fontSize:12}}/>
            <Bar dataKey="spent" name="Spent" fill="#f59e0b" radius={[0,3,3,0]}/>
            <Bar dataKey="remaining" name="Remaining" fill="#10b981" radius={[0,3,3,0]}/>
          </BarChart>
        </ChartCard>
      </div>
      <QuickActions role={role} isMgr={true} isFin={true}/>
    </div>
  )
}

function HeroBanner({ hero, name, greeting, today }) {
  return (
    <div style={{ background:hero.bg, borderRadius:20, padding:'28px 32px', color:'#fff', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', right:-40, top:-40, width:200, height:200, borderRadius:'50%', background:'rgba(255,255,255,.07)' }}/>
      <div style={{ position:'absolute', right:60, bottom:-60, width:140, height:140, borderRadius:'50%', background:'rgba(255,255,255,.05)' }}/>
      <div style={{ fontSize:13, opacity:.8, marginBottom:4 }}>{hero.emoji} {greeting}</div>
      <div style={{ fontSize:28, fontWeight:800, marginBottom:4, fontFamily:"'Playfair Display',serif" }}>{name||'User'}</div>
      <div style={{ fontSize:14, opacity:.8 }}>{hero.title} · {today}</div>
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
    <div style={{ background:'#fff', borderRadius:16, border:'1.5px solid #e2e8f0', padding:'16px 20px' }}>
      <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>⚡ Quick Actions</div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        {actions.map(a=>(
          <Link key={a.href} to={a.href} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:10, background:`${a.color}10`, color:a.color, fontSize:13, fontWeight:700, textDecoration:'none', border:`1.5px solid ${a.color}20`, transition:'all .15s' }}>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

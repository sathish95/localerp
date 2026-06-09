import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MISSING_ENV } from './lib/supabase'
import { AuthProvider, useAuth } from './context/AuthContext'
import { TabVisibilityProvider } from './context/TabVisibilityContext'
import Layout from './components/layout/Layout'
import { Loader } from './components/ui'

import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ExpensesPage from './pages/ExpensesPage'
import ApprovalsPage from './pages/ApprovalsPage'
import VendorsPage from './pages/VendorsPage'
import ProjectsPage from './pages/ProjectsPage'
import BudgetPage from './pages/BudgetPage'
import AssetsPage from './pages/AssetsPage'
import TravelPage from './pages/TravelPage'
import ProcurementPage from './pages/ProcurementPage'
import InvoicesPage from './pages/InvoicesPage'
import FundFlowPage from './pages/FundFlowPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import GRNPage from './pages/GRNPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
import ReportsPage from './pages/ReportsPage'
import LeavePage from './pages/LeavePage'
import TimesheetPage from './pages/TimesheetPage'
import TimesheetApprovalPage from './pages/TimesheetApprovalPage'
import ChatPage from './pages/ChatPage'
import AppMonitorPage from './pages/AppMonitorPage'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import AdminContentPage from './pages/AdminContentPage'
import ResourcePage from './pages/ResourcePage'
import TasksPage from './pages/TasksPage'
import { NotificationProvider } from './context/NotificationContext'

function AppRoutes() {
  const { user, profile, loading } = useAuth()
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}><div className="spinner" /></div>
  if (!user) return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  )

  const role = profile?.role || 'employee'
  const isManager = ['admin','ceo','manager','department_head'].includes(role)
  const isFinance  = ['admin','ceo','finance'].includes(role)
  const isAdmin    = ['admin','ceo'].includes(role)
  const isHR       = ['admin','ceo','hr'].includes(role)
  const isHROrManager = ['admin','ceo','hr','manager','department_head'].includes(role)

  return (
    <TabVisibilityProvider>
      <NotificationProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/travel" element={<TravelPage />} />
          <Route path="/approvals" element={isManager || isHR ? <ApprovalsPage /> : <Navigate to="/" />} />
          <Route path="/vendors" element={isManager || isFinance ? <VendorsPage /> : <Navigate to="/" />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/procurement" element={<ProcurementPage />} />
          <Route path="/invoices" element={isManager || isFinance ? <InvoicesPage /> : <Navigate to="/" />} />
          <Route path="/fundflow" element={isFinance ? <FundFlowPage /> : <Navigate to="/" />} />
          <Route path="/pos" element={isManager || isFinance ? <PurchaseOrdersPage /> : <Navigate to="/" />} />
          <Route path="/grn" element={isManager || isFinance ? <GRNPage /> : <Navigate to="/" />} />
          <Route path="/users" element={isManager || isFinance || isHR ? <UsersPage /> : <Navigate to="/" />} />
          <Route path="/settings" element={isAdmin ? <SettingsPage /> : <Navigate to="/" />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/leave" element={<LeavePage />} />
          <Route path="/resources" element={<ResourcePage />} />
          <Route path="/timesheet" element={<TimesheetPage />} />
          <Route path="/timesheet-approvals" element={<TimesheetApprovalPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/app-monitor" element={isAdmin ? <AppMonitorPage /> : <Navigate to="/" />} />
          <Route path="/content" element={isAdmin ? <AdminContentPage /> : <Navigate to="/" />} />
          <Route path="/login" element={<Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
      </NotificationProvider>
    </TabVisibilityProvider>
  )
}

function SetupScreen() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', fontFamily:"'Plus Jakarta Sans',sans-serif", padding:20 }}>
      <div style={{ maxWidth:520, width:'100%' }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>⚙️</div>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:28, fontWeight:800, marginBottom:8 }}>ThingsAlive NeoX</div>
          <div style={{ color:'#64748b', fontSize:15 }}>Environment variables are not configured</div>
        </div>
        <div style={{ background:'#fff', borderRadius:16, border:'1.5px solid #e2e8f0', overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,.06)' }}>
          <div style={{ background:'#fee2e2', borderBottom:'1.5px solid #fecaca', padding:'14px 20px', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:18 }}>⚠️</span>
            <span style={{ fontWeight:700, color:'#dc2626', fontSize:14 }}>Missing Supabase Configuration</span>
          </div>
          <div style={{ padding:24 }}>
            <p style={{ fontSize:14, color:'#475569', marginBottom:20, lineHeight:1.6 }}>
              Add these two environment variables to your <strong>Netlify site settings</strong> to connect to your Supabase database.
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:24 }}>
              {[
                { key:'VITE_SUPABASE_URL', hint:'https://xxxxxxxxxxxx.supabase.co', where:'Supabase → Project Settings → API → Project URL' },
                { key:'VITE_SUPABASE_ANON_KEY', hint:'eyJhbGciOiJIUzI1NiIs...', where:'Supabase → Project Settings → API → anon public key' },
              ].map(v => (
                <div key={v.key} style={{ borderRadius:10, border:'1.5px solid #e2e8f0', overflow:'hidden' }}>
                  <div style={{ background:'#f8fafc', padding:'8px 14px', borderBottom:'1px solid #e2e8f0', fontFamily:'monospace', fontSize:13, fontWeight:700, color:'#6366f1' }}>{v.key}</div>
                  <div style={{ padding:'8px 14px' }}>
                    <div style={{ fontFamily:'monospace', fontSize:12, color:'#94a3b8', marginBottom:4 }}>{v.hint}</div>
                    <div style={{ fontSize:12, color:'#64748b' }}>📍 {v.where}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background:'#f0f9ff', borderRadius:10, padding:16, border:'1px solid #bae6fd' }}>
              <div style={{ fontWeight:700, fontSize:13, color:'#0369a1', marginBottom:10 }}>How to add in Netlify:</div>
              {['Go to Netlify → Your Site → Site Configuration → Environment Variables','Click "Add a variable" for each key above','Paste the value from Supabase','Click Deploy → Trigger deploy (or push a new commit)'].map((s,i) => (
                <div key={i} style={{ display:'flex', gap:10, marginBottom:8, fontSize:13, color:'#0c4a6e' }}>
                  <span style={{ width:20, height:20, borderRadius:'50%', background:'#0369a1', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>{i+1}</span>
                  {s}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  if (MISSING_ENV) return <SetupScreen />
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { MISSING_ENV } from './lib/supabase'
import { AuthProvider, useAuth } from './context/AuthContext'
import { TabVisibilityProvider } from './context/TabVisibilityContext'
import Layout from './components/layout/Layout'
import ModuleGate from './components/ModuleGate'
import { Loader } from './components/ui'

import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
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
import LLMMonitorPage from './pages/LLMMonitorPage'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import AdminContentPage from './pages/AdminContentPage'
import ResourcePage from './pages/ResourcePage'
import TasksPage from './pages/TasksPage'
import NeoTaskAIPage from './pages/NeoTaskAIPage'
import CustomersPage from './pages/CustomersPage'
import ProductsPage from './pages/ProductsPage'
import BomManagementPage from './pages/BomManagementPage'
import InventoryPage from './pages/InventoryPage'
import DevicesPage from './pages/DevicesPage'
import SkillMatrixPage from './pages/SkillMatrixPage'
import AllocationsPage from './pages/AllocationsPage'
import CapacityPage from './pages/CapacityPage'
import RoleRatesPage from './pages/RoleRatesPage'
import CustomerInvoicesPage from './pages/CustomerInvoicesPage'
import PaymentsPage from './pages/PaymentsPage'
import AgingReportPage from './pages/AgingReportPage'
import ProfitMarginPage from './pages/ProfitMarginPage'
import SpendAnalyzerPage from './pages/SpendAnalyzerPage'
import WarrantyPage from './pages/WarrantyPage'
import DataAssistantPage from './pages/DataAssistantPage'
import ProposalsPage from './pages/ProposalsPage'
import LeadsPage from './pages/LeadsPage'
import LandingLinksPage from './pages/LandingLinksPage'
import MeetingBookingPagesPage from './pages/MeetingBookingPagesPage'
import OpportunitiesPage from './pages/OpportunitiesPage'
import SalesTasksPage from './pages/SalesTasksPage'
import ProductLaunchesPage from './pages/ProductLaunchesPage'
import TendersPage from './pages/TendersPage'
import PilotProjectsPage from './pages/PilotProjectsPage'
import BootstrapProgramsPage from './pages/BootstrapProgramsPage'
import SalesTimelinePage from './pages/SalesTimelinePage'
import SalesDashboardPage from './pages/SalesDashboardPage'
import PublicLeadFormPage from './pages/PublicLeadFormPage'
import PublicMeetingBookingPage from './pages/PublicMeetingBookingPage'
import CampaignsPage from './pages/CampaignsPage'
import LandingPagesPage from './pages/LandingPagesPage'
import ContentAssetsPage from './pages/ContentAssetsPage'
import MarketingCalendarPage from './pages/MarketingCalendarPage'
import PerformanceCyclesPage from './pages/PerformanceCyclesPage'
import MyPerformancePage from './pages/MyPerformancePage'
import TeamReviewsPage from './pages/TeamReviewsPage'
import CalibrationPage from './pages/CalibrationPage'
import PerformanceDashboardPage from './pages/PerformanceDashboardPage'
import SuperAdminPage from './pages/SuperAdminPage'
import { NotificationProvider } from './context/NotificationContext'

function AppRoutes() {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}><div className="spinner" /></div>

  // Public lead-capture / meeting-booking pages render standalone (no
  // Layout/sidebar) and are reachable regardless of auth state — checked
  // before the !user branch so an already-logged-in admin can preview
  // their own link too.
  if (location.pathname.startsWith('/l/')) {
    return <Routes><Route path="/l/:slug" element={<PublicLeadFormPage />} /></Routes>
  }
  if (location.pathname.startsWith('/book/')) {
    return <Routes><Route path="/book/:slug" element={<PublicMeetingBookingPage />} /></Routes>
  }

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
  const isProcurementModule = ['admin','ceo','manager','department_head','finance','procurement_lead','pm','cto'].includes(role)
  const isProposalModule = ['admin','ceo','finance','cto','sales_lead'].includes(role)
  const isSalesModule = ['admin','ceo','sales_head','regional_sales_head','sales_rep','sales_ops'].includes(role)
  const isLandingLinksModule = ['admin','ceo','sales_head','regional_sales_head','sales_ops','cmo','campaign_manager'].includes(role)
  const isSalesTenderPilotBootstrap = ['admin','ceo','sales_head','regional_sales_head','sales_rep','sales_ops','finance'].includes(role)
  const isSalesDashboard = ['admin','ceo','finance','cmo','cto','sales_head','regional_sales_head'].includes(role)
  const isMarketingRead = ['admin','ceo','cmo','campaign_manager','sales_rep','regional_sales_head','sales_head','finance','cto'].includes(role)
  const isPerformanceAdmin = ['admin','ceo','hr'].includes(role)
  const isPerformanceReviewer = ['admin','ceo','hr','manager','department_head'].includes(role)
  const isPerformanceDashboard = ['admin','ceo','hr','manager','department_head','cto'].includes(role)
  // PMO Head has no dedicated role in this app; 'manager' stands in as the
  // closest cross-project oversight role. department_head also gets in per
  // the stakeholder decision to give both the enterprise page and a
  // project-scoped mirror (rather than department_head being enterprise-blocked).
  const canViewSpendAnalyzer = ['admin','ceo','finance','manager','department_head'].includes(role)
  const canViewWarranty = ['admin','ceo','manager','department_head','finance','procurement_lead','pm','cto','field_technician'].includes(role)

  return (
    <TabVisibilityProvider>
      <NotificationProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<ModuleGate tab="dashboard" allowed={true}><DashboardPage /></ModuleGate>} />
          <Route path="/knowledge-base" element={<ModuleGate tab="knowledge-base" allowed={true}><KnowledgeBasePage /></ModuleGate>} />
          <Route path="/expenses" element={<ModuleGate tab="expenses" allowed={true}><ExpensesPage /></ModuleGate>} />
          <Route path="/travel" element={<ModuleGate tab="travel" allowed={true}><TravelPage /></ModuleGate>} />
          <Route path="/approvals" element={<ModuleGate tab="approvals" allowed={isManager || isHR}><ApprovalsPage /></ModuleGate>} />
          <Route path="/vendors" element={<ModuleGate tab="vendors" allowed={isManager || isFinance}><VendorsPage /></ModuleGate>} />
          <Route path="/projects" element={<ModuleGate tab="projects" allowed={true}><ProjectsPage /></ModuleGate>} />
          <Route path="/tasks" element={<ModuleGate tab="tasks" allowed={true}><TasksPage /></ModuleGate>} />
          <Route path="/neo-task-ai" element={<ModuleGate tab="neo-task-ai" allowed={true}><NeoTaskAIPage /></ModuleGate>} />
          <Route path="/budget" element={<ModuleGate tab="budget" allowed={true}><BudgetPage /></ModuleGate>} />
          <Route path="/assets" element={<ModuleGate tab="assets" allowed={true}><AssetsPage /></ModuleGate>} />
          <Route path="/procurement" element={<ModuleGate tab="procurement" allowed={true}><ProcurementPage /></ModuleGate>} />
          <Route path="/customers" element={<ModuleGate tab="customers" allowed={isProcurementModule}><CustomersPage /></ModuleGate>} />
          <Route path="/products" element={<ModuleGate tab="products" allowed={isProcurementModule}><ProductsPage /></ModuleGate>} />
          <Route path="/bom" element={<ModuleGate tab="bom" allowed={isProcurementModule}><BomManagementPage /></ModuleGate>} />
          <Route path="/inventory" element={<ModuleGate tab="inventory" allowed={isProcurementModule}><InventoryPage /></ModuleGate>} />
          <Route path="/devices" element={<ModuleGate tab="devices" allowed={isProcurementModule}><DevicesPage /></ModuleGate>} />
          <Route path="/warranty" element={<ModuleGate tab="warranty" allowed={canViewWarranty}><WarrantyPage /></ModuleGate>} />
          <Route path="/proposals" element={<ModuleGate tab="proposals" allowed={isProposalModule}><ProposalsPage /></ModuleGate>} />
          <Route path="/sales/leads" element={<ModuleGate tab="sales-leads" allowed={isSalesModule}><LeadsPage /></ModuleGate>} />
          <Route path="/sales/landing-links" element={<ModuleGate tab="sales-landing-links" allowed={isLandingLinksModule}><LandingLinksPage /></ModuleGate>} />
          <Route path="/sales/meeting-pages" element={<ModuleGate tab="sales-meeting-pages" allowed={isLandingLinksModule}><MeetingBookingPagesPage /></ModuleGate>} />
          <Route path="/sales/opportunities" element={<ModuleGate tab="sales-opportunities" allowed={isSalesModule}><OpportunitiesPage /></ModuleGate>} />
          <Route path="/sales/tasks" element={<ModuleGate tab="sales-tasks" allowed={isSalesModule}><SalesTasksPage /></ModuleGate>} />
          <Route path="/sales/product-launches" element={<ModuleGate tab="sales-product-launches" allowed={isSalesTenderPilotBootstrap || role==='cto'}><ProductLaunchesPage /></ModuleGate>} />
          <Route path="/sales/tenders" element={<ModuleGate tab="sales-tenders" allowed={isSalesTenderPilotBootstrap}><TendersPage /></ModuleGate>} />
          <Route path="/sales/pilot-projects" element={<ModuleGate tab="sales-pilot-projects" allowed={isSalesTenderPilotBootstrap}><PilotProjectsPage /></ModuleGate>} />
          <Route path="/sales/bootstrap-programs" element={<ModuleGate tab="sales-bootstrap-programs" allowed={isSalesTenderPilotBootstrap}><BootstrapProgramsPage /></ModuleGate>} />
          <Route path="/sales/timeline" element={<ModuleGate tab="sales-timeline" allowed={isSalesDashboard}><SalesTimelinePage /></ModuleGate>} />
          <Route path="/sales/dashboard" element={<ModuleGate tab="sales-dashboard" allowed={isSalesDashboard}><SalesDashboardPage /></ModuleGate>} />
          <Route path="/marketing/campaigns" element={<ModuleGate tab="marketing-campaigns" allowed={isMarketingRead}><CampaignsPage /></ModuleGate>} />
          <Route path="/marketing/landing-pages" element={<ModuleGate tab="marketing-landing-pages" allowed={isMarketingRead}><LandingPagesPage /></ModuleGate>} />
          <Route path="/marketing/content-assets" element={<ModuleGate tab="marketing-content-assets" allowed={isMarketingRead}><ContentAssetsPage /></ModuleGate>} />
          <Route path="/marketing/calendar" element={<ModuleGate tab="marketing-calendar" allowed={isMarketingRead}><MarketingCalendarPage /></ModuleGate>} />
          <Route path="/performance-cycles" element={<ModuleGate tab="performance-cycles" allowed={isPerformanceAdmin}><PerformanceCyclesPage /></ModuleGate>} />
          <Route path="/my-performance" element={<ModuleGate tab="my-performance" allowed={true}><MyPerformancePage /></ModuleGate>} />
          <Route path="/team-reviews" element={<ModuleGate tab="team-reviews" allowed={isPerformanceReviewer}><TeamReviewsPage /></ModuleGate>} />
          <Route path="/calibration" element={<ModuleGate tab="calibration" allowed={isPerformanceAdmin}><CalibrationPage /></ModuleGate>} />
          <Route path="/performance-dashboard" element={<ModuleGate tab="performance-dashboard" allowed={isPerformanceDashboard}><PerformanceDashboardPage /></ModuleGate>} />
          <Route path="/skill-matrix" element={<ModuleGate tab="skill-matrix" allowed={true}><SkillMatrixPage /></ModuleGate>} />
          <Route path="/allocations" element={<ModuleGate tab="allocations" allowed={true}><AllocationsPage /></ModuleGate>} />
          <Route path="/capacity" element={<ModuleGate tab="capacity" allowed={true}><CapacityPage /></ModuleGate>} />
          <Route path="/role-rates" element={<ModuleGate tab="role-rates" allowed={isFinance || role==='hr'}><RoleRatesPage /></ModuleGate>} />
          <Route path="/customer-invoices" element={<ModuleGate tab="customer-invoices" allowed={isFinance}><CustomerInvoicesPage /></ModuleGate>} />
          <Route path="/payments" element={<ModuleGate tab="payments" allowed={isFinance}><PaymentsPage /></ModuleGate>} />
          <Route path="/aging-report" element={<ModuleGate tab="aging-report" allowed={isFinance}><AgingReportPage /></ModuleGate>} />
          <Route path="/profit-margins" element={<ModuleGate tab="profit-margins" allowed={isFinance}><ProfitMarginPage /></ModuleGate>} />
          <Route path="/spend-analyzer" element={<ModuleGate tab="spend-analyzer" allowed={canViewSpendAnalyzer}><SpendAnalyzerPage /></ModuleGate>} />
          <Route path="/invoices" element={<ModuleGate tab="invoices" allowed={isManager || isFinance}><InvoicesPage /></ModuleGate>} />
          <Route path="/fundflow" element={<ModuleGate tab="fundflow" allowed={isFinance}><FundFlowPage /></ModuleGate>} />
          <Route path="/pos" element={<ModuleGate tab="pos" allowed={isManager || isFinance}><PurchaseOrdersPage /></ModuleGate>} />
          <Route path="/grn" element={<ModuleGate tab="grn" allowed={isManager || isFinance}><GRNPage /></ModuleGate>} />
          <Route path="/users" element={<ModuleGate tab="users" allowed={isManager || isFinance || isHR}><UsersPage /></ModuleGate>} />
          <Route path="/settings" element={<ModuleGate tab="settings" allowed={isAdmin}><SettingsPage /></ModuleGate>} />
          <Route path="/reports" element={<ModuleGate tab="reports" allowed={true}><ReportsPage /></ModuleGate>} />
          <Route path="/leave" element={<ModuleGate tab="leave" allowed={true}><LeavePage /></ModuleGate>} />
          <Route path="/resources" element={<ModuleGate tab="resources" allowed={true}><ResourcePage /></ModuleGate>} />
          <Route path="/timesheet" element={<ModuleGate tab="timesheet" allowed={true}><TimesheetPage /></ModuleGate>} />
          <Route path="/timesheet-approvals" element={<ModuleGate tab="timesheet-approvals" allowed={true}><TimesheetApprovalPage /></ModuleGate>} />
          <Route path="/chat" element={<ModuleGate tab="chat" allowed={true}><ChatPage /></ModuleGate>} />
          <Route path="/data-assistant" element={<ModuleGate tab="data-assistant" allowed={true}><DataAssistantPage /></ModuleGate>} />
          <Route path="/app-monitor" element={<ModuleGate tab="app-monitor" allowed={isAdmin}><AppMonitorPage /></ModuleGate>} />
          <Route path="/llm-monitor" element={<ModuleGate tab="llm-monitor" allowed={isAdmin}><LLMMonitorPage /></ModuleGate>} />
          <Route path="/content" element={<ModuleGate tab="content" allowed={isAdmin}><AdminContentPage /></ModuleGate>} />
          {/* Platform-level, not module-gated — a per-org "enabled modules"
              switch has no meaning for a feature that exists above every
              org. Gated purely on profile.is_super_admin. */}
          <Route path="/super-admin" element={profile?.is_super_admin ? <SuperAdminPage /> : <Navigate to="/" />} />
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

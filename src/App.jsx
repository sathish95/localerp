import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { MISSING_ENV } from './lib/supabase'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BrandingProvider } from './context/BrandingContext'
import { MaintenanceProvider, useMaintenance } from './context/MaintenanceContext'
import MaintenancePage from './pages/MaintenancePage'
import { TabVisibilityProvider } from './context/TabVisibilityContext'
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext'
import WorkspaceOnboardingPage from './pages/WorkspaceOnboardingPage'
import Layout from './components/layout/Layout'
import ModuleGate from './components/ModuleGate'
import { Loader } from './components/ui'

import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import OrgHomePage from './pages/OrgHomePage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import WikiPage from './pages/WikiPage'
import EmbedWikiPage from './pages/EmbedWikiPage'
import ExpensesPage from './pages/ExpensesPage'
import ApprovalsPage from './pages/ApprovalsPage'
import VendorsPage from './pages/VendorsPage'
import ProjectsPage from './pages/ProjectsPage'
import BudgetPage from './pages/BudgetPage'
import AssetsPage from './pages/AssetsPage'
import ROIPlanningPage from './pages/ROIPlanningPage'
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
import WorkItemsPage from './pages/WorkItemsPage'
import MyWorkPage from './pages/MyWorkPage'
import TeamWorkPage from './pages/TeamWorkPage'
import DailyStatusPage from './pages/DailyStatusPage'
import EmailToTasksPage from './pages/EmailToTasksPage'
import OutlookInboxPage from './pages/OutlookInboxPage'
import NeoTaskAIPage from './pages/NeoTaskAIPage'
import CustomersPage from './pages/CustomersPage'
import ContactsPage from './pages/ContactsPage'
import ProductsPage from './pages/ProductsPage'
import BomManagementPage from './pages/BomManagementPage'
import InventoryPage from './pages/InventoryPage'
import DevicesPage from './pages/DevicesPage'
import SkillMatrixPage from './pages/SkillMatrixPage'
import AllocationsPage from './pages/AllocationsPage'
import CapacityPage from './pages/CapacityPage'
import ActivityPlannerPage from './pages/ActivityPlannerPage'
import RoleRatesPage from './pages/RoleRatesPage'
import CustomerInvoicesPage from './pages/CustomerInvoicesPage'
import DeliveryNotesPage from './pages/DeliveryNotesPage'
import PaymentsPage from './pages/PaymentsPage'
import AgingReportPage from './pages/AgingReportPage'
import ProfitMarginPage from './pages/ProfitMarginPage'
import PortfolioDashboardPage from './pages/PortfolioDashboardPage'
import SpendAnalyzerPage from './pages/SpendAnalyzerPage'
import WarrantyPage from './pages/WarrantyPage'
import GoLiveSupportPage from './pages/GoLiveSupportPage'
import GoLiveEngagementPage from './pages/GoLiveEngagementPage'
import PublicGoLiveReportPage from './pages/PublicGoLiveReportPage'
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
import PublicROIViewPage from './pages/PublicROIViewPage'
import PublicProposalSharePage from './pages/PublicProposalSharePage'
import PublicDailyStatusPage from './pages/PublicDailyStatusPage'
import PublicSignPage from './pages/PublicSignPage'
import AgreementsPage from './pages/AgreementsPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import CampaignsPage from './pages/CampaignsPage'
import LandingPagesPage from './pages/LandingPagesPage'
import ContentAssetsPage from './pages/ContentAssetsPage'
import MarketingCalendarPage from './pages/MarketingCalendarPage'
import PerformanceCyclesPage from './pages/PerformanceCyclesPage'
import MyPerformancePage from './pages/MyPerformancePage'
import TeamReviewsPage from './pages/TeamReviewsPage'
import CalibrationPage from './pages/CalibrationPage'
import PerformanceDashboardPage from './pages/PerformanceDashboardPage'
import AwardManagementPage from './pages/AwardManagementPage'
import AwardWizardPage from './pages/AwardWizardPage'
import MyAwardsPage from './pages/MyAwardsPage'
import TeamAwardsPage from './pages/TeamAwardsPage'
import AwardRecommendationsPage from './pages/AwardRecommendationsPage'
import CertificateTemplatesPage from './pages/CertificateTemplatesPage'
import CertificateVerifyPage from './pages/CertificateVerifyPage'
import OnboardingPage from './pages/OnboardingPage'
import SuperAdminPage from './pages/SuperAdminPage'
import OrganizationDetailPage from './pages/OrganizationDetailPage'
import EstimationPage from './pages/EstimationPage'
import PaymentGatewaySetupPage from './pages/PaymentGatewaySetupPage'
import PartnersPage from './pages/PartnersPage'
import OrgSuspendedPage from './pages/OrgSuspendedPage'
import AccountDeactivatedPage from './pages/AccountDeactivatedPage'
import VendorDashboardPage from './pages/VendorDashboardPage'
import ScenarioDashboardPage from './pages/ScenarioDashboardPage'
import MyScenariosPage from './pages/MyScenariosPage'
import AllScenariosPage from './pages/AllScenariosPage'
import ScenarioBuilderPage from './pages/ScenarioBuilderPage'
import ScenarioDetailPage from './pages/ScenarioDetailPage'
import ScenarioTemplatesPage from './pages/ScenarioTemplatesPage'
import ScenarioTemplateBuilderPage from './pages/ScenarioTemplateBuilderPage'
import ScenarioComparisonPage from './pages/ScenarioComparisonPage'
import ScenarioApprovalsPage from './pages/ScenarioApprovalsPage'
import SupportTicketsPage from './pages/SupportTicketsPage'
import SupportTicketDetailPage from './pages/SupportTicketDetailPage'
import SupportDeskPage from './pages/SupportDeskPage'
import SupportDeskSettingsPage from './pages/SupportDeskSettingsPage'
import ITHelpdeskPage from './pages/ITHelpdeskPage'
import ITHelpdeskTicketPage from './pages/ITHelpdeskTicketPage'
import ITHelpdeskSettingsPage from './pages/ITHelpdeskSettingsPage'
import { NotificationProvider } from './context/NotificationContext'
import { PresenceProvider } from './context/PresenceContext'

// Industry-Adaptive Platform — Phase 2. Gates a brand-new org (created
// via the 'create' org_mode signup branch, STEP181) into the workspace
// onboarding wizard before it ever sees the normal app shell. Existing
// orgs (workspace_profiles.needs_onboarding = false, seeded false by
// STEP180/backfilled false by STEP181) never match this condition, so
// they fall straight through to `children` exactly as before this phase
// existed. Rendered OUTSIDE TabVisibilityProvider/Layout — the wizard is
// its own full-screen flow, no sidebar/nav chrome.
function WorkspaceOnboardingGate({ children }) {
  const { workspace, loading } = useWorkspace()
  const location = useLocation()

  // Unresolved yet — hold rather than flash the normal app shell (or the
  // wizard) before we actually know which one is correct.
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}><div className="spinner" /></div>

  const needsOnboarding = workspace?.needs_onboarding === true
  if (location.pathname === '/workspace-onboarding') {
    // Reachable only while still needed — once launched/skipped this
    // flips false and a stale bookmark just bounces to the dashboard.
    return needsOnboarding
      ? <Routes><Route path="/workspace-onboarding" element={<WorkspaceOnboardingPage />} /></Routes>
      : <Navigate to="/" replace />
  }
  if (needsOnboarding) {
    return <Routes><Route path="*" element={<Navigate to="/workspace-onboarding" replace />} /></Routes>
  }
  return children
}

function AppRoutes() {
  const { user, profile, loading } = useAuth()
  const { maintenanceOn } = useMaintenance()
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
  if (location.pathname.startsWith('/roi-view/')) {
    return <Routes><Route path="/roi-view/:token" element={<PublicROIViewPage />} /></Routes>
  }
  if (location.pathname.startsWith('/proposal-view/')) {
    return <Routes><Route path="/proposal-view/:token" element={<PublicProposalSharePage />} /></Routes>
  }
  if (location.pathname.startsWith('/golive-report/')) {
    return <Routes><Route path="/golive-report/:token" element={<PublicGoLiveReportPage />} /></Routes>
  }
  if (location.pathname.startsWith('/daily-status-view/')) {
    return <Routes><Route path="/daily-status-view/:token" element={<PublicDailyStatusPage />} /></Routes>
  }
  if (location.pathname.startsWith('/sign/')) {
    return <Routes><Route path="/sign/:token" element={<PublicSignPage />} /></Routes>
  }
  // Password-reset link from Supabase Auth's email — must render whether or
  // not the recovery token has already turned into a session.
  if (location.pathname === '/reset-password') {
    return <Routes><Route path="/reset-password" element={<ResetPasswordPage />} /></Routes>
  }
  if (location.pathname.startsWith('/verify/')) {
    return <Routes><Route path="/verify/:certificateNumber" element={<CertificateVerifyPage />} /></Routes>
  }
  // Chrome-free host for the mobile app's WebView-embedded wiki editor —
  // same PageEditor component the web app uses, no Layout/sidebar. Has no
  // session yet on first load (the WebView starts blank); EmbedWikiPage
  // itself waits for a postMessage handoff from the native app, calls
  // supabase.auth.setSession(), and this component re-renders once
  // useAuth() picks up the new session — so it must be reachable
  // regardless of the current `user` state, same as the routes above.
  if (location.pathname.startsWith('/embed/wiki/')) {
    return <Routes><Route path="/embed/wiki/:pageId" element={<EmbedWikiPage />} /></Routes>
  }

  if (!user) return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth" element={<AuthPage />} />
      {/* links from emails (e.g. "Please sign …") come back here after login */}
      <Route path="/agreements" element={<Navigate to={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`} replace />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  )

  // Suspended/soft-deleted org lockout (STEP108) — checked before any
  // route renders. A platform super admin is exempt: they need access
  // regardless of their own org's state to fix other orgs from
  // /super-admin, and default-org (where super admins typically live)
  // being suspended must never lock the platform operator out.
  if (profile?.org && !profile.is_super_admin && (profile.org.deleted_at || profile.org.is_active === false)) {
    return <OrgSuspendedPage />
  }

  // Per-member deactivation (profiles.is_active) — set by an org admin from
  // Users, or a platform super admin from the /super-admin org Manage
  // drawer (super_admin_set_member_active()). Previously this flag was
  // display-only; a deactivated member could still use the whole app.
  // Same super-admin exemption as the org-suspend check above.
  if (profile && !profile.is_super_admin && profile.is_active === false) {
    return <AccountDeactivatedPage />
  }

  // Vendor accounts (STEP134) are not organization members in any real
  // sense — their organization_id is just handle_new_user()'s
  // 'default-org' fallback, meaningless for them. Route every path to
  // their own dashboard instead of the normal org-scoped app, so a
  // vendor never sees default-org's operational surface at all.
  if (profile?.vendor_id) {
    return <Routes><Route path="*" element={<VendorDashboardPage />} /></Routes>
  }

  const role = profile?.role || 'employee'

  // Platform-wide maintenance mode (STEP204) — a platform super admin can
  // flip this on from /super-admin. admin/ceo/hr (trusted org roles) and
  // platform super admins are exempt so someone can always get in to turn
  // it back off (and HR can keep working, e.g. for anything time-
  // sensitive like leave/payroll); every other role gets the full-page
  // block below, checked after the org-suspended/deactivated/vendor
  // gates above but before any normal route renders.
  if (maintenanceOn && !profile?.is_super_admin && !['admin','ceo','hr'].includes(role)) {
    return <MaintenancePage />
  }

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
    <WorkspaceProvider>
    <WorkspaceOnboardingGate>
    <TabVisibilityProvider>
      <NotificationProvider>
      <PresenceProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<ModuleGate tab="dashboard" allowed={true}><DashboardPage /></ModuleGate>} />
          <Route path="/org-home" element={<ModuleGate tab="org-home" allowed={true}><OrgHomePage /></ModuleGate>} />
          <Route path="/knowledge-base" element={<ModuleGate tab="knowledge-base" allowed={true}><KnowledgeBasePage /></ModuleGate>} />
          <Route path="/wiki" element={<ModuleGate tab="wiki" allowed={true}><WikiPage /></ModuleGate>} />
          <Route path="/expenses" element={<ModuleGate tab="expenses" allowed={true}><ExpensesPage /></ModuleGate>} />
          <Route path="/travel" element={<ModuleGate tab="travel" allowed={true}><TravelPage /></ModuleGate>} />
          <Route path="/approvals" element={<ModuleGate tab="approvals" allowed={isManager || isHR}><ApprovalsPage /></ModuleGate>} />
          <Route path="/vendors" element={<ModuleGate tab="vendors" allowed={isManager || isFinance}><VendorsPage /></ModuleGate>} />
          <Route path="/portfolio" element={<ModuleGate tab="project-portfolio" allowed={isManager || isFinance}><PortfolioDashboardPage /></ModuleGate>} />
          <Route path="/projects" element={<ModuleGate tab="projects" allowed={true}><ProjectsPage /></ModuleGate>} />
          <Route path="/tasks" element={<ModuleGate tab="tasks" allowed={true}><TasksPage /></ModuleGate>} />
          <Route path="/work-items" element={<ModuleGate tab="work-items" allowed={true}><WorkItemsPage /></ModuleGate>} />
          <Route path="/my-work" element={<ModuleGate tab="my-work" allowed={true}><MyWorkPage /></ModuleGate>} />
          <Route path="/team-work" element={<ModuleGate tab="team-work" allowed={isManager}><TeamWorkPage /></ModuleGate>} />
          <Route path="/daily-status" element={<ModuleGate tab="daily-status" allowed={isManager}><DailyStatusPage /></ModuleGate>} />
          <Route path="/outlook-inbox" element={<ModuleGate tab="outlook-inbox" allowed={true}><OutlookInboxPage /></ModuleGate>} />
          <Route path="/agreements" element={<ModuleGate tab="agreements" allowed={true}><AgreementsPage /></ModuleGate>} />
          <Route path="/email-to-tasks" element={<ModuleGate tab="email-to-tasks" allowed={isManager || isFinance}><EmailToTasksPage /></ModuleGate>} />
          <Route path="/neo-task-ai" element={<ModuleGate tab="neo-task-ai" allowed={true}><NeoTaskAIPage /></ModuleGate>} />
          <Route path="/budget" element={<ModuleGate tab="budget" allowed={true}><BudgetPage /></ModuleGate>} />
          <Route path="/assets" element={<ModuleGate tab="assets" allowed={true}><AssetsPage /></ModuleGate>} />
          <Route path="/roi-planning" element={<ModuleGate tab="roi-planning" allowed={isManager || isFinance}><ROIPlanningPage /></ModuleGate>} />
          <Route path="/procurement" element={<ModuleGate tab="procurement" allowed={true}><ProcurementPage /></ModuleGate>} />
          <Route path="/customers" element={<ModuleGate tab="customers" allowed={isProcurementModule}><CustomersPage /></ModuleGate>} />
          <Route path="/contacts" element={<ModuleGate tab="contacts" allowed={true}><ContactsPage /></ModuleGate>} />
          <Route path="/products" element={<ModuleGate tab="products" allowed={isProcurementModule}><ProductsPage /></ModuleGate>} />
          <Route path="/bom" element={<ModuleGate tab="bom" allowed={isProcurementModule}><BomManagementPage /></ModuleGate>} />
          <Route path="/inventory" element={<ModuleGate tab="inventory" allowed={isProcurementModule}><InventoryPage /></ModuleGate>} />
          <Route path="/devices" element={<ModuleGate tab="devices" allowed={isProcurementModule}><DevicesPage /></ModuleGate>} />
          <Route path="/warranty" element={<ModuleGate tab="warranty" allowed={canViewWarranty}><WarrantyPage /></ModuleGate>} />
          <Route path="/golive" element={<ModuleGate tab="golive-support" allowed={true}><GoLiveSupportPage /></ModuleGate>} />
          <Route path="/golive/:id" element={<ModuleGate tab="golive-support" allowed={true}><GoLiveEngagementPage /></ModuleGate>} />
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
          <Route path="/awards" element={<ModuleGate tab="award-management" allowed={isPerformanceAdmin}><AwardManagementPage /></ModuleGate>} />
          <Route path="/awards/new" element={<ModuleGate tab="award-management" allowed={isPerformanceAdmin}><AwardWizardPage /></ModuleGate>} />
          <Route path="/awards/:id/edit" element={<ModuleGate tab="award-management" allowed={isPerformanceAdmin}><AwardWizardPage /></ModuleGate>} />
          <Route path="/my-awards" element={<ModuleGate tab="my-awards" allowed={true}><MyAwardsPage /></ModuleGate>} />
          <Route path="/team-awards" element={<ModuleGate tab="team-awards" allowed={isPerformanceReviewer}><TeamAwardsPage /></ModuleGate>} />
          <Route path="/awards/:id/recommendations" element={<ModuleGate tab="award-management" allowed={isPerformanceAdmin}><AwardRecommendationsPage /></ModuleGate>} />
          <Route path="/certificate-templates" element={<ModuleGate tab="certificate-templates" allowed={isPerformanceAdmin}><CertificateTemplatesPage /></ModuleGate>} />
          <Route path="/skill-matrix" element={<ModuleGate tab="skill-matrix" allowed={true}><SkillMatrixPage /></ModuleGate>} />
          <Route path="/allocations" element={<ModuleGate tab="allocations" allowed={true}><AllocationsPage /></ModuleGate>} />
          <Route path="/capacity" element={<ModuleGate tab="capacity" allowed={true}><CapacityPage /></ModuleGate>} />
          <Route path="/activity-planner" element={<ModuleGate tab="activity-planner" allowed={true}><ActivityPlannerPage /></ModuleGate>} />
          <Route path="/scenarios/dashboard" element={<ModuleGate tab="scenario-dashboard" allowed={true}><ScenarioDashboardPage /></ModuleGate>} />
          <Route path="/scenarios/my" element={<ModuleGate tab="scenario-my" allowed={true}><MyScenariosPage /></ModuleGate>} />
          <Route path="/scenarios/templates" element={<ModuleGate tab="scenario-templates" allowed={true}><ScenarioTemplatesPage /></ModuleGate>} />
          <Route path="/scenarios/templates/:id" element={<ModuleGate tab="scenario-templates" allowed={true}><ScenarioTemplateBuilderPage /></ModuleGate>} />
          <Route path="/scenarios/compare" element={<ModuleGate tab="scenario-compare" allowed={true}><ScenarioComparisonPage /></ModuleGate>} />
          <Route path="/scenarios/approvals" element={<ModuleGate tab="scenario-approvals" allowed={true}><ScenarioApprovalsPage /></ModuleGate>} />
          <Route path="/scenarios/new" element={<ModuleGate tab="scenario-all" allowed={true}><ScenarioBuilderPage /></ModuleGate>} />
          <Route path="/scenarios/:id" element={<ModuleGate tab="scenario-all" allowed={true}><ScenarioDetailPage /></ModuleGate>} />
          <Route path="/scenarios" element={<ModuleGate tab="scenario-all" allowed={true}><AllScenariosPage /></ModuleGate>} />
          <Route path="/role-rates" element={<ModuleGate tab="role-rates" allowed={isFinance || role==='hr'}><RoleRatesPage /></ModuleGate>} />
          <Route path="/customer-invoices" element={<ModuleGate tab="customer-invoices" allowed={isFinance}><CustomerInvoicesPage /></ModuleGate>} />
          <Route path="/delivery-notes" element={<ModuleGate tab="delivery-notes" allowed={isManager || isFinance}><DeliveryNotesPage /></ModuleGate>} />
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
          <Route path="/onboarding" element={isAdmin ? <OnboardingPage /> : <Navigate to="/" />} />
          <Route path="/reports" element={<ModuleGate tab="reports" allowed={true}><ReportsPage /></ModuleGate>} />
          <Route path="/leave" element={<ModuleGate tab="leave" allowed={true}><LeavePage /></ModuleGate>} />
          <Route path="/resources" element={<ModuleGate tab="resources" allowed={true}><ResourcePage /></ModuleGate>} />
          <Route path="/timesheet" element={<ModuleGate tab="timesheet" allowed={true}><TimesheetPage /></ModuleGate>} />
          <Route path="/timesheet-approvals" element={<ModuleGate tab="timesheet-approvals" allowed={true}><TimesheetApprovalPage /></ModuleGate>} />
          <Route path="/chat" element={<ModuleGate tab="chat" allowed={true}><ChatPage /></ModuleGate>} />
          <Route path="/data-assistant" element={<ModuleGate tab="data-assistant" allowed={true}><DataAssistantPage /></ModuleGate>} />
          <Route path="/support" element={<ModuleGate tab="support" allowed={true}><SupportTicketsPage /></ModuleGate>} />
          <Route path="/support/:id" element={<ModuleGate tab="support" allowed={true}><SupportTicketDetailPage /></ModuleGate>} />
          <Route path="/it-helpdesk" element={<ModuleGate tab="it-helpdesk" allowed={true}><ITHelpdeskPage /></ModuleGate>} />
          <Route path="/it-helpdesk/settings" element={<ModuleGate tab="it-helpdesk" allowed={isAdmin}><ITHelpdeskSettingsPage /></ModuleGate>} />
          <Route path="/it-helpdesk/:id" element={<ModuleGate tab="it-helpdesk" allowed={true}><ITHelpdeskTicketPage /></ModuleGate>} />
          <Route path="/app-monitor" element={<ModuleGate tab="app-monitor" allowed={isAdmin}><AppMonitorPage /></ModuleGate>} />
          <Route path="/llm-monitor" element={<ModuleGate tab="llm-monitor" allowed={isAdmin}><LLMMonitorPage /></ModuleGate>} />
          <Route path="/content" element={<ModuleGate tab="content" allowed={isAdmin}><AdminContentPage /></ModuleGate>} />
          {/* Platform-level, not module-gated — a per-org "enabled modules"
              switch has no meaning for a feature that exists above every
              org. Gated purely on profile.is_super_admin. */}
          <Route path="/super-admin" element={profile?.is_super_admin ? <SuperAdminPage /> : <Navigate to="/" />} />
          <Route path="/super-admin/organizations/:orgId" element={profile?.is_super_admin ? <OrganizationDetailPage /> : <Navigate to="/" />} />
          <Route path="/super-admin/estimation" element={profile?.is_super_admin ? <EstimationPage /> : <Navigate to="/" />} />
          <Route path="/super-admin/payment-setup" element={profile?.is_super_admin ? <PaymentGatewaySetupPage /> : <Navigate to="/" />} />
          <Route path="/super-admin/partners" element={profile?.is_super_admin ? <PartnersPage /> : <Navigate to="/" />} />
          <Route path="/super-admin/support" element={profile?.is_super_admin ? <SupportDeskPage /> : <Navigate to="/" />} />
          <Route path="/super-admin/support/settings" element={profile?.is_super_admin ? <SupportDeskSettingsPage /> : <Navigate to="/" />} />
          <Route path="/login" element={<Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
      </PresenceProvider>
      </NotificationProvider>
    </TabVisibilityProvider>
    </WorkspaceOnboardingGate>
    </WorkspaceProvider>
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
    <BrandingProvider>
      <MaintenanceProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </MaintenanceProvider>
    </BrandingProvider>
  )
}

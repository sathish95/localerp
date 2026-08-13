import { useState, useEffect, useRef } from 'react'
import CheckInWidget from '../CheckInWidget'
import NotificationBell from '../NotificationBell'
import AskBubble from '../AskBubble'
import GlobalSearchModal from '../GlobalSearchModal'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useTabVisibility } from '../../context/TabVisibilityContext'
import { useAppName } from '../../context/BrandingContext'
import { supabase } from '../../lib/supabase'
import {
  LayoutDashboard, Receipt, Users, FolderOpen, PieChart, Box, CheckSquare,
  FileText, TrendingUp, Settings, LogOut, Menu, X, ChevronLeft, ChevronDown, ChevronRight,
  Truck, Plane, ShoppingCart, Briefcase, CreditCard, Building2, Package, BarChart2,
  Calendar, Clock, FileSpreadsheet, Megaphone, ClipboardList, FileClock,
  MessageSquare, Activity, Sparkles, Cpu, GraduationCap, CalendarRange, Gauge,
  DollarSign, FileCheck, Wallet, History, Percent, Radar, ShieldCheck, Coins, BookOpen, Boxes, Warehouse,
  Target, Award, UserCheck, Scale, LineChart, UserPlus, Landmark, FlaskConical, Rocket, CalendarDays, Image, Link2, LayoutTemplate, CalendarClock, Search, Trophy, Medal, Star, FileBadge2, Calculator, KeyRound,
  Layers, GitCompareArrows, ClipboardCheck, LifeBuoy
} from 'lucide-react'

// One brand accent used everywhere (sidebar, avatars, active nav state) —
// matches index.css's --c1 exactly. Previously each role got its own hue
// here, which read as a different app skin per role rather than one
// consistent product; role identity is still shown as plain text (below).
const ACCENT = '#6366f1'
const roleLabel = {
  admin: 'Administrator', ceo: 'Chief Executive', manager: 'Manager',
  finance: 'Finance', employee: 'Employee', department_head: 'Dept. Head',
  procurement_lead: 'Procurement Lead', pm: 'Project Manager', cto: 'CTO',
  sales_rep: 'Sales Rep', regional_sales_head: 'Regional Sales Head', sales_head: 'Sales Head', sales_ops: 'Sales Ops', cmo: 'CMO',
  campaign_manager: 'Campaign Manager', sales_lead: 'Sales Head', field_technician: 'Field Technician',
}

const ALL_NAV = [
  { section: 'Overview', items: [
    { to: '/', tab: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/knowledge-base', tab: 'knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  ]},
  { section: 'Expenses & Travel', items: [
    { to: '/expenses', tab: 'expenses', label: 'Expenses', icon: Receipt },
    { to: '/travel', tab: 'travel', label: 'Travel Requests', icon: Plane },
    { to: '/approvals', tab: 'approvals', label: 'Approvals', icon: CheckSquare },
  ]},
  { section: 'Operations', items: [
    { to: '/projects', tab: 'projects', label: 'Projects', icon: FolderOpen, subTabs: [
      { id: 'overview', label: 'Overview', icon: '📊' },
      { id: 'milestones', label: 'Milestones', icon: '🏁' },
      { id: 'resources', label: 'Resources', icon: '👥' },
      { id: 'resourcing', label: 'Resourcing', icon: '📈' },
      { id: 'software', label: 'Software', icon: '💻' },
      { id: 'hardware', label: 'Hardware', icon: '🔧' },
      { id: 'support', label: 'Support', icon: '🛠' },
      { id: 'expenses', label: 'Expenses', icon: '🧾' },
      { id: 'changes', label: 'Changes', icon: '🔄' },
      { id: 'budget', label: 'Budget Config', icon: '⚙️' },
      { id: 'finance', label: 'Finance', icon: '💰' },
    ]},
    { to: '/tasks', tab: 'tasks', label: 'Task Management', icon: ClipboardList, subTabs: [
      { id: 'kanban', label: 'Kanban', icon: '⊞' },
      { id: 'list', label: 'List', icon: '☰' },
      { id: 'stories', label: 'Stories', icon: '◎' },
      { id: 'sprints', label: 'Sprints', icon: '⚡' },
      { id: 'reports', label: 'Reports', icon: '📊' },
      { id: 'dashboards', label: 'Dashboards', icon: '🧩' },
    ]},
    { to: '/neo-task-ai', tab: 'neo-task-ai', label: 'Neo Task AI', icon: Sparkles },
    { to: '/budget', tab: 'budget', label: 'Budget', icon: PieChart },
    { to: '/assets', tab: 'assets', label: 'Assets', icon: Box },
  ]},
  { section: 'Resourcing', items: [
    { to: '/skill-matrix', tab: 'skill-matrix', label: 'Skill Matrix', icon: GraduationCap },
    { to: '/allocations',  tab: 'allocations',  label: 'Allocations',  icon: CalendarRange },
    { to: '/capacity',     tab: 'capacity',     label: 'Capacity',     icon: Gauge },
  ]},
  { section: 'Pre-Sales', items: [
    { to: '/proposals', tab: 'proposals', label: 'Proposals', icon: FileText },
  ]},
  { section: 'Sales', items: [
    { to: '/sales/leads', tab: 'sales-leads', label: 'Leads', icon: UserPlus },
    { to: '/sales/landing-links', tab: 'sales-landing-links', label: 'Landing Links', icon: Link2 },
    { to: '/sales/meeting-pages', tab: 'sales-meeting-pages', label: 'Meeting Booking', icon: CalendarClock },
    { to: '/sales/opportunities', tab: 'sales-opportunities', label: 'Opportunities', icon: TrendingUp },
    { to: '/sales/tasks', tab: 'sales-tasks', label: 'Sales Tasks', icon: ClipboardList },
    { to: '/sales/product-launches', tab: 'sales-product-launches', label: 'Product Launches', icon: Sparkles },
    { to: '/sales/tenders', tab: 'sales-tenders', label: 'Tenders', icon: Landmark },
    { to: '/sales/pilot-projects', tab: 'sales-pilot-projects', label: 'Pilot Projects', icon: FlaskConical },
    { to: '/sales/bootstrap-programs', tab: 'sales-bootstrap-programs', label: 'Bootstrap Program', icon: Rocket },
    { to: '/sales/timeline', tab: 'sales-timeline', label: 'Sales Timeline', icon: History },
    { to: '/sales/dashboard', tab: 'sales-dashboard', label: 'Sales Dashboard', icon: LineChart },
  ]},
  { section: 'Marketing', items: [
    { to: '/marketing/campaigns', tab: 'marketing-campaigns', label: 'Campaigns', icon: Megaphone },
    { to: '/marketing/landing-pages', tab: 'marketing-landing-pages', label: 'Landing Pages', icon: LayoutTemplate },
    { to: '/marketing/content-assets', tab: 'marketing-content-assets', label: 'Content Assets', icon: Image },
    { to: '/marketing/calendar', tab: 'marketing-calendar', label: 'Marketing Calendar', icon: CalendarDays },
  ]},
  { section: 'Performance', items: [
    { to: '/performance-cycles', tab: 'performance-cycles', label: 'Review Cycles', icon: Target },
    { to: '/my-performance', tab: 'my-performance', label: 'My Performance', icon: Award },
    { to: '/team-reviews', tab: 'team-reviews', label: 'Team Reviews', icon: UserCheck },
    { to: '/calibration', tab: 'calibration', label: 'Calibration', icon: Scale },
    { to: '/performance-dashboard', tab: 'performance-dashboard', label: 'Performance Dashboard', icon: LineChart },
    { to: '/awards', tab: 'award-management', label: 'Award Management', icon: Trophy },
    { to: '/my-awards', tab: 'my-awards', label: 'My Awards', icon: Medal },
    { to: '/team-awards', tab: 'team-awards', label: 'Team Awards', icon: Star },
    { to: '/certificate-templates', tab: 'certificate-templates', label: 'Certificate Templates', icon: FileBadge2 },
  ]},
  { section: 'Inventory Management', items: [
    { to: '/products', tab: 'products', label: 'Product', icon: Package },
    { to: '/bom', tab: 'bom', label: 'BOM', icon: Boxes },
    { to: '/inventory?view=components', tab: 'inventory', label: 'Component', icon: Warehouse, subTabs: [
      { id: 'components', label: 'Components', icon: '🧩' },
      { id: 'overview', label: 'Stock Overview', icon: '📊' },
    ]},
    { to: '/devices', tab: 'devices', label: 'Devices', icon: Cpu },
    { to: '/procurement', tab: 'procurement', label: 'Purchase Request', icon: ShoppingCart },
    { to: '/warranty', tab: 'warranty', label: 'Warranty', icon: ShieldCheck },
    { to: '/pos', tab: 'pos', label: 'PO', icon: Package },
    { to: '/invoices', tab: 'invoices', label: 'Invoice', icon: FileText },
    { to: '/grn', tab: 'grn', label: 'GRN', icon: Briefcase },
  ]},
  { section: 'Vendors & Partners', items: [
    { to: '/customers', tab: 'customers', label: 'Customers', icon: Building2 },
    { to: '/vendors', tab: 'vendors', label: 'Vendors', icon: Truck },
    { to: '/fundflow', tab: 'fundflow', label: 'Fund Flow', icon: TrendingUp },
  ]},
  { section: 'Scenario Planning', items: [
    { to: '/scenarios/dashboard', tab: 'scenario-dashboard', label: 'Scenario Dashboard', icon: Radar },
    { to: '/scenarios/my', tab: 'scenario-my', label: 'My Scenarios', icon: Layers },
    { to: '/scenarios', tab: 'scenario-all', label: 'All Scenarios', icon: FolderOpen },
    { to: '/scenarios/templates', tab: 'scenario-templates', label: 'Scenario Templates', icon: LayoutTemplate },
    { to: '/scenarios/compare', tab: 'scenario-compare', label: 'Scenario Comparison', icon: GitCompareArrows },
    { to: '/scenarios/approvals', tab: 'scenario-approvals', label: 'Scenario Approvals', icon: ClipboardCheck },
  ]},
  { section: 'Finance', items: [
    { to: '/role-rates', tab: 'role-rates', label: 'Role Rates', icon: DollarSign },
    { to: '/customer-invoices', tab: 'customer-invoices', label: 'Customer Invoices', icon: FileCheck },
    { to: '/delivery-notes', tab: 'delivery-notes', label: 'Delivery Notes', icon: Truck },
    { to: '/payments', tab: 'payments', label: 'Payments', icon: Wallet },
    { to: '/aging-report', tab: 'aging-report', label: 'Aging Report', icon: History },
    { to: '/profit-margins', tab: 'profit-margins', label: 'Profit Margins', icon: Percent },
    { to: '/spend-analyzer', tab: 'spend-analyzer', label: 'Spend Analyzer', icon: Radar, subTabs: [
      { id: 'overview', label: 'Overview', icon: '📊' },
      { id: 'fundflow', label: 'Fund Flow', icon: '💸' },
      { id: 'resource', label: 'Resource Flow', icon: '👥' },
      { id: 'category', label: 'By Category', icon: '📦' },
      { id: 'department', label: 'By Department', icon: '🏢' },
      { id: 'project', label: 'By Project', icon: '📁' },
      { id: 'vendor', label: 'By Vendor', icon: '🚚' },
      { id: 'product', label: 'By Product', icon: '📱' },
      { id: 'component', label: 'By Component', icon: '🧩' },
      { id: 'device', label: 'By Device', icon: '📟' },
      { id: 'findings', label: 'Findings', icon: '💡' },
      { id: 'forecast', label: 'Forecast', icon: '🔮' },
      { id: 'benchmark', label: 'Benchmark', icon: '⚖️' },
    ]},
  ]},
  { section: 'HR & Resources', items: [
    { to: '/leave', tab: 'leave', label: 'Leave Management', icon: Calendar },
    { to: '/resources', tab: 'resources', label: 'Resource Tracking', icon: Clock },
    { to: '/timesheet', tab: 'timesheet', label: 'Timesheet', icon: FileSpreadsheet },
    { to: '/timesheet-approvals', tab: 'timesheet-approvals', label: 'Timesheet Approvals', icon: FileClock },
    { to: '/chat', tab: 'chat', label: 'Chat', icon: MessageSquare },
    { to: '/data-assistant', tab: 'data-assistant', label: 'Data Assistant', icon: Sparkles },
    { to: '/support', tab: 'support', label: 'Support', icon: LifeBuoy },
  ]},
  { section: 'Admin', items: [
    { to: '/users', tab: 'users', label: 'Users', icon: Users },
    { to: '/reports', tab: 'reports', label: 'Reports', icon: BarChart2 },
    { to: '/settings', tab: 'settings', label: 'Settings', icon: Settings },
    { to: '/content', tab: 'content', label: 'Landing Content', icon: Megaphone },
    { to: '/app-monitor', tab: 'app-monitor', label: 'App Monitor', icon: Activity },
    { to: '/llm-monitor', tab: 'llm-monitor', label: 'LLM Usage Monitor', icon: Coins },
  ]},
  { section: 'Platform', items: [
    // platformOnly bypasses both the role list and the per-org module
    // visibility check below — this is a platform capability that exists
    // above any single org's "enabled modules" switches, not a module.
    { to: '/super-admin', label: 'Organizations', icon: Landmark, platformOnly: true },
    { to: '/super-admin/estimation', label: 'Estimation', icon: Calculator, platformOnly: true },
    { to: '/super-admin/payment-setup', label: 'Payment Gateway Setup', icon: KeyRound, platformOnly: true },
    { to: '/super-admin/partners', label: 'Partners', icon: Briefcase, platformOnly: true },
    { to: '/super-admin/support', label: 'Support Desk', icon: LifeBuoy, platformOnly: true },
  ]},
]

// Stable session ID for this browser tab's lifetime
const SESSION_ID = Math.random().toString(36).slice(2)

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [navSearch, setNavSearch] = useState('')
  const [navActiveIndex, setNavActiveIndex] = useState(0)
  const navSearchRef = useRef(null)
  const [expandedNav, setExpandedNav] = useState({})

  // "/" focuses the sidebar search from anywhere in the app (same
  // convention as GitHub/Slack/Linear) — ignored while the user is
  // already typing in some other field. Expands the sidebar first if it
  // was collapsed, since the search box doesn't render in that state.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (isTyping) return
      e.preventDefault()
      setCollapsed(false)
      requestAnimationFrame(() => navSearchRef.current?.focus())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const toggleNavExpand = (to) => setExpandedNav(prev => ({ ...prev, [to]: !(prev[to] ?? true) }))

  // Section fold state — persisted so a collapsed section stays collapsed
  // across page loads instead of resetting every navigation.
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nav-collapsed-sections') || '{}') } catch { return {} }
  })
  useEffect(() => {
    try { localStorage.setItem('nav-collapsed-sections', JSON.stringify(collapsedSections)) } catch {}
  }, [collapsedSections])
  const toggleSection = (name) => setCollapsedSections(prev => ({ ...prev, [name]: !prev[name] }))
  const { profile, signOut } = useAuth()
  const { isTabVisible } = useTabVisibility()
  const appName = useAppName()
  const navigate = useNavigate()
  const location = useLocation()
  const role = profile?.role || 'employee'
  const initials = (profile?.full_name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  // Close sidebar on mobile nav, and drop any active nav search so it
  // doesn't stay filtered the next time the sidebar is opened
  useEffect(() => { setSidebarOpen(false); setNavSearch('') }, [location.pathname, location.search])

  // Global data search (Cmd/Ctrl+K) — distinct from the sidebar's own
  // menu-label filter above; this searches real records via
  // GlobalSearchModal/globalSearch.js.
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setGlobalSearchOpen(true) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Restart keyboard-arrow selection at the top of the results every time
  // the query changes, rather than keeping a now-meaningless index.
  useEffect(() => { setNavActiveIndex(0) }, [navSearch])

  // Track page views for app monitor
  useEffect(() => {
    if (!profile?.id) return
    supabase.from('app_events').insert({
      event_type: 'page_view',
      path: location.pathname,
      user_id: profile.id,
      session_id: SESSION_ID,
    }).then(() => {})
  }, [location.pathname, profile?.id])

  // Lightweight project list for the sidebar's "Switch Project" picker
  const [sidebarProjects, setSidebarProjects] = useState([])
  useEffect(() => {
    if (location.pathname !== '/projects') return
    supabase.from('projects').select('id,name').order('name').then(({ data }) => setSidebarProjects(data || []))
  }, [location.pathname])

  async function handleSignOut() { await signOut(); navigate('/login') }

  // Build visible nav
  const visibleNav = ALL_NAV.map(section => ({
    ...section,
    items: section.items.filter(item => {
      // Platform-level items skip both the per-org role list and module
      // visibility checks below — gated purely on is_super_admin.
      if (item.platformOnly) return !!profile?.is_super_admin
      // Tab visibility guard — the single source of truth for per-role nav
      // gating (Settings -> Roles & Modules), admin/ceo bypass this
      if (!isTabVisible(item.tab)) return false
      return true
    })
  })).filter(s => s.items.length > 0)

  const navQuery = navSearch.trim().toLowerCase()
  const isSearchingNav = navQuery.length > 0
  const filteredNav = isSearchingNav
    ? visibleNav
        .map(section => ({ ...section, items: section.items.filter(item => item.label.toLowerCase().includes(navQuery)) }))
        .filter(s => s.items.length > 0)
    : visibleNav
  // Flat, render-order list of currently-matching items, for arrow-key
  // navigation across section boundaries.
  const flatNavMatches = isSearchingNav ? filteredNav.flatMap(s => s.items) : []

  function onNavSearchKeyDown(e) {
    if (e.key === 'Escape') { setNavSearch(''); e.currentTarget.blur(); return }
    if (!flatNavMatches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setNavActiveIndex(i => (i + 1) % flatNavMatches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setNavActiveIndex(i => (i - 1 + flatNavMatches.length) % flatNavMatches.length) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatNavMatches[navActiveIndex] || flatNavMatches[0]
      if (target) { navigate(target.to); setNavSearch('') }
    }
  }

  // Highlights the substring of `label` that matched the active search
  // query — falls back to plain text when not searching.
  function NavLabel({ label }) {
    if (!isSearchingNav) return label
    const idx = label.toLowerCase().indexOf(navQuery)
    if (idx === -1) return label
    return (
      <>
        {label.slice(0, idx)}
        <mark style={{ background: 'var(--c1, #6366f1)', color: '#fff', borderRadius: 3, padding: '0 2px' }}>{label.slice(idx, idx + navQuery.length)}</mark>
        {label.slice(idx + navQuery.length)}
      </>
    )
  }

  const pageMap = {
    '/': 'Dashboard', '/knowledge-base': 'Knowledge Base', '/expenses': 'Expenses', '/travel': 'Travel Requests',
    '/approvals': 'Approvals', '/vendors': 'Vendors', '/projects': 'Projects',
    '/tasks': 'Task Management',
    '/budget': 'Budget', '/assets': 'Assets', '/procurement': 'Procurement',
    '/invoices': 'Invoices', '/fundflow': 'Fund Flow', '/pos': 'Purchase Orders',
    '/grn': 'GRN', '/users': 'Users', '/settings': 'Settings', '/reports': 'Reports',
    '/timesheet': 'Timesheet', '/timesheet-approvals': 'Timesheet Approvals', '/content': 'Landing Content',
    '/chat': 'Chat', '/app-monitor': 'App Monitor', '/llm-monitor': 'LLM Usage Monitor', '/neo-task-ai': 'Neo Task AI', '/data-assistant': 'Data Assistant',
    '/customers': 'Customers', '/products': 'Products', '/bom': 'BOM Management', '/inventory': 'Inventory Management', '/devices': 'Device Instances', '/warranty': 'Warranty Management',
    '/proposals': 'Proposals',
    '/sales/leads': 'Leads', '/sales/landing-links': 'Landing Links', '/sales/meeting-pages': 'Meeting Booking Pages', '/sales/opportunities': 'Opportunities', '/sales/tasks': 'Sales Tasks',
    '/sales/product-launches': 'Product Launches', '/sales/tenders': 'Tenders', '/sales/pilot-projects': 'Pilot Projects',
    '/sales/bootstrap-programs': 'Bootstrap Program', '/sales/timeline': 'Sales Timeline', '/sales/dashboard': 'Sales Dashboard',
    '/marketing/campaigns': 'Campaigns', '/marketing/landing-pages': 'Landing Pages', '/marketing/content-assets': 'Content Assets', '/marketing/calendar': 'Marketing Calendar',
    '/skill-matrix': 'Skill Matrix', '/allocations': 'Allocations', '/capacity': 'Capacity',
    '/role-rates': 'Role Rates', '/customer-invoices': 'Customer Invoices', '/delivery-notes': 'Delivery Notes', '/payments': 'Payments',
    '/aging-report': 'Aging Report', '/profit-margins': 'Profit Margins', '/spend-analyzer': 'Spend Analyzer',
  }
  const pageTitle = pageMap[location.pathname] || appName

  const SidebarContent = () => (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        {!collapsed && <div className="logo-text">{appName}</div>}
        {collapsed && <div className="logo-icon">PP</div>}
        <button className="collapse-btn desktop-only" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand' : 'Collapse'}>
          <ChevronLeft size={16} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        <button className="collapse-btn mobile-only" onClick={() => setSidebarOpen(false)}>
          <X size={16} />
        </button>
      </div>

      {/* Profile chip */}
      <div className="sidebar-profile" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="avatar" style={{ background: ACCENT }}>{initials}</div>
        {!collapsed && (
          <div className="profile-info">
            <div className="profile-name">{profile?.full_name?.split(' ')[0] || 'User'}</div>
            <div className="profile-role" style={{ color: 'var(--ink-muted)' }}>{roleLabel[role] || role}</div>
          </div>
        )}
      </div>

      {/* Nav search */}
      {!collapsed && (
        <div style={{ padding: '2px 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1.5px solid var(--border)', borderRadius: 9, padding: '6px 9px', background: 'var(--surface)' }}>
            <Search size={13} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
            <input ref={navSearchRef} value={navSearch} onChange={e => setNavSearch(e.target.value)} onKeyDown={onNavSearchKeyDown}
              placeholder="Search menu..." aria-label="Search sidebar menu"
              style={{ border: 'none', outline: 'none', background: 'none', font: 'inherit', fontSize: 12.5, width: '100%', color: 'var(--text)' }} />
            {isSearchingNav
              ? <button onClick={() => setNavSearch('')} title="Clear" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex', flexShrink: 0, padding: 0 }}>
                  <X size={13} />
                </button>
              : <kbd style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-muted)', background: '#fff', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', flexShrink: 0, fontFamily: 'inherit' }}>/</kbd>}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="sidebar-nav">
        {isSearchingNav && filteredNav.length === 0 && (
          <div style={{ padding: '16px 14px', fontSize: 12.5, color: 'var(--ink-muted)', textAlign: 'center' }}>
            No menu items match "{navSearch.trim()}"
          </div>
        )}
        {filteredNav.map(section => {
          const sectionCollapsed = !collapsed && !isSearchingNav && !!collapsedSections[section.section]
          return (
          <div key={section.section} className="nav-section">
            {!collapsed && (
              <button onClick={() => toggleSection(section.section)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '8px 10px 4px',
                }}>
                <span className="nav-section-label" style={{ padding: 0 }}>{section.section}</span>
                <ChevronDown size={12} style={{ color: 'var(--ink-muted)', flexShrink: 0, transition: 'transform .18s', transform: sectionCollapsed ? 'rotate(-90deg)' : 'none' }} />
              </button>
            )}
            {!sectionCollapsed && section.items.map(item => {
              const Icon = item.icon
              const itemPath = item.to.split('?')[0]
              const isActiveRoute = location.pathname === itemPath
              const searchParams = new URLSearchParams(location.search)
              const activeSub = searchParams.get('view') || item.subTabs?.[0]?.id
              const isProjects = item.to === '/projects'
              const selectedName = isProjects ? searchParams.get('pname') : null
              const currentPid = isProjects ? searchParams.get('pid') : null
              // Non-Projects items (e.g. Task Management): chevron lives on the main row.
              const isExpanded = expandedNav[item.to] ?? true
              // Projects: chevron lives on the "📁 Project Name" row instead.
              const tabsKey = `${item.to}:tabs`
              const tabsExpanded = expandedNav[tabsKey] ?? true

              const SubTabButtons = () => (
                <>
                  {item.subTabs.map(sub => {
                    const active = activeSub === sub.id
                    return (
                      <button key={sub.id} onClick={() => {
                          const p = new URLSearchParams(isActiveRoute ? location.search : '')
                          p.set('view', sub.id)
                          navigate(`${itemPath}?${p.toString()}`)
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                          border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                          fontSize: 12.5, fontWeight: active ? 700 : 500, textAlign: 'left',
                          background: active ? `${ACCENT}18` : 'transparent',
                          color: active ? ACCENT : 'var(--text-muted)',
                        }}>
                        <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0 }}>{sub.icon}</span>
                        <span>{sub.label}</span>
                      </button>
                    )
                  })}
                </>
              )

              // When you're already on this page, the whole row is the open/close
              // toggle for its views — no separate tiny chevron button to hunt for.
              // (Projects, once a project is open, keeps its own "📁 Name" toggle below instead.)
              const canToggleHere = item.subTabs && isActiveRoute && !collapsed && (!isProjects || !selectedName)
              const isKeyboardActive = isSearchingNav && flatNavMatches[navActiveIndex]?.to === item.to

              return (
                <div key={item.to} style={{ position: 'relative' }}>
                  <NavLink to={item.to} end={item.to === '/'} title={collapsed ? item.label : undefined}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    style={({ isActive }) => ({
                      ...(isActive ? { '--link-color': ACCENT } : {}),
                      ...(isKeyboardActive && !isActive ? { background: 'var(--surface)', boxShadow: `inset 0 0 0 1.5px ${ACCENT}55` } : {}),
                    })}
                    onClick={(e) => { if (canToggleHere) { e.preventDefault(); toggleNavExpand(item.to) } }}>
                    <Icon size={17} className="nav-icon" />
                    {!collapsed && <span className="nav-label" style={{ flex: 1, minWidth: 0 }}><NavLabel label={item.label} /></span>}
                    {canToggleHere && (isExpanded ? <ChevronDown size={14} style={{ flexShrink: 0, opacity: .75 }} /> : <ChevronRight size={14} style={{ flexShrink: 0, opacity: .75 }} />)}
                  </NavLink>

                  {/* Non-Projects sub-navigation (e.g. Task Management) */}
                  {item.subTabs && isActiveRoute && !collapsed && !isProjects && isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '2px 0 6px 30px' }}>
                      <SubTabButtons />
                    </div>
                  )}

                  {/* Projects: no project open yet — just list the views (now collapsible via the
                      same chevron toggle above, instead of always being pinned open) */}
                  {isProjects && item.subTabs && isActiveRoute && !collapsed && !selectedName && isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '2px 0 6px 30px' }}>
                      <SubTabButtons />
                    </div>
                  )}

                  {/* Projects: a project is open — collapsible name header + views + switcher */}
                  {isProjects && item.subTabs && isActiveRoute && !collapsed && selectedName && (
                    <div style={{ margin: '2px 0 6px 30px' }}>
                      <button onClick={() => toggleNavExpand(tabsKey)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', marginBottom: 4,
                          fontSize: 11.5, fontWeight: 800, color: ACCENT, background: `${ACCENT}12`, borderRadius: 8,
                          border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                        }} title={selectedName}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {selectedName}</span>
                        {tabsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      {tabsExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 8 }}>
                          <SubTabButtons />
                        </div>
                      )}
                      {sidebarProjects.filter(p => p.id !== currentPid).length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '4px 10px' }}>
                            Switch Project
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 160, overflowY: 'auto' }}>
                            {sidebarProjects.filter(p => p.id !== currentPid).map(p => (
                              <button key={p.id} onClick={() => navigate(`/projects?pid=${p.id}`)}
                                style={{
                                  display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 8,
                                  border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>
                                {p.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )
        })}
      </nav>

      {/* Sign out */}
      <div className="sidebar-footer">
        <button className="nav-link signout-btn" onClick={handleSignOut}>
          <LogOut size={17} className="nav-icon" />
          {!collapsed && <span className="nav-label">Sign Out</span>}
        </button>
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Desktop sidebar */}
      <div className="desktop-sidebar"><SidebarContent /></div>

      {/* Mobile sidebar */}
      <div className={`mobile-sidebar ${sidebarOpen ? 'open' : ''}`}><SidebarContent /></div>

      {/* Main */}
      <div className="main-area">
        {/* Topbar */}
        <header className="topbar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="topbar-title">{pageTitle}</div>
          {profile?.org && (
            <div className="desktop-only" style={{ alignItems:'center', gap:8, fontSize:12, color:'var(--ink-muted)' }}>
              <Building2 size={13} style={{ opacity:.6, flexShrink:0 }}/>
              <span style={{ fontWeight:700, color:'var(--ink-soft)', whiteSpace:'nowrap' }}>{profile.org.name}</span>
              {profile.org.plan_key && <span className="badge badge-purple">{profile.org.plan_key}</span>}
            </div>
          )}
          <div className="topbar-right" style={{display:'flex',alignItems:'center',gap:10}}>
            <button onClick={() => setGlobalSearchOpen(true)} title="Search (Ctrl/Cmd+K)"
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', color:'var(--ink-muted)', fontSize:12 }}>
              <Search size={14} /> <span className="desktop-only" style={{ border:'1px solid var(--border)', borderRadius:4, padding:'0 5px', fontSize:10.5 }}>Ctrl K</span>
            </button>
            <NotificationBell />
            <CheckInWidget />
            <div className="topbar-avatar" style={{ background: ACCENT }}>{initials}</div>
          </div>
        </header>

        {/* Content */}
        <main className="content">
          {children}
        </main>
      </div>
      <AskBubble />
      <GlobalSearchModal open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
    </div>
  )
}

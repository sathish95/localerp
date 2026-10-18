// Canonical module list — reconciles Layout.jsx's ALL_NAV (routing/nav
// structure) with TabVisibilityContext.jsx's tab-visibility keys. Both are
// kept as the source of truth for their own concern (nav rendering /
// permission checks), but this file is the definitive {key, label,
// section} list that STEP43's seed migration and the new Settings ->
// Roles & Modules admin UI both read from, so module-enablement doesn't
// need its own third, independently-drifting copy of the tab list.
export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', section: 'Overview' },
  { key: 'org-home', label: 'Company Home', section: 'Overview' },
  { key: 'knowledge-base', label: 'Knowledge Base', section: 'Overview' },
  { key: 'wiki', label: 'ThingsAlive Wiki', section: 'Overview' },
  { key: 'email-to-tasks', label: 'NeoX Email Intelligence', section: 'Overview' },
  { key: 'agreements', label: 'Agreements & e-Sign', section: 'Overview' },

  { key: 'expenses', label: 'Expenses', section: 'Expenses & Travel' },
  { key: 'travel', label: 'Travel Requests', section: 'Expenses & Travel' },
  { key: 'approvals', label: 'Approvals', section: 'Expenses & Travel' },

  { key: 'projects', label: 'Projects', section: 'Operations' },
  { key: 'project-portfolio', label: 'Project Portfolio', section: 'Operations' },
  { key: 'tasks', label: 'Task Management', section: 'Operations' },
  { key: 'work-items', label: 'Work Items', section: 'Operations' },
  { key: 'my-work', label: 'My Work', section: 'Operations' },
  { key: 'team-work', label: 'Team Work', section: 'Operations' },
  { key: 'daily-status', label: 'Daily Status', section: 'Operations' },
  { key: 'neo-task-ai', label: 'Neo Task AI', section: 'Operations' },
  { key: 'budget', label: 'Budget', section: 'Operations' },
  { key: 'assets', label: 'Assets', section: 'Operations' },
  { key: 'roi-planning', label: 'ROI Planning', section: 'Operations' },
  { key: 'activity-planner', label: 'Activity Planner', section: 'Operations' },

  { key: 'skill-matrix', label: 'Skill Matrix', section: 'Resourcing' },
  { key: 'allocations', label: 'Allocations', section: 'Resourcing' },
  { key: 'capacity', label: 'Capacity', section: 'Resourcing' },

  { key: 'products', label: 'Product', section: 'Inventory Management' },
  { key: 'bom', label: 'BOM', section: 'Inventory Management' },
  { key: 'inventory', label: 'Component', section: 'Inventory Management' },
  { key: 'devices', label: 'Devices', section: 'Inventory Management' },
  { key: 'procurement', label: 'Purchase Request', section: 'Inventory Management' },
  { key: 'warranty', label: 'Warranty', section: 'Inventory Management' },
  { key: 'golive-support', label: 'Go-Live Support', section: 'Inventory Management' },
  { key: 'pos', label: 'PO', section: 'Inventory Management' },
  { key: 'invoices', label: 'Invoice', section: 'Inventory Management' },
  { key: 'grn', label: 'GRN', section: 'Inventory Management' },
  { key: 'customers', label: 'Customers', section: 'Vendors & Partners' },
  { key: 'vendors', label: 'Vendors', section: 'Vendors & Partners' },
  { key: 'contacts', label: 'Contacts (POC)', section: 'Vendors & Partners' },
  { key: 'fundflow', label: 'Fund Flow', section: 'Vendors & Partners' },

  { key: 'proposals', label: 'Proposals', section: 'Pre-Sales' },

  { key: 'sales-leads', label: 'Leads', section: 'Sales' },
  { key: 'sales-landing-links', label: 'Landing Links', section: 'Sales' },
  { key: 'sales-meeting-pages', label: 'Meeting Booking Pages', section: 'Sales' },
  { key: 'sales-opportunities', label: 'Opportunities', section: 'Sales' },
  { key: 'sales-tasks', label: 'Sales Tasks', section: 'Sales' },
  { key: 'sales-product-launches', label: 'Product Launches', section: 'Sales' },
  { key: 'sales-tenders', label: 'Tenders', section: 'Sales' },
  { key: 'sales-pilot-projects', label: 'Pilot Projects', section: 'Sales' },
  { key: 'sales-bootstrap-programs', label: 'Bootstrap Program', section: 'Sales' },
  { key: 'sales-timeline', label: 'Sales Timeline', section: 'Sales' },
  { key: 'sales-dashboard', label: 'Sales Dashboard', section: 'Sales' },

  { key: 'marketing-campaigns', label: 'Campaigns', section: 'Marketing' },
  { key: 'marketing-landing-pages', label: 'Landing Pages', section: 'Marketing' },
  { key: 'marketing-content-assets', label: 'Content Assets', section: 'Marketing' },
  { key: 'marketing-calendar', label: 'Marketing Calendar', section: 'Marketing' },

  { key: 'performance-cycles', label: 'Review Cycles', section: 'Performance' },
  { key: 'my-performance', label: 'My Performance', section: 'Performance' },
  { key: 'team-reviews', label: 'Team Reviews', section: 'Performance' },
  { key: 'calibration', label: 'Calibration', section: 'Performance' },
  { key: 'performance-dashboard', label: 'Performance Dashboard', section: 'Performance' },
  { key: 'award-management', label: 'Award Management', section: 'Performance' },
  { key: 'my-awards', label: 'My Awards', section: 'Performance' },
  { key: 'team-awards', label: 'Team Awards', section: 'Performance' },
  { key: 'certificate-templates', label: 'Certificate Templates', section: 'Performance' },

  { key: 'scenario-dashboard', label: 'Scenario Dashboard', section: 'Scenario Planning' },
  { key: 'scenario-my', label: 'My Scenarios', section: 'Scenario Planning' },
  { key: 'scenario-all', label: 'All Scenarios', section: 'Scenario Planning' },
  { key: 'scenario-templates', label: 'Scenario Templates', section: 'Scenario Planning' },
  { key: 'scenario-compare', label: 'Scenario Comparison', section: 'Scenario Planning' },
  { key: 'scenario-approvals', label: 'Scenario Approvals', section: 'Scenario Planning' },

  { key: 'role-rates', label: 'Role Rates', section: 'Finance' },
  { key: 'customer-invoices', label: 'Customer Invoices', section: 'Finance' },
  { key: 'delivery-notes', label: 'Delivery Notes', section: 'Finance' },
  { key: 'payments', label: 'Payments', section: 'Finance' },
  { key: 'aging-report', label: 'Aging Report', section: 'Finance' },
  { key: 'profit-margins', label: 'Profit Margins', section: 'Finance' },
  { key: 'spend-analyzer', label: 'Spend Analyzer', section: 'Finance' },

  { key: 'leave', label: 'Leave Management', section: 'HR & Resources' },
  { key: 'resources', label: 'Resource Tracking', section: 'HR & Resources' },
  { key: 'timesheet', label: 'Timesheet', section: 'HR & Resources' },
  { key: 'timesheet-approvals', label: 'Timesheet Approvals', section: 'HR & Resources' },
  { key: 'chat', label: 'Chat', section: 'HR & Resources' },
  { key: 'outlook-inbox', label: 'Outlook Email', section: 'HR & Resources' },
  { key: 'data-assistant', label: 'Data Assistant', section: 'HR & Resources' },
  { key: 'it-helpdesk', label: 'IT Helpdesk', section: 'HR & Resources' },

  { key: 'support', label: 'Support', section: 'HR & Resources' },

  { key: 'users', label: 'Users', section: 'Admin' },
  { key: 'reports', label: 'Reports', section: 'Admin' },
  { key: 'settings', label: 'Settings', section: 'Admin' },
  { key: 'content', label: 'Landing Content', section: 'Admin' },
  { key: 'app-monitor', label: 'App Monitor', section: 'Admin' },
  { key: 'llm-monitor', label: 'LLM Usage Monitor', section: 'Admin' },
]

export const MODULE_SECTIONS = [...new Set(MODULES.map(m => m.section))]

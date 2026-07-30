// Canonical module list — reconciles Layout.jsx's ALL_NAV (routing/nav
// structure) with TabVisibilityContext.jsx's tab-visibility keys. Both are
// kept as the source of truth for their own concern (nav rendering /
// permission checks), but this file is the definitive {key, label,
// section} list that STEP43's seed migration and the new Settings ->
// Roles & Modules admin UI both read from, so module-enablement doesn't
// need its own third, independently-drifting copy of the tab list.
export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', section: 'Overview' },
  { key: 'knowledge-base', label: 'Knowledge Base', section: 'Overview' },

  { key: 'expenses', label: 'Expenses', section: 'Expenses & Travel' },
  { key: 'travel', label: 'Travel Requests', section: 'Expenses & Travel' },
  { key: 'approvals', label: 'Approvals', section: 'Expenses & Travel' },

  { key: 'projects', label: 'Projects', section: 'Operations' },
  { key: 'tasks', label: 'Task Management', section: 'Operations' },
  { key: 'neo-task-ai', label: 'Neo Task AI', section: 'Operations' },
  { key: 'budget', label: 'Budget', section: 'Operations' },
  { key: 'assets', label: 'Assets', section: 'Operations' },

  { key: 'skill-matrix', label: 'Skill Matrix', section: 'Resourcing' },
  { key: 'allocations', label: 'Allocations', section: 'Resourcing' },
  { key: 'capacity', label: 'Capacity', section: 'Resourcing' },

  { key: 'products', label: 'Product', section: 'Inventory Management' },
  { key: 'bom', label: 'BOM', section: 'Inventory Management' },
  { key: 'inventory', label: 'Component', section: 'Inventory Management' },
  { key: 'devices', label: 'Devices', section: 'Inventory Management' },
  { key: 'procurement', label: 'Purchase Request', section: 'Inventory Management' },
  { key: 'warranty', label: 'Warranty', section: 'Inventory Management' },
  { key: 'pos', label: 'PO', section: 'Inventory Management' },
  { key: 'invoices', label: 'Invoice', section: 'Inventory Management' },
  { key: 'grn', label: 'GRN', section: 'Inventory Management' },
  { key: 'customers', label: 'Customers', section: 'Vendors & Partners' },
  { key: 'vendors', label: 'Vendors', section: 'Vendors & Partners' },
  { key: 'fundflow', label: 'Fund Flow', section: 'Vendors & Partners' },

  { key: 'proposals', label: 'Proposals', section: 'Pre-Sales' },

  { key: 'performance-cycles', label: 'Review Cycles', section: 'Performance' },
  { key: 'my-performance', label: 'My Performance', section: 'Performance' },
  { key: 'team-reviews', label: 'Team Reviews', section: 'Performance' },
  { key: 'calibration', label: 'Calibration', section: 'Performance' },
  { key: 'performance-dashboard', label: 'Performance Dashboard', section: 'Performance' },

  { key: 'role-rates', label: 'Role Rates', section: 'Finance' },
  { key: 'customer-invoices', label: 'Customer Invoices', section: 'Finance' },
  { key: 'payments', label: 'Payments', section: 'Finance' },
  { key: 'aging-report', label: 'Aging Report', section: 'Finance' },
  { key: 'profit-margins', label: 'Profit Margins', section: 'Finance' },
  { key: 'spend-analyzer', label: 'Spend Analyzer', section: 'Finance' },

  { key: 'leave', label: 'Leave Management', section: 'HR & Resources' },
  { key: 'resources', label: 'Resource Tracking', section: 'HR & Resources' },
  { key: 'timesheet', label: 'Timesheet', section: 'HR & Resources' },
  { key: 'timesheet-approvals', label: 'Timesheet Approvals', section: 'HR & Resources' },
  { key: 'chat', label: 'Chat', section: 'HR & Resources' },
  { key: 'data-assistant', label: 'Data Assistant', section: 'HR & Resources' },

  { key: 'users', label: 'Users', section: 'Admin' },
  { key: 'reports', label: 'Reports', section: 'Admin' },
  { key: 'settings', label: 'Settings', section: 'Admin' },
  { key: 'content', label: 'Landing Content', section: 'Admin' },
  { key: 'app-monitor', label: 'App Monitor', section: 'Admin' },
  { key: 'llm-monitor', label: 'LLM Usage Monitor', section: 'Admin' },
]

export const MODULE_SECTIONS = [...new Set(MODULES.map(m => m.section))]

// Industry-Adaptive Platform — Phase 8. Names the DashboardPage.jsx
// sections (the main role-based landing dashboard, NOT the unrelated
// per-project widget builder in src/components/CustomDashboardBuilder.jsx
// / src/lib/dashboardWidgets.js — different feature, same word
// "dashboard", deliberately named differently here to avoid any
// confusion with that file) that can be toggled off via
// workspace_profiles.dashboard_widget_keys (STEP185). Deliberately
// covers only the CEO and Finance dashboard branches in
// DashboardPage.jsx — see that migration's header comment for why the
// other role branches aren't included this pass.
export const DASHBOARD_WIDGETS = [
  { key: 'ceo_process_command_center', label: 'Process Command Center', role: 'ceo' },
  { key: 'ceo_people_hr', label: 'People & HR', role: 'ceo' },
  { key: 'ceo_finance', label: 'Finance', role: 'ceo' },
  { key: 'ceo_operations_procurement', label: 'Operations & Procurement', role: 'ceo' },
  { key: 'ceo_technology_delivery', label: 'Technology & Delivery', role: 'ceo' },
  { key: 'finance_invoice_breakdown', label: 'Invoice Breakdown', role: 'finance' },
  { key: 'finance_forecast', label: '3-Month Spend Forecast', role: 'finance' },
]

// null (the default for every existing org — STEP185) means "no
// override, show everything" — the same posture every prior phase's
// config columns already use.
export function isWidgetVisible(dashboardWidgetKeys, key) {
  if (!Array.isArray(dashboardWidgetKeys)) return true
  return dashboardWidgetKeys.includes(key)
}

// Deterministic (non-AI) module recommendation for the workspace
// onboarding wizard (master prompt section 40: "Start with deterministic
// configuration/rules... do not make the entire onboarding dependent on
// an LLM"). Every key returned MUST already exist in src/config/modules.js
// — this file recommends a subset, it never invents a module.
import { MODULES } from '../config/modules'

const ALL_KEYS = new Set(MODULES.map(m => m.key))

// Present in every recommendation regardless of industry/operating
// model — the foundational surface every organization uses (matches
// what an existing "legacy" org already sees today).
const BASE = ['dashboard', 'org-home', 'tasks', 'timesheet', 'timesheet-approvals', 'approvals', 'leave', 'resources', 'reports', 'users', 'settings']

const BY_INDUSTRY = {
  construction: ['projects', 'budget', 'assets', 'procurement', 'vendors', 'invoices', 'pos', 'grn'],
  manufacturing: ['projects', 'assets', 'inventory', 'devices', 'procurement', 'bom', 'products', 'warranty'],
  it_software: ['projects', 'neo-task-ai', 'chat', 'data-assistant', 'it-helpdesk', 'wiki'],
  professional_services: ['projects', 'proposals', 'customer-invoices', 'chat', 'wiki'],
  facility_management: ['assets', 'procurement', 'it-helpdesk'],
  security: ['timesheet-approvals'],
  retail: ['inventory', 'products', 'customers'],
  healthcare: ['assets'],
  hospitality: ['assets', 'customers'],
  logistics: ['assets', 'procurement', 'vendors', 'fundflow'],
  warehousing: ['inventory', 'devices', 'procurement', 'grn'],
  field_service: ['assets', 'it-helpdesk'],
  maintenance: ['assets', 'it-helpdesk', 'procurement'],
  agriculture: ['assets'],
  mining: ['assets', 'procurement', 'warranty'],
  education: ['chat'],
  cleaning_services: [],
  other: [],
}

const BY_OPERATING_MODEL = {
  projects: ['projects', 'budget', 'allocations', 'capacity'],
  daily_tasks: ['tasks'],
  shifts: ['timesheet', 'resources'],
  work_orders: ['procurement', 'invoices'],
  field_service: ['assets', 'it-helpdesk'],
  production: ['inventory', 'devices'],
  client_service: ['customers', 'proposals'],
  recurring_operations: ['it-helpdesk'],
}

export function recommendModuleKeys(industryKey, operatingModelKeys = []) {
  const keys = new Set(BASE)
  for (const k of (BY_INDUSTRY[industryKey] || [])) keys.add(k)
  for (const modelKey of operatingModelKeys) {
    for (const k of (BY_OPERATING_MODEL[modelKey] || [])) keys.add(k)
  }
  // Defensive: never recommend a key that doesn't actually exist as a
  // module today (e.g. an industry map typo, or a module renamed later).
  return [...keys].filter(k => ALL_KEYS.has(k))
}

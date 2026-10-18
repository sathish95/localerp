import { supabase } from './supabase'
import { listFlows, makeStatusHelpers } from './departmentStatusFlows'

// Every table the Project Portfolio dashboard reads, in one parallel round
// trip. Optional sources (Go-Live incidents, payments) fail soft to [] so the
// page still loads in an org that hasn't run those steps.
const LEGACY_STEPS = ['backlog', 'todo', 'in_progress', 'delayed', 'qa', 'ready_for_demo', 'closed']
  .map(s => ({ status_key: s, is_closed: s === 'closed' }))

async function rows(q) {
  const { data, error } = await q
  if (error) { console.warn('[portfolio]', error.message); return [] }
  return data || []
}

export async function loadPortfolioData(organizationId) {
  const [projects, tasks, milestones, timelogs, expenses, sw, hw, sup, rates, invoices, payments,
    changeRequests, engagements, incidents, customers, departments, flows] = await Promise.all([
    rows(supabase.from('projects').select('id,name,code,status,budget,start_date,end_date,customer_id,department_id,project_type,created_at').order('name')),
    rows(supabase.from('project_tasks').select('id,project_id,department_id,status,planned_end_date,progress_pct').not('project_id', 'is', null)),
    rows(supabase.from('project_milestones').select('id,project_id,title,status,due_date,budget')),
    rows(supabase.from('time_logs').select('project_id,employee_id,hours_worked,work_date,visit_type').not('project_id', 'is', null)),
    rows(supabase.from('expense_requests').select('project_id,amount,total_amount,status,expense_date,created_at').not('project_id', 'is', null)),
    rows(supabase.from('project_software_costs').select('*')),
    rows(supabase.from('project_hardware_costs').select('*')),
    rows(supabase.from('project_support_costs').select('*')),
    rows(supabase.from('resource_rates').select('employee_id,hourly_rate,monthly_salary')),
    rows(supabase.from('customer_invoices').select('id,project_id,total_amount,status,due_date')),
    rows(supabase.from('payments').select('invoice_id,amount').eq('invoice_type', 'customer')),
    rows(supabase.from('change_requests').select('project_id,status')),
    rows(supabase.from('golive_engagements').select('id,project_id').is('deleted_at', null)),
    rows(supabase.from('golive_incidents').select('engagement_id,status,priority')),
    rows(supabase.from('customers').select('id,name')),
    rows(supabase.from('departments').select('id,name')),
    organizationId ? listFlows(organizationId).catch(() => []) : Promise.resolve([]),
  ])
  const engProject = Object.fromEntries(engagements.map(e => [e.id, e.project_id]))
  const { isTaskDone } = makeStatusHelpers(flows, LEGACY_STEPS)
  return {
    raw: {
      projects, tasks, milestones, timelogs, expenses, sw, hw, sup, rates, invoices, payments, changeRequests,
      incidents: incidents.map(i => ({ ...i, project_id: engProject[i.engagement_id] })).filter(i => i.project_id),
      customers, departments,
    },
    // tasks marked 100% count as done even if their flow step isn't closed
    isTaskDone: t => isTaskDone(t) || Number(t.progress_pct) >= 100,
  }
}

// Supabase Edge Function: send-email
//
// The delivery worker for STEP228's email_outbox. Each run (every minute):
//   1. enqueue_email_digests()      — daily digests due this hour
//      enqueue_alert_emails()       — check-in reminders + overdue lists (STEP231)
//      enqueue_due_announcements()  — maintenance / update / general notices (STEP233)
//      process_email_events()       — event-rule emails from captured row changes (STEP233)
//      enqueue_golive_report_emails() — Go-Live daily report (overview + day summary) after each engagement's send time (STEP256)
//   2. enqueue_due_report_emails()  — scheduled report emails due this hour
//   3. claim_email_batch(50)        — atomically takes pending rows
//   4. renders each template (../_shared/emailTemplates.ts); team reports
//      are computed with the SAME core the web page uses
//      (../_shared/teamPerformanceCore.js), in the org's timezone
//   5. sends over SMTP with Nodemailer, then mark_email_result()
//
// Secrets (supabase secrets set …):
//   SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL, APP_URL, CRON_SECRET
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// Port must be 465 (implicit TLS): Supabase Edge Functions block outbound
// 25 and 587.
//
// Deploy:   supabase functions deploy send-email --no-verify-jwt   (auth = CRON_SECRET)
// Schedule: see the checklist at the bottom of sql/STEP228_email_service.sql
//
// The service role bypasses RLS, so EVERY query below filters by
// organization_id explicitly.

import nodemailer from 'npm:nodemailer@6.9.16'
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { computeTeamPerformanceCore } from '../_shared/teamPerformanceCore.js'
import { reportWindow, computeProjectStatusCore, computeFinanceCore } from '../_shared/reportsCore.js'
import { previousWindow, computeHrCore, computeManagerCore, computeSalesCore } from '../_shared/audienceCore.js'
import { computeWorkPlanCore, nextWorkingDayAfter } from '../_shared/planningCore.js'
import { teamPerformanceReport, projectStatusReport, financialReport, monthlyReport, ceoReport, hrReport, managerReport, salesReport } from '../_shared/reportEmails.ts'
import { checkinReminderEmail, checkinManagerEmail, overdueDigestEmail, overdueManagerEmail } from '../_shared/alertEmails.ts'
import { announcementEmail, eventEmail } from '../_shared/noticeEmails.ts'
import { goLiveDailyEmail } from '../_shared/goLiveEmails.ts'
import { notificationEmail, digestEmail, welcomeEmail, inviteEmail, testEmail, type Org, type Rendered } from '../_shared/emailTemplates.ts'

const BATCH = 50
const env = (k: string, d?: string) => Deno.env.get(k) ?? d ?? ''

type Row = {
  id: string; organization_id: string; recipient_id: string | null; to_email: string; to_name: string | null
  template: string; payload: any; attempts: number
  from_name: string | null; reply_to: string | null; footer_text: string | null; timezone: string; org_name: string | null
}

Deno.serve(async (req) => {
  // Caller check. Deploy with --no-verify-jwt and set CRON_SECRET: the cron
  // job sends it as "Authorization: Bearer <CRON_SECRET>". (Projects on the
  // newer sb_secret_… API keys can't pass the gateway's JWT check, which
  // otherwise rejects every cron call with 401 Invalid JWT.)
  const secret = env('CRON_SECRET')
  if (secret) {
    const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('x-cron-secret') || ''
    if (given !== secret) return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

  for (const fn of ['enqueue_email_digests', 'enqueue_due_report_emails', 'enqueue_alert_emails', 'enqueue_due_announcements', 'process_email_events', 'enqueue_golive_report_emails']) {
    const { error } = await admin.rpc(fn)
    if (error) console.error(`[send-email] ${fn}:`, error.message)
  }

  const { data, error } = await admin.rpc('claim_email_batch', { p_limit: BATCH })
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return json({ claimed: 0 })

  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_EMAIL', 'APP_URL'].filter(k => !env(k))
  if (missing.length) {
    const msg = `Email not configured: missing function secret(s) ${missing.join(', ')}`
    for (const r of rows) await admin.rpc('mark_email_result', { p_id: r.id, p_ok: false, p_error: msg })
    return json({ error: msg }, 500)
  }

  const port = Number(env('SMTP_PORT', '465'))
  const transport = nodemailer.createTransport({
    host: env('SMTP_HOST'), port, secure: port === 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    pool: true, maxConnections: 3,
  })

  const reportCache = new Map<string, Promise<any>>()
  let sent = 0, failed = 0

  for (const r of rows) {
    // Platform-wide notices (STEP233) go out under the platform's name, not the recipient org's.
    const platform = !!r.payload?.platform
    const org: Org = {
      orgName: r.org_name || 'ThingsAlive NeoX',
      fromName: r.payload?.from_name || r.from_name || r.org_name || 'ThingsAlive NeoX',
      footer: platform ? null : r.footer_text, appUrl: env('APP_URL'), timezone: r.timezone || 'Asia/Kolkata',
    }
    let rendered: Rendered | null = null
    try {
      rendered = await render(admin, r, org, reportCache)
      await transport.sendMail({
        from: { name: org.fromName, address: env('SMTP_FROM_EMAIL') },
        to: r.to_name ? { name: r.to_name, address: r.to_email } : r.to_email,
        replyTo: (!platform && r.reply_to) || undefined,
        subject: rendered.subject, html: rendered.html, text: rendered.text,
        headers: { 'X-Entity-Ref-ID': r.id },
      })
      await admin.rpc('mark_email_result', { p_id: r.id, p_ok: true, p_subject: rendered.subject })
      sent++
    } catch (e) {
      failed++
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[send-email] ${r.template} → ${r.to_email} failed:`, msg)
      await admin.rpc('mark_email_result', { p_id: r.id, p_ok: false, p_subject: rendered?.subject ?? null, p_error: msg })
    }
  }
  transport.close()
  return json({ claimed: rows.length, sent, failed })
})

async function render(admin: SupabaseClient, r: Row, org: Org, cache: Map<string, Promise<any>>): Promise<Rendered> {
  switch (r.template) {
    case 'notification': return notificationEmail(org, r.payload)
    case 'digest':       return digestEmail(org, r.payload, r.to_name)
    case 'welcome':      return welcomeEmail(org, r.payload, r.to_name, r.to_email)
    case 'invite':       return inviteEmail(org, r.payload, r.to_name)
    case 'test':         return testEmail(org)
    case 'checkin_reminder': return checkinReminderEmail(org, r.payload, r.to_name)
    case 'checkin_manager':  return checkinManagerEmail(org, r.payload, r.to_name)
    case 'overdue_digest':   return overdueDigestEmail(org, r.payload, r.to_name)
    case 'overdue_manager':  return overdueManagerEmail(org, r.payload, r.to_name)
    case 'announcement':     return announcementEmail(org, r.payload, r.to_name)
    case 'event':            return eventEmail(org, r.payload, r.to_name)
    case 'golive_daily':     return goLiveDailyEmail(org, r.payload, r.to_name)
    case 'team_report': {
      // Every scheduled report uses this outbox template; payload.report_type
      // picks which one. Missing = team_performance (STEP228 rows).
      const p = r.payload
      const type = p.report_type || 'team_performance'
      const { from, to } = reportWindow(p.period, p.coverage || 'to_date', p.as_of)
      const prevW = previousWindow(from, to)
      // One computation per (report, window, scope) per run, shared by all recipients.
      const get = (w: { from: string; to: string }, kind = type) => {
        const key = [r.organization_id, kind, w.from, w.to, p.department_id || '', p.project_id || '', p.manager_id || ''].join('|')
        if (!cache.has(key)) cache.set(key, buildReport(admin, kind, r.organization_id, w.from, w.to, org.timezone, p))
        return cache.get(key)!
      }
      const [cur, prev] = await Promise.all([get({ from, to }), get(prevW)])
      switch (type) {
        case 'project_status':  return projectStatusReport(org, p, { cur, prev })
        case 'financial':       return financialReport(org, p, { cur, prev })
        case 'monthly_summary': return monthlyReport(org, p, { ...cur, prev })
        case 'ceo_briefing':    return ceoReport(org, p, { ...cur, prev })
        case 'hr_people':       return hrReport(org, p, { ...cur, prev })
        case 'manager_team':    return managerReport(org, p, { mgr: cur, prev })
        case 'sales_pipeline':  return salesReport(org, p, { cur, prev })
        default:                return teamPerformanceReport(org, p, { cur, prev })
      }
    }
    default: throw new Error(`Unknown template ${r.template}`)
  }
}

/* ── Reports, computed server-side in the org's timezone ── */

// Wall-clock date (YYYY-MM-DD) of an instant in a timezone.
const zonedDate = (ts: string | Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))

// UTC instant of local midnight (or end of day) for a date in a timezone.
function zonedBoundary(date: string, tz: string, endOfDay = false) {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(guess)).map(x => [x.type, x.value]))
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return new Date(guess - (asUtc - guess)).toISOString()
}

const CLOSED_WORDS = ['closed', 'done', 'complete', 'completed', 'resolved']

type Ctx = { admin: SupabaseClient; orgId: string; from: string; to: string; tz: string; startIso: string; endIso: string; today: string; dateOfTs: (ts: string) => string }

// Every query is filtered by organization_id: the service role bypasses RLS.
const q = (c: Ctx, t: string, cols: string) => c.admin.from(t).select(cols).eq('organization_id', c.orgId)
const must = (res: Record<string, { data: any; error: any }>) => {
  for (const [name, r] of Object.entries(res)) if (r.error) throw new Error(`${name}: ${r.error.message}`)
}
const opt = (r: { data: any; error: any }) => (r.error ? [] : r.data ?? []) // optional add-on tables

// Flow-aware "closed", same rule as makeIsTaskDone() in src/lib/dailyStatus.js.
async function loadIsTaskDone(c: Ctx) {
  const flows = await q(c, 'department_status_flows', 'department_id, steps:department_status_steps(status_key, is_closed)')
  const closedByDept = new Map<string, Map<string, boolean>>()
  for (const f of opt(flows) as any[]) closedByDept.set(f.department_id || '__none', new Map((f.steps || []).map((s: any) => [s.status_key, !!s.is_closed])))
  return (t: any) => {
    const status = String(t?.status || '')
    const flow = closedByDept.get(t?.department_id || '__none')
    const flowSays = flow ? flow.get(status) === true : status === 'closed'
    return flowSays || CLOSED_WORDS.includes(status.trim().toLowerCase())
  }
}

async function buildReport(admin: SupabaseClient, type: string, orgId: string, from: string, to: string, tz: string, p: any) {
  const c: Ctx = {
    admin, orgId, from, to, tz, startIso: zonedBoundary(from, tz), endIso: zonedBoundary(to, tz, true),
    today: zonedDate(new Date(), tz), dateOfTs: (ts: string) => zonedDate(ts, tz),
  }
  switch (type) {
    case 'project_status': return buildProjectStatus(c, p.project_id || null)
    case 'financial': return buildFinance(c)
    case 'sales_pipeline': return buildSales(c)
    case 'manager_team': return buildManager(c, p.manager_id)
    case 'hr_people': {
      const team = await buildTeam(c, null)
      return { team, hr: await buildHr(c, team) }
    }
    case 'monthly_summary': {
      const [team, projects, finance] = await Promise.all([buildTeam(c, p.department_id || null), buildProjectStatus(c, null), buildFinance(c)])
      return { team, projects, finance, from, to }
    }
    case 'ceo_briefing': {
      const [team, projects, finance, sales] = await Promise.all([buildTeam(c, null), buildProjectStatus(c, null), buildFinance(c), buildSales(c)])
      return { team, projects, finance, sales, hr: await buildHr(c, team), from, to }
    }
    default: return buildTeam(c, p.department_id || null)
  }
}

// Wall-clock minutes after local midnight, for late-arrival checks.
const zonedMinutes = (ts: string, tz: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]))
  return (+parts.hour) * 60 + (+parts.minute)
}

async function buildHr(c: Ctx, team: any) {
  const soon = addDays(c.today, 14)
  const lo = c.from < c.today ? c.from : c.today
  const [profiles, departments, timeLogs, leaves, pendingLeaves] = await Promise.all([
    q(c, 'profiles', 'id, full_name, role, department_id, designation, employment_type, date_joined, is_active'),
    q(c, 'departments', 'id, name'),
    q(c, 'time_logs', 'employee_id, work_date, check_in').gte('work_date', c.from).lte('work_date', c.to),
    q(c, 'leave_requests', 'employee_id, leave_type, from_date, to_date, status, created_at').eq('status', 'approved').lte('from_date', soon)
      .or(`to_date.gte.${lo},and(to_date.is.null,from_date.gte.${lo})`),
    q(c, 'leave_requests', 'employee_id, leave_type, from_date, to_date, status, created_at').eq('status', 'pending'),
  ])
  must({ profiles })
  // timesheet_approvals has no organization_id: scope by this org's people.
  const ids = ((profiles.data ?? []) as any[]).map(x => x.id)
  const timesheets = ids.length ? await c.admin.from('timesheet_approvals').select('employee_id, status, period_month, period_year, total_hours, manager_id')
    .in('employee_id', ids).like('status', 'pending%') : { data: [], error: null }
  return computeHrCore({
    profiles: profiles.data ?? [], departments: opt(departments), timeLogs: opt(timeLogs),
    leaves: [...opt(leaves), ...opt(pendingLeaves)], timesheets: opt(timesheets),
  }, team, { from: c.from, to: c.to, today: c.today, dateOfTs: c.dateOfTs, minutesOfTs: (ts: string) => zonedMinutes(ts, c.tz) })
}

async function buildManager(c: Ctx, managerId: string) {
  if (!managerId) throw new Error('manager_team report without manager_id')
  const planDay = nextWorkingDayAfter(c.today)
  const [team, profiles, tasks, planLeaves, pendingLeaves, expenses, timesheets, isTaskDone] = await Promise.all([
    buildTeam(c, null),
    q(c, 'profiles', 'id, full_name, role, department_id, is_active, reporting_manager_id, manager_id'),
    q(c, 'project_tasks', 'id, task_id, task_name, status, department_id, assigned_to, planned_start_date, planned_end_date, estimated_hours').not('assigned_to', 'is', null),
    q(c, 'leave_requests', 'employee_id, leave_type, from_date, to_date').eq('status', 'approved').lte('from_date', planDay)
      .or(`to_date.gte.${planDay},and(to_date.is.null,from_date.eq.${planDay})`),
    q(c, 'leave_requests', 'employee_id, leave_type, from_date, to_date, status').eq('status', 'pending'),
    q(c, 'expense_requests', 'expense_number, title, amount, total_amount, requested_by, current_approver, status').eq('current_approver', managerId)
      .in('status', ['submitted', 'manager_review', 'dept_review', 'finance_review', 'ceo_review']),
    c.admin.from('timesheet_approvals').select('employee_id, status, period_month, period_year, total_hours, manager_id').eq('manager_id', managerId).eq('status', 'pending_manager'),
    loadIsTaskDone(c),
  ])
  must({ profiles, tasks })
  const people = (profiles.data ?? []) as any[]
  const reports = people.filter(x => x.is_active !== false && (x.reporting_manager_id || x.manager_id) === managerId)
  const plan = computeWorkPlanCore({ day: planDay, employees: reports, tasks: tasks.data ?? [], leaves: opt(planLeaves), isTaskDone })
  return computeManagerCore(managerId, team, plan, { profiles: people, leaves: opt(pendingLeaves), expenses: opt(expenses), timesheets: opt(timesheets) })
}

async function buildSales(c: Ctx) {
  const [leads, opportunities, stages, profiles] = await Promise.all([
    q(c, 'sales_leads', 'source, status, assigned_rep_id, created_at, updated_at'),
    q(c, 'sales_opportunities', 'opportunity_number, pipeline_stage, expected_close_date, expected_value, probability_percent, status, assigned_rep_id, created_at, updated_at'),
    q(c, 'sales_pipeline_stages', 'stage_name, sort_order'),
    q(c, 'profiles', 'id, full_name'),
  ])
  return computeSalesCore({ leads: opt(leads), opportunities: opt(opportunities), stages: opt(stages), profiles: opt(profiles) },
    { from: c.from, to: c.to, today: c.today, dateOfTs: c.dateOfTs })
}

const addDays = (s: string, k: number) => { const t = new Date(s + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10) }

async function buildTeam(c: Ctx, departmentId: string | null) {
  const [profiles, timeLogs, workLogs, tasks, changeLog, leaves, it, sup, depts, isTaskDone] = await Promise.all([
    q(c, 'profiles', 'id, full_name, role, department_id, is_active'),
    q(c, 'time_logs', 'employee_id, work_date, hours_worked, check_in, check_out').gte('work_date', c.from).lte('work_date', c.to),
    q(c, 'work_logs', 'employee_id, task_id, started_at, ended_at, duration_minutes').gte('started_at', c.startIso).lte('started_at', c.endIso),
    q(c, 'project_tasks', 'id, task_id, task_name, status, department_id, assigned_to, planned_end_date, estimated_hours, actual_hours'),
    q(c, 'task_change_log', 'task_id, new_value, created_at').eq('field_name', 'status').gte('created_at', c.startIso).lte('created_at', c.endIso),
    q(c, 'leave_requests', 'employee_id, leave_type, from_date, to_date').eq('status', 'approved').lte('from_date', c.to)
      .or(`to_date.gte.${c.from},and(to_date.is.null,from_date.gte.${c.from})`),
    q(c, 'it_helpdesk_tickets', 'assigned_to, resolved_at, closed_at').or(`resolved_at.gte.${c.startIso},closed_at.gte.${c.startIso}`),
    q(c, 'support_tickets', 'assigned_agent_id, resolved_at, closed_at').or(`resolved_at.gte.${c.startIso},closed_at.gte.${c.startIso}`),
    q(c, 'departments', 'id, name'),
    loadIsTaskDone(c),
  ])
  must({ profiles, timeLogs, workLogs, tasks, changeLog })
  let people = (profiles.data ?? []) as any[]
  if (departmentId) people = people.filter(x => x.department_id === departmentId)
  const report = computeTeamPerformanceCore({
    profiles: people, timeLogs: timeLogs.data ?? [], workLogs: workLogs.data ?? [], tasks: tasks.data ?? [],
    changeLog: changeLog.data ?? [], leaves: opt(leaves), itTickets: opt(it), supportTickets: opt(sup),
  }, { from: c.from, to: c.to, today: c.today, isTaskDone, dateOfTs: c.dateOfTs })
  const departmentName = departmentId ? (opt(depts) as any[]).find(d => d.id === departmentId)?.name : null
  return { ...report, departmentName }
}

async function buildProjectStatus(c: Ctx, projectId: string | null) {
  const [projects, tasks, changeLog, milestones, workLogs, profiles, isTaskDone] = await Promise.all([
    q(c, 'projects', 'id, code, name, client_name, status, budget, spent, start_date, end_date, manager_id'),
    q(c, 'project_tasks', 'id, task_id, task_name, status, department_id, assigned_to, planned_end_date, project_id'),
    q(c, 'task_change_log', 'task_id, new_value, created_at').eq('field_name', 'status').gte('created_at', c.startIso).lte('created_at', c.endIso),
    q(c, 'project_milestones', 'project_id, title, due_date, status, actual_end, invoice_amount, billing_status'),
    q(c, 'work_logs', 'project_id, task_id, duration_minutes, started_at').gte('started_at', c.startIso).lte('started_at', c.endIso),
    q(c, 'profiles', 'id, full_name'),
    loadIsTaskDone(c),
  ])
  must({ projects, tasks, changeLog })
  return computeProjectStatusCore({
    projects: projects.data ?? [], tasks: tasks.data ?? [], changeLog: changeLog.data ?? [],
    milestones: opt(milestones), workLogs: opt(workLogs), profiles: opt(profiles),
  }, { from: c.from, to: c.to, today: c.today, isTaskDone, dateOfTs: c.dateOfTs, projectId })
}

async function buildFinance(c: Ctx) {
  const [expenses, vendorInvoices, purchaseOrders, travel, customerInvoices, customers, milestones, projects, margins, costSnapshots] = await Promise.all([
    q(c, 'expense_requests', 'expense_number, title, category, project_id, amount, total_amount, status, expense_date, paid_at, payment_status'),
    q(c, 'invoices', 'invoice_number, vendor_name, total_amount, invoice_date, due_date, status, payment_status, paid_at, project_id'),
    q(c, 'purchase_orders', 'po_number, total_amount, order_date, status, project_id'),
    q(c, 'travel_requests', 'actual_cost, claim_amount, estimated_cost, status, travel_date, project_id'),
    q(c, 'customer_invoices', 'invoice_number, customer_id, total_amount, invoice_date, due_date, status, paid_at, project_id'),
    q(c, 'customers', 'id, name'),
    q(c, 'project_milestones', 'project_id, title, status, actual_end, billing_status, invoice_amount, budget'),
    q(c, 'projects', 'id, code, name, status, budget, spent'),
    q(c, 'profit_margins', 'project_id, revenue_recognized, gross_margin, margin_percent, computed_at'),
    q(c, 'actual_cost_snapshots', 'project_id, total_actual_cost, computed_at'),
  ])
  must({ projects })
  return computeFinanceCore({
    expenses: opt(expenses), vendorInvoices: opt(vendorInvoices), purchaseOrders: opt(purchaseOrders), travel: opt(travel),
    customerInvoices: opt(customerInvoices), customers: opt(customers), milestones: opt(milestones), projects: projects.data ?? [],
    margins: opt(margins), costSnapshots: opt(costSnapshots),
  }, { from: c.from, to: c.to, today: c.today, dateOfTs: c.dateOfTs })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

-- ============================================================
-- SEED: Knowledge Base content for every module in the app.
-- Content is derived from reading the actual page/lib source code
-- (not generic descriptions) — description, a complete FEATURES
-- checklist (every real capability, filter, validation, computed
-- metric, role-gate found in code), step-by-step flow, primary
-- tables, and cross-module notes.
--
-- Run after STEP47_knowledge_base.sql and STEP49_kb_features.sql.
--
-- Refresh behavior: ON CONFLICT (key) DO UPDATE, but ONLY for rows
-- an admin has never touched from the Knowledge Base UI
-- (kb_modules.updated_by IS NULL) — so re-running this after an
-- admin has edited a module's content will never clobber their
-- edit, but will still refresh every untouched row with the latest
-- researched content.
-- ============================================================

INSERT INTO kb_modules (key, section, label, description, flow, features, primary_tables, linked_modules, notes, sort_order) VALUES

('dashboard', 'Overview', 'Dashboard',
$q$Role-adaptive analytics home page with no data of its own — it renders a completely different hero banner, KPI set, and chart layout depending on the logged-in user's role (admin, ceo, manager/department_head, finance, hr, employee, procurement_lead, pm, cto), aggregating counts and sums across roughly 16 other tables purely client-side.$q$,
$q$Load -> parallel-fetch 16 tables -> filter to "my data" for the employee role -> compute KPI cards, monthly trend charts, a burn-rate watchlist, department/project health scorecards, payment/resource/procurement flow diagrams, and a simple 3-month spend forecast, entirely client-side -> user can switch the Day/Week/Month/Year period filter to recompute period-scoped KPIs from cached raw data without re-fetching -> click through KPI cards, department cards, or project rings to jump to the relevant module.$q$,
$q$- Fetches 16 tables in parallel on load/role change: expense_requests, travel_requests, vendors, projects, assets, purchase_requisitions, invoices, time_logs, leave_requests, resource_rates, profiles, device_instances, products, customers, budgets, departments
- Employee role view is scoped to "my data" only (expenses, travel, hours, leave filtered to the current user)
- Role-specific hero banner (gradient + emoji + title) for 10 distinct roles, falling back to the employee hero for unknown roles
- Day/Week/Month/Year period filter (finance/manager roles) recomputed client-side against cached raw data, no re-fetch
- Burn Rate Watchlist (manager/department_head/finance): top 5 at-risk projects spending faster than their elapsed timeline pace
- Department Bird's-Eye View (CEO/admin): per-department health ring gauge (over/risk/healthy/unknown), headcount, hours logged, pending expense+leave count, sorted worst-first
- Project Health ring-gauge strip: budget-utilization % per project (over >100% / risk >=70% / healthy), sorted worst-first, top 8
- Two Sankey-style flow diagrams (CEO/admin): Payment Flow (Allocated -> Committed/Available) and Payment Flow Settlement (Committed -> Spent/Still Committed)
- Resource Flow diagram: team hours split across top 5 projects by hours logged, plus an "Other Projects" bucket
- Procurement Flow diagram: total PRs split into Draft/In Review/Approved/Rejected/Cancelled
- 3-month spend forecast (finance/CEO): rolling 3-month average with a +5%/month compounding projection, actual-vs-forecast line chart
- Top Contributors leaderboard: top 5 employees by hours logged
- Device fleet breakdown (procurement_lead/pm/cto/CEO): deployed/in-storage/needs-attention/decommissioned, plus warranty-expiring-within-30-days count
- Procurement pipeline bar chart: pending counts at each review stage
- Role-gated Quick Actions panel and clickable KPI cards deep-linking into the relevant module
- Check-in widget embedded at the top of every non-CEO/admin dashboard
- Staff-by-role and leave-by-type charts (HR/CEO/admin), Project Budget vs Actual Spend bar chart (manager/PM/CEO/admin, top 6 by budget)$q$,
'expense_requests, travel_requests, vendors, projects, assets, purchase_requisitions, invoices, time_logs, leave_requests, resource_rates, profiles, device_instances, products, customers, budgets, departments',
ARRAY['expenses','travel','timesheet','leave','approvals','projects','vendors','assets','resources','devices','procurement','users','budget','fundflow','invoices','products','customers','reports'],
$q$This is the aggregation hub for the whole app: it reads from nearly every module and links out via KPI cards, but does not own any table itself.$q$,
1),

('knowledge-base', 'Overview', 'Knowledge Base',
$q$This page. A living reference documenting every module in the app — description, a complete feature checklist, real flow, the tables it owns, and how it links to everything else — editable by admin/CEO directly from the UI.$q$,
$q$Load -> fetch all rows from kb_modules ordered by section/sort_order -> auto-select the first module -> user searches/browses the sidebar -> selecting a module renders its description/features/flow/tables/links/notes -> admin/CEO can click Edit to open a form and Save, which updates the row and refreshes local state.$q$,
$q$- Two-pane layout: sticky left sidebar with search + section-grouped module list, right pane with full detail
- Live search filters modules by label or description substring
- Detail pane renders description, a checklist-style Features list, a Flow text block, Primary Tables as pill chips, and clickable Linked Modules chips that jump to the linked module
- Notes shown as a distinct amber-highlighted callout when present
- Edit button (admin/ceo only) opens a modal to edit description, features (one per line), flow, primary_tables, notes, and linked_modules (checkbox grid)
- Save persists via updateKbModule(), stamping updated_by/updated_at, and merges the change into local state
- Empty state prompts running the seed migration if kb_modules has no rows yet$q$,
'kb_modules',
ARRAY[]::TEXT[],
NULL,
2),

('expenses', 'Expenses & Travel', 'Expenses',
$q$Employee expense claims (title, amount, category, date, optional linked project, optional receipt upload) that route through a role-based, DB-configurable multi-step approval chain, with immediate project-budget deduction on submission.$q$,
$q$submitted -> manager_review -> ceo_review -> finance_review -> approved (or rejected at any step, with an optional reason). The exact chain depends on the submitter's own role (employee/manager/finance/hr/department_head chains differ). If a project is linked, the amount is deducted from that project's budget immediately on submission, and submission is blocked if it would exceed the remaining budget.$q$,
$q$- New Expense form: title, amount, category (10-option dropdown), date, optional project link, description, optional receipt upload (pdf/png/jpg/jpeg/doc/docx)
- Blocks submission if the amount exceeds the linked project's remaining budget
- Receipt uploaded to Supabase Storage bucket "invoices" under receipts/{userId}/{expenseNumber}_{filename}
- Auto-generates a sequential expense number via nextNum('expense')
- Immediately increments the linked project's spent field by the claim amount at submit time
- Employees see only their own expenses; other roles see all
- "YOUR APPROVAL FLOW" banner showing the submitter's own role-specific chain
- Multi-step approval chain resolved per submitter role, DB-configurable via Settings -> Approval Chain, falling back to hardcoded defaults
- Stats row: Total, Pending, Approved, Rejected, total approved value
- Status filter pills with live counts; search by title/expense number
- Per-row Approval Chain visualization (compact)
- Role-gated Review button, shown only when the current user's role matches the pending step
- Approve/Reject writes an audit entry to approval_logs alongside the status update
- Rejection allows an optional reason; approval advances to the next step and stamps the relevant *_approved_by/*_approved_at fields
- Employees can delete their own expense only while still "submitted"
- Detail modal: full record, attachments, chain progress, chronological approval history log
- Review modal previews "Approve -> moves to X review" or "Final Approval" before committing
- Admins can act on any expense regardless of status$q$,
'expense_requests, approval_logs, projects, profiles, approval_chains, approval_chain_steps',
ARRAY['approvals','travel','projects','settings'],
NULL,
1),

('travel', 'Expenses & Travel', 'Travel Requests',
$q$Business travel requests (route, dates, mode of transport, purpose, estimated cost, optional linked project) using the exact same DB-configurable approval engine and project-budget-deduction behaviour as Expenses, as a table view without file attachments.$q$,
$q$submitted -> manager_review -> ceo_review -> finance_review -> approved/rejected, identical mechanics to Expenses (same approvalFlow.js engine, chain resolved by the requester's own role). If a project is linked and a cost is entered, budget is deducted at submission and submission is blocked if it would exceed remaining budget.$q$,
$q$- New Travel Request form: From/To location, Travel Date (required), Return Date (optional), Travel Mode dropdown, Estimated Cost (optional), optional Project link, Purpose (required)
- Blocks submission if estimated cost exceeds the linked project's remaining budget
- Immediately increments the linked project's spent field on submission
- Auto-generates a sequential request number via nextNum('travel')
- Employees see only their own requests; other roles see all
- "YOUR APPROVAL FLOW" banner (shares approvalFlow.js engine with workflow='travel')
- Stats row: Total, Pending, Approved, Rejected
- Search by from/to location or purpose
- Table shows route, linked project, mode, dates, cost, requester, status, compact chain viz
- Role-gated Review button, approve/reject writes to approval_logs and advances/stamps approver fields identically to Expenses
- Employees can delete their own request only while "submitted"
- Detail modal with full approval chain viz; Review modal previews the next chain step before committing$q$,
'travel_requests, approval_logs, projects, profiles, approval_chains, approval_chain_steps',
ARRAY['approvals','expenses','projects','settings'],
NULL,
2),

('approvals', 'Expenses & Travel', 'Approvals',
$q$A unified reviewer inbox aggregating four request types (Expenses, Travel, Purchase Requisitions, and Invoices) into one tabbed queue, reusing the same approvalFlow.js/procurementApproval.js engines as the individual module pages so review decisions here stay consistent with decisions made on those pages directly.$q$,
$q$Loads all four tables in parallel -> the Pending tab shows strictly-submitted expenses/travel plus any-review-stage procurement plus uploaded invoices (finance/admin/ceo only) -> reviewer approves/rejects inline or opens the detail modal to add a comment first -> action updates the source table's status via the appropriate approval engine, logs to approval_logs (except invoices), and for approved procurement also commits the requisition amount to its budget -> list reloads.$q$,
$q$- Five tabs with live counts: Pending (aggregate), Expenses, Travel, Purchase Req., Invoices
- Pending tab surfaces expenses/travel only at status "submitted"; procurement uses the full review-status set (procurement_lead_review through ceo_review); invoices only for finance/admin/ceo at status "uploaded"
- Header summary chips showing live pending counts for Expenses/Travel/Procurement
- Per-row Eye icon opens detail modal; Approve/Reject appear inline only when isReviewable() is true for that role/status/type
- isReviewable dispatches to the correct engine per type: canActOnSync (expense/travel), procCanActOnSync (procurement, keyed by chain_type), or a hardcoded finance/admin/ceo + status check (invoice)
- Approving a procurement item also commits the requisition amount against its budget
- Expense/travel approve-reject reuses buildApprovalUpdate from approvalFlow.js; procurement reuses procBuildApprovalUpdate; invoices use a direct status update (no approval_logs entry for invoices)
- Reviewer comments field, passed through as comments on the approval_logs insert (expense/travel/procurement)
- Detail modal dynamically renders type-specific fields (Category/Date for expenses, From/To for travel)
- Warms both approval-chain caches on mount so chain-dependent buttons render correctly on first paint
- Row-level Reject/Approve buttons skip the modal and act directly with no comment$q$,
'expense_requests, travel_requests, purchase_requisitions, invoices, approval_logs, budgets, profiles',
ARRAY['expenses','travel','procurement','invoices','budget'],
$q$This page owns no table of its own; it reads and writes directly into each source module's table.$q$,
3),

('projects', 'Operations', 'Projects',
$q$The central project hub: full project CRUD (with reserved/contingency budget) plus, per project, milestones, software/hardware/support cost line-items, resource allocations (both legacy hour-based and Phase-1 percent/date staffing with a Gantt view), change requests, vendor invoice visibility, and a dedicated Finance tab with actual-cost snapshots, burn-rate projection, profit margin, and company-wide Spend Analyzer findings scoped to the project. A configurable markup engine computes cost-to-company vs cost-to-client vs proposal pricing across every cost category.$q$,
$q$Create a project (with optional customer/department/type and reserved budget) -> add milestones (pending -> in_progress -> completed/delayed) with planned/actual dates and budgets -> log software/hardware/support cost items (auto-priced client x1.3 / proposal x1.5) -> allocate resources either by hours (legacy) or by %/dates (Resourcing/Gantt) -> raise change requests (draft -> submitted -> under_review -> approved/rejected -> implemented) -> bill completed milestones into Customer Invoices -> Finance tab recomputes actual cost, burn rate, and margin on demand, cross-referencing company-wide Spend Analyzer findings.$q$,
$q$- Project list: stat cards, filters (search, status, date range), card grid with per-project utilization bar
- Create/edit: name, customer, department, free-text project_type, status, total/reserved budget with live "Available Now" field, dates, description
- 10-tab project detail: Overview, Milestones, Resources, Resourcing, Software, Hardware, Support, Expenses, Change Requests, Budget (config), Finance
- Overview: Allocated-vs-Spent segmented bar, Milestone Budget vs Spend list, Monthly Cost Trend chart, Full Cost Summary table (company/client/proposal columns)
- Milestones: planned vs actual dates, budget, status, hours-logged progress bar, "Bill" button (finance/admin/ceo) that jumps to Customer Invoices pre-filled
- Software/Hardware/Support cost items: dynamic custom categories, auto-calculated client (x1.3) and proposal (x1.5) cost, qty x unit_price auto-total, optional milestone link
- Resources tab (legacy): allocate hours against a milestone/month/year with idle-hours tracking and a live cost preview from resource_rates
- Resourcing tab (Phase-1): AllocationGantt visual, allocation_percent/hours/role/status table from the allocations table, weekly cost run-rate KPI
- Change Requests: cr_id, title, priority, status workflow, estimated/actual hours and cost, KPI strip
- Budget Config: per-project markup config (client/proposal markup %, toggles), live-computed base/client/proposal totals and margin %
- Finance tab: "Recompute Now", Budget vs Actual card, Burn Rate card (elapsed% vs spend%, daily burn rate, projected exhaustion date), Profit Margin card (role-gated), open vendor Invoices table, Company Context panel linking to company-wide Spend Analyzer findings
- Delete project with typed confirmation (cascades milestones/costs/tasks; expenses/timelogs retained)$q$,
'projects, project_milestones, project_software_costs, project_hardware_costs, project_support_costs, project_resource_alloc, change_requests, allocations, invoices, resource_rates, actual_cost_snapshots, expense_requests, time_logs, customers, departments',
ARRAY['expenses','travel','assets','budget','tasks','allocations','customer-invoices','spend-analyzer','warranty','profit-margins'],
$q$Nearly every other module's project_id foreign key points back here — the FK hub of the app, alongside Users/profiles.$q$,
1),

('tasks', 'Operations', 'Task Management',
$q$Agile task and delivery management scoped to projects: a Kanban board, filterable/groupable list view, epic-grouped user-story tree, sprint tracking with velocity, per-role permission matrix, daily-update comments with inline progress percentage, Excel bulk import, and an analytics Reports tab plus an embedded Custom Dashboards builder. Realtime Supabase subscriptions keep the board in sync across users.$q$,
$q$Create user stories under epics -> break stories into tasks (task/bug/change_request/feature/improvement) -> assign to team members and optionally a sprint -> move through backlog -> todo -> in_progress -> delayed -> qa -> ready_for_demo -> closed via Kanban drag, quick actions, or the status dropdown -> team posts daily-update comments with progress % -> managers track velocity per sprint and completion/on-time metrics in Reports -> per-role permissions are configured once and enforced on every action.$q$,
$q$- Two visibility modes: managers see all tasks in active projects; non-managers see tasks assigned to them plus tasks in projects they're formally assigned to
- 7-state Kanban board with drag-and-drop, per-column KPI card, inline "+ Add task"
- List view: sortable/groupable table (status/assignee/module/priority/sprint), inline status dropdown, overdue highlighting
- Task types (task/bug/change_request/feature/improvement) and story types, each with a distinct badge
- Per-role Permission Matrix modal (managers only): can_view/create/edit/delete/change_status per role, project-scoped or global default
- Access management modal: add/remove team members with a sub-role (member/lead/viewer)
- User Stories view: epic-grouped collapsible tree with per-epic/story progress bars and story-point aggregation
- Sprints view: sprint cards (planning/active/completed), goal, dates, task-count/velocity, manager-only Start/Complete lifecycle buttons
- Task Comments/"Daily Updates": threaded comments with an optional progress slider that writes back to progress_pct
- Task Detail modal with inline status change, overdue flag, progress bar, all linked entities
- Excel/CSV bulk Import Tasks modal scoped to a project
- Realtime sync via postgres_changes on project_tasks, with a visibility-change fallback reload
- Notifications on assignment, re-assignment, and status change
- Reports tab: Completion Rate, On-Time Delivery %, Overdue count, Hours Logged, Status/Priority/Type distribution charts, per-Project Progress, Resource Utilization leaderboard, Change Request Summary per project
- Custom Dashboards tab: embedded drag-and-drop dashboard builder bound to the selected project and date range$q$,
'project_tasks, user_stories, sprints, epics, task_role_permissions, task_comments, project_assignments, change_requests',
ARRAY['projects','neo-task-ai'],
$q$Shares project_tasks and user_stories directly with Neo Task AI: AI-generated items land here with an explicit back-reference to the AI session that created them.$q$,
2),

('neo-task-ai', 'Operations', 'Neo Task AI',
$q$LLM-driven requirements-to-backlog generator: paste or upload a requirement document (optionally linked to a project), pick a model (DeepSeek V3, Gemini 2.5 Pro, Ollama local, or Claude Opus 5), and the AI drafts user stories with Given/When/Then acceptance criteria, a prioritized backlog, typed implementation tasks with validation/security/performance notes, Gherkin test cases, and REST API specs — all reviewable and inline-editable before a one-click import into Task Management.$q$,
$q$Upload or paste a requirement document (optionally linking a project) -> pick a model -> an ai_analysis_sessions row is created and the LLM's structured JSON response is parsed and persisted across 5 staging tables (stories, backlog, tasks, test_cases, apis) -> review/edit each item inline, rejecting/restoring as needed -> "Import to Project" batch-inserts approved stories and tasks into Task Management's user_stories and project_tasks, marks staging rows imported with back-links, and stamps the session as imported.$q$,
$q$- Home screen: KPI strip and Analysis History table (document, model, linked project, status, story/task/test-case counts)
- Upload screen: drag-and-drop (.txt/.md; PDF/DOCX prompt to paste text), document name, optional project link, live character/token count
- 4-model selector cards (DeepSeek V3, Gemini 2.5 Pro, Ollama Local, Claude Opus 5) — disabled when the required API key is missing
- Ollama-specific model-name input, with a local-server reminder
- Analyzing screen: live token-streaming progress for Ollama; a 6-step pulsing sequence for cloud models
- Results screen with 6 tabs: User Stories, Backlog, Tasks, Test Cases, APIs, Sprint Plan, each badge showing live item count
- User Stories tab: inline-editable capability text, Given/When/Then acceptance criteria, negative/edge/security ACs, reject/restore toggle
- Backlog tab: inline-editable title/description/priority/business value/points, reject/restore
- Tasks tab: type-color-coded badge (FE/BE/DB/API/INT/FW/QA/DEVOPS), inline-editable description/validation/error-handling/security/performance notes, dependency chips
- Test Cases tab: Given/When/Then table, test type, priority
- APIs tab: method-colored badge, endpoint, formatted request/response JSON preview
- Sprint Plan tab: auto-groups items into Sprint 1/2/3 buckets with a project summary tile grid
- "Import to Project": batch-inserts non-rejected stories/tasks with generated task IDs, marks staging rows imported and back-linked
- Unified LLM abstraction (src/lib/llm.js): OpenAI-compatible chat for DeepSeek/Gemini, native streaming for Ollama, Anthropic Messages API for Claude
- Robust 3-strategy JSON parser tolerates LLM formatting inconsistencies
- DB-saved API keys (Settings) take priority over VITE_*_API_KEY env vars
- Every LLM call is logged via logLLMUsage with provider, model, tokens, latency, success/failure$q$,
'ai_analysis_sessions, ai_generated_stories, ai_generated_backlog, ai_generated_tasks, ai_generated_test_cases, ai_generated_apis, project_tasks, user_stories, llm_usage_logs',
ARRAY['tasks','projects','llm-monitor','settings'],
$q$Every request through this module is logged to llm_usage_logs, visible in LLM Usage Monitor. Shares its LLM_MODELS registry/provider code with Data Assistant.$q$,
3),

('budget', 'Operations', 'Budget',
$q$Finance-owned budget planning by department or project per fiscal year (optionally per month), with allocated-vs-spent tracking, procurement-driven commitment tracking, and a formal, versioned revision/approval workflow for changing an already-set allocation — every revision is preserved in an auditable history rather than overwriting the original figure.$q$,
$q$Finance/admin/ceo sets an allocated amount per department or project (annual or monthly) -> as Procurement PRs are approved, committed_amount accrues against the budget and actual spend accrues elsewhere -> changing an already-set allocated amount requires a revision request with a reason -> a different admin/ceo/finance user approves (writing the new amount) or rejects with a reason (self-approval blocked unless the reviewer is exactly 'admin') -> every revision remains visible in a per-budget audit trail.$q$,
$q$- Budget-line create/edit: Department or Project scope (mutually exclusive), optional category label, fiscal year, optional month, allocated amount with a live monthly-equivalent hint
- Role gate: only admin/ceo/finance can create/edit/delete/revise; others get read-only
- KPI strip: Budget Lines, Total Allocated, Total Spent, Remaining, Utilization %
- Filter pills: type (All/Department/Project), Pending Revisions toggle (finance-only, badge count), fiscal-year selector
- "Budget vs Actual" bar chart for the top 10 filtered lines
- Table: type badge, name, category, period, allocated/spent/remaining (red if overspent), utilization bar (amber >75%, red >100%), per-row edit/revise/history/delete
- Revision workflow: propose a new amount + mandatory reason, auto-incremented revision_number, previous/requested/delta tracked
- Revision history expands inline per row: revision #, delta (colored), reason, requester, status pill
- Approve/reject pending revisions (finance/admin/ceo only); rejecting requires a reason
- Self-approval guard: a user cannot approve their own revision unless role is exactly 'admin'
- Delete budget line with confirm dialog$q$,
'budgets, budget_revisions, departments, projects, approval_logs',
ARRAY['projects','procurement','spend-analyzer'],
$q$This budgets table (by department/project/fiscal year) is a distinct concept from the budget/spent columns Expenses/Travel/Projects mutate directly on the projects table — the two are not reconciled. committed_amount/spent on budgets are written by Procurement (src/lib/budgetSync.js), not by this page.$q$,
4),

('assets', 'Operations', 'Assets',
$q$Company asset register (laptops, vehicles, equipment, etc.) with lifecycle status tracking and optional assignment to an employee and/or project. Auto-generates a sequential asset code on creation.$q$,
$q$purchased -> assigned -> returned -> scrap (settable directly, not a strictly enforced linear progression).$q$,
$q$- List table: code, name, category badge, linked project, purchase value, status badge, assigned-to, row actions
- Status filter pills (purchased/assigned/returned/scrap) with live counts
- Search by name, serial number, or asset code
- Role gate: admin/ceo/finance/manager can add/edit/delete; others read-only
- Add/Edit fields: name, category (10-option dropdown), make/model, serial number, purchase value/date, warranty expiry, assigned-to employee, status, optional project link, location, notes
- asset_code auto-generated via nextNum('asset') on create, preserved on edit
- Detail modal: full read-only field grid plus notes
- Delete with confirmation dialog$q$,
'assets, profiles, projects',
ARRAY['projects'],
NULL,
5),

('skill-matrix', 'Resourcing', 'Skill Matrix',
$q$Self-service employee skill profile with manager endorsement: employees rate their own proficiency on skills from a shared, categorized catalog, and their direct manager reviews and endorses (optionally adjusting) each claim. Admin/CEO/HR can bulk-import skill assignments via Excel.$q$,
$q$Employee adds a skill (choosing from the categorized catalog), rates proficiency (Beginner/Intermediate/Expert/Master), optionally logs years of experience and certification -> saved as unendorsed -> appears in the direct manager's Endorsements queue -> manager reviews, optionally adjusts the level, and endorses -> card shows "Endorsed by {manager}". Editing an already-endorsed skill resets it to pending and re-queues it.$q$,
$q$- "My Skills" tab: grid of skill cards for the logged-in employee
- "Endorsements" tab (only for users with direct reports): pending-count badge in the tab label
- Add Skill: skill dropdown grouped by category with search, proficiency, years of experience, "Certified" checkbox
- Editing an existing skill locks the skill_id field; only proficiency/years/certified are editable
- Warning shown when editing an already-endorsed skill: saving resets endorsement, requiring re-approval
- Upsert on (employee_id, skill_id); editing clears endorsed_by/endorsed_at
- Proficiency levels each get a distinct color for the card border/badge
- Card shows years of experience (if >0), certified badge, endorsement status (green "Endorsed by X" or amber "Pending")
- Endorsement lets the manager confirm or adjust proficiency before endorsing
- Pending endorsements scoped strictly to the manager's direct reports
- Bulk "Import Skills" (admin/ceo/hr only) via the shared ExcelImport component$q$,
'skills, employee_skills, profiles',
ARRAY['capacity','allocations','users'],
$q$Skills/employee_skills also feed Capacity's bench-report skill filter.$q$,
1),

('allocations', 'Resourcing', 'Allocations',
$q$Resource-to-project staffing request workflow with percentage- and hours-based allocation tracking, role-gated request/approval, and an overlap-aware over-allocation guard that requires an explicit override with written justification. Allocation hours/week are auto-derived from the employee's default weekly capacity and the requested percentage.$q$,
$q$A qualifying role submits a staffing request for an employee/project/date-range/% -> a live conflict check flags any date-overlapping allocations that would push the employee over 100% committed, forcing an explicit override + justification -> request lands in the employee's direct manager's Approvals queue -> manager approves (conflict re-checked at approval time) or rejects with a required reason -> approved rows become approved/active and feed Capacity's utilization calculations; requester and manager are notified at each stage.$q$,
$q$- 4 KPI cards: Total, Pending, Active, Closed — scoped to all allocations for admin/ceo/hr/cto, "my allocations" otherwise
- Tabs: My Allocations, Request (request-capable roles), Approvals (badge count, direct reports only), All Allocations
- Request form: employee, project, allocation %, role on project, start/end dates
- Inline warning if the employee has no reporting_manager_id set
- Live over-allocation conflict check on every change (employee/dates/percent), listing overlapping allocations and committed vs projected %
- Override mechanism: checkbox + required justification textarea, submit blocked until both are satisfied when a conflict exists
- Allocation hours/week auto-computed from percent x default_weekly_capacity_hours (40h fallback)
- Notifies the employee's manager on submit; approve/reject notifies the requester
- Approve re-runs the conflict check at approval time with a confirm-dialog escape hatch
- Reject requires a reason via modal
- Status via shared StatusBadge (requested/approved/active/rejected/cancelled)
- Role gates: canRequest (admin/ceo/pm/manager/department_head), isViewAll (admin/ceo/hr/cto)$q$,
'allocations, projects, profiles',
ARRAY['projects','capacity','skill-matrix','users'],
$q$Feeds directly into Capacity's weekly capacity_snapshots computation. AllocationGantt (shared component) is reused on the Capacity page for utilization and bench drill-down views.$q$,
2),

('capacity', 'Resourcing', 'Capacity',
$q$Workforce capacity, bench, and burnout monitoring built on a weekly capacity_snapshots table recomputed from each active employee's approved/active allocations, approved leave, holidays, and default weekly hours. Provides a personal utilization trend, a manager-facing department aggregate view, and a filterable bench/burnout report with per-employee drill-down.$q$,
$q$On page load, recomputeAllActive() derives capacity_snapshots per active employee per week (4 weeks back, 12 forward) from Allocations, Leave, and Holidays -> user sees their own utilization trend and allocation Gantt on "My Utilization" -> if manager/hr/admin/ceo/department_head, can switch to Department Aggregate (bar chart of avg utilization per department per week) or Bench Report (filterable/sortable team table flagged bench/burnout against configurable thresholds) -> clicking an employee row drills into their allocation Gantt.$q$,
$q$- Auto-recompute on mount for all active employees across a rolling 4-past/12-future week window
- Manual "Recompute Now" button
- Utilization = allocated_hours / max(available_hours - leave_hours, 0), clamped to a sentinel 999% if fully unavailable but still allocated
- Leave-hours handles both hourly "permission" leave and day-range leave, only counting approved leave, excluding weekends and holidays
- Tabs: My Utilization (everyone), Department Aggregate + Bench Report (manager-tier only, bench-risk count badge)
- My Utilization: Recharts trend of utilization %, personal AllocationGantt (10-week paginated)
- Department Aggregate: week navigator, bar chart color-coded burnout/bench/normal per department
- Bench Report: 3 KPI cards (Bench Risk, Burnout Risk, Total Tracked), configurable bench/burnout thresholds persisted to capacity_settings, sortable table with search/department/skill filters, click-to-drill-down into an employee's own Gantt
- Skill filter cross-references employee_skills to find employees with a given skill$q$,
'capacity_snapshots, capacity_settings, allocations, leave_requests, holidays, profiles, departments, skills, employee_skills',
ARRAY['allocations','skill-matrix','leave'],
NULL,
3),

('customers', 'Procurement', 'Customers',
$q$Simple CRUD directory of customer accounts with dual card/table views, quick stats, and free-text search. Captures identity/contact info, GST number, an active/inactive status flag, and notes — no approval workflow.$q$,
$q$Click Add Customer -> fill required Name plus optional industry/contact/address/GST/notes -> Save auto-generates a CUS-###### code -> customer immediately becomes selectable wherever customers are referenced (e.g. Devices' Customer dropdown).$q$,
$q$- Card/Table view toggle; stat row: Total, Active, Inactive, distinct Industries
- Search filters by name, industry, or city
- Card view: avatar circle, status badge, industry chip, contact/phone/email/city, GST pill
- Add/Edit fields: Name (required), Industry, Contact Person, Email, Phone, City, Address, GST Number, Status (active/inactive), Notes
- Auto-generated code (CUS-######) and created_by stamp on insert
- Role-gated create/edit/delete (admin/ceo/manager/department_head/finance/procurement_lead)
- Delete requires confirmation dialog
- Binary status only (active/inactive) — no "blacklisted" state, unlike Vendors$q$,
'customers',
ARRAY['devices','customer-invoices'],
NULL,
1),

('vendors', 'Procurement', 'Vendors',
$q$CRUD directory of suppliers with dual card/table views. Captures contact info, a fixed 9-category taxonomy, GST/PAN, banking details, configurable payment/credit terms, and a 1-5 star rating. Status supports a third "blacklisted" state beyond active/inactive.$q$,
$q$Add Vendor -> fill Basic Information (name, category, contact) -> fill Tax & Banking (GST, payment terms, bank details, rating) -> Save auto-generates a VEN-###### code -> vendor becomes selectable wherever vendors are referenced (Procurement, Purchase Orders, Invoices, Fund Flow).$q$,
$q$- Card/Table toggle, same pattern as Customers
- Fixed 9-category taxonomy (Technology, Manufacturing, Services, Logistics, Healthcare, Finance, Construction, Retail, Other)
- Star rating (1-5) shown on cards and table
- Add/Edit sectioned into "Basic Information" and "Tax & Banking"
- Basic: name, category, contact person, email, phone, city, address
- Tax & Banking: GST number, payment terms (days), bank name, account number, IFSC code, rating (1-5)
- Status: Active / Inactive / Blacklisted
- Role gate for create/edit/delete: admin/ceo/manager/finance/department_head
- Delete requires confirmation dialog; created_by stamped on insert$q$,
'vendors',
ARRAY['procurement','pos','invoices','fundflow'],
$q$The hub vendor record referenced throughout the whole procurement chain.$q$,
2),

('products', 'Procurement', 'Products',
$q$Device and part catalog: part number, a fixed device-type taxonomy, default warranty duration, reorder thresholds, and standard cost. The is_serialized flag decides whether individual units of a product get tracked as serialized Device Instances; warranty_months doubles as the fallback warranty duration the Warranty engine uses when no explicit Warranty Policy exists for that part number.$q$,
$q$Add Product -> part number auto-generated if left blank -> set Device Type, Standard Cost, Warranty (months), Reorder Level/Qty, optional spec sheet -> toggle is_serialized to enable per-unit tracking -> Save -> product becomes selectable in Devices' Product dropdown, and its warranty_months becomes the default warranty length wherever no explicit Warranty Policy exists.$q$,
$q$- Table view only (no card mode); stat row: Total, Active, Serialized (Tracked), distinct Device Types
- Fixed 11-option Device Type taxonomy (IoT Logger, Temperature/Humidity/Pressure Sensor, Gateway, Flow Meter, GPS Tracker, Vibration Sensor, Camera Module, Power Meter, Other)
- Search + Device Type filter, combinable
- Add/Edit fields: Part Number (auto-generated if blank), Name, Device Type, Standard Cost, Warranty (months), Status (active/discontinued), Reorder Level/Qty, Spec Sheet, is_serialized checkbox
- Role gate for create/edit/delete: admin/ceo/manager/department_head/finance/procurement_lead
- Delete with confirmation; created_by stamped on insert$q$,
'products',
ARRAY['devices','warranty','procurement'],
NULL,
3),

('devices', 'Procurement', 'Devices',
$q$Serialized device instance registry: each physical unit tracked by serial number, linked to a product and optionally a customer/project/assigned user, through a 5-state lifecycle with a current location. Registering a device with an Installed Date — or moving one to "deployed" — automatically computes and activates a warranty window, and every move/redeploy is logged to deployment_history.$q$,
$q$Register a device (Product + Serial Number required) -> optionally set an Installed Date, which auto-computes Warranty Start/End from the selected Policy (or the product's default warranty_months) and best-effort activates a device_warranties record -> device appears with live Age/Claim Value columns -> Move/Redeploy to a new project/customer/status (reason required) logs a deployment_history entry and, if the new status is "deployed," activates or refreshes the warranty clock -> View History shows the full move timeline; View Warranty jumps into Warranty's Claims tab pre-filtered to this device.$q$,
$q$- Stat row: Total, Deployed, In Storage, Needs Attention (faulty+replaced), Decommissioned, Warranty <=30 days
- Search by serial/device code/product; Status filter (5 states)
- Live per-row Age/Claim Value computed from device age, applicable Warranty Policy, depreciation tiers, and product standard cost (falls back to 100% claim if no policy/tiers)
- Register Device modal: Product, Serial Number, Warranty Policy, Installed Date (auto-fits warranty window), Customer, Project, Status, Location, Assigned To, manually overridable Warranty Start/End, Notes
- Selecting a Product auto-applies its Warranty Policy; changing Installed Date/Policy live-recomputes the window
- Auto-generated device code (DEV-######); best-effort device_warranties activation on create if an Installed Date is present
- Move/Redeploy modal: new Project/Customer/Status, mandatory Reason, warranty-policy picker + live end-date preview when moving to "deployed"
- Deployment History modal: full move timeline with reason/mover/date
- "View Warranty" deep-links to /warranty?tab=claims&device={id}
- Role gate for create/edit/move/delete: admin/ceo/manager/department_head/procurement_lead/pm$q$,
'device_instances, deployment_history, products, customers, projects, profiles, warranty_policies, warranty_depreciation_tiers, device_warranties',
ARRAY['products','warranty','customers','projects'],
NULL,
4),

('warranty', 'Procurement', 'Warranty',
$q$The full warranty subsystem: device-level warranty lifecycle, claim intake with an age-based depreciation-adjusted claim-value calculator, a configurable PM -> CEO -> Finance approval chain (skippable below an auto-approve cost threshold), four resolution paths (Replace/Repair/Remote Fix/Reject) each with its own cost-booking behavior, and finance-grade configuration (policies, depreciation tiers, budgets/reserves) plus analytics rollups — all gated by role, with cost figures restricted to Finance/Admin/CEO.$q$,
$q$Reported (claim logged via serial-number search + issue description) -> auto-branch by estimated cost against the auto-approve threshold: below threshold skips straight to Approved; at/above threshold enters the review chain at PM Review -> CEO Review -> Finance Review -> Approved -> Resolve action chosen (Replace deploys a fresh in-storage unit and starts a new warranty window / Repair logs cost with warranty unchanged / Remote Fix logs a no-truck-roll cost / Reject books no cost) -> Resolved (or Rejected, terminal, at any review step or directly for out-of-warranty claims).$q$,
$q$- Tabs: Overview, Claims (badge count), and (admin/ceo/finance only) Policies, Budgets, Settings; field technicians see only Claims
- Overview KPIs: Active Claims, Claims This Month, Claim Rate per 100 units, and (cost-visible roles) Avg Cost/Claim, Planned Reserve, Actual Warranty Cost
- "By Product Type" table: units deployed, claims, claim rate, avg time-to-failure, and (cost roles) hardware/software cost, reserve variance
- "Recompute Now" manually triggers analytics rollup + findings generation; also runs automatically on load for cost-visible roles
- New Claim: live serial-number search/autocomplete, warranty-status preview, auto-computed age-based claim-value preview (editable), Issue Type dropdown, required description
- Out-of-warranty claims are still logged (not dropped) as Rejected-Out of Warranty with 0 cost
- Claim chain branching: cost vs claim_auto_approve_threshold (default 25,000) decides short (auto-Approved) vs full (PM->CEO->Finance) chain
- Approval chain is DB-configurable (approval_chains/approval_chain_steps), with a hardcoded 3-step fallback
- Approve/Reject gated by canActOnClaim (admin bypasses all steps); rejection requires a reason, is terminal — no resubmit flow
- Resolve modal (once Approved): Replace (deploys a replacement in-storage unit, logs deployment history, starts a fresh warranty window per the policy's "fresh on replacement" flag, books a Hardware cost entry), Repair (logs Hardware cost, warranty unchanged), Remote Fix (logs Software cost, no truck roll), Reject (no cost, reason recorded)
- Device Warranty Trace panel: walks the full device chain (including forward through Replace-chain devices), warranty windows, claims, cost totals, inline chain visual
- Policies tab: CRUD warranty policies (duration, coverage type, HW/SW covered, fresh-on-replacement, active) with an Age-Based Claim Depreciation tier editor
- Budgets tab: warranty budgets scoped to a product type or project, planning method (flat/% of unit cost/% of revenue), Planned vs Actual Reserve variance table
- Settings tab: claim auto-approve threshold, near-expiry alert window, default fresh-warranty-on-replacement toggle
- Role-based cost visibility (admin/ceo/finance) gates all rupee figures app-wide in this module
- Deep-linkable via ?tab=claims&device={id}$q$,
'warranty_claims, device_warranties, warranty_policies, warranty_depreciation_tiers, warranty_budgets, warranty_cost_entries, warranty_settings, device_instances, deployment_history, approval_chains, approval_chain_steps',
ARRAY['devices','products','spend-analyzer','projects','settings'],
NULL,
5),

('procurement', 'Procurement', 'Purchase Req.',
$q$Purchase Requisition creation and a condition-branched, DB-configurable multi-step approval chain, tied to a project and a budget line, with live budget-availability checking at both creation time and the finance-review gate. The chain type (full vs short) is decided automatically from request type and estimated total.$q$,
$q$draft -> procurement_lead_review -> pm_review -> (full chain only) cto_review -> finance_review (blocks on budget shortfall unless an override with justification is supplied) -> ceo_review -> approved. Rejection at any step resets status to draft with a stamped rejection_reason for resubmission. Approval commits the amount to the budget's committed_amount; cancellation of an approved request releases it back. The full 5-step chain applies only to Production/Post-Production requests at or above the cost threshold (default 100,000); everything else uses the short 2-step chain (Procurement Lead -> PM).$q$,
$q$- New Request: 3-way Request Type picker (Production/Post-Production/On-Demand); required title/project/budget line/line items
- Dynamic line-item table: catalog pick or free text, quantity, unit cost, computed line total, add/remove rows
- Project picker auto-resolves the budget line when exactly one matches; live budget snapshot (Allocated/Committed/Available) with an over-budget warning
- Optional fields: category, priority, preferred vendor, required-by date, justification; "Demand Reference" shown only for On-Demand
- Approval chain steps DB-configurable via Settings, with automatic fallback to hardcoded defaults; cached and warmed on page load
- Live approval-chain preview in the create modal before submission
- Role-gated Review: only the role matching the current pending step can act (admin always can; CEO step restricted to 'ceo')
- Finance-step budget-overrun check on approval: blocks unless an "Override" checkbox + required justification is provided
- Reject resets to draft with a rejection_reason (shown as a red banner)
- Approve commits the estimated total against the budget's committed_amount; each step stamps its own approved_by/approved_at
- Cancel (approved only, admin/ceo/finance/procurement_lead) releases the committed budget, confirm dialog
- Visual chain-step widget (compact and full-size) showing done/active/pending states
- Stat cards: Total, Pending, Approved, Cancelled, Total Value; search by title/PR number$q$,
'purchase_requisitions, purchase_requisition_items, approval_logs, budgets, vendors, products, approval_chains, approval_chain_steps',
ARRAY['vendors','budget','pos','approvals','settings'],
$q$An approved requisition is meant to become a Purchase Order, but no create-UI for Purchase Orders exists anywhere in the app — PO rows must originate from another process (no code path here converts an approved PR into a PO automatically).$q$,
6),

('invoices', 'Procurement', 'Invoices',
$q$Vendor invoice intake with optional document upload, an automated 3-way match against a linked Purchase Order (preferring the GRN received-amount when available, falling back to the PO total), and running payment recording that only flips the invoice to "paid" once fully covered. Match variance tolerance is configurable centrally and overridable per-invoice with a mandatory justification.$q$,
$q$uploaded -> processing -> verified -> (matched via automated 3-way match, or rejected) -> paid. Manual status transitions are available directly from the table for finance/admin/ceo; match_status is a separate field driven by "Run Match" (unmatched/matched/variance/override_approved), not the workflow status. A variance match can be manually overridden with a required justification note. Payments accumulate against an invoice and status only flips to paid once total payments cover the invoice total.$q$,
$q$- Add/Edit modal (admin/ceo/finance): invoice number, total amount, vendor dropdown or free-text fallback, PO dropdown (filtered by vendor) for 3-way match
- Auto-computed Total = Subtotal + GST as the user types
- File upload to Supabase Storage bucket "invoices" with a sanitized timestamped filename
- Status dropdown limited to editable statuses (matched excluded — driven only by the match engine)
- Inline status-change dropdown in the table row (finance/admin/ceo only)
- Stat cards: Total Invoices, Total Value, Paid, Pending; status filter pills; search by invoice #/vendor
- Overdue due-date highlighting for unpaid invoices past due
- Match-status badge (Unmatched/Matched/Variance/Override Approved)
- "Run Match" (finance/admin/ceo, requires a linked PO): compares invoice total against GRN received_amount (or PO total as fallback), computes variance %, flags matched if within tolerance (default 5%, DB-configurable) else variance
- Override flow: justification input + Override button sets match_status to override_approved
- Payments panel: lists all recorded payments; payment recording form (amount, date, method, reference) hidden once paid/rejected
- Recording a payment re-sums total paid and flips status to paid once fully covered (no "partially_paid" state for vendor invoices)$q$,
'invoices, payments, vendors, projects, purchase_orders, grn, finance_settings',
ARRAY['vendors','pos','grn','payments','aging-report','spend-analyzer'],
NULL,
7),

('fundflow', 'Procurement', 'Fund Flow',
$q$A vendor-centric, read-only dashboard of invoice payment-status flow (paid/processing/pending/rejected) plus an expense-reimbursement summary — aggregated entirely client-side from vendors, invoices, and expense_requests, with no writes on this page at all.$q$,
$q$This page has no workflow of its own — it is a read-only rollup of statuses already driven elsewhere. Invoices flow through uploaded -> processing/verified/matched -> paid/rejected (set on the Invoices page); expenses flow through draft -> submitted -> approved (set on the Expenses page). Fund Flow simply buckets and totals those existing statuses per vendor and overall.$q$,
$q$- 6-tile KPI banner: Total Invoiced, Paid Out, In Processing, Pending Review, Exp. Approved, Exp. Pending
- Stacked bar chart of top 10 vendors by total invoice value, split Paid/Processing/Pending/Rejected
- Donut chart of overall payment-status breakdown with a value-labeled legend
- Detailed vendor fund-flow table: per-vendor status split, invoice count, category badge, running total, proportional mini-bar
- Expense Reimbursement Flow: Released/Awaiting Approval/Draft summary cards
- All aggregation done client-side from three parallel Supabase selects, active vendors only$q$,
'vendors, invoices, expense_requests',
ARRAY['vendors','invoices','spend-analyzer'],
$q$Despite the name, this page does not show the full Budget -> Committed -> PO -> GRN -> Invoiced -> Paid chain — only the Invoiced -> Paid segment plus a separate expense summary. That fuller chain exists separately in src/lib/fundFlow.js and is actually surfaced inside Spend Analyzer's Fund Flow tab, not here.$q$,
8),

('pos', 'Procurement', 'Purchase Orders',
$q$Read-only listing and detail view of Purchase Orders, each linked back to its originating Purchase Requisition and to vendor contact/GST details. There is no create or edit capability anywhere in this page — POs must be inserted outside the app and this page only displays and filters them.$q$,
$q$draft -> sent -> acknowledged -> delivered -> closed (or cancelled at any point). This status set is only ever displayed, never transitioned from within this page.$q$,
$q$- KPI strip: Total POs, Total Value, Sent, Delivered, Cancelled counts
- Status filter pills (6 statuses) with live counts; search by PO number or vendor name
- Table: PO Number, Vendor (avatar+name+phone), Linked PR number, Order/Delivery Date, Amount, Status
- Detail modal: Vendor, GST Number, linked PR number/title, dates, Subtotal/GST/Total, conditional Terms and Notes sections
- Purely read-only — no status-change controls, no edit form, no create button anywhere in the page$q$,
'purchase_orders, purchase_requisitions, vendors',
ARRAY['procurement','vendors','grn','invoices'],
$q$Read-only, no create or update UI exists for Purchase Orders anywhere in this codebase.$q$,
9),

('grn', 'Procurement', 'GRN',
$q$Goods Receipt Notes displayed against their originating Purchase Orders and vendors, with a single editable field — received_amount — that feeds directly into the Invoices module's 3-way match as the preferred reference, falling back to the PO's total when no GRN amount has been recorded. Apart from that one field the page is entirely read-only; there is no GRN creation UI.$q$,
$q$pending -> partial -> received -> closed. Like Purchase Orders, this status set is only ever displayed — no button anywhere transitions it.$q$,
$q$- Stat cards: Total GRNs, Pending, Partial, Received, Closed
- Status filter pills with live counts; search by GRN number, PO number, or vendor name
- Table: GRN Number, PO Number, Vendor, Received Date, Status, truncated Remarks
- Detail modal field grid: PO Number, Vendor, Received Date, Status
- Editable "Received Amount" field (admin/ceo/finance/procurement_lead only) — used for 3-way match against the PO and invoice amounts
- Items Received list rendered from a JSON items column when present
- The only write path in the entire module is the received_amount save action$q$,
'grn, purchase_orders, vendors',
ARRAY['pos','invoices'],
$q$The only editable field in the entire GRN module is received_amount — everything else is read-only display with no UI path to change it. This value is consumed by src/lib/threeWayMatch.js as the preferred reference over the PO total.$q$,
10),

('role-rates', 'Finance', 'Role Rates',
$q$A per-designation, effective-dated hourly cost-rate table used as the org-wide fallback for people-cost calculations (Actual Cost, Burn Rate, Resource Flow) whenever an individual employee has no personal rate set. New rates auto-close the prior open-ended rate the day before the new one starts, preserving clean, non-overlapping history per designation.$q$,
$q$Admin/Finance/HR opens Role Rates -> clicks Add Rate -> picks/types a designation (autocompleted from existing profile designations) -> sets hourly rate + effective-from date + optional notes -> Save -> if an open-ended rate for that designation already existed, it is closed the day before the new effective date -> new rate becomes current and is immediately available to rate-resolution for any calculation dated on/after its effective date.$q$,
$q$- Grouped-by-designation accordion; expand to see full rate history
- Current (open-ended) rate shown inline on the collapsed header with a history count
- Expanded history: Rate, Effective From, Effective To ("Current" if open-ended), Notes, delete action
- Add Rate (admin/finance/hr only): free-text designation with datalist autocomplete, hourly rate, effective-from date, optional notes
- Explanatory helper text on the auto-close-prior-rate behavior
- Delete gated behind a confirm dialog warning it may affect historical cost calculations
- Empty state with call-to-action when no rates exist yet$q$,
'role_rates, profiles',
ARRAY['budget','profit-margins','spend-analyzer','resources'],
$q$Consumed by src/lib/roleRates.js's getRateForDesignation(), called from Actual Cost (Profit Margins, Spend Analyzer) and Resource Flow (Spend Analyzer) rate resolution.$q$,
1),

('customer-invoices', 'Finance', 'Customer Invoices',
$q$Accounts-receivable counterpart to vendor Invoices — bills a project, optionally a specific milestone, to a customer, and tracks the invoice through draft -> sent -> partially_paid/paid (or cancelled), with payments recorded and summed from the invoice's own detail view. Creating an invoice against a milestone automatically flips that milestone's billing_status to "invoiced".$q$,
$q$draft -> sent -> partially_paid (as payments accumulate below total) -> paid (once total paid covers total_amount), or cancelled at any point. Billing a milestone (via the modal or a project_id/milestone_id deep link) marks it invoiced on the project the moment the invoice is created, independent of payment status.$q$,
$q$- Stat cards: Total Invoices, Total Value, Paid, Outstanding
- Status filter pills (5 statuses); search by invoice #, customer, or project
- Deep-link support: arriving with project_id/milestone_id query params auto-opens the New Invoice modal pre-filled (e.g. from a milestone's "Bill" button)
- Project selector loads that project's milestones; selecting one pre-fills Total Amount from the milestone's invoice_amount
- Invoice Number auto-generated via nextNum('invoice') when left blank
- Subtotal + GST live-recompute Total Amount, independently overridable after
- Table: Invoice #, Project, Milestone, Customer, Amount, Due Date (red if overdue), Status
- On create with a milestone selected, project_milestones.billing_status is set to 'invoiced'
- Detail modal Payments panel + inline payment-recording form (amount, date, method, reference), hidden once paid/cancelled
- Recording a payment re-sums total paid and auto-transitions to partially_paid or paid$q$,
'customer_invoices, project_milestones, payments, customers, projects',
ARRAY['projects','customers','payments','aging-report','profit-margins'],
NULL,
2),

('payments', 'Finance', 'Payments',
$q$A unified, read-only payment ledger across both vendor payables and customer receivables — every row is written by recordPayment() from either a vendor Invoice's or a Customer Invoice's own detail view; there is no create action anywhere on this page itself.$q$,
$q$A payment is recorded elsewhere (vendor Invoice or Customer Invoice detail view) via recordPayment() -> inserted into payments -> this page's next load picks it up read-only, joined against both invoice tables for display, filterable by type and searchable across invoice/party/project.$q$,
$q$- Stat cards: Total Payments, Paid to Vendors, Received from Customers
- Type filter pills: All / Vendor (Payable) / Customer (Receivable)
- Search by invoice number, vendor/customer name, or project name
- Table: Date, Type badge, Invoice #, Party, signed Amount (red for vendor, green for customer), Method, Reference #, Recorded By
- Joins both invoices and customer_invoices in parallel to resolve invoice/party labels per row
- Empty state explicitly points to recording a payment from an invoice's own detail view$q$,
'payments, invoices, customer_invoices, profiles',
ARRAY['invoices','customer-invoices','fundflow','aging-report'],
$q$No create-UI here — payments are only ever recorded from an Invoice's or Customer Invoice's own detail view.$q$,
3),

('aging-report', 'Finance', 'Aging Report',
$q$Buckets outstanding, unpaid invoices by days-past-due for either vendor payables or customer receivables, using configurable bucket boundaries. Computed live on every view — this app has no scheduled-job layer, so "overdue" is always derived at read time rather than stored as a potentially-stale flag.$q$,
$q$User selects Vendor or Customer -> bucket boundaries are read from finance_settings, then all non-terminal-status rows from invoices or customer_invoices are pulled -> each row is bucketed by days-past-due computed against today's date -> user clicks a bucket tile to drill into that bucket's underlying invoice rows.$q$,
$q$- Toggle between Vendor Payables (AP) and Customer Receivables (AR); switching re-fetches and re-buckets from scratch
- Vendor mode excludes paid/rejected; customer mode excludes paid/cancelled
- Bucket boundaries dynamic, read from finance_settings.aging_bucket_days (default 30/60/90) plus a "current" (not-yet-due) bucket
- Stat cards: Total Outstanding, Overdue (excludes current bucket)
- Bucket tiles with amount, record count, and an escalating color scale (green -> red as buckets age)
- Clicking a tile filters the detail table below to that bucket
- Detail table columns adapt by type (Vendor vs Customer/Project)
- Party name resolution falls back gracefully when no joined record exists$q$,
'invoices, customer_invoices, finance_settings',
ARRAY['invoices','customer-invoices','payments'],
NULL,
4),

('profit-margins', 'Finance', 'Profit Margins',
$q$Per-project gross margin (recognized revenue minus total actual cost) for active projects, restricted to admin/ceo/finance both client-side and via RLS (a non-permitted caller silently gets zero rows rather than an error), recomputed on demand rather than automatically.$q$,
$q$Finance/Leadership opens Profit Margins -> page loads existing margin rows sorted worst-margin-first -> clicks Recompute All -> for every active project: actual cost is rolled up (people cost via role_rates/resource_rates plus hardware/software/support/warranty cost), recognized revenue is summed from non-draft, non-cancelled customer invoices, margin and margin% are computed and upserted -> table and stat cards refresh.$q$,
$q$- Hard role gate (admin/ceo/finance) — non-matching roles see a dedicated "No access" state; the real enforcement is RLS, this is just a UX shortcut
- "Recompute All" iterates every active project sequentially
- Margin math: gross_margin = revenue_recognized - total_actual_cost; margin_percent avoids divide-by-zero when revenue is 0
- Results upserted keyed on (project_id, period_key='ALL') — lifetime-to-date only, no per-period view
- Stamps computed_at/computed_by on every recompute
- Stat cards: Total Revenue, Total Actual Cost, Gross Margin, Margin % (colored red/green by sign)
- Table sorted ascending by margin_percent (worst-margin projects surface first)
- Empty state prompting a first recompute$q$,
'profit_margins, customer_invoices, actual_cost_snapshots, projects',
ARRAY['projects','customer-invoices','role-rates','spend-analyzer'],
$q$total_actual_cost combines people cost (role_rates fallback + resource_rates) with hardware/software/support/warranty cost tables. margin_percent is also read directly by Spend Analyzer's Benchmark tab.$q$,
5),

('spend-analyzer', 'Finance', 'Spend Analyzer',
$q$The company-wide spend cockpit: Overview, Fund Flow, Resource Flow, Category, Department, Project, Vendor, auto-generated Findings, Forecast, and Benchmark views, all recomputed on demand from existing transactional tables with no data duplication. Access is gated to admin/ceo/finance/manager plus department_head. "Recompute All" rebuilds the company-wide category rollup, the vendor spend summary, and regenerates six finding types in sequence; each tab then reads its own slice.$q$,
$q$User picks a tab (deep-linkable via a view query param) -> Overview/Category/Department/Project/Vendor/Findings load their own slice from the recomputed company_spend_rollup/vendor_spend_summary/spend_findings tables (or live-compute Forecast/Benchmark on read); Fund Flow and Resource Flow tabs run independent, filter-driven live queries instead -> "Recompute All" runs recomputeCompanyRollup -> recomputeVendorSpendSummary -> generateFindings in sequence and reloads the active tab -> clicking any stage/category/department/project/vendor row expands an inline, lazily-fetched drilldown.$q$,
$q$- Access gated to admin/ceo/finance/manager plus department_head; blocked roles see a dedicated "No access" state
- Global "Recompute All" chains 3 recompute steps then reloads the active tab
- Overview tab: 5 KPI tiles (Budget/Actual Spend/Revenue/Profit-Loss/Margin %), a Committed->Invoiced->Paid mini-summary, red/amber/green project health flag tiles, 12-month planned-vs-actual spend trend
- Fund Flow tab (the real Budget -> Committed -> PO -> GRN -> Invoiced -> Paid chain, distinct from the standalone Fund Flow nav page): department/project filters, 5 KPI tiles, a clickable horizontal stage-pill chain with per-stage drill-down tables shaped to that stage
- Resource Flow tab: joins allocation hours with people cost at the per-employee level — a join no other module exposes alone; department/project filters, 4 KPIs, cost-by-designation bar chart, per-employee expandable table
- Category tab: fixed 6-category taxonomy (Resource/Hardware/Software/Support/Change/Warranty + Misc) derived from free-text budget categories via keyword matching; progress-bar table with Top Departments/Projects drilldown
- Department tab: planned/actual/variance table with a per-department drilldown (projects, category mix, resource utilization summary)
- Project tab: top-200-by-spend table with a Health badge; selecting a project swaps to a full detail view with its own KPIs, category breakdown, embedded Fund Flow chain, and Resource Allocations table
- Vendor tab: reads the pre-computed vendor_spend_summary (top 20); per-vendor expandable mini fund-flow chain plus PO/Invoice lists
- Findings tab: 6 auto-generated finding types (Recurring Overrun, Contingency Pattern, Underutilized Budget, Vendor Consolidation, Allocation Inefficiency, Change Cost Creep) plus warranty findings; Acknowledge/Mark Actioned/Dismiss state machine, only 'new' findings are replaced on recompute
- Forecast tab: simple linear burn-rate projection (explicitly not a statistical forecast) flagging at-risk projects
- Benchmark tab: groups projects by project_type for peer comparison (avg budget utilization, avg margin from profit_margins), feeds the Budget Wizard's "copy from similar project" suggestions$q$,
'company_spend_rollup, vendor_spend_summary, spend_findings, budgets, actual_cost_snapshots, invoices, customer_invoices, allocations, change_requests, projects, departments, purchase_orders, purchase_requisitions, grn, payments, profiles, capacity_snapshots, role_rates, resource_rates, profit_margins, finance_settings',
ARRAY['budget','procurement','pos','grn','invoices','payments','allocations','role-rates','warranty','profit-margins','customer-invoices'],
$q$Its Fund Flow tab is the actual Budget -> Committed -> PO -> GRN -> Invoiced -> Paid chain implementation (src/lib/fundFlow.js) — the standalone Fund Flow nav page is a different, lighter view sharing the same lib. This module touches more tables than any other page in the app.$q$,
6),

('leave', 'HR & Resources', 'Leave Management',
$q$Employee leave application with balance tracking across four leave types (sick, casual, personal, permission/hourly), a flat any-manager-tier team approval queue (no ordered chain), a team-out calendar, and HR-managed holiday and per-employee policy configuration. Leave types can be flagged to auto-approve without review.$q$,
$q$Employee selects leave type -> fills date/time or permission fields + reason -> submits (auto-approved instantly if the leave type has requires_approval=false, otherwise pending) -> any manager-tier role (manager/department_head/hr/admin/ceo) approves or rejects (no ordered chain) -> on approval, leave balance is decremented and employee capacity is recomputed for that date range.$q$,
$q$- Balance cards per leave type: remaining/used/total with a progress bar
- Apply Leave modal: type-selector grid, date range (permission adds a from/to time picker), live computed duration preview
- Required Reason validation; auto-generated request numbers via nextNum('leave')
- Auto-approve support per leave type (requires_approval flag)
- Flat approval gate — any manager-tier role can act, no ordered chain
- Working-day calculation excludes weekends and configured holidays
- "My Leaves" vs "Team Approvals" tabs (pending-count badge), search on the approvals table
- "Team Calendar" tab: date-range picker showing who is out each day, built client-side from approved records
- "Holidays" tab (HR/admin/ceo): add/delete company holidays
- HR-only "Set Leave Policy" modal for per-employee annual entitlements
- Employee can cancel their own request only while pending
- Local-timezone-safe date formatting throughout to avoid UTC roll-back bugs$q$,
'leave_requests, leave_balances, leave_policies, leave_types, holidays, profiles',
ARRAY['capacity','resources','users','settings'],
$q$Approval here directly feeds Capacity's bench recompute (recomputeForEmployeeRange). Settings' Approval Chain tab registers a "leave" entry for UI consistency only — it has no live effect on this module's flat role-gate logic.$q$,
1),

('resources', 'HR & Resources', 'Resource Tracking',
$q$Daily attendance via check-in/check-out against time_logs, a live team overview for managers, a full log browser, and a client-side monthly payroll estimate. Payroll numbers are estimates only — there is no persisted payroll record, calculations run fresh in the browser on every render.$q$,
$q$Employee checks in (optionally tagging a project + task note) -> works -> checks out, stamping check_out and computing hours_worked -> managers view live team status in Team Overview, browse raw logs in All Logs, and see computed payroll estimates in Payroll Summary once a resource rate is set per employee.$q$,
$q$- "Check In Now" with optional project + comment; blocked if already checked in
- Live "Checked In" banner with check-out comment field and Check Out button
- "My Time Log" table with a live active-entry indicator
- Manager-only tabs: Team Overview, All Logs, Payroll Summary
- Team Overview: per-employee cards with live-check-in indicator, monthly hours, monthly rate, estimated net salary
- All Logs: search + month/year filter across the full team
- Payroll Summary: monthly salary, hourly rate, hours worked, leave deduction, net salary, per-employee "Ready"/"No Rate" status
- Payroll math: hourly rate falls back to monthly_salary / 176; leave days convert to 8h equivalents combined with permission hours
- "Set Resource Rate" modal (manager-only): monthly salary auto-computes an editable hourly rate at 176 hrs/month
- IST-localized time formatting throughout$q$,
'time_logs, resource_rates, leave_requests, projects, profiles',
ARRAY['timesheet','leave','projects'],
$q$Shares time_logs directly with Timesheet — they are two different views over the same data. Payroll shown here is an estimate, not a persisted record, and is computed with a slightly different formula than Timesheet's own pay preview.$q$,
2),

('timesheet', 'HR & Resources', 'Timesheet',
$q$A monthly filter/reporting layer over the same time_logs table used by Resource Tracking — supports bulk multi-day entry (one row per date) instead of single check-in/out, per-user summary cards with a simpler pay estimate, and CSV export. Manager-oriented; it does not itself drive check-in/check-out.$q$,
$q$Manager/employee picks month, year, and (if manager) a user filter -> table loads matching time_logs rows -> "Add Entry" bulk-creates daily rows across a date range in one submit -> "Export CSV" downloads the currently filtered rows.$q$,
$q$- Month/year selector plus a manager-only user filter, all combine to filter/reload time_logs
- Stat strip: Total Hours, Working Days, Team Members
- "Add Entry" bulk multi-day insert: one row per calendar day in the range, synthetic check-in/check-out timestamps derived from entered hours
- Validation: end date can't precede start, date range capped at ~92 days, employee required for managers
- Live estimated-pay preview in the Add Entry modal once employee + hours are filled
- Per-user summary cards (manager view): hours total, days, estimated pay or a "No rate set" warning
- Detailed log table with project badge, hours (or "Active" if still open), comment
- "Export CSV" downloads Date/Employee/Project/Hours/Work Done for the current filter, named by month/year$q$,
'time_logs, resource_rates, projects, profiles',
ARRAY['resources','timesheet-approvals'],
NULL,
3),

('timesheet-approvals', 'HR & Resources', 'Timesheet Approvals',
$q$Monthly timesheet submission with a DB-configurable 3-step approval chain (Manager -> HR -> Finance) built on top of the same time_logs rows used by Resource/Timesheet, kept in a separate timesheet_approvals table. Chain steps/roles are pulled from approval_chains/approval_chain_steps when seeded, falling back to a hardcoded default otherwise.$q$,
$q$Employee's time_logs for the month roll up into totals -> "Submit for Approval" creates/updates a timesheet_approvals row at pending_manager -> manager approves (-> pending_hr) or rejects (-> rejected, with reason + level recorded) -> HR approves (-> pending_finance) or rejects -> Finance/CEO approves (-> approved) or rejects. Admin/CEO acting from pending_manager can approve straight through in one action. A rejection at any level requires a written reason and a resubmission wipes all prior approval data, restarting at pending_manager.$q$,
$q$- "My Timesheet" tab: visual 4-node approval timeline with approver names and timestamps
- KPI strip (manager/HR/finance roles): Submitted, Pending Manager/HR/Finance, Approved, Rejected counts for the month
- Status-specific colored banners including a detailed rejection banner (level, rejecter, reason)
- "Submit for Approval" modal with hours/days/entries summary and an optional note
- Resubmitting after rejection clears all prior approval columns and restarts the chain
- Notifies all managers on submission; notifies the employee on each approve/reject
- Manager Approval / HR Dashboard / Finance-CEO Approval tabs, each scoped to that step's pending queue (admin/ceo see everything still in review)
- HR Dashboard additionally shows a full company-wide status table for the month
- Admin/CEO one-shot shortcut: approving from the first step auto-fills all three approver fields and jumps straight to approved
- canActOn gate — only the role assigned to the current step (or admin/ceo) can act; chain capped at 3 steps to match the fixed manager_id/hr_id/finance_id columns on timesheet_approvals$q$,
'timesheet_approvals, time_logs, approval_chains, approval_chain_steps, profiles',
ARRAY['timesheet','resources','settings'],
$q$Step position is wired to fixed database columns (manager/HR/finance) — reassigning roles is safe, but reordering steps changes which column gets stamped, not just labels.$q$,
4),

('chat', 'HR & Resources', 'Chat',
$q$1:1 direct-message chat with live online-presence tracking, built on Supabase Realtime (postgres_changes for messages, presence for online status). Admin/CEO additionally get a "Monitor All Chats" view that lists every conversation and can read/reply to any of them.$q$,
$q$User picks a colleague -> a canonical DM room is found or created -> message history loads (last 200) with a realtime subscription attached -> sending a message inserts into chat_messages, optimistically appends locally, and notifies the recipient. Admin/CEO can additionally browse "Monitor All Chats" and open any room directly.$q$,
$q$- Colleague list with search, avatar initials, live online/offline presence dot, last-message preview
- Canonical DM room IDs ensure a room is looked-up-or-created deterministically, never duplicated
- Realtime presence channel shows a live "N online now" count
- Message thread: date separators, bubble alignment, per-message timestamps, auto-scroll on new message
- Enter-to-send (Shift+Enter for newline), 200-message load limit, optimistic send with notification to the recipient
- Admin/CEO-only "Monitor All Chats": every room's participants, type, message count, last-activity time, and a direct open-into-conversation action$q$,
'chat_rooms, chat_room_members, chat_messages, profiles',
ARRAY['users'],
NULL,
5),

('data-assistant', 'HR & Resources', 'Data Assistant',
$q$An LLM chat assistant grounded in a live, cached snapshot of company data (5-minute cache, force-refreshable), with a 4-model picker (DeepSeek V3, Gemini 2.5 Pro, Claude Opus 5, local Ollama) and one-click quick-answer buttons for ten common operational questions. It has no free database access — every answer is generated purely from the JSON snapshot handed to the model.$q$,
$q$Page loads -> builds or reuses (if under 5 minutes old) a cached JSON snapshot of expenses, travel, PRs, POs, GRN, invoices, payments, leave, timesheets, projects, departments, budgets, vendors, assets, and employees -> user clicks a quick-answer chip (runs a live, deterministic Supabase query directly, bypassing the LLM) or types a free-text question (sent to the selected model with the snapshot as grounding context, cached for exact repeats) -> model replies using only that snapshot.$q$,
$q$- Model picker cards with per-model API-key-configured check (env var or DB-stored key); unusable models are greyed out
- Ollama-specific local model-name input
- "Refresh data" button forces a fresh snapshot, bypassing the cache, with a freshness indicator and any load-failure warnings
- Ten deterministic quick-answer question chips (pending expenses/PRs/leave/travel, over-budget projects, budget vs spent, this-month spend, pending invoice amount, most-over-budget department, active employee count) that query Supabase directly, not the LLM
- Free-text chat input, auto-growing, Enter to send
- Exact-repeat answer cache (in-memory) so an identical question is instant on a second ask
- Chat transcript with distinct bubble styling and an animated typing indicator$q$,
'llm_usage_logs',
ARRAY['llm-monitor','settings'],
$q$Every request is logged to llm_usage_logs. Also embedded as a floating "AskBubble" widget on every protected page (via Layout.jsx), sharing the same model picker, quick-answer list, and answer cache as this full page — a model choice or cached answer in one surface is reflected in the other.$q$,
6),

('users', 'Admin', 'Users',
$q$An admin/HR-managed employee directory with role-based visual filtering, full CRUD, and a per-user profile detail view that aggregates live payroll, time-tracking, expense, and leave data from other modules. Editing is restricted to admin, ceo, and hr; everyone else gets read-only browsing. A bulk Excel importer handles onboarding many employees at once.$q$,
$q$Admin/HR opens Users -> browses/filters/searches the directory -> clicks a card to view aggregated profile detail (time, expense, leave, payroll KPIs fetched live) -> edits fields or toggles active status inline -> or clicks Add User / Import Employees to onboard, with new hires created via Supabase Auth admin API where available, falling back to a direct profile insert.$q$,
$q$- Role filter cards with live per-role headcount, plus a text search box (name/email)
- Deterministic per-role color/icon, with a generic fallback for custom roles added via Settings
- Cards: avatar, role badge, department tag, Inactive badge (dimmed) when applicable
- Add User / Import Employees (Excel bulk import) buttons
- Create/Edit fields: name, email (immutable on edit), role, department, designation, phone, reporting manager, employment type, default weekly capacity hours, date joined, Active checkbox
- New-user creation attempts Supabase Auth admin API first, falling back to a direct profiles insert with a message to create the auth user separately
- Editing weekly capacity hours triggers a capacity recompute for that employee
- Activate/Deactivate toggle from both the card and detail header, without opening the edit modal
- Delete with confirmation dialog
- Detail view: hero card, KPI tiles (Monthly/Hourly Rate, Hours This Month, Total Hours, Total Expenses, Leave Days Used, all computed live), Recent Time Logs, Recent Expenses, Leave History grid$q$,
'profiles, roles, departments, time_logs, expense_requests, leave_requests, resource_rates',
ARRAY['leave','resources','skill-matrix','allocations','capacity','settings'],
$q$Every other module's employee/requested_by foreign key ultimately points back to profiles.id here — the heaviest cross-module hub in the app alongside Projects. Reporting-manager assignment here feeds allocation and leave approval routing.$q$,
1),

('reports', 'Admin', 'Reports',
$q$A lightweight CSV export center offering eight canned, pre-mapped reports (Expenses, Travel, Vendors, Invoices, Purchase Requisitions, Assets, Projects, Users) plus a combined "Export All" that concatenates every report into one multi-section CSV. Exports run entirely client-side.$q$,
$q$User opens Reports -> row counts load per module -> clicks Export CSV on a single report (fetch -> map -> CSV -> download) or Export All (loop through every report, build one combined multi-section CSV, download).$q$,
$q$- 8 predefined reports, each with a live row-count badge fetched on load
- Summary strip of the first 6 reports as compact stat tiles
- Per-report Export CSV button: full fetch, human-readable column mapping, RFC4180-style CSV escaping, browser download
- Toast notification confirming success/row-count, warning on zero rows, or showing the error on failure
- "Export All" builds one combined CSV with a section header before each report's block
- Aggregate total record count and module count shown in the page subtitle
- "Export Tips" help card explaining CSV compatibility and Export All vs per-module export$q$,
'expense_requests, travel_requests, vendors, invoices, purchase_requisitions, assets, projects, profiles',
ARRAY['expenses','travel','vendors','invoices','procurement','assets','projects','users'],
NULL,
2),

('settings', 'Admin', 'Settings',
$q$A six-tab admin configuration console covering role/module governance, the org's configurable multi-step approval-chain engine, department budgets, expense categories, GST invoice settings, and centrally-managed AI/LLM API keys. Note: Expense Categories and GST Settings are currently UI-only mockups with local state and a fake "saved" toast, not yet wired to Supabase tables.$q$,
$q$Admin opens Settings -> selects a tab -> Roles & Modules: create/edit roles, toggle module kill-switches and per-role visibility (live-refreshes the sidebar) -> Approval Chain: expand a workflow, edit/reorder/add/remove steps or spin up a new named chain, save -> Budget Config: enter per-department budgets, save (persisted) -> Expense Categories / GST Settings: edit locally (not yet persisted) -> AI/LLM Keys: enter provider keys, save (persisted org-wide, effective immediately for all users).$q$,
$q$- Roles & Modules — Roles: colored role pills, built-in vs custom, create/edit/delete (custom roles only)
- Roles & Modules — Module Enablement: collapsible sections, one row per module with a company-wide "Enabled" kill-switch plus per-role visibility checkboxes (admin/ceo always see enabled modules regardless)
- Approval Chain: one collapsible section per workflow (Expense, Travel, Procurement, Warranty, Timesheet, Leave), chain count, "New Chain" button
- Per-chain step editor: fixed status_value per position (read-only, workflow-hardcoded), editable approver-role dropdown, editable display label, reorder arrows, remove-step, "Add Step" from the workflow's unused vocabulary, "Save Steps"
- Chain-level controls: Active toggle, delete (custom chains only), "CUSTOM" badge, selector context shown, unique key
- Workflow-specific caution notes (Timesheet: step position is wired to fixed DB columns; Leave: entry is for visibility only, no live effect)
- New Chain modal: workflow, selector value where applicable (with a warning that activating deactivates any conflicting active chain), unique key, label, step builder
- Budget Config: editable Annual/Monthly Budget per department, "Save Budgets" upserts (persisted)
- Expense Categories: add/rename/delete categories, seeded with 12 defaults — local state only, not yet persisted
- GST Settings: GSTIN, business name/address, CGST/SGST/IGST rates, invoice-breakdown toggles — local state only, not yet persisted
- AI / LLM Keys: password-style inputs for DeepSeek/Gemini/Claude keys plus an Ollama URL, admin/ceo-writable, applies org-wide immediately and takes priority over .env values$q$,
'roles, modules, module_role_visibility, budgets, llm_settings, approval_chains, approval_chain_steps',
ARRAY['knowledge-base','llm-monitor','budget','expenses','travel','procurement','warranty','timesheet-approvals','leave'],
$q$The Approval Chain tab here drives the configurable approval flow system used by Expenses, Travel, Purchase Req., Warranty, and Timesheet Approvals (Leave is registered for UI consistency only, with no live effect). Module Enablement toggles are read app-wide by TabVisibilityContext/sidebar nav.$q$,
3),

('content', 'Admin', 'Landing Content',
$q$An admin-only CMS for the four content types shown on the public landing page — Announcements, Staff Awards, News Posts, and Hackathon Topics — with full CRUD, publish/hide toggling, and per-type custom forms in a single shared modal.$q$,
$q$Admin opens Content -> selects a content-type tab -> table loads that type's rows -> Add/Edit opens a shared modal with the tab-appropriate form -> Save inserts/updates the corresponding table and stamps created_by -> row-level eye icon toggles landing-page visibility -> delete removes immediately.$q$,
$q$- 4 tabs: Announcements, Awards, News Posts, Hackathon — each with type-specific extra table columns (pinned flag, recipient, category/image indicator, difficulty+tags)
- Universal Status column (Active/Hidden) driven by is_active, or is_published specifically for News
- Row actions: toggle visibility, edit, delete (no confirm dialog on delete)
- Announcements form: title, content, type (info/success/warning/event), expiry, active/pinned flags
- Awards form: title, icon (emoji), description, "Award To" dropdown (all profiles), award date, color, show-on-landing checkbox
- News form: title, content, image URL, category, Publish checkbox (auto-stamps published_at)
- Hackathon form: title, description, difficulty, comma-separated tags, active flag
- Users list loaded once for the Awards "Award To" dropdown; data reloads on tab change$q$,
'announcements, awards, news_posts, hackathon_topics, profiles',
ARRAY['users'],
$q$The one other place in this app besides the Knowledge Base and Settings that follows the pattern "admin edits a table here, a different page reads it publicly" — the public Landing Page reads these same four tables directly.$q$,
4),

('app-monitor', 'Admin', 'App Monitor',
$q$An admin/CEO-only analytics dashboard for site-wide usage, built entirely from app_events (page views, sessions, errors) recorded on every route change. Shows time-series page-view trends, top pages, most active users, and a live scrollable raw event log, with a date-range selector and a cross-link into the dedicated LLM usage monitor.$q$,
$q$Admin/CEO opens App Monitor -> selects a time range -> app_events + profiles fetched in parallel -> client-side aggregation (page views, unique users, top pages, hourly/daily buckets, error types, top users) -> renders KPI tiles, two charts, an error breakdown, and a live raw event table -> Refresh re-runs the query; the banner links out to LLM Monitor for AI-specific usage.$q$,
$q$- Hard role gate: admin/ceo only
- Date range selector: Today / 7 Days / 30 Days, manual Refresh
- Promotional banner cross-linking to LLM Monitor for chatbot/AI usage specifically
- KPI tiles: Page Views, Unique Users, Registered Users (independent of the date range)
- "Page Views Over Time" line chart (hourly for Today, daily for 7d/30d)
- "Top Pages" bar chart (top 8 by page_view count)
- "Most Active Users" list (top 8 by event count, resolved to names)
- "Error Types" breakdown grouped by metadata.error_type, with a positive empty state when there are none
- Recent Events live table (capped to 300 rows shown, up to 2000 fetched): time, type, path, user, session, truncated metadata$q$,
'app_events, profiles',
ARRAY['llm-monitor','users'],
NULL,
5),

('llm-monitor', 'Admin', 'LLM Usage Monitor',
$q$An admin/CEO-only monitoring dashboard for every AI/LLM request made across the app (Data Assistant and Neo Task AI), sourced from llm_usage_logs. Surfaces token consumption, latency, estimated cost, and success/failure, broken down by time, model, source feature, and requesting user.$q$,
$q$Admin/CEO opens LLM Monitor -> selects a time range -> llm_usage_logs + profiles fetched in parallel -> client-side aggregation (totals, time-bucketed series, per-model/source/user rollups, estimated cost) -> renders KPI tiles, time-series charts, ranking charts, and a detailed recent-requests table -> Refresh re-runs the query.$q$,
$q$- Hard role gate: admin/ceo only
- Date range selector: Today / 7 Days / 30 Days, manual Refresh
- KPI tiles: Total Requests, Total Tokens, Avg Latency, Error Rate, Est. Cost (explicitly labeled "approximate, not billing-accurate")
- "Requests Over Time" line chart and "Tokens Consumed" stacked bar chart (prompt vs completion)
- "By Model" bar chart (color-coded per known model), "By Source" bar chart (Data Assistant / Neo Task AI), "Top Users" bar chart
- Recent Requests table (up to 200 shown): time, user, source, model badge, tokens, latency, success/fail status (with error tooltip), question text or error message$q$,
'llm_usage_logs, profiles',
ARRAY['data-assistant','neo-task-ai','app-monitor'],
NULL,
6)

ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  flow = EXCLUDED.flow,
  features = EXCLUDED.features,
  primary_tables = EXCLUDED.primary_tables,
  linked_modules = EXCLUDED.linked_modules,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order
WHERE kb_modules.updated_by IS NULL;

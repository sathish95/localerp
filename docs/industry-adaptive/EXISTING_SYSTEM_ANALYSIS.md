# Existing System Analysis

Phase 0 audit for the Industry-Adaptive Enterprise Workforce, Work, Task &
Resource Management Platform initiative. Pure inspection — no code or
schema changes were made while producing this document.

## 1. Current architecture

**ThingsAlive NeoX** (`procurepro`, v3.0.0) is a React 18 + Vite SPA backed
entirely by Supabase (Postgres + RLS + Realtime + Storage + RPCs, no
separate application server). There is a companion Expo/React Native
mobile app in `mobile/` sharing the same Supabase project.

- No backend framework/ORM — the Supabase JS client (`src/lib/supabase.js`)
  talks to Postgres directly via PostgREST; all business rules live in
  RLS policies and Postgres functions, not an API layer.
- No React Query on web (confirmed in `CLAUDE.md`) — direct
  `supabase.from(...).select()` calls inside `useEffect`. Mobile *does*
  use React Query (`@tanstack/react-query`) — the two clients are
  architecturally distinct despite sharing a backend.
- Schema evolves via 176 hand-written, hand-numbered SQL files in `sql/`
  (`STEP20` through `STEP179`, plus a handful of lettered/diagnostic
  variants). **The foundational schema — `projects`, `project_tasks`,
  `time_logs`, `checkin_tasks`, `profiles`, the original `roles` enum —
  predates `STEP20` and was created directly in the Supabase dashboard.
  It is not in version control.** This is the single biggest blind spot
  for this initiative: nobody can grep a file to find `project_tasks`'s
  exact column list or constraints; only `information_schema` (a live DB
  query) has the ground truth. STEP89's own header comment independently
  confirms this ("the trigger on auth.users... predates STEP20, set up
  directly in Supabase").
- No lint or test scripts exist (`package.json` has only `dev`/`build`/
  `preview`; confirmed in `CLAUDE.md`). "Run existing tests" from the
  master prompt has nothing to execute — there is no test suite of any
  kind, so regression protection for this initiative must come from
  manual QA + the additive-migration discipline this repo already
  practices, not from CI.
- Already multi-tenant: `STEP89_multitenant_foundations.sql` added
  `organizations`, `profiles.organization_id`, `current_org_id()` and
  `is_platform_super_admin()`, then `STEP90–STEP99` retrofitted RLS
  across ~40 tables to scope by `organization_id = current_org_id()`.
  This is highly relevant — the industry-adaptive work is really "Phase
  2" of a multi-tenant SaaS transformation that's already ~90 migrations
  deep.

## 2. Existing modules

Web (`src/pages/`, 105 files) covers: Expenses, Travel, Approvals,
Projects (+ Gantt/Milestones/Resources/Software/Hardware/Support/Fund
Flow), Task Management (Kanban/List/Stories/Sprints/Reports/Dashboards),
Neo Task AI, Budget, Assets, Skill Matrix, Allocations, Capacity,
Products/BOM/Inventory/Devices/Procurement/Warranty/PO/Invoices/GRN,
Customers, Vendors, Fund Flow, Scenario Planning (6 pages), Finance
(Role Rates, Customer Invoices, Delivery Notes, Payments, Aging,
Profit Margins, Spend Analyzer), Leave, Resource Tracking (check-in),
Timesheet, Timesheet Approvals, Chat, Data Assistant, IT Helpdesk,
Support, Sales/Pre-sales CRM (11 pages), Marketing (4 pages),
Performance (9 pages), Users, Reports, Settings, Landing Content,
App/LLM Monitor, ThingsAlive Wiki, plus platform-level Super Admin pages.

## 3. Database entities (relevant to this initiative)

Untracked base schema (pre-STEP20, inferred from usage across
`src/pages/*.jsx` and `sql/*.sql` ALTERs — never seen as a `CREATE TABLE`
in this repo):
- `profiles` (id, full_name, email, role, organization_id, dept, ...)
- `projects` (id, name, budget, spent, organization_id, ...)
- `project_tasks` (id, task_id [display code], task_name, project_id,
  assigned_to, status, priority, planned/actual dates, estimated/actual
  hours, department_id [STEP167], progress_pct [STEP28], ...)
- `time_logs` (id, employee_id, project_id, work_date, check_in,
  check_out, hours_worked, comment, ...) — `CheckInWidget.jsx` inserts
  with `project_id: selProject || null`, i.e. **already nullable at the
  application layer today**.
- `checkin_tasks` (checkin_log_id, task_id, employee_id, work_date,
  status_update) — join table linking a check-in session to the tasks
  worked during it.
- `departments` (id, name, code, organization_id)

Tracked (in `sql/`):
- `timesheet_approvals` (`STEP22`) — one row per **employee × month**,
  status `draft→pending_manager→pending_hr→pending_finance→approved/
  rejected`. Critically, **this table has no `project_id` and no FK to
  `time_logs` at all** — it's a rollup computed client-side from
  `time_logs` for that employee/period. This means the approval layer is
  already fully decoupled from Project.
- `organizations`, `modules`, `module_role_visibility` (`STEP89`,
  retrofitted `STEP90–99`) — the multi-tenant + module-toggle backbone.
- `mobile_module_capable_keys()`, `organization_module_allocations`,
  `mobile_module_config` (`STEP161–165`) — a second, mobile-specific
  gating layer on top of `modules`.
- `wiki_spaces`/`wiki_pages` (`STEP168–178`) — the most recent example
  of a brand-new domain module built org-scoped from day one, and a
  template for how new modules should be structured going forward.

## 4. Project relationships

`projects` is the organizing unit for nearly every operational table:
`project_tasks`, `user_stories`, `sprints`, `epics`, `change_requests`,
`project_assignments`, `project_budget_config`, `project_hardware_costs`,
`project_software_costs`, `project_support_costs`, `project_milestones`,
`project_resource_alloc` all carry a required `project_id`. `time_logs`
and `expense_requests`/`travel_requests` carry an *optional* `project_id`
(nullable, already used that way in check-in and, per
`src/lib/requests.ts` on mobile, expense/travel forms have a "Project
(optional)" picker).

## 5. Task relationships

`project_tasks` is 1:1 tied to a `project_id` in every current code path
— `TasksPage.jsx` has no "no project" task creation flow (see §10). Tasks
also relate to `user_stories`/`sprints`/`epics` (all themselves
project-scoped), `checkin_tasks` (session-scoped), `task_comments`
(`STEP28`), `task_status_log`, and `task_role_permissions` (a
project-or-null, role-based permission override table — this is the one
place `project_id IS NULL` already means "applies org-wide", a useful
precedent for a Project-optional Task).

## 6. Check-in/out relationships

`time_logs` is the attendance/session record: `check_in`/`check_out`
timestamps, `hours_worked` computed on checkout, optional `project_id`,
optional free-text `comment`. `checkin_tasks` links a session to zero or
more `project_tasks`, each carrying its own `status_update` so checking
out can also close out task status. **Today, a check-in session and the
tasks worked during it are already independent concepts** — exactly the
separation the master prompt's §29 asks for (check-in once, work on
multiple tasks across the day). This already works on both web
(`CheckInWidget.jsx`) and mobile (`mobile/src/lib/checkin.ts`).

## 7. Timesheet relationships

`TimesheetPage.jsx`/`TimesheetApprovalPage.jsx` read `time_logs` for a
given employee/month, sum `hours_worked`, and let the employee submit
that rollup into a `timesheet_approvals` row for the period. No
project-level rollup or gate exists in the approval object itself.

## 8. Approval relationships

`src/lib/approvalFlow.js` defines a **generic, reusable** chain engine:
`CHAINS` keyed by submitter role, status progression `submitted →
manager_review → ceo_review → finance_review → approved`. This is
already used by more than just timesheets (expenses, travel, procurement
share the same shape) — a good precedent for adding new approval types
(task completion, overtime) without inventing a second engine.

## 9. RBAC implementation

Two layers, deliberately separate:
1. **Route/page-level** — hardcoded role-set constants in `src/App.jsx`
   (`isAdmin`, `isManager`, `isFinance`, `isHR`) gate entire routes. Roles
   themselves (`admin, ceo, manager, department_head, finance, hr,
   employee`) are a fixed list — `roles` became a real table at `STEP42`
   (replacing an enum) but the seven role *names* are still assumed
   throughout RLS policies (`role IN ('admin','ceo',...)` appears in
   dozens of policies) and are not themselves per-organization
   configurable.
2. **Nav/module-level** — `TabVisibilityContext.jsx` + `modules` +
   `module_role_visibility`, edited from Settings → "Roles & Modules".
   This *is* per-organization and admin-configurable today, and mobile's
   `get_effective_modules()` RPC (`STEP162`) generalizes it further with
   purchase/allocation/mobile-capability gates. This is the closest
   existing thing to the master prompt's "Module Registry."

## 10. Hardcoded terminology

Terminology is baked into JSX text/labels throughout, not sourced from
any config: "Project", "Task", "Employee", "Site" (doesn't exist as a
concept — "Project" is the closest location-like grouping),
"Timesheet", "Check-in/Check-out", "Department". `src/config/modules.js`
labels (`"Task Management"`, `"Resource Tracking"`, etc.) are the closest
thing to a single source of truth for a *module's* display name, but
there is no per-field/per-noun terminology layer at all — introducing
one is genuinely new work, not a refactor of something existing.

## 11. Current navigation

`src/components/layout/Layout.jsx`'s `ALL_NAV` is one static array of
~20 sections (Overview, Expenses & Travel, Operations, Resourcing,
Pre-Sales, Sales, Marketing, Performance, Inventory Management, Vendors
& Partners, Scenario Planning, Finance, HR & Resources, Admin, Platform),
each item gated only by `isTabVisible(item.tab)` (per-org,
per-role) or `profile.is_super_admin` for platform-only items. There is
no industry/workspace dimension to navigation today — visibility is
binary (org enabled it + role can see it), not "this org's *type of
business* doesn't have this concept at all."

## 12. Reusable components

- `src/components/ui/index.jsx` — `Loader`, `Modal`, `Badge`,
  `StatusBadge`, `StatCard`, `Alert`, `Confirm`, `SearchBox`, `Empty`,
  `ApprovalChain`.
- `src/lib/approvalFlow.js` — generic multi-step chain engine.
- `src/lib/modules.js` + `src/config/modules.js` — module
  enable/disable + role-visibility, already org-scoped.
- `get_effective_modules(p_platform)` — single-RPC resolver for "what
  can this user see," already handles purchased/org-disabled/
  role-hidden/not-allocated/not-on-mobile in one ordered gate chain, a
  strong template for a future "what can this user see, given their
  WorkspaceProfile" resolver.
- `mobile/src/lib/roles.ts` — small, composable role-predicate helpers
  (`isManager`, `isFinance`, `isHR`) mirroring `App.jsx`'s constants,
  reused this session for the mobile chatbot's role-gated capability set
  — a workable pattern for "who gets which WorkspaceProfile feature."

## 13. Risks

- **Untracked base schema** is the top risk: any additive migration for
  this initiative that assumes a column's nullability/type without
  checking live `information_schema` first could be wrong. A first,
  concrete Phase 0 follow-up (before Phase 1 code) should be exporting
  a current schema dump into `sql/` (read-only, e.g.
  `SELECT` from `information_schema.columns`/`table_constraints`) so
  future migrations have ground truth in version control.
- **Hardcoded role list** (`admin/ceo/manager/department_head/finance/
  hr/employee`) is load-bearing in dozens of RLS policies and dozens of
  `role IN (...)` JS checks. Any industry-specific role vocabulary
  (Guard, Operator, Technician) must be a *display label* over these
  seven roles, not a parallel role system, or RLS breaks everywhere.
- **No automated tests** means every phase's "regression check" is
  manual — the master prompt's Phase-gate testing checklist (§52) has
  to be executed by hand against a real org each time.
- **TasksPage.jsx is 1384 lines, single-file, tightly coupled to
  Projects** (see §10 of this doc / F. in the summary) — the biggest
  concentration of "Project is mandatory" logic in the whole repo, and
  the file most at risk of regression when Task becomes Project-optional.
- **No React Query on web** means introducing WorkspaceProfile as
  request-time context requires a new context provider pattern
  consistent with existing `AuthContext`/`TabVisibilityContext`, not a
  React Query cache key — small but real design decision for Phase 1.

## 14. Technical debt relevant to this project

- Two independent module-gating systems (web `modules`/
  `module_role_visibility` vs. mobile's additional
  `mobile_module_capable_keys()`/`mobile_module_config`/
  `organization_module_allocations`) that must both eventually
  understand WorkspaceProfile, or a new org onboarded via the
  industry-adaptive flow will get inconsistent module visibility between
  web and mobile.
- `roles` migrated from enum → table at `STEP42` but the *code* never
  followed up to stop hardcoding the seven names — a good precedent
  showing this kind of "add a config table, keep the old constants
  working" migration is exactly this repo's established pattern (see
  `STEP89`'s own framing), which the industry-adaptive work should copy.
- Settings page (`SettingsPage.jsx`) already has ~15 tabs
  (Organization, Roles & Modules, Permissions, Departments, Billing,
  Mobile App, Approval Chain, Budget, Categories, GST, Document
  Templates, AI Keys, AI Capabilities, Sales Config, Marketing Config,
  Onboarding & Tour) — a new "Workspace" tab (§37 of the master prompt)
  fits this existing pattern directly, no new admin shell needed.

# Implementation Plan

Phases 1–10 from the master prompt, translated into this repo's actual
files/routes. Each phase ends with the master prompt's §53 report
(files changed, migrations, routes, components, tests, backward-compat
status, known issues, next phase) before the next phase starts.

## Phase 1 — Workspace Foundation

**Migrations:** `STEP181–182` (see MIGRATION_PLAN).

**New files:**
- `src/lib/workspace.js` — `getWorkspaceProfile(orgId)`,
  `updateWorkspaceProfile(orgId, patch)`, mirrors `src/lib/modules.js`'s
  shape exactly.
- `src/context/WorkspaceContext.jsx` — mirrors `TabVisibilityContext.jsx`
  1:1: loads once per org, exposes `workspace`, `refresh()`. Wraps the
  app in `App.jsx` alongside `TabVisibilityProvider`.
- `src/lib/terminology.js` + fold `useTerm()` into `WorkspaceContext`
  (no separate context needed — one provider, two concerns, matching how
  `TabVisibilityContext` already both gates *and* will soon supply
  terminology).
- Seed data: `industry_profiles`/`business_types`/`operating_models`
  rows for the ~16 industries and their business types listed in master
  prompt §6/§7, inserted via a `STEP18x_industry_seed_data.sql`.

**Not done yet:** no UI reads `WorkspaceContext` for anything user-visible.
This phase only proves the plumbing loads without error for every
existing org (which all get the `LEGACY_DEFAULT` profile from `STEP182`).

**Regression check:** every existing page still renders identically;
`WorkspaceContext` is provided but not consumed.

## Phase 2 — Onboarding

**New route:** `/onboarding/workspace` (new page,
`src/pages/WorkspaceOnboardingPage.jsx`), reachable only from the
existing signup flow for brand-new organizations (find the current
post-signup redirect in `AuthContext.jsx`/`App.jsx` and branch: new org
→ this route; existing org → unchanged dashboard redirect).

**Steps (master prompt §48):** Organization details (likely already
collected at signup — check `PublicLeadFormPage.jsx`-adjacent signup
form before duplicating fields) → Industry card grid → Business Type →
Operating Model (multi-select) → Recommended Workspace preview →
Customize (checkbox list of `enabled_module_keys`, pre-checked per the
`workspace_profile_templates` seed lookup) → Launch, which writes the
org's real `workspace_profiles` row (replacing its `is_legacy_default`
placeholder from `STEP182`).

**Regression check:** existing orgs never see this route. New-org signup
is the only trigger.

## Phase 3 — Adaptive Experience

**Files touched:**
- `Layout.jsx` — `ALL_NAV` filtering gains one more predicate:
  `workspace.hasModule(item.tab)` alongside the existing
  `isTabVisible(item.tab)` check (both must pass; `hasModule` is a no-op
  `true` when `enabled_module_keys IS NULL`, i.e. every existing org).
- Every page currently rendering the literal string "Project" in a
  label position it's safe to swap (page titles, empty-states, button
  text — NOT variable names, table names, or API params) reads
  `useTerm('project')` instead. Start with the highest-traffic surfaces:
  `ProjectsPage.jsx` header, `Layout.jsx`'s nav label, `TasksPage.jsx`
  header — not a full sweep in one PR.
- Dashboard: a new `dashboard_widget_configs` table + registry
  (`src/lib/dashboardWidgets.js`) filtering `DashboardPage.jsx`'s widget
  list by `workspace.enabled_module_keys`.

**Feature flag:** `adaptive_navigation` — until enabled per-org, `Layout.jsx`
takes its old code path unconditionally.

**Regression check:** flag off (default) → byte-identical nav/labels for
every org, including new ones that completed Phase 2 onboarding, until
they're explicitly flipped over.

## Phase 4 — Universal Task Engine

**Migrations:** `STEP183–184`.

**Files touched:**
- `TasksPage.jsx` (1384 lines — the highest-risk file, per Phase 0
  analysis): add a "No project" option to the existing project `<select>`
  at line ~134, and stop defaulting `project_id: selProj ||
  projects[0]?.id` to a hard fallback — allow `null`. This is the single
  highest-leverage change for the master prompt's core principle
  ("Project must become optional").
  RPC/RLS check needed first: confirm (via the Phase 0 schema snapshot)
  whether `project_tasks.project_id` is `NOT NULL` at the DB level; if
  so, this phase's first migration is `ALTER TABLE project_tasks ALTER
  COLUMN project_id DROP NOT NULL` (additive-safe: loosening a
  constraint never breaks existing rows).
- New "Direct Task" quick-create entry point (master prompt §15's
  "Quick Task") reachable from a new `/my-work` route (Phase 4 also
  ships a minimal version of "My Work," fully built out in Phase 5).
- Task Template: `task_templates` table (new) + a template picker in
  the existing task-creation modal.

**Regression check:** every existing project's task list, kanban, and
sprint views render unchanged; creating a task **with** a project
selected behaves exactly as before.

## Phase 5 — Work Execution

**Migrations:** `STEP185`.

**Files touched:**
- `CheckInWidget.jsx` (web) and `mobile/src/lib/checkin.ts`/
  `mobile/src/app/feature/checkin.tsx` (mobile, already built this
  session) — add Start/Pause/Resume/Complete actions on a task that
  write to `work_logs`, independent of the active check-in session
  (master prompt §29's worked example). The existing
  `checkin_tasks.status_update` mechanism (set at checkout) stays as
  the "did this session touch this task" record; `work_logs` is the new
  finer-grained per-task timer.
- `TimesheetPage.jsx` — extend the existing hours breakdown to show
  `Presence` (from `time_logs`, unchanged) vs. `Task Work` (summed from
  `work_logs`) vs. `Unallocated` (the difference), per master prompt §31.
  `timesheet_approvals` itself is not touched — it still approves a
  single `total_hours` figure computed the same way it is today.
- `/my-work` (started in Phase 4) fully built: Today/Upcoming/
  Overdue/Completed tabs per master prompt §16.

**Regression check:** an employee who never touches a task (today's
100% of usage) has an unchanged check-in/checkout/timesheet/approval
experience — `work_logs` stays empty for them forever.

## Phase 6 — Organization Operations

**Files touched:** `departments` already exists — extend, don't rebuild.
New: `locations` table (generalizing the "Site"/"Plant"/"Store" concept
per master prompt §23), `skills`/`profile_skills` tables (master prompt
§26), `shifts`/`shift_assignments` (master prompt §27, integrating with
existing `time_logs` the same additive way as everything else).

## Phase 7 — Work Order

Build the generic `work_items` UI (list/detail pages) on top of the
`work_items`/`work_type_configs` tables from Phase 4's migration,
connecting Task → optional `work_item_id`, and `work_logs` →
`work_item_id`, per master prompt's Work Order chain.

## Phase 8 — Enterprise Configuration

`form_schemas`, `task_workflows` (see TARGET_ARCHITECTURE) + a
`/settings/workspace` admin tab (new `WorkspaceSettingsTab` in
`SettingsPage.jsx`, alongside the existing 15 tabs) exposing Industry/
Business Type/Operating Model/Modules/Terminology/Navigation/Dashboard/
Work Types/Task Types/Forms/Workflows editors per master prompt §37.
This is the largest, most speculative phase — do not start it before
Phases 1–5 are stable in at least one real customer org.

## Phase 9 — Resource Modules

Equipment/Assets/Materials/Inventory already exist as web modules
(`AssetsPage.jsx`, `ProductsPage.jsx`, `BOMPage.jsx`, inventory pages) —
this phase is really "teach `work_items`/tasks to reference them,"
not "build them from scratch."

## Phase 10 — AI

Reuse `src/lib/llm.js`'s existing `LLM_MODELS`/`analyzeRequirements()`
infrastructure (already powers Neo Task AI) for the onboarding assistant
and AI-assisted task creation, rather than a new LLM integration layer.
Master prompt's requirement that AI actions be "permission aware,
explainable, previewed, confirmed, audited" maps directly onto the
existing pattern in `NeoTaskAIPage.jsx` (upload → AI generates a
*preview* → user confirms → then, and only then, rows are persisted).

## Cross-phase regression checklist (master prompt §52)

Since there is no test suite, each phase's sign-off is a manual pass of:
Project create/edit, Check-in, Check-out, Timesheet create/submit,
Timesheet approval, existing permissions, existing org sees unchanged
nav, existing records render — plus, from Phase 2 onward, the new-org
equivalents (workspace profile assigned, Project-optional task created,
task linked to a project optionally, work_log feeding a timesheet).

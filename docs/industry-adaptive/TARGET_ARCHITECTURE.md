# Target Architecture

How the master prompt's four-layer model (Experience / Configuration /
Domain / Transaction) maps onto this repo's actual files and tables, and
how new config entities sit *alongside* — never duplicating — the
multi-tenant/module infrastructure that already exists.

## The four layers, concretely

```
EXPERIENCE LAYER            src/config/modules.js (nav labels)
  Terminology                → NEW: terminology_overrides table +
  Navigation                    useTerminology() hook
  Dashboard                  → EXTENDS: Layout.jsx's ALL_NAV (filtered by
  Forms                        workspace, not just isTabVisible())
                              → NEW: FormSchema-driven fields on top of
                                existing forms (ProjectsPage/TasksPage
                                keep their JSX shell; field *set* becomes
                                data-driven)

CONFIGURATION LAYER          modules, module_role_visibility (existing)
  Industry                   → NEW: industry_profiles, business_types,
  Workspace                     operating_models, workspace_profiles
  Modules                    → EXTENDS get_effective_modules() to also
  Workflow                      consult workspace_profiles.enabled_modules
  Templates                  → NEW: task_templates, task_workflows

DOMAIN LAYER                 projects, project_tasks (existing, untouched)
  Project                    → NEW, additive: work_items (generic parent
  Work                          of task, optional project_id), locations,
  Task                          skills
  People                     → profiles (existing, untouched)
  Resources                  → resource_type_configs (new, prep-only)

TRANSACTION LAYER            time_logs, checkin_tasks (existing, untouched)
  Check-In                   → NEW: work_logs (task-level time, distinct
  Check-Out                     from session-level time_logs — see F.)
  WorkLog                    → timesheet_approvals (existing, untouched)
  Timesheet                  → EXTENDS timesheet rollup query to also
  Approval                      sum work_logs where relevant, same rules
```

**Rule enforced throughout:** every arrow into an existing table is
`ADD COLUMN IF NOT EXISTS ... NULL` or a new table with a *soft* FK
(plain UUID, matching this repo's own `CLAUDE.md` convention — "soft FK
references... Hard REFERENCES constraints silently abort the entire
script"). Nothing in this layer diagram deletes or renames an existing
column.

## Configuration layer — new tables, and how they relate to what exists

```
organizations (existing)
  └─ workspace_profiles (NEW, 1:1 with organizations by default)
       ├─ industry_profile_id  → industry_profiles (NEW, seed data)
       ├─ business_type_id     → business_types (NEW, seed data,
       │                          FK'd to industry_profiles)
       ├─ operating_model_ids  → workspace_operating_models (NEW,
       │                          join table — many-to-many, since §8
       │                          requires MULTIPLE operating models)
       ├─ enabled_module_keys  → still resolved through the EXISTING
       │                          modules/module_role_visibility tables;
       │                          workspace_profiles only supplies the
       │                          *recommended default* set at
       │                          onboarding time, it does not replace
       │                          the per-module enable/disable switch
       │                          admins already use in Settings →
       │                          Roles & Modules
       └─ terminology_overrides (NEW, JSONB or key/value rows —
                                   see Terminology Engine below)
```

`industry_profiles` / `business_types` / `operating_models` are seed
data (like `EXPENSE_CATEGORIES` or `roles` — a small admin-editable
lookup table, not user data). A `workspace_profile_templates` seed table
maps `(industry, business_type, operating_models[])` combinations to a
recommended `enabled_module_keys[]` + `terminology_overrides` JSONB — this
is the deterministic (non-LLM) recommendation engine the master prompt's
§40 explicitly asks to start with.

**`get_effective_modules(p_platform)` gets exactly one new gate**,
inserted before `not_on_mobile`: if the org's `workspace_profiles.
enabled_module_keys` is non-null and doesn't include a module, and that
module isn't already force-enabled by an explicit admin override in
`modules`, resolve `allowed = false, reason = 'workspace_hidden'`. Every
existing gate (`purchased`, `org_disabled`, `role_hidden`,
`not_allocated`, `not_on_mobile`) is untouched. **Orgs with no
`workspace_profiles` row (i.e. every existing org, see MIGRATION_PLAN's
LEGACY_DEFAULT) skip this gate entirely** — behaviour is bit-for-bit
identical to today until a workspace profile is explicitly assigned.

## Terminology Engine

```ts
// src/lib/terminology.js (new) + a TerminologyContext (new), mirroring
// the existing TabVisibilityContext.jsx pattern exactly:
const DEFAULT_TERMS = {
  project: 'Project', task: 'Task', location: 'Site',
  person: 'Employee', team: 'Team', ...
}
// workspace_profiles.terminology_overrides is a sparse JSONB —
// { location: 'Plant', person: 'Operator' } — merged over DEFAULT_TERMS.
export const useTerm = (key) => useContext(TerminologyCtx)[key] ?? DEFAULT_TERMS[key]
```

Consumed in JSX as `{t('location')}` the same way `useAppName()` is
consumed today (`BrandingContext.jsx` is the closest existing precedent
— a context that swaps a display string org-wide). **This changes
labels only.** `location` never becomes a real table/column rename;
`project_id` stays `project_id` in the database forever, regardless of
whether the UI shows "Project," "Site," or "Plant."

## Universal Work Engine — how it avoids fragmentation

The master prompt explicitly forbids `ConstructionProject`,
`ManufacturingProject`, etc. Concretely:

- `work_items` (NEW) is one table: `id, organization_id, work_type_key
  (FK to work_type_configs — 'project'|'work_order'|'service_request'|
  'production_order'|...), title, client_id, location_id, department_id,
  status, custom_fields JSONB, created_at...`.
- **`projects` is not migrated into `work_items`.** It stays exactly as
  it is — the existing, first-class Project entity the master prompt's
  §13 requires preserving. `work_items` is additive: it's what a
  Manufacturing org uses for a Production Order, or a Security org uses
  for a Client Contract, when "Project" isn't the right shape for their
  business. A `project_tasks` row keeps `project_id`; a new
  Project-optional task additionally gets an optional `work_item_id` —
  either, both, or neither may be set (never both required).
- `work_type_configs` (NEW, seed + admin-editable) is what makes a
  "Production Order" and a "Client Contract" the same underlying row
  with a different `FormSchema` and `WorkflowConfig` attached — exactly
  the master prompt's §12/§33 requirement, achieved as *configuration*,
  not as new domain tables per industry.

## FormSchema and WorkflowConfig — additive config, not new forms-per-industry

`form_schemas` (NEW): `id, organization_id, entity_type ('task'|
'work_item'|'project'), work_type_key nullable, fields JSONB [{key,
label, type, required, options, order}]`. `TaskForm`/`WorkForm`
components render this schema *in addition to* their existing hardcoded
fields — existing orgs with no `form_schemas` row render the exact same
form they render today (see IMPLEMENTATION_PLAN Phase 8, deliberately
late — this is the highest-risk, most speculative piece and should not
block Phases 1–4).

`task_workflows` (NEW): `id, organization_id, work_type_key, states
JSONB [{key,label}], transitions JSONB [{from,to,requires_role,
requires_fields}]`. `project_tasks.status` stays a plain TEXT column
(as it is today) — a workflow config only *validates and labels*
transitions the UI already performs; it does not change how status is
stored.

## Why this doesn't destabilize the Transaction Layer

`time_logs`, `checkin_tasks`, `timesheet_approvals` are never altered
beyond additive nullable columns (if any are needed at all — Phase 0
found none are strictly required; `time_logs.project_id` is already
nullable, `timesheet_approvals` already has no project dependency). The
new `work_logs` table (Phase 5) is a *sibling* of `checkin_tasks`, not a
replacement — it exists so Task start/pause/resume/complete can be timed
independently of a check-in session, per master prompt §29/§30, and its
rows *feed into* the existing timesheet hour calculation as an
additional bucket ("Task Work" vs. "Presence") rather than replacing
`hours_worked`.

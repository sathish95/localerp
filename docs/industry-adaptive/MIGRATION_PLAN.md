# Migration Plan

All migrations below follow this repo's existing convention exactly (see
`CLAUDE.md` and `STEP89`'s own header): soft FKs (plain UUID, no
`REFERENCES` to tables that might not exist yet), `ADD COLUMN IF NOT
EXISTS` with a nullable or defaulted type, `NOTIFY pgrst, 'reload
schema';` at the end of every file, numbered sequentially starting at
`STEP180`.

## 0. Prerequisite — schema ground-truth dump (before STEP180)

Because the base schema (`projects`, `project_tasks`, `time_logs`,
`checkin_tasks`, `profiles`) predates version control (see
EXISTING_SYSTEM_ANALYSIS §1/§13), the first artifact — not a migration,
a read-only dump — should be:

```sql
-- sql/STEP180_schema_snapshot_DIAGNOSTIC.sql (read-only, no ALTER/CREATE)
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('projects','project_tasks','time_logs',
                      'checkin_tasks','profiles','departments')
ORDER BY table_name, ordinal_position;
```

Run once in the Supabase SQL editor, paste the result into
`docs/industry-adaptive/SCHEMA_SNAPSHOT.md` for the record. This closes
the single biggest unknown flagged in Phase 0 before any Phase 1 code is
written against assumptions about nullability.

## 1. New tables (all additive, all `organization_id UUID NOT NULL
DEFAULT current_org_id()` following the `wiki_spaces` / STEP168 pattern
exactly)

```sql
-- STEP181_industry_config_core.sql
CREATE TABLE IF NOT EXISTS industry_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,          -- 'construction','manufacturing',...
  label TEXT NOT NULL,
  icon TEXT, sort_order INT DEFAULT 0, active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS business_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_profile_id UUID NOT NULL,   -- soft ref -> industry_profiles
  key TEXT NOT NULL, label TEXT NOT NULL,
  sort_order INT DEFAULT 0, active BOOLEAN DEFAULT true,
  UNIQUE (industry_profile_id, key)
);

CREATE TABLE IF NOT EXISTS operating_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,          -- 'projects','daily_tasks','shifts',...
  label TEXT NOT NULL, sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workspace_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  industry_profile_id UUID,          -- soft ref, nullable
  business_type_id UUID,             -- soft ref, nullable
  enabled_module_keys TEXT[],        -- null = "no override, use modules table as-is"
  terminology_overrides JSONB DEFAULT '{}',
  is_legacy_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE TABLE IF NOT EXISTS workspace_operating_models (
  workspace_profile_id UUID NOT NULL,  -- soft ref -> workspace_profiles
  operating_model_id UUID NOT NULL,    -- soft ref -> operating_models
  PRIMARY KEY (workspace_profile_id, operating_model_id)
);
```

RLS on all five: `SELECT` permissive within `current_org_id()` (seed
tables `industry_profiles`/`business_types`/`operating_models` are global
— `SELECT` for any authenticated user, `INSERT/UPDATE/DELETE` restricted
to `is_platform_super_admin()` only, matching how e.g. `EXPENSE_CATEGORIES`-
style global lookups are handled); `workspace_profiles`/
`workspace_operating_models` write-gated to `role IN ('admin','ceo')`
within the org, exactly the `STEP91` pattern for `modules`.

```sql
-- STEP182_workspace_legacy_seed.sql
-- One workspace_profiles row per EXISTING organization, pinned to a
-- special LEGACY_DEFAULT industry_profile row. See "Legacy default" below.
INSERT INTO industry_profiles (key, label, sort_order)
VALUES ('legacy_default', 'Legacy (Unconfigured)', -1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO workspace_profiles (organization_id, industry_profile_id, is_legacy_default)
SELECT o.id, (SELECT id FROM industry_profiles WHERE key='legacy_default'), true
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM workspace_profiles wp WHERE wp.organization_id = o.id);
```

```sql
-- STEP183_work_items_core.sql  (Phase 4/7 prep — see IMPLEMENTATION_PLAN)
CREATE TABLE IF NOT EXISTS work_type_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  key TEXT NOT NULL, label TEXT NOT NULL,
  icon TEXT, active BOOLEAN DEFAULT true,
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  work_type_key TEXT NOT NULL,       -- soft ref -> work_type_configs.key
  title TEXT NOT NULL,
  client_id UUID, location_id UUID, department_id UUID,  -- all soft refs, nullable
  status TEXT NOT NULL DEFAULT 'open',
  custom_fields JSONB DEFAULT '{}',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
```

```sql
-- STEP184_task_project_optional.sql  (the ONE change to an existing table)
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS work_item_id UUID; -- soft ref, nullable
-- project_id's existing nullability is whatever STEP180's snapshot found;
-- this migration does NOT change project_id's constraint either way —
-- see "Project-optional Task" in the summary for the actual mechanism.
```

```sql
-- STEP185_work_logs.sql  (Phase 5 prep)
CREATE TABLE IF NOT EXISTS work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  employee_id UUID NOT NULL REFERENCES profiles(id),
  task_id UUID,               -- soft ref -> project_tasks
  checkin_log_id UUID,        -- soft ref -> time_logs, nullable (task work
                               -- outside any check-in session is allowed)
  work_item_id UUID, project_id UUID,  -- soft refs, both nullable
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ, duration_minutes INT,
  description TEXT, evidence_urls TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Every file above ends `NOTIFY pgrst, 'reload schema';` per convention.

## 2. Legacy default — reproducing today exactly

`LEGACY_DEFAULT` is not a code branch, it's data: `is_legacy_default =
true` on a workspace_profiles row with `enabled_module_keys = NULL` and
`terminology_overrides = '{}'`. Every read path added in Phase 1+ treats
`NULL`/`'{}'` as "no override" — so:
- `get_effective_modules()`'s new workspace gate never fires for a
  `NULL` `enabled_module_keys`.
- `useTerm(key)` returns `DEFAULT_TERMS[key]` unchanged when
  `terminology_overrides = '{}'`.
- `ALL_NAV` filtering (Phase 3) is a no-op when there's no workspace
  override.

**No conditional "if legacy then old code path" branches are needed
anywhere** — the defaults of the new tables/columns *are* the legacy
behaviour. This is the safest possible migration shape: existing orgs
are never special-cased, they simply have empty configuration.

## 3. Rollout sequencing

1. `STEP180` (diagnostic, read-only) → capture real schema.
2. `STEP181–182` (Configuration Layer core + legacy seed) → zero
   observable effect on any existing screen; new tables are simply
   unread by any existing code path.
3. `STEP183–185` (Domain/Transaction additions) → same: unread by
   existing code until Phase 4/5/7 application code is written.
4. Feature flags (`industry_workspace`, `universal_tasks`,
   `recurring_tasks`, `task_worklogs`, `adaptive_navigation`,
   `adaptive_forms` — master prompt §45) gate the *application* code
   that starts reading these tables, independent of when the SQL lands.
   Recommend a simple `feature_flags` table (`org_id, flag_key,
   enabled`) rather than env vars, since this is a per-org SaaS and
   different orgs will want different rollout timing.

## 4. What is explicitly NOT migrated

- `projects`, `project_tasks.project_id`, `time_logs`, `checkin_tasks`,
  `timesheet_approvals` — no column drops, no renames, no constraint
  tightening, ever, per master prompt §13/§28/§31/§32.
- No existing RLS policy is replaced; new gates are *added* to
  `get_effective_modules()`'s existing `IF/ELSIF` chain, matching how
  `STEP163`'s allocation gate was itself added to that same function
  without touching the four gates that preceded it.

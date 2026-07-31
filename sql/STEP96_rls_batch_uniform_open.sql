-- ============================================================
-- STEP96: Multi-tenant RLS retrofit — the 35 tables sharing an
-- identical trivial policy (name "open", FOR ALL TO authenticated,
-- USING (true) WITH CHECK (true) — full access, no role gating at all)
-- confirmed via STEP92's live pg_policies dump. One loop covers all 35;
-- profiles gets the same treatment individually right after, since it
-- needs one extra safety clause.
--
-- This single batch spans what were originally planned as separate
-- Core/HR, Procurement (parents), Finance-adjacent, and Projects
-- batches — the ground truth shows they're actually identical in shape,
-- so one migration handles them correctly instead of pretending they
-- need module-specific treatment they don't have today.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';

  FOREACH t IN ARRAY ARRAY[
    'departments','approval_logs','assets','budgets','change_requests','checkin_tasks',
    'cost_centers','epics','expense_requests','grn','invoices','leave_balances',
    'leave_policies','leave_requests','project_assignments','project_budget_config',
    'project_hardware_costs','project_milestones','project_resource_alloc',
    'project_software_costs','project_support_costs','project_tasks','projects',
    'purchase_orders','purchase_requisitions','quotations','resource_rates','sprints',
    'task_role_permissions','task_status_log','time_logs','timesheet_submissions',
    'travel_requests','user_stories','vendors'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
    EXECUTE format('DROP POLICY IF EXISTS open ON %I', t);
    EXECUTE format('CREATE POLICY open ON %I FOR ALL TO authenticated USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id())', t);
  END LOOP;
END $$;

-- ── profiles — same "open" pattern, plus an unconditional self-access
-- clause. Without it, a profile whose organization_id is still NULL
-- (a pre-STEP95 fallback-inserted row, or any edge case) could never
-- see or fix its own row again once organization_id = current_org_id()
-- is enforced, since NULL = NULL is not true in SQL — that would
-- permanently lock the affected user out. organization_id itself stays
-- nullable here (deliberate since STEP89 — see that file's header). ──
DROP POLICY IF EXISTS open ON profiles;
CREATE POLICY open ON profiles FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR id = auth.uid())
  WITH CHECK (organization_id = current_org_id() OR id = auth.uid());

-- ── Deliberately NOT touched in this batch: `sequences` (PR/PO/INV/AST
-- numbering counters, src/lib/supabase.js's nextNum()). Its current
-- schema shows only a single-column PK with no other constraints
-- visible — likely `type TEXT PRIMARY KEY` — and confidently rebuilding
-- that into a composite (organization_id, type) PK without knowing the
-- exact column name risks breaking every numbered-document creation
-- flow (PRs, POs, invoices, assets) across the whole app. Left global
-- for now: every org's documents share one counter, meaning numbers
-- won't be gapless per-org (e.g. org B might see PR-0004 as its first
-- PR) — a cosmetic UX quirk, not a security or correctness issue.
-- Revisit once its exact column names are confirmed.

NOTIFY pgrst, 'reload schema';

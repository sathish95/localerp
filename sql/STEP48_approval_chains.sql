-- ============================================================
-- STEP48: Configurable Approval Chains
-- Makes the approver ROLE assigned to each step of an approval chain
-- admin-editable, and lets admins define new named chains — without
-- changing the underlying status-string vocabulary each engine (and
-- every other page that reads those statuses, e.g. Dashboard/Reports/
-- ApprovalsPage) already depends on.
--
-- workflow: 'expense' | 'travel' | 'procurement' | 'warranty' | 'timesheet' | 'leave'
-- selector_type: how the engine picks which chain applies to a given record
--   'submitter_role' -> selector_value is the submitter's role (expense/travel)
--   'chain_type'      -> selector_value is 'short'/'full' (procurement)
--   'always'          -> the workflow's one chain (warranty/timesheet/leave)
--
-- Run in Supabase SQL Editor after STEP47, then run SEED_approval_chains.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_chains (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow         TEXT        NOT NULL,
  key              TEXT        UNIQUE NOT NULL,
  label            TEXT        NOT NULL,
  selector_type    TEXT        NOT NULL,
  selector_value   TEXT,
  reject_behavior  TEXT        DEFAULT 'terminal', -- 'terminal' | 'reset_to_draft'
  is_active        BOOLEAN     DEFAULT true,
  is_custom        BOOLEAN     DEFAULT false,       -- true for admin-created chains (vs seeded defaults)
  created_by       UUID,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_chain_steps (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  chain_id         UUID        NOT NULL, -- soft ref to approval_chains.id
  step_order       INT         NOT NULL,
  status_value     TEXT        NOT NULL, -- the engine's status string for this position, e.g. 'manager_review'
  approver_role    TEXT        NOT NULL, -- soft ref to roles.role_key — the editable part
  label            TEXT        NOT NULL, -- display name, e.g. "Manager"
  UNIQUE(chain_id, step_order)
);

CREATE INDEX IF NOT EXISTS approval_chains_workflow_idx ON approval_chains(workflow, selector_type, selector_value);
CREATE INDEX IF NOT EXISTS approval_chain_steps_chain_idx ON approval_chain_steps(chain_id, step_order);

ALTER TABLE approval_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_chain_steps ENABLE ROW LEVEL SECURITY;

-- Every engine needs to read these at runtime for any logged-in user acting
-- on a request, so SELECT is permissive; writes are admin/ceo only — same
-- convention as modules.js / llmSettings.js / kb_modules.
DROP POLICY IF EXISTS approval_chains_select ON approval_chains;
CREATE POLICY approval_chains_select ON approval_chains FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS approval_chains_write ON approval_chains;
CREATE POLICY approval_chains_write ON approval_chains FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

DROP POLICY IF EXISTS approval_chain_steps_select ON approval_chain_steps;
CREATE POLICY approval_chain_steps_select ON approval_chain_steps FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS approval_chain_steps_write ON approval_chain_steps;
CREATE POLICY approval_chain_steps_write ON approval_chain_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- STEP32: Budget Revisions (versioned history + approval)
-- Run after STEP31. Reuses the pre-existing generic `approval_logs`
-- table for the audit trail (entity_type='budget_revision') — no
-- bespoke log table, approval_logs already has the right shape.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS budget_revisions (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_id           UUID        NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  revision_number     INT         NOT NULL,          -- client-computed: max(existing)+1
  previous_allocated  NUMERIC(14,2) NOT NULL,
  requested_allocated NUMERIC(14,2) NOT NULL,
  delta               NUMERIC(14,2) NOT NULL,         -- client-computed = requested - previous
  reason              TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review','approved','rejected','cancelled')),
  requested_by        UUID        NOT NULL REFERENCES profiles(id),
  reviewed_by         UUID        REFERENCES profiles(id),
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS budget_revisions_budget_idx  ON budget_revisions(budget_id);
CREATE INDEX IF NOT EXISTS budget_revisions_status_idx  ON budget_revisions(status);
DROP TRIGGER IF EXISTS budget_revisions_updated_at ON budget_revisions;
CREATE TRIGGER budget_revisions_updated_at BEFORE UPDATE ON budget_revisions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE budget_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_revisions_all ON budget_revisions FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_revisions TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- STEP22: Timesheet Approval Workflow
-- Multi-level: Employee → Manager → HR → Finance/CEO
-- ============================================================

CREATE TABLE IF NOT EXISTS timesheet_approvals (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id      UUID         NOT NULL REFERENCES profiles(id),

  period_month     SMALLINT     NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year      SMALLINT     NOT NULL,

  status           TEXT         NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_manager','pending_hr','pending_finance','approved','rejected')),

  total_hours      NUMERIC(7,2) DEFAULT 0,
  total_days       SMALLINT     DEFAULT 0,

  -- Submission
  submitted_at     TIMESTAMPTZ,
  submission_note  TEXT,

  -- Level 1: Manager
  manager_id            UUID REFERENCES profiles(id),
  manager_approved_at   TIMESTAMPTZ,
  manager_comment       TEXT,

  -- Level 2: HR
  hr_id                 UUID REFERENCES profiles(id),
  hr_approved_at        TIMESTAMPTZ,
  hr_comment            TEXT,

  -- Level 3: Finance / CEO
  finance_id            UUID REFERENCES profiles(id),
  finance_approved_at   TIMESTAMPTZ,
  finance_comment       TEXT,

  -- Rejection (any level)
  rejected_by           UUID REFERENCES profiles(id),
  rejected_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  rejected_at_level     TEXT CHECK (rejected_at_level IN ('manager','hr','finance')),

  created_at       TIMESTAMPTZ  DEFAULT now(),
  updated_at       TIMESTAMPTZ  DEFAULT now(),

  UNIQUE (employee_id, period_month, period_year)
);

-- Indexes
CREATE INDEX IF NOT EXISTS ta_status_idx   ON timesheet_approvals(status);
CREATE INDEX IF NOT EXISTS ta_period_idx   ON timesheet_approvals(period_year, period_month);
CREATE INDEX IF NOT EXISTS ta_employee_idx ON timesheet_approvals(employee_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS ta_updated_at ON timesheet_approvals;
CREATE TRIGGER ta_updated_at
  BEFORE UPDATE ON timesheet_approvals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE timesheet_approvals ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS ta_employee_own   ON timesheet_approvals;
DROP POLICY IF EXISTS ta_approvers_all  ON timesheet_approvals;

-- Employees see only their own records
CREATE POLICY ta_employee_own ON timesheet_approvals
  FOR ALL USING (employee_id = auth.uid());

-- Managers / HR / Finance / Admin / CEO see all records
CREATE POLICY ta_approvers_all ON timesheet_approvals
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','ceo','manager','department_head','hr','finance')
    )
  );

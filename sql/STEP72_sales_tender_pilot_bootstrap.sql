-- ============================================================
-- STEP72: Sales & Pre-Sales CRM — Part 3, the three non-standard entry
-- tracks (Government Tender, Non-Government Pilot, Bootstrap/Startup
-- Program). Each converges back into sales_opportunities on
-- win/conversion (won_opportunity_id / converted_opportunity_id),
-- tagged with the right source_type — same convergence principle as
-- Lead -> Opportunity in STEP70.
--
-- sales_marketing_budget_lines stands in for the spec's "existing Budget
-- Line entity" — no such standalone master entity exists in this
-- codebase (Budget & Finance here is per-project: `budgets`,
-- project_planned_budget from STEP64), and Bootstrap spend explicitly
-- ISN'T project-scoped, so a small dedicated table gives it the same
-- planned-amount + approval discipline without forcing it into a
-- project-shaped table.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_tenders (
  id                             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tender_number                  TEXT          NOT NULL,
  issuing_body                   TEXT          NOT NULL,
  submission_deadline            DATE,
  eligibility_criteria_checklist JSONB         NOT NULL DEFAULT '[]',
  document_uploads               JSONB         NOT NULL DEFAULT '[]',
  bid_amount                     NUMERIC(14,2),
  currency                       TEXT          NOT NULL DEFAULT 'INR',
  status                         TEXT          NOT NULL DEFAULT 'Identified' CHECK (status IN (
                                   'Identified','Eligibility Check','Documents Prepared','Submitted','Under Evaluation','Won','Lost'
                                 )),
  won_opportunity_id             UUID,          -- soft ref -> sales_opportunities, set on Won
  created_by                     UUID          REFERENCES profiles(id),
  created_at                     TIMESTAMPTZ   DEFAULT now(),
  updated_at                     TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_tenders_status_idx ON sales_tenders(status);

DROP TRIGGER IF EXISTS sales_tenders_updated_at ON sales_tenders;
CREATE TRIGGER sales_tenders_updated_at BEFORE UPDATE ON sales_tenders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sales_pilot_projects (
  id                      UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_name           TEXT          NOT NULL,
  product_piloted         TEXT          REFERENCES products(part_number),  -- matches part_number convention (STEP62), not products.id
  pilot_cost              NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency                TEXT          NOT NULL DEFAULT 'INR',
  pilot_duration          TEXT,
  start_date              DATE,
  end_date                DATE,
  conversion_outcome      TEXT          CHECK (conversion_outcome IN ('Converted','Not Converted')),
  conversion_reason       TEXT,
  converted_opportunity_id UUID,          -- soft ref -> sales_opportunities, set on conversion
  created_by               UUID          REFERENCES profiles(id),
  created_at                TIMESTAMPTZ   DEFAULT now(),
  updated_at                TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_pilot_projects_outcome_idx ON sales_pilot_projects(conversion_outcome);

DROP TRIGGER IF EXISTS sales_pilot_projects_updated_at ON sales_pilot_projects;
CREATE TRIGGER sales_pilot_projects_updated_at BEFORE UPDATE ON sales_pilot_projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sales_marketing_budget_lines (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  period_label    TEXT          NOT NULL,   -- e.g. 'FY2026'
  category        TEXT          NOT NULL DEFAULT 'Marketing — Bootstrap/Startup Program',
  planned_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT          NOT NULL DEFAULT 'INR',
  approved_by     UUID          REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ   DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_bootstrap_programs (
  id                       UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  program_name             TEXT          NOT NULL,
  target_segment           TEXT          NOT NULL CHECK (target_segment IN ('Startups','Incubators','Accelerator Partners')),
  participant_company_name TEXT          NOT NULL,
  product_provided         TEXT          REFERENCES products(part_number),
  cost_absorbed             NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency                  TEXT          NOT NULL DEFAULT 'INR',
  marketing_budget_line_id  UUID          REFERENCES sales_marketing_budget_lines(id),
  program_duration          TEXT,
  status                    TEXT          NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed')),
  conversion_outcome        TEXT          CHECK (conversion_outcome IN ('Converted to Paid Deal','Ongoing','Not Converted')),
  converted_opportunity_id  UUID,          -- soft ref -> sales_opportunities
  created_by                 UUID          REFERENCES profiles(id),
  created_at                  TIMESTAMPTZ   DEFAULT now(),
  updated_at                  TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_bootstrap_programs_status_idx ON sales_bootstrap_programs(status);
CREATE INDEX IF NOT EXISTS sales_bootstrap_programs_budget_line_idx ON sales_bootstrap_programs(marketing_budget_line_id);

DROP TRIGGER IF EXISTS sales_bootstrap_programs_updated_at ON sales_bootstrap_programs;
CREATE TRIGGER sales_bootstrap_programs_updated_at BEFORE UPDATE ON sales_bootstrap_programs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Shared status-change audit trail for all three tracks (Part 8).
CREATE TABLE IF NOT EXISTS sales_status_audit_log (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type  TEXT        NOT NULL CHECK (entity_type IN ('Tender','PilotProject','BootstrapProgram')),
  entity_id    UUID        NOT NULL,
  from_status  TEXT,
  to_status    TEXT        NOT NULL,
  changed_by   UUID        REFERENCES profiles(id),
  changed_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_status_audit_log_entity_idx ON sales_status_audit_log(entity_type, entity_id);

ALTER TABLE sales_tenders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_pilot_projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_marketing_budget_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_bootstrap_programs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_status_audit_log        ENABLE ROW LEVEL SECURITY;

-- These tracks carry cost/budget fields, so finance is included in the
-- write-gate alongside sales leadership (unlike STEP70's plain rep-level
-- write access).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_tenders','sales_pilot_projects','sales_marketing_budget_lines','sales_bootstrap_programs','sales_status_audit_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''finance''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''finance''))
       )', t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.sales_tenders, public.sales_pilot_projects, public.sales_marketing_budget_lines,
  public.sales_bootstrap_programs, public.sales_status_audit_log
  TO authenticated;

NOTIFY pgrst, 'reload schema';

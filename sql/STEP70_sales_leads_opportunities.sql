-- ============================================================
-- STEP70: Sales & Pre-Sales CRM — Part 1's core convergence entities.
-- Lead -> Opportunity is the single lifecycle every entry track (direct
-- inbound/outbound, Won Tender, Converted Pilot, Converted Bootstrap
-- Program) eventually lands in; Opportunity.linked_proposal_id is set
-- once src/lib/salesOpportunities.js's convertToProposal() calls the
-- EXISTING createProposal() (src/lib/proposals.js) — no proposal/cost
-- logic duplicated here.
--
-- "Overdue" is intentionally NOT a stored sales_tasks.status value — it's
-- computed client-side (due_date < today && status <> 'Completed') so it
-- can never go stale between recomputes.
--
-- sales_stage_audit_log / sales_task_reassignment_log satisfy Part 8's
-- audit-trail requirement for Opportunity stage changes and Task
-- reassignment.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_leads (
  id                          UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_number                 TEXT          UNIQUE,
  source                      TEXT,          -- soft ref -> sales_lead_sources.name (admin-editable list, free text)
  domain                      TEXT          NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  region_id                   UUID          REFERENCES sales_regions(id),
  contact_name                TEXT          NOT NULL,
  company_name                TEXT,          -- nullable for B2C/D2C individual buyers
  product_interest_id         TEXT          REFERENCES products(part_number),  -- matches proposal_hardware_lines' part_number convention (STEP62), not products.id
  product_launch_interest_id  UUID,          -- soft ref -> product_launches (STEP71)
  status                      TEXT          NOT NULL DEFAULT 'New' CHECK (status IN (
                                'New','Contacted','Qualified','Disqualified','Converted to Opportunity','Unassigned — Needs Coverage'
                              )),
  assigned_rep_id              UUID          REFERENCES profiles(id),  -- nullable; real FK, embedded via PostgREST in src/lib/salesLeads.js
  coverage_alert_sent_at       TIMESTAMPTZ,
  coverage_alert_resolved_by   UUID,          -- soft ref -> profiles
  created_by                   UUID          REFERENCES profiles(id),
  created_at                   TIMESTAMPTZ   DEFAULT now(),
  updated_at                   TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_leads_status_idx ON sales_leads(status);
CREATE INDEX IF NOT EXISTS sales_leads_region_domain_idx ON sales_leads(region_id, domain);
CREATE INDEX IF NOT EXISTS sales_leads_assigned_rep_idx ON sales_leads(assigned_rep_id);

DROP TRIGGER IF EXISTS sales_leads_updated_at ON sales_leads;
CREATE TRIGGER sales_leads_updated_at BEFORE UPDATE ON sales_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sales_opportunities (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_number    TEXT          UNIQUE,
  lead_id               UUID          REFERENCES sales_leads(id),  -- nullable (Won Tender / Converted Pilot / Bootstrap don't originate from a Lead)
  domain                TEXT          NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  region_id             UUID          REFERENCES sales_regions(id),
  assigned_rep_id        UUID          REFERENCES profiles(id),
  pipeline_stage         TEXT          NOT NULL,  -- soft ref -> sales_pipeline_stages.stage_name (scoped by domain), validated app-side since it's dynamic per domain
  expected_close_date    DATE,
  expected_value         NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency                TEXT          NOT NULL DEFAULT 'INR',
  probability_percent     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  status                  TEXT          NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Won','Lost')),
  linked_proposal_id      UUID,          -- soft ref -> proposals, set once Convert to Proposal is used
  source_type             TEXT          NOT NULL DEFAULT 'Direct' CHECK (source_type IN ('Direct','Won Tender','Converted Pilot','Converted Bootstrap Program')),
  created_by               UUID          REFERENCES profiles(id),
  created_at               TIMESTAMPTZ   DEFAULT now(),
  updated_at               TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_opportunities_status_idx ON sales_opportunities(status);
CREATE INDEX IF NOT EXISTS sales_opportunities_region_domain_idx ON sales_opportunities(region_id, domain);
CREATE INDEX IF NOT EXISTS sales_opportunities_assigned_rep_idx ON sales_opportunities(assigned_rep_id);
CREATE INDEX IF NOT EXISTS sales_opportunities_linked_proposal_idx ON sales_opportunities(linked_proposal_id);

DROP TRIGGER IF EXISTS sales_opportunities_updated_at ON sales_opportunities;
CREATE TRIGGER sales_opportunities_updated_at BEFORE UPDATE ON sales_opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sales_activities (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  related_to_type       TEXT          NOT NULL CHECK (related_to_type IN ('Lead','Opportunity')),
  related_to_id         UUID          NOT NULL,
  activity_type         TEXT          NOT NULL,  -- soft ref -> sales_activity_types.name
  direction              TEXT          NOT NULL CHECK (direction IN ('Inbound','Outbound')),
  performed_by           UUID          NOT NULL REFERENCES profiles(id),
  activity_date           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  duration_minutes        INT,
  notes                    TEXT,
  outcome                  TEXT,          -- soft ref -> sales_activity_outcomes.name
  next_follow_up_date      DATE,
  created_at               TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_activities_related_idx ON sales_activities(related_to_type, related_to_id);
CREATE INDEX IF NOT EXISTS sales_activities_performed_by_idx ON sales_activities(performed_by);

CREATE TABLE IF NOT EXISTS sales_tasks (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  related_to_type       TEXT          NOT NULL CHECK (related_to_type IN ('Lead','Opportunity','Proposal')),
  related_to_id         UUID          NOT NULL,
  task_type              TEXT          NOT NULL,  -- soft ref -> sales_task_types.name
  assigned_to             UUID          NOT NULL REFERENCES profiles(id),
  due_date                 DATE          NOT NULL,
  priority                 TEXT          NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  status                   TEXT          NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Completed')),
  created_by               UUID          REFERENCES profiles(id),
  linked_activity_id       UUID,          -- soft ref -> sales_activities, nullable
  created_at               TIMESTAMPTZ   DEFAULT now(),
  updated_at               TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_tasks_assigned_to_idx ON sales_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS sales_tasks_related_idx ON sales_tasks(related_to_type, related_to_id);
CREATE INDEX IF NOT EXISTS sales_tasks_due_date_idx ON sales_tasks(due_date);

DROP TRIGGER IF EXISTS sales_tasks_updated_at ON sales_tasks;
CREATE TRIGGER sales_tasks_updated_at BEFORE UPDATE ON sales_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Audit trails (Part 8's non-functional requirement) ──
CREATE TABLE IF NOT EXISTS sales_stage_audit_log (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id  UUID        NOT NULL,   -- soft ref -> sales_opportunities
  from_stage      TEXT,
  to_stage        TEXT        NOT NULL,
  changed_by      UUID        REFERENCES profiles(id),
  changed_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_stage_audit_log_opp_idx ON sales_stage_audit_log(opportunity_id);

CREATE TABLE IF NOT EXISTS sales_task_reassignment_log (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id        UUID        NOT NULL,   -- soft ref -> sales_tasks
  from_employee  UUID,          -- soft ref -> profiles
  to_employee    UUID,          -- soft ref -> profiles
  changed_by     UUID        REFERENCES profiles(id),
  changed_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_task_reassignment_log_task_idx ON sales_task_reassignment_log(task_id);

ALTER TABLE sales_leads                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_opportunities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_activities             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_tasks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_stage_audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_task_reassignment_log  ENABLE ROW LEVEL SECURITY;

-- "My region only" / "my leads only" is enforced at the query layer
-- (src/lib/salesLeads.js etc.) — RLS here follows this codebase's
-- dominant pattern (permissive SELECT, role-gated writes), matching
-- every existing table's RLS rather than encoding row-level ownership.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_leads','sales_opportunities','sales_activities','sales_tasks','sales_stage_audit_log','sales_task_reassignment_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops''))
       )', t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.sales_leads, public.sales_opportunities, public.sales_activities, public.sales_tasks,
  public.sales_stage_audit_log, public.sales_task_reassignment_log
  TO authenticated;

NOTIFY pgrst, 'reload schema';

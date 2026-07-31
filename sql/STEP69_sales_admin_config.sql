-- ============================================================
-- STEP69: Sales & Pre-Sales CRM — Part 7's admin config backing tables.
-- Everything here is meant to be edited from the new "Sales Config" tab
-- in Settings, not hardcoded — pipeline stages per domain, lookup lists,
-- assignment rules, stale/overdue thresholds, and a small generic
-- key/value flag table (mirrors modules.enabled's simple flag-row idea).
-- ============================================================

-- ── Pipeline stages — admin-configurable PER DOMAIN (B2B may have 6
-- stages, D2C 3) — this is why approval_chains (STEP48) doesn't fit:
-- that system varies the approver at a fixed status vocabulary, not an
-- arbitrary admin-defined stage list. ──
CREATE TABLE IF NOT EXISTS sales_pipeline_stages (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  domain                    TEXT          NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  stage_name                TEXT          NOT NULL,
  sort_order                INT           NOT NULL DEFAULT 0,
  default_probability_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active                 BOOLEAN       NOT NULL DEFAULT true,
  UNIQUE(domain, stage_name)
);

INSERT INTO sales_pipeline_stages (domain, stage_name, sort_order, default_probability_percent) VALUES
  ('B2B','Prospecting',1,10), ('B2B','Qualified',2,25), ('B2B','Needs Analysis',3,40),
  ('B2B','Proposal Sent',4,60), ('B2B','Negotiation',5,80), ('B2B','Closing',6,90),
  ('B2C','Enquiry',1,20), ('B2C','Quoted',2,50), ('B2C','Closing',3,85),
  ('D2C','Interested',1,30), ('D2C','Quoted',2,60), ('D2C','Closing',3,90),
  ('Government','Identified',1,10), ('Government','Tender Submitted',2,35), ('Government','Under Evaluation',3,55), ('Government','Closing',4,85),
  ('Non-Government','Pilot Proposed',1,20), ('Non-Government','Pilot Running',2,45), ('Non-Government','Conversion Discussion',3,70), ('Non-Government','Closing',4,90)
ON CONFLICT (domain, stage_name) DO NOTHING;

-- ── Simple admin-editable lookup lists ──
CREATE TABLE IF NOT EXISTS sales_lead_sources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO sales_lead_sources (name) VALUES ('Campaign'),('Referral'),('Website'),('Cold Outreach'),('Tender Portal'),('Inbound Call') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_activity_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO sales_activity_types (name) VALUES ('Call'),('Email'),('Meeting'),('Demo'),('Site Visit') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_task_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO sales_task_types (name) VALUES ('Follow-up Call'),('Send Proposal'),('Site Visit'),('Internal Review'),('Document Collection') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_activity_outcomes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO sales_activity_outcomes (name) VALUES ('Connected'),('No Answer'),('Interested'),('Not Interested'),('Follow-up Scheduled') ON CONFLICT (name) DO NOTHING;

-- ── Assignment rules — how createLead() picks assigned_rep_id ──
CREATE TABLE IF NOT EXISTS sales_assignment_rules (
  id          UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  domain      TEXT          NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  region_id   UUID          REFERENCES sales_regions(id),  -- nullable (domain-wide rule); real FK, embedded via PostgREST
  rule_type   TEXT          NOT NULL DEFAULT 'domain_region_match' CHECK (rule_type IN ('round_robin','manual','domain_region_match')),
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   DEFAULT now()
);

-- ── Stale-lead / overdue-task thresholds — Part 8 §4's seeded defaults ──
CREATE TABLE IF NOT EXISTS sales_stale_threshold_config (
  id                            UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  domain                        TEXT          NOT NULL UNIQUE CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  stale_lead_days               INT           NOT NULL,
  task_overdue_escalation_days  INT           NOT NULL,
  applies_to_region_id          UUID          REFERENCES sales_regions(id),  -- nullable region override; real FK, embedded via PostgREST
  notes                         TEXT
);
INSERT INTO sales_stale_threshold_config (domain, stale_lead_days, task_overdue_escalation_days, notes) VALUES
  ('B2B', 14, 3, 'Flag immediately at due_date, escalate to manager after 3 days overdue'),
  ('B2C', 5, 1, 'Flag immediately at due_date, escalate after 1 day overdue'),
  ('D2C', 3, 1, 'Flag immediately at due_date, escalate after 1 day overdue'),
  ('Government', 30, 7, 'Tender cycles run long — escalate at deadline minus 7 days if incomplete, not a fixed grace'),
  ('Non-Government', 14, 3, 'Pilot Project track — flag immediately at due_date, escalate after 3 days overdue')
ON CONFLICT (domain) DO NOTHING;

-- ── Config flags — small key/value table, mirrors modules.enabled's
-- simple flag-row idea. view_sales_profit_attribution_individual gates
-- whether a rep can see their OWN attribution row (default OFF per
-- Part 8 §2 — booked revenue and actual delivered profit are different
-- things and showing the gap risks feeling punitive in v1). ──
CREATE TABLE IF NOT EXISTS sales_config_flags (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_by  UUID        REFERENCES profiles(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
INSERT INTO sales_config_flags (key, value) VALUES ('view_sales_profit_attribution_individual', 'false')
ON CONFLICT (key) DO NOTHING;

DROP TRIGGER IF EXISTS sales_config_flags_updated_at ON sales_config_flags;
CREATE TRIGGER sales_config_flags_updated_at BEFORE UPDATE ON sales_config_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sales_pipeline_stages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lead_sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_activity_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_task_types              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_activity_outcomes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_assignment_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_stale_threshold_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_config_flags            ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales_pipeline_stages','sales_lead_sources','sales_activity_types','sales_task_types',
    'sales_activity_outcomes','sales_assignment_rules','sales_stale_threshold_config','sales_config_flags'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       )', t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.sales_pipeline_stages, public.sales_lead_sources, public.sales_activity_types, public.sales_task_types,
  public.sales_activity_outcomes, public.sales_assignment_rules, public.sales_stale_threshold_config, public.sales_config_flags
  TO authenticated;

NOTIFY pgrst, 'reload schema';

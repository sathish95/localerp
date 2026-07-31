-- ============================================================
-- STEP73: Sales & Pre-Sales CRM — Part 4, Finance integration rollups.
-- Both tables are cached/materialized rollups, recomputed by explicit JS
-- calls after the relevant mutation (src/lib/salesFinance.js), never
-- computed live on every request — same pattern as profit_margins
-- (STEP35) / src/lib/profitMargin.js's recomputeMargin(), which this
-- module reuses rather than reimplementing: sales_profit_attribution
-- reads profit_margins.gross_margin/margin_percent for the Won
-- Opportunity's linked project, it doesn't recompute actual cost itself.
--
-- sales_profit_attribution is the one deliberate RLS exception in this
-- module: default-closed to Sales Head + Finance + admin/ceo at the DB
-- level (Part 8 §2 — a rep shouldn't see their deal look "less
-- profitable" over warranty/change costs outside their control, at least
-- not until the metric has track record). Regional Sales Head
-- region-scoping and the view_sales_profit_attribution_individual
-- flag-based loosening for reps happen in src/lib/salesFinance.js on top
-- of this floor.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_revenue_forecast (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  region_id         UUID,          -- soft ref -> sales_regions, nullable (company-wide row when null)
  domain            TEXT,          -- nullable (all-domains row when null)
  sales_rep_id      UUID,          -- soft ref -> profiles, nullable (region/domain-level row when null)
  period_key        TEXT          NOT NULL DEFAULT 'ALL',   -- 'ALL' cumulative, or e.g. '2026-07'
  pipeline_value     NUMERIC(14,2) NOT NULL DEFAULT 0,
  weighted_forecast   NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_won_value    NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_lost_value   NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency             TEXT          NOT NULL DEFAULT 'INR',
  computed_at           TIMESTAMPTZ   DEFAULT now()
);
-- NULLS are not distinct for uniqueness purposes by default in Postgres
-- (two NULL region_id rows would both satisfy a plain UNIQUE constraint),
-- so the company-wide/all-domain/all-rep rollup row is guarded by
-- COALESCE'd expression indexes instead of a bare UNIQUE(...).
CREATE UNIQUE INDEX IF NOT EXISTS sales_revenue_forecast_grain_idx ON sales_revenue_forecast (
  COALESCE(region_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(domain, ''),
  COALESCE(sales_rep_id, '00000000-0000-0000-0000-000000000000'),
  period_key
);

CREATE TABLE IF NOT EXISTS sales_profit_attribution (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  region_id        UUID          REFERENCES sales_regions(id),
  domain           TEXT,
  sales_rep_id     UUID          REFERENCES profiles(id),
  opportunity_id   UUID          NOT NULL UNIQUE,  -- soft ref -> sales_opportunities
  project_id       UUID,          -- soft ref -> projects
  gross_margin     NUMERIC(14,2) NOT NULL DEFAULT 0,
  margin_percent   NUMERIC(6,2)  NOT NULL DEFAULT 0,
  currency          TEXT          NOT NULL DEFAULT 'INR',
  computed_at        TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_profit_attribution_region_domain_idx ON sales_profit_attribution(region_id, domain);
CREATE INDEX IF NOT EXISTS sales_profit_attribution_rep_idx ON sales_profit_attribution(sales_rep_id);

ALTER TABLE sales_revenue_forecast   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_profit_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_revenue_forecast_select ON sales_revenue_forecast;
DROP POLICY IF EXISTS sales_revenue_forecast_write  ON sales_revenue_forecast;
CREATE POLICY sales_revenue_forecast_select ON sales_revenue_forecast FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sales_revenue_forecast_write ON sales_revenue_forecast FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','regional_sales_head','sales_rep','sales_ops','finance'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','regional_sales_head','sales_rep','sales_ops','finance'))
);

-- Deliberately NOT permissive SELECT — floor is admin/ceo/finance/sales_head.
DROP POLICY IF EXISTS sales_profit_attribution_select ON sales_profit_attribution;
DROP POLICY IF EXISTS sales_profit_attribution_write  ON sales_profit_attribution;
CREATE POLICY sales_profit_attribution_select ON sales_profit_attribution FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_head'))
);
CREATE POLICY sales_profit_attribution_write ON sales_profit_attribution FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_head'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_head'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_revenue_forecast, public.sales_profit_attribution TO authenticated;

NOTIFY pgrst, 'reload schema';

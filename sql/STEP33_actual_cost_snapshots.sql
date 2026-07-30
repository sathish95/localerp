-- ============================================================
-- STEP33: Actual Cost & Burn Rate — Materialized Snapshots
-- Mirrors capacity_snapshots (STEP30): recomputed client-side only,
-- never via trigger/procedure. Run after STEP31 (needs role_rates)
-- and STEP32.
-- ============================================================

CREATE TABLE IF NOT EXISTS actual_cost_snapshots (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id        UUID        NOT NULL REFERENCES projects(id),
  period_type       TEXT        NOT NULL DEFAULT 'month' CHECK (period_type IN ('month','to_date')),
  period_key        TEXT        NOT NULL,     -- 'YYYY-MM' for month rows, 'ALL' for the to-date rollup row
  people_cost       NUMERIC(14,2) DEFAULT 0,  -- allocations.allocation_hours_per_week × role_rates, overlap-windowed
  hardware_cost     NUMERIC(14,2) DEFAULT 0,  -- SUM(invoices.total_amount) recognized spend, this project/period
  total_actual_cost NUMERIC(14,2) DEFAULT 0,  -- people_cost + hardware_cost, computed client-side
  computed_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, period_type, period_key)
);
CREATE INDEX IF NOT EXISTS actual_cost_project_idx ON actual_cost_snapshots(project_id);

ALTER TABLE actual_cost_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY actual_cost_snapshots_all ON actual_cost_snapshots FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.actual_cost_snapshots TO authenticated;

NOTIFY pgrst, 'reload schema';

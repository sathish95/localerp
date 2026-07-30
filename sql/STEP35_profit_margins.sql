-- ============================================================
-- STEP35: Profit Margins — the ONE table with genuinely restricted
-- server-side RLS instead of this app's usual permissive pattern.
-- Run LAST — depends on actual_cost_snapshots (STEP33) and
-- customer_invoices (STEP34) as its input data sources.
-- ============================================================

CREATE TABLE IF NOT EXISTS profit_margins (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id         UUID        NOT NULL REFERENCES projects(id),
  period_key         TEXT        NOT NULL DEFAULT 'ALL',   -- 'YYYY-MM' or 'ALL' (lifetime-to-date)
  revenue_recognized NUMERIC(14,2) DEFAULT 0,               -- SUM(customer_invoices) sent/paid for the project/period
  total_actual_cost  NUMERIC(14,2) DEFAULT 0,               -- mirrors actual_cost_snapshots.total_actual_cost, same period
  gross_margin       NUMERIC(14,2) DEFAULT 0,               -- revenue - cost, computed client-side
  margin_percent     NUMERIC(6,2)  DEFAULT 0,
  computed_at        TIMESTAMPTZ DEFAULT now(),
  computed_by        UUID        REFERENCES profiles(id),
  UNIQUE (project_id, period_key)
);
CREATE INDEX IF NOT EXISTS profit_margins_project_idx ON profit_margins(project_id);

ALTER TABLE profit_margins ENABLE ROW LEVEL SECURITY;

-- Genuinely restricted — checks profiles.role for the CURRENT auth.uid() server-side.
-- Role set intentionally matches the existing /fundflow route's `isFinance` gate in
-- App.jsx (['admin','ceo','finance']) — the closest existing "sensitive financial
-- data" precedent already proven in this app, not an arbitrary new list.
CREATE POLICY profit_margins_select ON profit_margins FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY profit_margins_insert ON profit_margins FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY profit_margins_update ON profit_margins FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
-- Deliberately NO DELETE policy — rows are immutable snapshots, corrected via
-- upsert-on-conflict(project_id, period_key), same pattern as capacity_snapshots.

-- GRANT is still required even with a restrictive RLS policy: GRANT governs
-- table-level privilege, RLS governs row-level visibility. A role that fails the
-- RLS USING clause but lacks the table GRANT would get a hard permission-denied
-- error instead of a clean empty result set — GRANT must exist so that Postgres
-- evaluates RLS at all and non-permitted roles simply see 0 rows (not an error).
GRANT SELECT, INSERT, UPDATE ON public.profit_margins TO authenticated;
-- No DELETE grant — matches the "no DELETE policy" above.

NOTIFY pgrst, 'reload schema';

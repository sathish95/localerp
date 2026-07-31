-- ============================================================
-- STEP78: Landing Links — grant the campaign_manager role (added in
-- STEP76, after STEP75's original RLS policy was written) write access
-- too, since Campaign Managers are the ones expected to create/manage
-- these links day-to-day, not just admin/ceo/sales_head/sales_ops/cmo.
-- ============================================================

DROP POLICY IF EXISTS sales_landing_links_write ON sales_landing_links;
CREATE POLICY sales_landing_links_write ON sales_landing_links FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','sales_ops','cmo','campaign_manager'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','sales_ops','cmo','campaign_manager'))
);

NOTIFY pgrst, 'reload schema';

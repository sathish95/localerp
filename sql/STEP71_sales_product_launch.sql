-- ============================================================
-- STEP71: Sales & Pre-Sales CRM — Part 2, product coverage (available +
-- upcoming). products.sales_status is added directly to the existing
-- catalog table (not duplicated) per the module spec; ProductLaunch
-- tracks pre-catalog products so sales can log real pre-launch demand
-- signal before engineering ships anything.
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS sales_status TEXT NOT NULL DEFAULT 'Available'
  CHECK (sales_status IN ('Available','Discontinued','Limited Stock'));

CREATE TABLE IF NOT EXISTS product_launches (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  product_name        TEXT          NOT NULL,
  description          TEXT,
  target_launch_date   DATE,
  development_stage    TEXT          NOT NULL DEFAULT 'Concept' CHECK (development_stage IN ('Concept','Development','Beta','Pilot-Ready','Launched')),
  linked_product_id    TEXT          REFERENCES products(part_number),  -- set once it becomes a real catalog product; matches part_number convention (STEP62), not products.id
  created_by            UUID          REFERENCES profiles(id),
  created_at             TIMESTAMPTZ   DEFAULT now(),
  updated_at             TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_launches_stage_idx ON product_launches(development_stage);

DROP TRIGGER IF EXISTS product_launches_updated_at ON product_launches;
CREATE TRIGGER product_launches_updated_at BEFORE UPDATE ON product_launches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_launch_interest (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           UUID,          -- soft ref -> sales_leads, nullable
  opportunity_id    UUID,          -- soft ref -> sales_opportunities, nullable
  product_launch_id UUID          NOT NULL,  -- soft ref -> product_launches
  notes              TEXT,
  created_at          TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_launch_interest_launch_idx ON product_launch_interest(product_launch_id);

ALTER TABLE product_launches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_launch_interest  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_launches','product_launch_interest'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops'',''cto''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops'',''cto''))
       )', t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_launches, public.product_launch_interest TO authenticated;

NOTIFY pgrst, 'reload schema';

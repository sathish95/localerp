-- ============================================================
-- STEP51: Product-wise multi-level Bill of Materials.
-- A self-referencing relationship on top of the existing products catalog —
-- parent_part_number/component_part_number are both soft refs to
-- products.part_number, same convention as device_instances.part_number
-- and purchase_requisition_items.part_number elsewhere in this schema.
-- Multi-level nesting (a component can itself have components) is just
-- this same relationship applied recursively in application code
-- (src/lib/bom.js) — cycle prevention (A contains B, B contains A,
-- directly or transitively) is enforced there before every insert, not in
-- SQL, since Postgres CHECK constraints can't see across rows. The
-- CHECK below only blocks the trivial direct self-reference case.
-- Run in Supabase SQL Editor after STEP25_procurement_masterdata.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_bom_components (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_part_number     TEXT        NOT NULL,
  component_part_number  TEXT        NOT NULL,
  quantity               NUMERIC     NOT NULL DEFAULT 1,
  notes                  TEXT,
  created_by             UUID,
  created_at             TIMESTAMPTZ DEFAULT now(),
  UNIQUE(parent_part_number, component_part_number),
  CHECK (parent_part_number <> component_part_number)
);

CREATE INDEX IF NOT EXISTS product_bom_parent_idx    ON product_bom_components(parent_part_number);
CREATE INDEX IF NOT EXISTS product_bom_component_idx ON product_bom_components(component_part_number);

ALTER TABLE product_bom_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_bom_select ON product_bom_components;
DROP POLICY IF EXISTS product_bom_write  ON product_bom_components;

-- Everyone reads (documentation-like, not sensitive) — same convention as
-- kb_modules/approval_chains. Write matches ProductsPage.jsx's existing
-- canEdit role set exactly (same roles who can already edit the catalog).
CREATE POLICY product_bom_select ON product_bom_components FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY product_bom_write  ON product_bom_components FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

NOTIFY pgrst, 'reload schema';

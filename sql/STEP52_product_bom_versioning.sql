-- ============================================================
-- STEP52: Product BOM versioning — supersedes STEP51's flat
-- product_bom_components table (introduced the same session, no real data
-- riding on it yet) with a real versioned-document model: a version header
-- per product (product_bom_versions — one row per save, exactly one marked
-- 'active' at a time) and that version's component snapshot underneath it
-- (product_bom_version_components). Every save creates a new version rather
-- than mutating the current one, so history is never lost.
--
-- save_bom_version() does the archive-old + insert-new + insert-components
-- sequence as one real Postgres transaction (SECURITY DEFINER, since the
-- Supabase JS client has no multi-statement transaction of its own) — a
-- partial failure can't leave a product with zero active versions or two
-- active versions at once. It re-checks the caller's role itself (mirroring
-- the RLS write policy below) since SECURITY DEFINER bypasses RLS.
--
-- Run in Supabase SQL Editor after STEP25_procurement_masterdata.sql.
-- ============================================================

DROP TABLE IF EXISTS product_bom_components CASCADE;

CREATE TABLE IF NOT EXISTS product_bom_versions (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number  TEXT        NOT NULL,               -- soft ref to products.part_number
  version_no   INT         NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  notes        TEXT,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(part_number, version_no)
);

-- Enforces "exactly one active version per product" at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS product_bom_versions_active_idx ON product_bom_versions(part_number) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS product_bom_versions_part_idx ON product_bom_versions(part_number);

CREATE TABLE IF NOT EXISTS product_bom_version_components (
  id                     UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id             UUID    NOT NULL,   -- soft ref to product_bom_versions.id
  component_part_number  TEXT    NOT NULL,   -- soft ref to products.part_number
  quantity               NUMERIC NOT NULL DEFAULT 1,
  notes                  TEXT
);
CREATE INDEX IF NOT EXISTS product_bom_version_components_version_idx ON product_bom_version_components(version_id);
CREATE INDEX IF NOT EXISTS product_bom_version_components_part_idx ON product_bom_version_components(component_part_number);

ALTER TABLE product_bom_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_bom_version_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_bom_versions_select ON product_bom_versions;
DROP POLICY IF EXISTS product_bom_versions_write  ON product_bom_versions;
DROP POLICY IF EXISTS product_bom_version_components_select ON product_bom_version_components;
DROP POLICY IF EXISTS product_bom_version_components_write  ON product_bom_version_components;

-- Everyone reads (documentation-like, not sensitive) — same convention as
-- kb_modules/approval_chains. Write matches ProductsPage.jsx's existing
-- canEdit role set exactly. Row-level writes normally go through the
-- save_bom_version() RPC below (which is SECURITY DEFINER and does its own
-- role check), but these policies still gate any direct table access.
CREATE POLICY product_bom_versions_select ON product_bom_versions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY product_bom_versions_write  ON product_bom_versions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);
CREATE POLICY product_bom_version_components_select ON product_bom_version_components FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY product_bom_version_components_write  ON product_bom_version_components FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

CREATE OR REPLACE FUNCTION save_bom_version(
  p_part_number TEXT,
  p_components  JSONB,   -- array of {component_part_number, quantity, notes}
  p_user_id     UUID,
  p_notes       TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_next_version INT;
  v_new_version_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead')) THEN
    RAISE EXCEPTION 'Not authorized to edit BOM';
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_version FROM product_bom_versions WHERE part_number = p_part_number;

  UPDATE product_bom_versions SET status = 'archived' WHERE part_number = p_part_number AND status = 'active';

  INSERT INTO product_bom_versions (part_number, version_no, status, notes, created_by)
    VALUES (p_part_number, v_next_version, 'active', p_notes, p_user_id)
    RETURNING id INTO v_new_version_id;

  INSERT INTO product_bom_version_components (version_id, component_part_number, quantity, notes)
    SELECT v_new_version_id, (c->>'component_part_number')::TEXT, (c->>'quantity')::NUMERIC, c->>'notes'
    FROM jsonb_array_elements(p_components) AS c;

  RETURN v_new_version_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_bom_version(TEXT, JSONB, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

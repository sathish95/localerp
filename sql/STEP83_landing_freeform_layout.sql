-- ============================================================
-- STEP83: Landing Page Builder — freeform (pixel/percent) block
-- positioning, replacing the 24-col/rowHeight-10 grid snap (STEP79/82).
--
-- Generalizes the existing math rather than replacing it: x/w become
-- percentages of the live container width (float, 0-100 — the grid's
-- x/24 already behaved like a percentage of whatever width
-- react-grid-layout's WidthProvider measured), y/h become literal
-- pixels (exactly what layout_y*10/layout_h*10 already computed under
-- rowHeight=10). No fixed reference width is needed anywhere — percent
-- and pixel are just CSS values now, computed at drag-time in the
-- frontend via getBoundingClientRect().
--
-- Additive + guarded, same discipline as STEP82's one-time rescale:
-- new columns added alongside (not replacing) the old layout_x/y/w/h
-- INT columns. The old columns are deliberately NOT dropped here — SQL
-- migration and frontend deploy aren't atomic, so keeping them intact
-- means either deploy ordering is non-destructive. A later cleanup
-- STEP can drop them once the new frontend is confirmed live.
-- ============================================================

ALTER TABLE landing_page_blocks
  ADD COLUMN IF NOT EXISTS layout_x_pct DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS layout_y_px  INTEGER,
  ADD COLUMN IF NOT EXISTS layout_w_pct DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS layout_h_px  INTEGER;

ALTER TABLE landing_page_template_blocks
  ADD COLUMN IF NOT EXISTS layout_x_pct DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS layout_y_px  INTEGER,
  ADD COLUMN IF NOT EXISTS layout_w_pct DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS layout_h_px  INTEGER;

CREATE TABLE IF NOT EXISTS _schema_migration_flags (key TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _schema_migration_flags WHERE key = 'step83_landing_freeform_layout') THEN
    UPDATE landing_page_blocks SET
      layout_x_pct = layout_x / 24.0 * 100, layout_y_px = layout_y * 10,
      layout_w_pct = layout_w / 24.0 * 100, layout_h_px = layout_h * 10;
    UPDATE landing_page_template_blocks SET
      layout_x_pct = layout_x / 24.0 * 100, layout_y_px = layout_y * 10,
      layout_w_pct = layout_w / 24.0 * 100, layout_h_px = layout_h * 10;
    INSERT INTO _schema_migration_flags (key) VALUES ('step83_landing_freeform_layout');
  END IF;
END $$;

-- Sane defaults for any future INSERT that omits the new columns.
ALTER TABLE landing_page_blocks ALTER COLUMN layout_x_pct SET DEFAULT 0;
ALTER TABLE landing_page_blocks ALTER COLUMN layout_y_px  SET DEFAULT 0;
ALTER TABLE landing_page_blocks ALTER COLUMN layout_w_pct SET DEFAULT 100;
ALTER TABLE landing_page_blocks ALTER COLUMN layout_h_px  SET DEFAULT 60;
ALTER TABLE landing_page_template_blocks ALTER COLUMN layout_x_pct SET DEFAULT 0;
ALTER TABLE landing_page_template_blocks ALTER COLUMN layout_y_px  SET DEFAULT 0;
ALTER TABLE landing_page_template_blocks ALTER COLUMN layout_w_pct SET DEFAULT 100;
ALTER TABLE landing_page_template_blocks ALTER COLUMN layout_h_px  SET DEFAULT 60;

-- Extending the RETURNS TABLE shape (x/y/w/h -> x_pct/y_px/w_pct/h_px)
-- needs DROP first — same "cannot change return type" lesson as
-- STEP80/STEP81's function updates.
DROP FUNCTION IF EXISTS get_landing_page_public(TEXT);

CREATE OR REPLACE FUNCTION get_landing_page_public(p_slug TEXT)
RETURNS TABLE (page_id UUID, page_name TEXT, blocks JSONB) AS $$
  SELECT lp.id, lp.name,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'block_type', b.block_type,
        'x_pct', b.layout_x_pct, 'y_px', b.layout_y_px,
        'w_pct', b.layout_w_pct, 'h_px', b.layout_h_px,
        'config', b.config
      ) ORDER BY b.layout_y_px, b.layout_x_pct)
      FROM landing_page_blocks b WHERE b.landing_page_id = lp.id
    ), '[]'::jsonb)
  FROM sales_landing_links l
  JOIN landing_pages lp ON lp.id = l.landing_page_id
  WHERE l.slug = p_slug AND l.is_active = true AND lp.status = 'Published';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_landing_page_public(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

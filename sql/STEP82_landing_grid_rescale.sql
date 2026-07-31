-- ============================================================
-- STEP82: Landing Page Builder — finer grid + a one-time rescale of
-- everything already built, so existing pages don't visually shift.
--
-- The builder/public renderer move from a 12-column/rowHeight-20 grid to
-- 24-column/rowHeight-10 (src/components/LandingPageBuilder.jsx,
-- src/components/PublicLandingPage.jsx) — twice the placement resolution
-- in both axes, plus auto-compaction and collision-blocking turned off,
-- so a block stays exactly wherever it's dragged (including overlap)
-- instead of react-grid-layout snapping it back into a tidy stack. This
-- is the practical ceiling of the grid-based approach (still no bespoke
-- canvas engine) — see the conversation history for why a true freeform
-- canvas isn't realistic scope here.
--
-- Doubling the grid resolution means every existing block's x/y/w/h
-- needs doubling too, or everything already built would shrink to a
-- corner. This is a genuine one-time DATA migration (not idempotent
-- schema DDL like every other STEP file) — guarded by a flags table so
-- re-running this script is safe and does NOT double the values twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS _schema_migration_flags (key TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _schema_migration_flags WHERE key = 'step82_landing_grid_rescale') THEN
    UPDATE landing_page_blocks SET layout_x = layout_x * 2, layout_y = layout_y * 2, layout_w = layout_w * 2, layout_h = layout_h * 2;
    UPDATE landing_page_template_blocks SET layout_x = layout_x * 2, layout_y = layout_y * 2, layout_w = layout_w * 2, layout_h = layout_h * 2;
    INSERT INTO _schema_migration_flags (key) VALUES ('step82_landing_grid_rescale');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- STEP85: Backfill any landing_page_blocks / landing_page_template_blocks
-- rows still missing layout_x_pct/layout_y_px/layout_w_pct/layout_h_px
-- (STEP83). Observed in production: some rows had these left NULL even
-- after STEP83 ran — the CSS `left: ${null}%` / `width: ${null}%` this
-- produces is invalid and gets silently dropped by the browser, which
-- collapses every affected block to content-width and stacks it in
-- document order (the "everything is a narrow overlapping column"
-- symptom).
--
-- Unlike STEP83's one-time migration, this is NOT flag-guarded — it only
-- touches rows where the new columns are still NULL, so it's always
-- safe to re-run and never double-converts an already-migrated row.
-- ============================================================

UPDATE landing_page_blocks SET
  layout_x_pct = layout_x / 24.0 * 100, layout_y_px = layout_y * 10,
  layout_w_pct = layout_w / 24.0 * 100, layout_h_px = layout_h * 10
WHERE layout_x_pct IS NULL OR layout_y_px IS NULL OR layout_w_pct IS NULL OR layout_h_px IS NULL;

UPDATE landing_page_template_blocks SET
  layout_x_pct = layout_x / 24.0 * 100, layout_y_px = layout_y * 10,
  layout_w_pct = layout_w / 24.0 * 100, layout_h_px = layout_h * 10
WHERE layout_x_pct IS NULL OR layout_y_px IS NULL OR layout_w_pct IS NULL OR layout_h_px IS NULL;

NOTIFY pgrst, 'reload schema';

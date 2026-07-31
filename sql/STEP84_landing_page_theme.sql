-- ============================================================
-- STEP84: Landing Page Builder — page-level theme.
--
-- Trivial additive column, kept in its own file separate from STEP83's
-- riskier freeform-layout data migration so it can ship/roll back on its
-- own schedule. theme shape: {primaryColor, backgroundColor, textColor,
-- fontFamily, buttonRadius} — applied as CSS custom properties
-- (--lp-primary/--lp-bg/--lp-text/--lp-font) on the canvas wrapper in
-- both LandingPageBuilder.jsx and PublicLandingPage.jsx; renderers
-- reference them with their current hardcoded color as fallback
-- (var(--lp-primary, #6366f1)), so blocks that don't opt in are
-- unaffected. Per-block styling (background/text color/padding/
-- alignment/border radius) needs no schema change — it lives in each
-- block's existing config.style JSON.
-- ============================================================

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS theme JSONB NOT NULL DEFAULT '{}';

-- Extending the RETURNS TABLE shape (adding `theme`) needs DROP first —
-- same "cannot change return type" lesson as STEP83's update to this
-- same function.
DROP FUNCTION IF EXISTS get_landing_page_public(TEXT);

CREATE OR REPLACE FUNCTION get_landing_page_public(p_slug TEXT)
RETURNS TABLE (page_id UUID, page_name TEXT, theme JSONB, blocks JSONB) AS $$
  SELECT lp.id, lp.name, lp.theme,
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

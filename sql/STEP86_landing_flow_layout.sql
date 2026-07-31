-- ============================================================
-- STEP86: Landing Page Builder — auto-height flow layout, replacing
-- manual pixel-height blocks entirely.
--
-- STEP83-85 chased a real but ultimately wrong design: giving every
-- block a manually-dragged fixed pixel height. Height math derived from
-- historical grid state (or the old 24-col/rowHeight-10 grid before
-- that) never reliably matches actual rendered content height —
-- especially once font sizes, wrapping, and the narrower editor canvas
-- width are accounted for — so content kept overflowing its box into
-- the next block. That's a structural flaw in "manual height," not a
-- migration bug, and no amount of better math fixes it.
--
-- The fix: blocks now stack via CSS flexbox (flex-wrap), each sized to
-- its own intrinsic content height — exactly how Webflow/Framer/Swipe
-- Pages actually build pages. Only `layout_w_pct` (width, 0-100) and
-- `sort_order` (vertical position) remain meaningful. `layout_x_pct`,
-- `layout_y_px`, `layout_h_px` (STEP83) are no longer read by the
-- frontend — left in place, unused, rather than dropped, since nothing
-- depends on their absence and a drop buys nothing.
--
-- No data migration needed: layout_w_pct is already correctly populated
-- (STEP83/85's x/w-percent math was never the buggy part), and
-- sort_order was already correct for every template-cloned block
-- (STEP79's seed data sets it 1..21 per template, and
-- src/lib/landingPageBuilder.js's createLandingPage() has always copied
-- it verbatim). The only gap was newly-added (non-template) blocks
-- defaulting to sort_order=0 — fixed in application code
-- (addBlock() now assigns max(existing)+1), no SQL needed for that.
-- ============================================================

DROP FUNCTION IF EXISTS get_landing_page_public(TEXT);

CREATE OR REPLACE FUNCTION get_landing_page_public(p_slug TEXT)
RETURNS TABLE (page_id UUID, page_name TEXT, theme JSONB, blocks JSONB) AS $$
  SELECT lp.id, lp.name, lp.theme,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'block_type', b.block_type,
        'w_pct', b.layout_w_pct, 'config', b.config
      ) ORDER BY b.sort_order, b.created_at)
      FROM landing_page_blocks b WHERE b.landing_page_id = lp.id
    ), '[]'::jsonb)
  FROM sales_landing_links l
  JOIN landing_pages lp ON lp.id = l.landing_page_id
  WHERE l.slug = p_slug AND l.is_active = true AND lp.status = 'Published';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_landing_page_public(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

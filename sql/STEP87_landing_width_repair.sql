-- ============================================================
-- STEP87: Repair landing_page_blocks / landing_page_template_blocks
-- layout_w_pct — every width came out exactly half of what it should be.
--
-- Root cause: STEP83's conversion `layout_w_pct = layout_w / 24.0 * 100`
-- assumed every row's legacy layout_w was already on the 24-column scale
-- (post-STEP82 rescale). In practice these rows were still on the
-- original 12-column scale (e.g. Hero's seeded layout_w=12, meaning
-- "full width of 12" — STEP79's literal seed values), so dividing by 24
-- silently halved every width: a full-width Hero became 50%, a 3-column
-- FeatureCard row became 3x16.67%=50% total instead of 100%. This is
-- why Hero/TrustBar rendered side-by-side at half width instead of each
-- taking a full row, and why 3-column rows only filled half the canvas.
--
-- Fix: reset layout_w_pct directly from block_type, using the same
-- known-correct defaults as src/lib/landingPageBlockCatalog.js's
-- BLOCK_CATALOG (single source of truth for "how wide should this block
-- type be by default"). This is a full reset rather than a scale-factor
-- correction because there's no reliable signal left to distinguish an
-- already-correct row from a halved one — safe here because width
-- customization only just shipped, so no page has meaningfully hand-
-- resized a block's width yet.
-- ============================================================

UPDATE landing_page_blocks SET layout_w_pct = CASE block_type
  WHEN 'FeatureCard'     THEN 33.333
  WHEN 'StatBlock'       THEN 33.333
  WHEN 'HowItWorksStep'  THEN 33.333
  WHEN 'Button'          THEN 33.333
  WHEN 'Image'           THEN 50
  WHEN 'TestimonialCard' THEN 50
  ELSE 100
END;

UPDATE landing_page_template_blocks SET layout_w_pct = CASE block_type
  WHEN 'FeatureCard'     THEN 33.333
  WHEN 'StatBlock'       THEN 33.333
  WHEN 'HowItWorksStep'  THEN 33.333
  WHEN 'Button'          THEN 33.333
  WHEN 'Image'           THEN 50
  WHEN 'TestimonialCard' THEN 50
  ELSE 100
END;

NOTIFY pgrst, 'reload schema';

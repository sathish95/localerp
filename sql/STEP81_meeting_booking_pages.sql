-- ============================================================
-- STEP81: Meeting Booking Pages — a second public page type
-- (/book/:slug) alongside the plain lead-capture link (/l/:slug), for
-- "book a call" style pages that pair the existing Turnstile-verified
-- lead form with an embedded third-party scheduler (Calendly, Cal.com,
-- etc. — a plain iframe of a URL you paste in, not a custom-built
-- availability/scheduling engine).
--
-- Reuses sales_landing_links (STEP75) rather than a new table — a
-- meeting page IS a landing link, just with page_type='meeting' and a
-- scheduler_embed_url. This means it inherits, for free: campaign
-- attribution (marketing_campaign_channel_links.linked_landing_page_id
-- already references sales_landing_links(id) — STEP76), Turnstile
-- protection, auto-assignment, RLS, and lead counts — nothing new to
-- duplicate there.
-- ============================================================

ALTER TABLE sales_landing_links ADD COLUMN IF NOT EXISTS page_type TEXT NOT NULL DEFAULT 'form' CHECK (page_type IN ('form','meeting'));
ALTER TABLE sales_landing_links ADD COLUMN IF NOT EXISTS scheduler_embed_url TEXT;

-- Extending get_landing_link_public()'s RETURNS TABLE changes its output
-- shape, which CREATE OR REPLACE cannot do in place ("cannot change
-- return type of existing function") — DROP first, same lesson as
-- STEP80's public_submit_lead() update.
DROP FUNCTION IF EXISTS get_landing_link_public(TEXT);

CREATE OR REPLACE FUNCTION get_landing_link_public(p_slug TEXT)
RETURNS TABLE (
  campaign_name TEXT, display_headline TEXT, display_subheadline TEXT,
  domain TEXT, is_active BOOLEAN, featured_products JSONB,
  page_type TEXT, scheduler_embed_url TEXT
) AS $$
  SELECT l.campaign_name, l.display_headline, l.display_subheadline, l.domain, l.is_active,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('part_number', p.part_number, 'name', p.name))
      FROM products p WHERE p.part_number = ANY(l.featured_products)
    ), '[]'::jsonb),
    l.page_type, l.scheduler_embed_url
  FROM sales_landing_links l
  WHERE l.slug = p_slug;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_landing_link_public(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

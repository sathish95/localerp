-- ============================================================
-- STEP75: Sales & Pre-Sales CRM — public lead-capture links.
--
-- Lets Sales/Marketing generate named, shareable URLs (e.g.
-- yourapp.com/l/linkedin-b2b-north) for external campaigns. Anyone who
-- fills the form at that link becomes a real sales_leads row, pre-tagged
-- with that link's domain/region/source — so the CMO dashboard's lead
-- source effectiveness view (src/lib/salesDashboards.js) attributes it
-- correctly without any manual re-tagging.
--
-- Architecture note: this app has NO backend/API layer (CLAUDE.md) — every
-- other module is direct Supabase client calls. Rather than introduce the
-- first real dependency on a deployed Edge Function (there's an existing
-- one, analyze-requirements, but the frontend never actually calls it —
-- Neo Task AI calls DeepSeek/Gemini directly from the browser instead),
-- this keeps that same pattern: the public page calls two SECURITY
-- DEFINER Postgres functions directly. Turnstile CAPTCHA verification
-- (which needs a secret key that must never reach the browser) happens
-- SERVER-SIDE inside public_submit_lead() via the `http` extension's
-- synchronous http_post() — no edge function deploy/secrets CLI step
-- needed, consistent with how llm_settings (STEP44) already lets admins
-- store API keys from the Settings UI instead of only .env.
--
-- The Turnstile SECRET key is stored in sales_public_form_secrets, which
-- has NO select policy at all — nobody can read it back via the REST
-- API, not even admin. Only a SECURITY DEFINER function (owned by a
-- role with BYPASSRLS, e.g. this script's runner) can read it internally.
-- The Settings UI sets/rotates it write-only and checks presence via
-- sales_public_form_secret_status(), never the value itself.
--
-- The Turnstile SITE key is NOT secret (it's meant to be embedded in the
-- browser) — set it as VITE_TURNSTILE_SITE_KEY in .env, same pattern as
-- VITE_DEEPSEEK_API_KEY etc.
--
-- Requires the `http` Postgres extension. If CREATE EXTENSION below
-- fails (some Supabase plans restrict it), enable it manually via
-- Database -> Extensions -> search "http" in the Supabase dashboard,
-- then re-run just that one line.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- ── sales_leads: contact fields + campaign attribution ──
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS landing_link_id UUID;

-- ── Landing links (Part 7-style admin config, one row per campaign link) ──
CREATE TABLE IF NOT EXISTS sales_landing_links (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  slug                TEXT          NOT NULL UNIQUE,   -- URL-safe, used as /l/:slug
  campaign_name       TEXT          NOT NULL,
  domain              TEXT          NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  region_id           UUID          REFERENCES sales_regions(id),
  source              TEXT          NOT NULL DEFAULT 'Campaign',
  display_headline    TEXT,
  display_subheadline TEXT,
  featured_products   TEXT[]        NOT NULL DEFAULT '{}',  -- products.part_number[], curated per campaign (not the full catalog)
  is_active           BOOLEAN       NOT NULL DEFAULT true,
  created_by          UUID          REFERENCES profiles(id),
  created_at          TIMESTAMPTZ   DEFAULT now(),
  updated_at          TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_landing_links_slug_idx ON sales_landing_links(slug);

DROP TRIGGER IF EXISTS sales_landing_links_updated_at ON sales_landing_links;
CREATE TRIGGER sales_landing_links_updated_at BEFORE UPDATE ON sales_landing_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_leads_landing_link_fk') THEN
    ALTER TABLE sales_leads ADD CONSTRAINT sales_leads_landing_link_fk FOREIGN KEY (landing_link_id) REFERENCES sales_landing_links(id);
  END IF;
END $$;

ALTER TABLE sales_landing_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_landing_links_select ON sales_landing_links;
DROP POLICY IF EXISTS sales_landing_links_write  ON sales_landing_links;
CREATE POLICY sales_landing_links_select ON sales_landing_links FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sales_landing_links_write ON sales_landing_links FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','sales_ops','cmo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','sales_ops','cmo'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_landing_links TO authenticated;

-- ── Turnstile secret — write-only, no SELECT policy for anyone ──
CREATE TABLE IF NOT EXISTS sales_public_form_secrets (
  id                    BOOLEAN     PRIMARY KEY DEFAULT true CHECK (id),  -- singleton row
  turnstile_secret_key  TEXT,
  updated_by            UUID        REFERENCES profiles(id),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sales_public_form_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_public_form_secrets_insert ON sales_public_form_secrets;
DROP POLICY IF EXISTS sales_public_form_secrets_update ON sales_public_form_secrets;
CREATE POLICY sales_public_form_secrets_insert ON sales_public_form_secrets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY sales_public_form_secrets_update ON sales_public_form_secrets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
-- Deliberately no SELECT policy — this table is unreadable via PostgREST/REST API by anyone.
GRANT INSERT, UPDATE ON public.sales_public_form_secrets TO authenticated;

CREATE OR REPLACE FUNCTION set_turnstile_secret(p_secret TEXT, p_profile_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile_id AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  INSERT INTO sales_public_form_secrets (id, turnstile_secret_key, updated_by, updated_at)
  VALUES (true, p_secret, p_profile_id, now())
  ON CONFLICT (id) DO UPDATE SET turnstile_secret_key = EXCLUDED.turnstile_secret_key, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION set_turnstile_secret(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION sales_public_form_secret_status()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM sales_public_form_secrets WHERE id = true AND turnstile_secret_key IS NOT NULL AND turnstile_secret_key <> '');
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION sales_public_form_secret_status() TO authenticated;

-- ── Public read: campaign display info + curated product list only —
-- never the full catalog, never internal IDs beyond what the form needs. ──
CREATE OR REPLACE FUNCTION get_landing_link_public(p_slug TEXT)
RETURNS TABLE (
  campaign_name TEXT, display_headline TEXT, display_subheadline TEXT,
  domain TEXT, is_active BOOLEAN, featured_products JSONB
) AS $$
  SELECT l.campaign_name, l.display_headline, l.display_subheadline, l.domain, l.is_active,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('part_number', p.part_number, 'name', p.name))
      FROM products p WHERE p.part_number = ANY(l.featured_products)
    ), '[]'::jsonb)
  FROM sales_landing_links l
  WHERE l.slug = p_slug;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_landing_link_public(TEXT) TO anon, authenticated;

-- ── Public write: verify Turnstile, auto-assign, insert, alert on gap ──
CREATE OR REPLACE FUNCTION public_submit_lead(
  p_slug TEXT, p_contact_name TEXT, p_company_name TEXT, p_phone TEXT, p_email TEXT,
  p_message TEXT, p_product_interest TEXT, p_turnstile_token TEXT
) RETURNS TEXT AS $$
DECLARE
  v_link            sales_landing_links%ROWTYPE;
  v_secret          TEXT;
  v_verify_res      extensions.http_response;
  v_verify_body     JSONB;
  v_rule_type       TEXT;
  v_assigned_rep    UUID;
  v_status          TEXT;
  v_lead_number     TEXT;
  v_lead_id         UUID;
  v_notified        UUID[];
BEGIN
  IF coalesce(trim(p_contact_name), '') = '' THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF coalesce(trim(p_phone), '') = '' AND coalesce(trim(p_email), '') = '' THEN RAISE EXCEPTION 'A phone number or email is required'; END IF;

  SELECT * INTO v_link FROM sales_landing_links WHERE slug = p_slug AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'This link is not available'; END IF;

  -- ── Turnstile verification (server-side only — secret never leaves this function) ──
  SELECT turnstile_secret_key INTO v_secret FROM sales_public_form_secrets WHERE id = true;
  IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'Form is not yet configured for submissions'; END IF;
  IF coalesce(trim(p_turnstile_token), '') = '' THEN RAISE EXCEPTION 'Captcha verification is required'; END IF;

  SELECT * INTO v_verify_res FROM extensions.http_post(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    'secret=' || v_secret || '&response=' || p_turnstile_token,
    'application/x-www-form-urlencoded'
  );
  v_verify_body := v_verify_res.content::jsonb;
  IF (v_verify_body->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Captcha verification failed';
  END IF;

  -- ── Auto-assignment (mirrors src/lib/salesLeads.js's pickAssignee()) ──
  SELECT rule_type INTO v_rule_type FROM sales_assignment_rules
  WHERE domain = v_link.domain AND is_active = true AND (region_id = v_link.region_id OR region_id IS NULL)
  ORDER BY region_id NULLS LAST LIMIT 1;

  IF v_rule_type IS NOT NULL AND v_rule_type <> 'manual' THEN
    SELECT ra.profile_id INTO v_assigned_rep
    FROM sales_rep_assignments ra
    JOIN sales_role_definitions rd ON rd.id = ra.sales_role_definition_id
    WHERE rd.domain = v_link.domain AND rd.is_active = true AND (rd.region_id = v_link.region_id OR rd.region_id IS NULL)
      AND ra.active_from <= CURRENT_DATE AND (ra.active_to IS NULL OR ra.active_to >= CURRENT_DATE)
    GROUP BY ra.profile_id
    ORDER BY (SELECT count(*) FROM sales_leads sl WHERE sl.assigned_rep_id = ra.profile_id AND sl.status <> 'Disqualified') ASC
    LIMIT 1;
  END IF;

  v_status := CASE WHEN v_assigned_rep IS NULL THEN 'Unassigned — Needs Coverage' ELSE 'New' END;
  v_lead_number := 'LEAD-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substr(md5(random()::text), 1, 4);

  INSERT INTO sales_leads (
    lead_number, source, domain, region_id, contact_name, company_name, phone, email, message,
    product_interest_id, landing_link_id, status, assigned_rep_id, coverage_alert_sent_at
  ) VALUES (
    v_lead_number, v_link.source, v_link.domain, v_link.region_id, p_contact_name, p_company_name, p_phone, p_email, p_message,
    NULLIF(p_product_interest, ''), v_link.id, v_status, v_assigned_rep,
    CASE WHEN v_assigned_rep IS NULL THEN now() END
  ) RETURNING id INTO v_lead_id;

  -- ── Coverage-gap alert (mirrors src/lib/salesLeads.js's alertCoverageGap()) ──
  IF v_assigned_rep IS NULL THEN
    IF v_link.region_id IS NOT NULL THEN
      SELECT array_agg(id) INTO v_notified FROM profiles WHERE role = 'regional_sales_head';
    END IF;
    IF v_notified IS NULL OR array_length(v_notified, 1) IS NULL THEN
      SELECT array_agg(id) INTO v_notified FROM profiles WHERE role = 'sales_head';
    END IF;
    IF v_notified IS NOT NULL THEN
      INSERT INTO notifications (recipient_id, type, title, body, link, metadata)
      SELECT uid, 'sales_lead_unassigned', 'Lead needs coverage (public form)',
        p_contact_name || ' (' || v_link.domain || ', via ' || v_link.campaign_name || ') has no matching sales rep assignment and needs manual triage.',
        '/sales/leads?id=' || v_lead_id, jsonb_build_object('lead_id', v_lead_id, 'domain', v_link.domain, 'region_id', v_link.region_id)
      FROM unnest(v_notified) AS uid;
    END IF;
  END IF;

  RETURN v_lead_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public_submit_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

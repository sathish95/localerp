-- ============================================================
-- STEP80: Landing Page Builder v2 — real image upload (Supabase Storage),
-- custom lead-form fields, and CTA-action config (button -> scroll to
-- form). The CTA-action and richer LeadForm config are pure JSONB
-- additions inside landing_page_blocks.config — no schema change needed
-- for those, only for the two things below that ARE relational:
--
-- 1. A public-readable Storage bucket for uploaded landing-page images —
--    mirrors this app's existing `invoices` bucket pattern
--    (src/pages/InvoicesPage.jsx), except public=true since these images
--    render on the unauthenticated /l/:slug page.
-- 2. sales_leads.custom_fields — marketer-defined form questions can't be
--    relational columns, so answers land in JSONB.
--
-- public_submit_lead() (STEP75, updated STEP77) gets ONE new named,
-- defaulted parameter (p_custom_fields). Supabase JS calls RPCs with
-- named parameters, so every existing call site (which doesn't pass it)
-- keeps working unchanged — this is purely additive.
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('landing-assets', 'landing-assets', true)
ON CONFLICT (id) DO NOTHING;

-- storage.objects already has RLS enabled by default in every Supabase
-- project, and it's owned by the supabase_storage_admin role — the SQL
-- Editor's role can create policies on it (a supported, documented
-- Supabase workflow) but cannot run ALTER TABLE on it ("must be owner of
-- table objects"), so that statement is deliberately omitted here.

DROP POLICY IF EXISTS landing_assets_select ON storage.objects;
DROP POLICY IF EXISTS landing_assets_insert ON storage.objects;
DROP POLICY IF EXISTS landing_assets_update ON storage.objects;
DROP POLICY IF EXISTS landing_assets_delete ON storage.objects;

-- Public read — these are marketing images meant to be visible on an
-- unauthenticated page, same trust level as the rest of /l/:slug.
CREATE POLICY landing_assets_select ON storage.objects FOR SELECT USING (bucket_id = 'landing-assets');

-- Write gated to the same roles as landing_pages itself (STEP79).
CREATE POLICY landing_assets_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'landing-assets' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cmo','campaign_manager'))
);
CREATE POLICY landing_assets_update ON storage.objects FOR UPDATE USING (
  bucket_id = 'landing-assets' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cmo','campaign_manager'))
);
CREATE POLICY landing_assets_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'landing-assets' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cmo','campaign_manager'))
);

-- ── Custom lead-form answers ──
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';

-- ── public_submit_lead() — identical to STEP77's version, plus
-- p_custom_fields (defaulted, so old callers that don't pass it are
-- unaffected). Adding a parameter changes the function's TYPE signature,
-- so CREATE OR REPLACE alone would create a second, overloaded version
-- instead of truly replacing STEP77's — DROP the old 8-arg signature
-- first so exactly one version of this function exists. ──
DROP FUNCTION IF EXISTS public_submit_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public_submit_lead(
  p_slug TEXT, p_contact_name TEXT, p_company_name TEXT, p_phone TEXT, p_email TEXT,
  p_message TEXT, p_product_interest TEXT, p_turnstile_token TEXT,
  p_custom_fields JSONB DEFAULT '{}'
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
  v_campaign_id     UUID;
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

  -- ── Campaign attribution — resolve via this landing link's channel link, if any ──
  SELECT campaign_id INTO v_campaign_id FROM marketing_campaign_channel_links WHERE linked_landing_page_id = v_link.id;

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
    product_interest_id, landing_link_id, campaign_id, custom_fields, status, assigned_rep_id, coverage_alert_sent_at
  ) VALUES (
    v_lead_number, v_link.source, v_link.domain, v_link.region_id, p_contact_name, p_company_name, p_phone, p_email, p_message,
    NULLIF(p_product_interest, ''), v_link.id, v_campaign_id, coalesce(p_custom_fields, '{}'::jsonb), v_status, v_assigned_rep,
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
GRANT EXECUTE ON FUNCTION public_submit_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

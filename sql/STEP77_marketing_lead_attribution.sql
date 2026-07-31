-- ============================================================
-- STEP77: Marketing Module — Lead -> Campaign attribution.
--
-- sales_leads.campaign_id is set once at creation: automatically for
-- public-form submissions (resolved server-side from the landing link's
-- channel link, inside public_submit_lead()) or manually for leads
-- entered in-app (src/lib/salesLeads.js's createLead(), e.g. trade-show
-- sign-ups tied directly to a Campaign with no landing link involved).
-- Single-touch by construction — a Lead is only ever created once.
-- ============================================================

ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES marketing_campaigns(id);
CREATE INDEX IF NOT EXISTS sales_leads_campaign_idx ON sales_leads(campaign_id);

-- Re-create public_submit_lead() (STEP75) with one added step: resolve the
-- landing link's campaign via marketing_campaign_channel_links and stamp
-- it onto the new Lead, so campaign-sourced public leads roll up into
-- CampaignResult with zero manual tagging. Everything else is unchanged
-- from STEP75.
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
    product_interest_id, landing_link_id, campaign_id, status, assigned_rep_id, coverage_alert_sent_at
  ) VALUES (
    v_lead_number, v_link.source, v_link.domain, v_link.region_id, p_contact_name, p_company_name, p_phone, p_email, p_message,
    NULLIF(p_product_interest, ''), v_link.id, v_campaign_id, v_status, v_assigned_rep,
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

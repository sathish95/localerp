-- ============================================================
-- STEP101: Multi-tenant RLS retrofit — Batch 7 (Sales/CRM, 26 tables).
-- Exact current policy names/definitions/role-lists confirmed by reading
-- STEP68-STEP75 + STEP78 directly (STEP78 is the live override of
-- STEP75's original sales_landing_links_write role list — used here, not
-- the superseded STEP75 version).
--
-- sales_landing_links.slug stays GLOBALLY unique (not widened per-org) —
-- it's the public URL path segment for /l/:slug across the whole
-- platform, not a per-tenant namespace; two orgs could otherwise be
-- assigned the same public URL, which is a real routing collision, not a
-- cosmetic one like the sequence-number gaps left elsewhere.
--
-- sales_public_form_secrets is a singleton row (id BOOLEAN PRIMARY KEY
-- DEFAULT true) — redesigned to organization_id UUID PRIMARY KEY, same
-- pattern as the other singleton tables. Its 3 SECURITY DEFINER RPCs
-- (set_turnstile_secret, sales_public_form_secret_status,
-- get_landing_link_public) and the anonymous-write RPC
-- (public_submit_lead) are rewritten below since SECURITY DEFINER
-- bypasses RLS entirely — org-scoping the underlying tables is not
-- sufficient on its own, same lesson as STEP94's performance RPCs.
-- public_submit_lead is called by an UNAUTHENTICATED visitor (no
-- auth.uid()), so it resolves organization_id from the landing link row
-- itself (v_link.organization_id), not current_org_id() — exactly the
-- open question flagged back in the original Phase 2 forward plan.
-- ============================================================

-- ── Group A: sales_regions, sales_role_definitions, sales_rep_assignments ──
DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';
  FOREACH t IN ARRAY ARRAY['sales_regions','sales_role_definitions','sales_rep_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id())', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       ) WITH CHECK (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       )', t, t
    );
  END LOOP;
END $$;
ALTER TABLE sales_regions DROP CONSTRAINT IF EXISTS sales_regions_region_name_key;
ALTER TABLE sales_regions ADD CONSTRAINT sales_regions_org_name_key UNIQUE (organization_id, region_name);

-- ── Group B: sales_pipeline_stages, lookup lists, assignment rules, thresholds, config flags ──
DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';
  FOREACH t IN ARRAY ARRAY[
    'sales_pipeline_stages','sales_lead_sources','sales_activity_types','sales_task_types',
    'sales_activity_outcomes','sales_assignment_rules','sales_stale_threshold_config','sales_config_flags'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id())', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       ) WITH CHECK (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''sales_ops''))
       )', t, t
    );
  END LOOP;
END $$;
ALTER TABLE sales_pipeline_stages DROP CONSTRAINT IF EXISTS sales_pipeline_stages_domain_stage_name_key;
ALTER TABLE sales_pipeline_stages ADD CONSTRAINT sales_pipeline_stages_org_domain_stage_key UNIQUE (organization_id, domain, stage_name);
ALTER TABLE sales_lead_sources DROP CONSTRAINT IF EXISTS sales_lead_sources_name_key;
ALTER TABLE sales_lead_sources ADD CONSTRAINT sales_lead_sources_org_name_key UNIQUE (organization_id, name);
ALTER TABLE sales_activity_types DROP CONSTRAINT IF EXISTS sales_activity_types_name_key;
ALTER TABLE sales_activity_types ADD CONSTRAINT sales_activity_types_org_name_key UNIQUE (organization_id, name);
ALTER TABLE sales_task_types DROP CONSTRAINT IF EXISTS sales_task_types_name_key;
ALTER TABLE sales_task_types ADD CONSTRAINT sales_task_types_org_name_key UNIQUE (organization_id, name);
ALTER TABLE sales_activity_outcomes DROP CONSTRAINT IF EXISTS sales_activity_outcomes_name_key;
ALTER TABLE sales_activity_outcomes ADD CONSTRAINT sales_activity_outcomes_org_name_key UNIQUE (organization_id, name);
ALTER TABLE sales_stale_threshold_config DROP CONSTRAINT IF EXISTS sales_stale_threshold_config_domain_key;
ALTER TABLE sales_stale_threshold_config ADD CONSTRAINT sales_stale_threshold_config_org_domain_key UNIQUE (organization_id, domain);
-- sales_config_flags: key TEXT PRIMARY KEY -> widen PK to (organization_id, key)
ALTER TABLE sales_config_flags DROP CONSTRAINT IF EXISTS sales_config_flags_pkey;
ALTER TABLE sales_config_flags ADD PRIMARY KEY (organization_id, key);

-- ── Group C: sales_leads, sales_opportunities, sales_activities, sales_tasks, audit logs ──
DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';
  FOREACH t IN ARRAY ARRAY['sales_leads','sales_opportunities','sales_activities','sales_tasks','sales_stage_audit_log','sales_task_reassignment_log'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id())', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops''))
       ) WITH CHECK (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops''))
       )', t, t
    );
  END LOOP;
END $$;

-- ── Group D: product_launches, product_launch_interest ──
DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';
  FOREACH t IN ARRAY ARRAY['product_launches','product_launch_interest'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id())', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops'',''cto''))
       ) WITH CHECK (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''regional_sales_head'',''sales_rep'',''sales_ops'',''cto''))
       )', t, t
    );
  END LOOP;
END $$;

-- ── Group E: sales_tenders, sales_pilot_projects, sales_marketing_budget_lines, sales_bootstrap_programs, sales_status_audit_log ──
DO $$
DECLARE
  t TEXT;
  default_org UUID;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';
  FOREACH t IN ARRAY ARRAY['sales_tenders','sales_pilot_projects','sales_marketing_budget_lines','sales_bootstrap_programs','sales_status_audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id())', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''finance''))
       ) WITH CHECK (
         organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_head'',''finance''))
       )', t, t
    );
  END LOOP;
END $$;

-- ── Group F: sales_revenue_forecast (permissive-write), sales_profit_attribution (restricted) ──
ALTER TABLE sales_revenue_forecast ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE sales_revenue_forecast SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE sales_revenue_forecast ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE sales_revenue_forecast ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS sales_revenue_forecast_select ON sales_revenue_forecast;
DROP POLICY IF EXISTS sales_revenue_forecast_write  ON sales_revenue_forecast;
CREATE POLICY sales_revenue_forecast_select ON sales_revenue_forecast FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY sales_revenue_forecast_write ON sales_revenue_forecast FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','regional_sales_head','sales_rep','sales_ops','finance'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','regional_sales_head','sales_rep','sales_ops','finance'))
);
-- the COALESCE grain index needs organization_id folded in too, else two
-- orgs' company-wide rollup rows (all-null grain) would collide.
DROP INDEX IF EXISTS sales_revenue_forecast_grain_idx;
CREATE UNIQUE INDEX IF NOT EXISTS sales_revenue_forecast_grain_idx ON sales_revenue_forecast (
  organization_id,
  COALESCE(region_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(domain, ''),
  COALESCE(sales_rep_id, '00000000-0000-0000-0000-000000000000'),
  period_key
);

ALTER TABLE sales_profit_attribution ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE sales_profit_attribution SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE sales_profit_attribution ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE sales_profit_attribution ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS sales_profit_attribution_select ON sales_profit_attribution;
DROP POLICY IF EXISTS sales_profit_attribution_write  ON sales_profit_attribution;
CREATE POLICY sales_profit_attribution_select ON sales_profit_attribution FOR SELECT USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_head'))
);
CREATE POLICY sales_profit_attribution_write ON sales_profit_attribution FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_head'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_head'))
);

-- ── Group G: sales_landing_links (slug stays globally unique — see header) ──
ALTER TABLE sales_landing_links ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE sales_landing_links SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE sales_landing_links ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE sales_landing_links ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS sales_landing_links_select ON sales_landing_links;
DROP POLICY IF EXISTS sales_landing_links_write  ON sales_landing_links;
CREATE POLICY sales_landing_links_select ON sales_landing_links FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY sales_landing_links_write ON sales_landing_links FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','sales_ops','cmo','campaign_manager'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','sales_head','sales_ops','cmo','campaign_manager'))
);

-- ── sales_public_form_secrets: singleton -> per-org PK redesign ──
ALTER TABLE sales_public_form_secrets ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE sales_public_form_secrets SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
DROP POLICY IF EXISTS sales_public_form_secrets_insert ON sales_public_form_secrets;
DROP POLICY IF EXISTS sales_public_form_secrets_update ON sales_public_form_secrets;
ALTER TABLE sales_public_form_secrets DROP CONSTRAINT IF EXISTS sales_public_form_secrets_pkey;
ALTER TABLE sales_public_form_secrets DROP COLUMN IF EXISTS id;
ALTER TABLE sales_public_form_secrets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE sales_public_form_secrets ADD PRIMARY KEY (organization_id);
ALTER TABLE sales_public_form_secrets ALTER COLUMN organization_id SET DEFAULT current_org_id();
CREATE POLICY sales_public_form_secrets_insert ON sales_public_form_secrets FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY sales_public_form_secrets_update ON sales_public_form_secrets FOR UPDATE USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
-- still deliberately no SELECT policy at all

-- ── SECURITY DEFINER RPCs — bypass RLS, must be taught org-scoping explicitly ──

CREATE OR REPLACE FUNCTION set_turnstile_secret(p_secret TEXT, p_profile_id UUID)
RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- p_profile_id must be the caller's own id, not just any admin/ceo's id —
  -- otherwise any authenticated user could overwrite another organization's
  -- Turnstile secret by passing that org's admin/ceo profile id (this
  -- function is SECURITY DEFINER, so it bypasses RLS entirely and this
  -- check is the only thing standing between "my org's secret" and "any
  -- org's secret" once org-scoping was added in this batch).
  IF p_profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT organization_id INTO v_org_id FROM profiles WHERE id = p_profile_id AND role IN ('admin','ceo');
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  INSERT INTO sales_public_form_secrets (organization_id, turnstile_secret_key, updated_by, updated_at)
  VALUES (v_org_id, p_secret, p_profile_id, now())
  ON CONFLICT (organization_id) DO UPDATE SET turnstile_secret_key = EXCLUDED.turnstile_secret_key, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION sales_public_form_secret_status()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM sales_public_form_secrets
    WHERE organization_id = current_org_id() AND turnstile_secret_key IS NOT NULL AND turnstile_secret_key <> ''
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- get_landing_link_public: unchanged logic (slug is globally unique, so the
-- row itself already pins the org — no filter needed, SECURITY DEFINER
-- already bypasses RLS to read it regardless).

-- public_submit_lead: STEP80 (not STEP75/77) is the current live version —
-- it DROPPED the old 8-arg signature and replaced it with a 9-arg one
-- (added p_custom_fields, defaulted) on top of STEP77's campaign_id
-- attribution. Rewritten here to (a) carry the 9-arg signature and
-- custom_fields insert forward unchanged and (b) resolve organization_id
-- from the landing link row (v_link.organization_id) throughout, since the
-- caller is anonymous and current_org_id() would return NULL for them.
-- Every downstream table read/write is explicitly scoped to that org —
-- SECURITY DEFINER bypasses RLS, so this scoping must be manual, not left
-- to RLS. DROP first since (per STEP80's own comment) a same-named
-- function with a different arg list creates an overload rather than
-- truly replacing the prior one.
DROP FUNCTION IF EXISTS public_submit_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public_submit_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

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
  SELECT turnstile_secret_key INTO v_secret FROM sales_public_form_secrets WHERE organization_id = v_link.organization_id;
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

  -- ── Campaign attribution — resolve via this landing link's channel link, if any (STEP77) ──
  SELECT campaign_id INTO v_campaign_id FROM marketing_campaign_channel_links WHERE linked_landing_page_id = v_link.id;

  -- ── Auto-assignment (mirrors src/lib/salesLeads.js's pickAssignee()), org-scoped ──
  SELECT rule_type INTO v_rule_type FROM sales_assignment_rules
  WHERE organization_id = v_link.organization_id AND domain = v_link.domain AND is_active = true AND (region_id = v_link.region_id OR region_id IS NULL)
  ORDER BY region_id NULLS LAST LIMIT 1;

  IF v_rule_type IS NOT NULL AND v_rule_type <> 'manual' THEN
    SELECT ra.profile_id INTO v_assigned_rep
    FROM sales_rep_assignments ra
    JOIN sales_role_definitions rd ON rd.id = ra.sales_role_definition_id
    WHERE ra.organization_id = v_link.organization_id AND rd.organization_id = v_link.organization_id
      AND rd.domain = v_link.domain AND rd.is_active = true AND (rd.region_id = v_link.region_id OR rd.region_id IS NULL)
      AND ra.active_from <= CURRENT_DATE AND (ra.active_to IS NULL OR ra.active_to >= CURRENT_DATE)
    GROUP BY ra.profile_id
    ORDER BY (SELECT count(*) FROM sales_leads sl WHERE sl.assigned_rep_id = ra.profile_id AND sl.organization_id = v_link.organization_id AND sl.status <> 'Disqualified') ASC
    LIMIT 1;
  END IF;

  v_status := CASE WHEN v_assigned_rep IS NULL THEN 'Unassigned — Needs Coverage' ELSE 'New' END;
  v_lead_number := 'LEAD-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substr(md5(random()::text), 1, 4);

  INSERT INTO sales_leads (
    organization_id, lead_number, source, domain, region_id, contact_name, company_name, phone, email, message,
    product_interest_id, landing_link_id, campaign_id, custom_fields, status, assigned_rep_id, coverage_alert_sent_at
  ) VALUES (
    v_link.organization_id, v_lead_number, v_link.source, v_link.domain, v_link.region_id, p_contact_name, p_company_name, p_phone, p_email, p_message,
    NULLIF(p_product_interest, ''), v_link.id, v_campaign_id, coalesce(p_custom_fields, '{}'::jsonb), v_status, v_assigned_rep,
    CASE WHEN v_assigned_rep IS NULL THEN now() END
  ) RETURNING id INTO v_lead_id;

  -- ── Coverage-gap alert (mirrors src/lib/salesLeads.js's alertCoverageGap()), org-scoped ──
  IF v_assigned_rep IS NULL THEN
    IF v_link.region_id IS NOT NULL THEN
      SELECT array_agg(id) INTO v_notified FROM profiles WHERE role = 'regional_sales_head' AND organization_id = v_link.organization_id;
    END IF;
    IF v_notified IS NULL OR array_length(v_notified, 1) IS NULL THEN
      SELECT array_agg(id) INTO v_notified FROM profiles WHERE role = 'sales_head' AND organization_id = v_link.organization_id;
    END IF;
    IF v_notified IS NOT NULL THEN
      -- organization_id must be explicit here, not left to its
      -- DEFAULT current_org_id() — this whole function runs as an
      -- unauthenticated (anon) caller, so auth.uid() is NULL and
      -- current_org_id() would resolve to NULL, tripping notifications'
      -- NOT NULL constraint and rolling back the sales_leads INSERT above
      -- along with it (same savepoint). v_link.organization_id is the
      -- already-resolved, trustworthy org for this whole request.
      INSERT INTO notifications (organization_id, recipient_id, type, title, body, link, metadata)
      SELECT v_link.organization_id, uid, 'sales_lead_unassigned', 'Lead needs coverage (public form)',
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

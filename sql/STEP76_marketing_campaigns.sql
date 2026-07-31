-- ============================================================
-- STEP76: Marketing Module — Campaign entity + budget/cost/channel/results
-- schema, plus a lightweight Content Asset library.
--
-- Ties together entities already built rather than duplicating them:
-- CampaignChannelLink points at the EXISTING sales_landing_links (public
-- lead-capture links, STEP75) and sales_bootstrap_programs (STEP72) —
-- no new landing-page or bootstrap concept invented. CampaignBudget
-- reuses the EXISTING sales_marketing_budget_lines table (STEP72,
-- originally built for Bootstrap Program) as the shared marketing budget
-- pool, same approved_by/approved_at stamp discipline — there is no
-- chain-based Budget approval workflow in this codebase to plug into
-- (Bootstrap Program doesn't use one either), so this doesn't invent a
-- parallel one.
--
-- Every FK here is REAL (not soft), matching the lesson from STEP74: all
-- referenced tables (sales_regions, profiles, products, product_launches,
-- sales_marketing_budget_lines, sales_landing_links, sales_bootstrap_programs,
-- invoices) already exist and are stable, and src/lib/marketingCampaigns.js
-- embeds several of them via PostgREST, which requires real FKs.
--
-- marketing_campaign_results is a CACHED rollup (leads/opportunities/
-- deals/spend/ROI), recomputed by explicit JS calls after the relevant
-- mutation — never a DB trigger, matching profit_margins/
-- sales_revenue_forecast/sales_profit_attribution's established pattern.
-- ============================================================

INSERT INTO roles (role_key, label, is_system, color) VALUES
  ('campaign_manager', 'Campaign Manager', true, '#f472b6')
ON CONFLICT (role_key) DO NOTHING;

-- ── Admin-configurable lookup lists (reuse src/lib/salesAdmin.js's
-- listLookup()/createLookup() pattern — same id/name/is_active shape as
-- sales_lead_sources etc.) ──
CREATE TABLE IF NOT EXISTS marketing_campaign_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO marketing_campaign_types (name) VALUES
  ('Digital'),('Trade Show'),('Referral Program'),('Content Marketing'),('Bootstrap-Startup'),('Email'),('Paid Ads')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS marketing_campaign_cost_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO marketing_campaign_cost_types (name) VALUES
  ('Ad Spend'),('Event/Venue'),('Content Production'),('Agency Fee'),('Other')
ON CONFLICT (name) DO NOTHING;

-- ── Campaign ──
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_name             TEXT          NOT NULL,
  campaign_type              TEXT          NOT NULL,  -- soft ref -> marketing_campaign_types.name (admin-editable list, free text)
  domain                     TEXT          CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),  -- nullable = cross-domain
  region_id                  UUID          REFERENCES sales_regions(id),  -- nullable = company-wide
  start_date                 DATE,
  end_date                   DATE,
  status                     TEXT          NOT NULL DEFAULT 'Planning' CHECK (status IN ('Planning','Active','Paused','Completed')),
  owner_id                   UUID          REFERENCES profiles(id),
  linked_product_id          TEXT          REFERENCES products(part_number),
  linked_product_launch_id   UUID          REFERENCES product_launches(id),
  created_by                 UUID          REFERENCES profiles(id),
  created_at                 TIMESTAMPTZ   DEFAULT now(),
  updated_at                 TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_campaigns_status_idx ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS marketing_campaigns_domain_region_idx ON marketing_campaigns(domain, region_id);

DROP TRIGGER IF EXISTS marketing_campaigns_updated_at ON marketing_campaigns;
CREATE TRIGGER marketing_campaigns_updated_at BEFORE UPDATE ON marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Campaign budget — planned side only; actual_spend is derived,
-- lives solely in marketing_campaign_results (single source of truth). ──
CREATE TABLE IF NOT EXISTS marketing_campaign_budgets (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     UUID          NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  budget_line_id  UUID          NOT NULL REFERENCES sales_marketing_budget_lines(id),
  planned_spend   NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT          NOT NULL DEFAULT 'INR',
  created_at      TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(campaign_id, budget_line_id)
);
CREATE INDEX IF NOT EXISTS marketing_campaign_budgets_campaign_idx ON marketing_campaign_budgets(campaign_id);

-- ── Cost entries — the actual spend log ──
CREATE TABLE IF NOT EXISTS marketing_campaign_cost_entries (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id       UUID          NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  cost_type         TEXT          NOT NULL,  -- soft ref -> marketing_campaign_cost_types.name
  amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency          TEXT          NOT NULL DEFAULT 'INR',
  incurred_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  vendor_invoice_id UUID          REFERENCES invoices(id),
  notes             TEXT,
  created_by        UUID          REFERENCES profiles(id),
  created_at        TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_campaign_cost_entries_campaign_idx ON marketing_campaign_cost_entries(campaign_id);

-- ── Channel links — Campaign <-> {Landing Page, Bootstrap Program, other}.
-- A single Campaign can have many channel links; a given Landing Page or
-- Bootstrap Program attributes to exactly one Campaign at a time (partial
-- unique indexes below), so rollups never double-count. ──
CREATE TABLE IF NOT EXISTS marketing_campaign_channel_links (
  id                          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id                 UUID        NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  channel_type                TEXT        NOT NULL CHECK (channel_type IN ('Landing Page','Bootstrap Program','Direct Outreach','Other')),
  linked_landing_page_id       UUID        REFERENCES sales_landing_links(id),
  linked_bootstrap_program_id  UUID        REFERENCES sales_bootstrap_programs(id),
  notes                        TEXT,
  created_at                   TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (channel_type = 'Landing Page' AND linked_landing_page_id IS NOT NULL)
    OR (channel_type = 'Bootstrap Program' AND linked_bootstrap_program_id IS NOT NULL)
    OR (channel_type IN ('Direct Outreach','Other'))
  )
);
CREATE INDEX IF NOT EXISTS marketing_campaign_channel_links_campaign_idx ON marketing_campaign_channel_links(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_campaign_channel_links_landing_page_uq ON marketing_campaign_channel_links(linked_landing_page_id) WHERE linked_landing_page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_campaign_channel_links_bootstrap_uq ON marketing_campaign_channel_links(linked_bootstrap_program_id) WHERE linked_bootstrap_program_id IS NOT NULL;

-- ── Results — the cached ROI rollup, recomputed by src/lib/marketingCampaigns.js ──
CREATE TABLE IF NOT EXISTS marketing_campaign_results (
  id                            UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id                   UUID          NOT NULL UNIQUE REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  leads_generated               INT           NOT NULL DEFAULT 0,
  opportunities_created         INT           NOT NULL DEFAULT 0,
  deals_won                     INT           NOT NULL DEFAULT 0,
  actual_spend                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue_attributed_projected  NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue_attributed_realized   NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_per_lead                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_per_won_deal              NUMERIC(14,2) NOT NULL DEFAULT 0,
  roi_percent_projected          NUMERIC(8,2)  NOT NULL DEFAULT 0,
  roi_percent_realized           NUMERIC(8,2)  NOT NULL DEFAULT 0,
  currency                       TEXT          NOT NULL DEFAULT 'INR',
  computed_at                    TIMESTAMPTZ   DEFAULT now()
);

-- ── Content Asset library ──
CREATE TABLE IF NOT EXISTS marketing_content_assets (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_name          TEXT          NOT NULL,
  asset_type          TEXT          NOT NULL CHECK (asset_type IN ('Brochure','Case Study','Product One-Pager','Video','Presentation Template')),
  file_reference       TEXT,          -- URL / file link
  linked_product_id    TEXT          REFERENCES products(part_number),
  tags                  TEXT[]        NOT NULL DEFAULT '{}',
  created_by            UUID          REFERENCES profiles(id),
  created_at             TIMESTAMPTZ   DEFAULT now(),
  updated_at             TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_content_assets_type_idx ON marketing_content_assets(asset_type);

DROP TRIGGER IF EXISTS marketing_content_assets_updated_at ON marketing_content_assets;
CREATE TRIGGER marketing_content_assets_updated_at BEFORE UPDATE ON marketing_content_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──
ALTER TABLE marketing_campaign_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_cost_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns                ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_budgets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_cost_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_channel_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_results          ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_content_assets            ENABLE ROW LEVEL SECURITY;

-- SELECT permissive throughout — Sales Reps need read access to Campaigns
-- (context on their leads) and Content Assets (pull for customer use),
-- and none of these tables carry the kind of sensitive per-rep number
-- sales_profit_attribution does.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'marketing_campaign_types','marketing_campaign_cost_types','marketing_campaigns',
    'marketing_campaign_budgets','marketing_campaign_cost_entries','marketing_campaign_channel_links',
    'marketing_campaign_results','marketing_content_assets'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager'',''finance''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager'',''finance''))
       )', t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.marketing_campaign_types, public.marketing_campaign_cost_types, public.marketing_campaigns,
  public.marketing_campaign_budgets, public.marketing_campaign_cost_entries, public.marketing_campaign_channel_links,
  public.marketing_campaign_results, public.marketing_content_assets
  TO authenticated;

NOTIFY pgrst, 'reload schema';

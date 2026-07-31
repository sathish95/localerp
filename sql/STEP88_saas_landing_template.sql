-- ============================================================
-- STEP88: "SaaS Product Launch" showcase template — a real
-- ConvertFlow/Leadpages-style SaaS page walking the growth block
-- catalog (STEP89, src/lib/landingPageBlockCatalog.js) end to end:
-- AnnouncementBar -> Header -> HeroSplit -> LogoCloud -> FeatureGrid ->
-- ScreenshotShowcase -> IntegrationGrid -> StatGrid -> TestimonialGrid ->
-- PricingTable -> FAQGroup -> CTABanner -> Footer.
--
-- Same pattern as STEP79's five seed templates (idempotent — ON
-- CONFLICT DO NOTHING on the template name, IF NOT EXISTS guard before
-- inserting its blocks so re-running this script is safe). All blocks
-- are full-width (layout_w_pct=100) since the auto-height flow canvas
-- (STEP86) stacks them top-to-bottom by sort_order — multi-column
-- layout for e.g. FeatureGrid/StatGrid/TestimonialGrid/PricingTable
-- happens INSIDE those blocks' own renderers, not via page-level
-- column placement.
-- ============================================================

DO $$
DECLARE
  v_tid UUID;
BEGIN
  INSERT INTO landing_page_templates (name, domain, description) VALUES
    ('SaaS Product Launch', 'B2B', 'Full ConvertFlow/Leadpages-style SaaS flow — announcement bar, split hero, social proof, feature grid, product screenshot, integrations, pricing, FAQ and footer.')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tid FROM landing_page_templates WHERE name = 'SaaS Product Launch';

  IF NOT EXISTS (SELECT 1 FROM landing_page_template_blocks WHERE template_id = v_tid) THEN
    INSERT INTO landing_page_template_blocks (template_id, block_type, layout_w_pct, config, sort_order) VALUES
      (v_tid, 'AnnouncementBar', 100, '{"text":"New: our biggest release yet","link_label":"See what''s new","link_url":"#","background_style":"violet"}'::jsonb, 1),
      (v_tid, 'Header', 100, '{"logo_text":"Your SaaS","menu_items":[{"label":"Product","url":"#"},{"label":"Pricing","url":"#"},{"label":"Customers","url":"#"}],"cta_label":"Start Free Trial","cta_action":"scroll_to_form","cta_url":"","cta_meeting_page_slug":""}'::jsonb, 2),
      (v_tid, 'HeroSplit', 100, '{"eyebrow":"NOW IN BETA","headline":"Run your whole business from one dashboard","subheadline":"The platform enterprise teams switch to and never leave. Set up in minutes, scale to millions of users.","cta_label":"Start Free Trial","cta_action":"scroll_to_form","cta_url":"","cta_meeting_page_slug":"","image_url":"","background_style":"indigo","image_position":"right"}'::jsonb, 3),
      (v_tid, 'LogoCloud', 100, '{"heading":"Trusted by teams at","logos":[{"name":"Acme Corp","image_url":""},{"name":"Globex","image_url":""},{"name":"Initech","image_url":""},{"name":"Umbrella","image_url":""},{"name":"Stark Industries","image_url":""}]}'::jsonb, 4),
      (v_tid, 'FeatureGrid', 100, '{"columns":3,"items":[{"icon":"⚡","title":"Fast setup","description":"Live in minutes, no engineering required."},{"icon":"🔗","title":"Integrates everywhere","description":"Connects to the tools your team already uses."},{"icon":"📈","title":"Built to scale","description":"From your first customer to your millionth."}]}'::jsonb, 5),
      (v_tid, 'ScreenshotShowcase', 100, '{"image_url":"","caption":"Your product, front and center.","frame_style":"browser"}'::jsonb, 6),
      (v_tid, 'IntegrationGrid', 100, '{"heading":"Works with your stack","logos":[{"name":"Slack","image_url":""},{"name":"Salesforce","image_url":""},{"name":"HubSpot","image_url":""},{"name":"Zapier","image_url":""}]}'::jsonb, 7),
      (v_tid, 'StatGrid', 100, '{"items":[{"number":"10,000+","label":"Active teams"},{"number":"99.99%","label":"Uptime SLA"},{"number":"4.9/5","label":"Average rating"}]}'::jsonb, 8),
      (v_tid, 'TestimonialGrid', 100, '{"items":[{"quote":"We cut onboarding time in half within the first month.","author":"Ops Lead","role":"Mid-market SaaS","avatar_url":""},{"quote":"Support has been outstanding from day one.","author":"IT Director","role":"Enterprise","avatar_url":""}]}'::jsonb, 9),
      (v_tid, 'PricingTable', 100, '{"plans":[{"name":"Starter","price":"$29","period":"mo","features":"Core features, Email support, Up to 5 seats","cta_label":"Start Free Trial","highlighted":"no"},{"name":"Growth","price":"$99","period":"mo","features":"Everything in Starter, Priority support, Unlimited seats, Advanced analytics","cta_label":"Start Free Trial","highlighted":"yes"},{"name":"Enterprise","price":"Custom","period":"","features":"Everything in Growth, Dedicated account manager, SSO & SAML, Custom SLA","cta_label":"Talk to Sales","highlighted":"no"}]}'::jsonb, 10),
      (v_tid, 'FAQGroup', 100, '{"items":[{"question":"Do you offer a free trial?","answer":"Yes, every plan starts with a 14-day free trial, no credit card required."},{"question":"Can I change plans later?","answer":"Yes, upgrade or downgrade at any time from your billing settings."},{"question":"Do you offer annual pricing?","answer":"Yes, annual plans save 20% compared to monthly billing."}]}'::jsonb, 11),
      (v_tid, 'CTABanner', 100, '{"headline":"Ready to get started?","subheadline":"Join 10,000+ teams already running on our platform.","cta_label":"Start Free Trial","cta_action":"scroll_to_form","cta_url":"","cta_meeting_page_slug":"","background_style":"violet"}'::jsonb, 12),
      (v_tid, 'Footer', 100, '{"logo_text":"Your SaaS","columns":[{"heading":"Product","link1_label":"Features","link1_url":"#","link2_label":"Pricing","link2_url":"#"},{"heading":"Company","link1_label":"About","link1_url":"#","link2_label":"Careers","link2_url":"#"}],"social_links":[{"platform":"twitter","url":"#"},{"platform":"linkedin","url":"#"}],"copyright_text":""}'::jsonb, 13);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

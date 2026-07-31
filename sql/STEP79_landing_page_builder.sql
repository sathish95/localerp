-- ============================================================
-- STEP79: Visual Landing Page Builder — grid-based, freeform drag/resize.
--
-- Reuses this codebase's EXISTING drag/resize grid mechanism
-- (react-grid-layout + react-resizable, already dependencies, already
-- proven in src/components/CustomDashboardBuilder.jsx for dashboard
-- widgets) for landing-page BLOCKS instead. layout_x/y/w/h below mirror
-- custom_dashboard_widgets' exact column shape — same grid math, same
-- edit-vs-view toggle (drag/resize enabled in the builder, disabled on
-- the public page), so the editor and the live page are guaranteed to
-- render identically. No new dependency, no bespoke canvas engine.
--
-- Builds ON TOP of sales_landing_links (STEP75) rather than replacing
-- it — a landing link optionally points at a landing_pages row via the
-- new landing_page_id column. Links without one keep rendering the
-- plain fixed-form page exactly as before.
--
-- Block config JSON shapes (must match src/lib/landingPageBlockCatalog.js
-- and src/components/landing-blocks/*):
--   Hero            {headline, subheadline, image_url, cta_label}
--   TrustBar        {items: [text, ...]}
--   FeatureCard     {icon, title, description}
--   ProductCard     {product_part_number, override_title, override_description}
--   ProductGrid     {product_part_numbers: [text, ...]}
--   HowItWorksStep  {step_number, title, description}
--   TestimonialCard {quote, author, role}
--   StatBlock       {number, label}
--   ComparisonTable {rows: [{feature, us, competitor}, ...]}
--   PricingCard     {plan_name, price, features: [text,...], cta_label}
--   FAQItem         {question, answer}
--   LeadForm        {headline}  -- the actual form fields come from the
--                                  EXISTING public_submit_lead() flow (STEP75/77)
--   Heading         {text, level}
--   Paragraph       {text}
--   Image           {image_url, alt}
--   Button          {label, url}
--   Divider         {}
-- ============================================================

CREATE TABLE IF NOT EXISTS landing_page_templates (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT        NOT NULL UNIQUE,
  domain       TEXT        NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government','Both')),
  description  TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS landing_page_template_blocks (
  id           UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id  UUID          NOT NULL REFERENCES landing_page_templates(id) ON DELETE CASCADE,
  block_type   TEXT          NOT NULL,
  layout_x     INT           NOT NULL DEFAULT 0,
  layout_y     INT           NOT NULL DEFAULT 0,
  layout_w     INT           NOT NULL DEFAULT 12,
  layout_h     INT           NOT NULL DEFAULT 6,
  config       JSONB         NOT NULL DEFAULT '{}',
  sort_order   INT           NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS landing_page_template_blocks_template_idx ON landing_page_template_blocks(template_id);

CREATE TABLE IF NOT EXISTS landing_pages (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT          NOT NULL,
  domain              TEXT          NOT NULL CHECK (domain IN ('B2B','B2C','D2C','Government','Non-Government')),
  template_id         UUID          REFERENCES landing_page_templates(id),  -- informational: which template it started from
  status              TEXT          NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Published')),
  linked_product_ids  TEXT[]        NOT NULL DEFAULT '{}',  -- products.part_number[], same convention as sales_landing_links.featured_products
  created_by          UUID          REFERENCES profiles(id),
  created_at          TIMESTAMPTZ   DEFAULT now(),
  updated_at          TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_pages_domain_idx ON landing_pages(domain);

DROP TRIGGER IF EXISTS landing_pages_updated_at ON landing_pages;
CREATE TRIGGER landing_pages_updated_at BEFORE UPDATE ON landing_pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS landing_page_blocks (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  landing_page_id  UUID          NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  block_type       TEXT          NOT NULL,
  layout_x         INT           NOT NULL DEFAULT 0,
  layout_y         INT           NOT NULL DEFAULT 0,
  layout_w         INT           NOT NULL DEFAULT 12,
  layout_h         INT           NOT NULL DEFAULT 6,
  config           JSONB         NOT NULL DEFAULT '{}',
  sort_order       INT           NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   DEFAULT now(),
  updated_at       TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_page_blocks_page_idx ON landing_page_blocks(landing_page_id);

DROP TRIGGER IF EXISTS landing_page_blocks_updated_at ON landing_page_blocks;
CREATE TRIGGER landing_page_blocks_updated_at BEFORE UPDATE ON landing_page_blocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sales_landing_links ADD COLUMN IF NOT EXISTS landing_page_id UUID REFERENCES landing_pages(id);

-- ── RLS — SELECT permissive to authenticated (builder needs to browse
-- templates/pages), write gated to the same roles as marketing_campaigns.
-- anon gets NO direct table access — only the SECURITY DEFINER RPCs below. ──
ALTER TABLE landing_page_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_page_template_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_pages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_page_blocks          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['landing_page_templates','landing_page_template_blocks','landing_pages','landing_page_blocks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''cmo'',''campaign_manager''))
       )', t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.landing_page_templates, public.landing_page_template_blocks, public.landing_pages, public.landing_page_blocks
  TO authenticated;

-- ── Public RPCs — same discipline as get_landing_link_public (STEP75):
-- curated, minimal, never the raw tables. ──
CREATE OR REPLACE FUNCTION get_landing_page_public(p_slug TEXT)
RETURNS TABLE (page_id UUID, page_name TEXT, blocks JSONB) AS $$
  SELECT lp.id, lp.name,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'block_type', b.block_type,
        'x', b.layout_x, 'y', b.layout_y, 'w', b.layout_w, 'h', b.layout_h,
        'config', b.config
      ) ORDER BY b.layout_y, b.layout_x)
      FROM landing_page_blocks b WHERE b.landing_page_id = lp.id
    ), '[]'::jsonb)
  FROM sales_landing_links l
  JOIN landing_pages lp ON lp.id = l.landing_page_id
  WHERE l.slug = p_slug AND l.is_active = true AND lp.status = 'Published';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_landing_page_public(TEXT) TO anon, authenticated;

-- Resolves product names for whichever part_numbers a page's ProductCard/
-- ProductGrid blocks reference — never the full catalog, and never
-- standard_cost (that's an internal COGS figure, not customer-facing).
CREATE OR REPLACE FUNCTION get_products_public(p_part_numbers TEXT[])
RETURNS TABLE (part_number TEXT, name TEXT, device_type TEXT) AS $$
  SELECT p.part_number, p.name, p.device_type FROM products p
  WHERE p.part_number = ANY(p_part_numbers) AND p.status = 'active';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_products_public(TEXT[]) TO anon, authenticated;

-- ── Seed 5 templates, each walking the same canonical ~12-section flow
-- (Hero -> Trust -> Features -> Product -> How It Works -> Testimonials
-- -> Stats -> Comparison -> Pricing -> FAQ -> Final CTA), varied per
-- domain. Fully editable/rearrangeable per page after creation — this is
-- just the starter arrangement. ──
DO $$
DECLARE
  v_tid UUID;
BEGIN
  -- ── Template 1: B2B Enterprise ──
  INSERT INTO landing_page_templates (name, domain, description) VALUES
    ('B2B Enterprise', 'B2B', 'Full-length page for enterprise IoT deals — trust signals, ROI comparison, and a demo-request CTA.')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tid FROM landing_page_templates WHERE name = 'B2B Enterprise';
  IF NOT EXISTS (SELECT 1 FROM landing_page_template_blocks WHERE template_id = v_tid) THEN
    INSERT INTO landing_page_template_blocks (template_id, block_type, layout_x, layout_y, layout_w, layout_h, config, sort_order) VALUES
      (v_tid,'Hero',0,0,12,8,'{"headline":"Enterprise IoT that scales with you","subheadline":"Deploy, monitor and manage your fleet from one platform.","image_url":"","cta_label":"Request a Demo"}'::jsonb,1),
      (v_tid,'TrustBar',0,8,12,3,'{"items":["Trusted by 200+ enterprises","ISO 27001 Certified","99.9% Uptime SLA"]}'::jsonb,2),
      (v_tid,'FeatureCard',0,11,4,6,'{"icon":"⚙️","title":"Enterprise-grade reliability","description":"Built for mission-critical deployments at scale."}'::jsonb,3),
      (v_tid,'FeatureCard',4,11,4,6,'{"icon":"🔒","title":"Security first","description":"End-to-end encryption and role-based access control."}'::jsonb,4),
      (v_tid,'FeatureCard',8,11,4,6,'{"icon":"📊","title":"Real-time analytics","description":"Actionable insights across every deployed device."}'::jsonb,5),
      (v_tid,'ProductCard',0,17,12,8,'{"product_part_number":"","override_title":"","override_description":""}'::jsonb,6),
      (v_tid,'HowItWorksStep',0,25,4,5,'{"step_number":1,"title":"Discovery Call","description":"We map your deployment needs."}'::jsonb,7),
      (v_tid,'HowItWorksStep',4,25,4,5,'{"step_number":2,"title":"Pilot Rollout","description":"Deploy to a test site first."}'::jsonb,8),
      (v_tid,'HowItWorksStep',8,25,4,5,'{"step_number":3,"title":"Scale Up","description":"Roll out company-wide with full support."}'::jsonb,9),
      (v_tid,'TestimonialCard',0,30,6,6,'{"quote":"Cut our deployment time in half.","author":"Ops Director","role":"Manufacturing"}'::jsonb,10),
      (v_tid,'TestimonialCard',6,30,6,6,'{"quote":"Support has been outstanding from day one.","author":"IT Lead","role":"Logistics"}'::jsonb,11),
      (v_tid,'StatBlock',0,36,4,4,'{"number":"200+","label":"Enterprises"}'::jsonb,12),
      (v_tid,'StatBlock',4,36,4,4,'{"number":"99.9%","label":"Uptime"}'::jsonb,13),
      (v_tid,'StatBlock',8,36,4,4,'{"number":"24/7","label":"Support"}'::jsonb,14),
      (v_tid,'ComparisonTable',0,40,12,8,'{"rows":[{"feature":"Real-time monitoring","us":"Yes","competitor":"Limited"},{"feature":"Dedicated support","us":"Yes","competitor":"No"},{"feature":"Custom integrations","us":"Yes","competitor":"Extra cost"}]}'::jsonb,15),
      (v_tid,'PricingCard',0,48,12,8,'{"plan_name":"Enterprise","price":"Custom pricing","features":["Unlimited devices","Dedicated account manager","SLA-backed support"],"cta_label":"Talk to Sales"}'::jsonb,16),
      (v_tid,'FAQItem',0,56,12,3,'{"question":"How long does deployment take?","answer":"Most pilots go live within 2 weeks."}'::jsonb,17),
      (v_tid,'FAQItem',0,59,12,3,'{"question":"Do you support custom integrations?","answer":"Yes, via our open API."}'::jsonb,18),
      (v_tid,'FAQItem',0,62,12,3,'{"question":"What does support look like?","answer":"24/7 for Enterprise plans."}'::jsonb,19),
      (v_tid,'FAQItem',0,65,12,3,'{"question":"Can we start with a pilot?","answer":"Yes, most customers start with a single-site pilot."}'::jsonb,20),
      (v_tid,'LeadForm',0,68,12,7,'{"headline":"Talk to our team"}'::jsonb,21);
  END IF;

  -- ── Template 2: B2B Product Launch ──
  INSERT INTO landing_page_templates (name, domain, description) VALUES
    ('B2B Product Launch', 'B2B', 'Announce a new product/feature to your existing B2B pipeline, with a pre-launch interest form.')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tid FROM landing_page_templates WHERE name = 'B2B Product Launch';
  IF NOT EXISTS (SELECT 1 FROM landing_page_template_blocks WHERE template_id = v_tid) THEN
    INSERT INTO landing_page_template_blocks (template_id, block_type, layout_x, layout_y, layout_w, layout_h, config, sort_order) VALUES
      (v_tid,'Hero',0,0,12,8,'{"headline":"Introducing our newest product","subheadline":"Be the first to bring it into your operations.","image_url":"","cta_label":"Get Early Access"}'::jsonb,1),
      (v_tid,'TrustBar',0,8,12,3,'{"items":["Built on our proven platform","Backed by our engineering team"]}'::jsonb,2),
      (v_tid,'FeatureCard',0,11,4,6,'{"icon":"🚀","title":"Faster deployment","description":"Live in days, not months."}'::jsonb,3),
      (v_tid,'FeatureCard',4,11,4,6,'{"icon":"🔗","title":"Fits your stack","description":"Integrates with what you already run."}'::jsonb,4),
      (v_tid,'FeatureCard',8,11,4,6,'{"icon":"📈","title":"Built to scale","description":"From pilot to full rollout."}'::jsonb,5),
      (v_tid,'ProductCard',0,17,12,8,'{"product_part_number":"","override_title":"","override_description":""}'::jsonb,6),
      (v_tid,'HowItWorksStep',0,25,4,5,'{"step_number":1,"title":"Sign Up","description":"Join the early access list."}'::jsonb,7),
      (v_tid,'HowItWorksStep',4,25,4,5,'{"step_number":2,"title":"Onboarding Call","description":"We walk you through setup."}'::jsonb,8),
      (v_tid,'HowItWorksStep',8,25,4,5,'{"step_number":3,"title":"Go Live","description":"Start using it in your workflow."}'::jsonb,9),
      (v_tid,'TestimonialCard',0,30,6,6,'{"quote":"Exactly what we were waiting for.","author":"Early Access Customer","role":"Beta Program"}'::jsonb,10),
      (v_tid,'TestimonialCard',6,30,6,6,'{"quote":"Setup was painless.","author":"Technical Lead","role":"Beta Program"}'::jsonb,11),
      (v_tid,'StatBlock',0,36,4,4,'{"number":"50+","label":"Early Adopters"}'::jsonb,12),
      (v_tid,'StatBlock',4,36,4,4,'{"number":"2 weeks","label":"Avg. time to live"}'::jsonb,13),
      (v_tid,'StatBlock',8,36,4,4,'{"number":"4.8/5","label":"Beta satisfaction"}'::jsonb,14),
      (v_tid,'ComparisonTable',0,40,12,8,'{"rows":[{"feature":"Setup time","us":"Days","competitor":"Weeks"},{"feature":"Onboarding support","us":"Included","competitor":"Extra cost"}]}'::jsonb,15),
      (v_tid,'PricingCard',0,48,12,8,'{"plan_name":"Early Access","price":"Special launch pricing","features":["Priority onboarding","Direct line to product team"],"cta_label":"Request Access"}'::jsonb,16),
      (v_tid,'FAQItem',0,56,12,3,'{"question":"When does it launch?","answer":"Early access starts now, general availability follows."}'::jsonb,17),
      (v_tid,'FAQItem',0,59,12,3,'{"question":"Is there a cost to join early access?","answer":"No, early access is free during the beta period."}'::jsonb,18),
      (v_tid,'FAQItem',0,62,12,3,'{"question":"Can I migrate my existing setup?","answer":"Yes, our team helps with migration."}'::jsonb,19),
      (v_tid,'FAQItem',0,65,12,3,'{"question":"Who do I contact for support?","answer":"Your onboarding contact, directly."}'::jsonb,20),
      (v_tid,'LeadForm',0,68,12,7,'{"headline":"Get early access"}'::jsonb,21);
  END IF;

  -- ── Template 3: B2C Direct-to-Consumer ──
  INSERT INTO landing_page_templates (name, domain, description) VALUES
    ('B2C Direct-to-Consumer', 'B2C', 'Consumer-facing product page — benefit-led, social proof, simple pricing.')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tid FROM landing_page_templates WHERE name = 'B2C Direct-to-Consumer';
  IF NOT EXISTS (SELECT 1 FROM landing_page_template_blocks WHERE template_id = v_tid) THEN
    INSERT INTO landing_page_template_blocks (template_id, block_type, layout_x, layout_y, layout_w, layout_h, config, sort_order) VALUES
      (v_tid,'Hero',0,0,12,8,'{"headline":"Smart living, made simple","subheadline":"The easiest way to bring your home online.","image_url":"","cta_label":"Get Yours Today"}'::jsonb,1),
      (v_tid,'TrustBar',0,8,12,3,'{"items":["Loved by 10,000+ customers","Free shipping","30-day returns"]}'::jsonb,2),
      (v_tid,'FeatureCard',0,11,4,6,'{"icon":"⚡","title":"Setup in minutes","description":"No technician needed."}'::jsonb,3),
      (v_tid,'FeatureCard',4,11,4,6,'{"icon":"📱","title":"Control from your phone","description":"Manage everything from one app."}'::jsonb,4),
      (v_tid,'FeatureCard',8,11,4,6,'{"icon":"💚","title":"Peace of mind","description":"Alerts the moment something needs attention."}'::jsonb,5),
      (v_tid,'ProductCard',0,17,12,8,'{"product_part_number":"","override_title":"","override_description":""}'::jsonb,6),
      (v_tid,'HowItWorksStep',0,25,4,5,'{"step_number":1,"title":"Order","description":"Choose your bundle."}'::jsonb,7),
      (v_tid,'HowItWorksStep',4,25,4,5,'{"step_number":2,"title":"Unbox & Plug In","description":"Ready in under 10 minutes."}'::jsonb,8),
      (v_tid,'HowItWorksStep',8,25,4,5,'{"step_number":3,"title":"Enjoy","description":"Control it from anywhere."}'::jsonb,9),
      (v_tid,'TestimonialCard',0,30,6,6,'{"quote":"Wish I bought this sooner!","author":"Verified Buyer","role":""}'::jsonb,10),
      (v_tid,'TestimonialCard',6,30,6,6,'{"quote":"So easy to set up, my parents use it too.","author":"Verified Buyer","role":""}'::jsonb,11),
      (v_tid,'StatBlock',0,36,4,4,'{"number":"10,000+","label":"Happy customers"}'::jsonb,12),
      (v_tid,'StatBlock',4,36,4,4,'{"number":"4.7/5","label":"Average rating"}'::jsonb,13),
      (v_tid,'StatBlock',8,36,4,4,'{"number":"< 10 min","label":"Setup time"}'::jsonb,14),
      (v_tid,'ComparisonTable',0,40,12,8,'{"rows":[{"feature":"Setup time","us":"10 minutes","competitor":"1 hour+"},{"feature":"Monthly fee","us":"None","competitor":"Yes"}]}'::jsonb,15),
      (v_tid,'PricingCard',0,48,12,8,'{"plan_name":"Starter Bundle","price":"₹4,999","features":["1 device","Free shipping","30-day returns"],"cta_label":"Buy Now"}'::jsonb,16),
      (v_tid,'FAQItem',0,56,12,3,'{"question":"Do I need a technician?","answer":"No, it''s plug-and-play."}'::jsonb,17),
      (v_tid,'FAQItem',0,59,12,3,'{"question":"What''s the warranty?","answer":"1 year standard warranty included."}'::jsonb,18),
      (v_tid,'FAQItem',0,62,12,3,'{"question":"Can I return it?","answer":"Yes, within 30 days."}'::jsonb,19),
      (v_tid,'FAQItem',0,65,12,3,'{"question":"Is there a monthly fee?","answer":"No, it''s a one-time purchase."}'::jsonb,20),
      (v_tid,'LeadForm',0,68,12,7,'{"headline":"Want to know more?"}'::jsonb,21);
  END IF;

  -- ── Template 4: B2C Promo/Discount ──
  INSERT INTO landing_page_templates (name, domain, description) VALUES
    ('B2C Promo/Discount', 'B2C', 'Short, urgency-driven promo page for a limited-time offer.')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tid FROM landing_page_templates WHERE name = 'B2C Promo/Discount';
  IF NOT EXISTS (SELECT 1 FROM landing_page_template_blocks WHERE template_id = v_tid) THEN
    INSERT INTO landing_page_template_blocks (template_id, block_type, layout_x, layout_y, layout_w, layout_h, config, sort_order) VALUES
      (v_tid,'Hero',0,0,12,8,'{"headline":"Limited-time offer — up to 30% off","subheadline":"This week only.","image_url":"","cta_label":"Shop the Sale"}'::jsonb,1),
      (v_tid,'TrustBar',0,8,12,3,'{"items":["Offer ends soon","Free shipping on all orders"]}'::jsonb,2),
      (v_tid,'FeatureCard',0,11,4,6,'{"icon":"🏷️","title":"Up to 30% off","description":"On select bundles."}'::jsonb,3),
      (v_tid,'FeatureCard',4,11,4,6,'{"icon":"🚚","title":"Free shipping","description":"No minimum order."}'::jsonb,4),
      (v_tid,'FeatureCard',8,11,4,6,'{"icon":"⏰","title":"This week only","description":"Offer ends soon."}'::jsonb,5),
      (v_tid,'ProductCard',0,17,12,8,'{"product_part_number":"","override_title":"","override_description":""}'::jsonb,6),
      (v_tid,'HowItWorksStep',0,25,4,5,'{"step_number":1,"title":"Pick your bundle","description":"Choose what fits you."}'::jsonb,7),
      (v_tid,'HowItWorksStep',4,25,4,5,'{"step_number":2,"title":"Apply the offer","description":"Discount applied at checkout."}'::jsonb,8),
      (v_tid,'HowItWorksStep',8,25,4,5,'{"step_number":3,"title":"Enjoy the savings","description":"Delivered fast."}'::jsonb,9),
      (v_tid,'TestimonialCard',0,30,6,6,'{"quote":"Grabbed it during the sale, great deal!","author":"Verified Buyer","role":""}'::jsonb,10),
      (v_tid,'TestimonialCard',6,30,6,6,'{"quote":"Fast shipping and easy checkout.","author":"Verified Buyer","role":""}'::jsonb,11),
      (v_tid,'StatBlock',0,36,4,4,'{"number":"30%","label":"Max discount"}'::jsonb,12),
      (v_tid,'StatBlock',4,36,4,4,'{"number":"Free","label":"Shipping"}'::jsonb,13),
      (v_tid,'StatBlock',8,36,4,4,'{"number":"This week","label":"Offer window"}'::jsonb,14),
      (v_tid,'ComparisonTable',0,40,12,8,'{"rows":[{"feature":"Price this week","us":"Discounted","competitor":"Full price"},{"feature":"Shipping","us":"Free","competitor":"Paid"}]}'::jsonb,15),
      (v_tid,'PricingCard',0,48,12,8,'{"plan_name":"Sale Bundle","price":"Starting at ₹3,499","features":["Limited-time discount","Free shipping"],"cta_label":"Claim the Offer"}'::jsonb,16),
      (v_tid,'FAQItem',0,56,12,3,'{"question":"When does the sale end?","answer":"This week — while stock lasts."}'::jsonb,17),
      (v_tid,'FAQItem',0,59,12,3,'{"question":"Can I combine offers?","answer":"One discount per order."}'::jsonb,18),
      (v_tid,'FAQItem',0,62,12,3,'{"question":"Is shipping really free?","answer":"Yes, on all orders during the sale."}'::jsonb,19),
      (v_tid,'FAQItem',0,65,12,3,'{"question":"What if I need help choosing?","answer":"Reach out via the form below."}'::jsonb,20),
      (v_tid,'LeadForm',0,68,12,7,'{"headline":"Questions about the offer?"}'::jsonb,21);
  END IF;

  -- ── Template 5: Universal Startup Pitch (domain = Both) ──
  INSERT INTO landing_page_templates (name, domain, description) VALUES
    ('Universal Startup Pitch', 'Both', 'Simple, general-purpose page for Bootstrap/Startup Program cohorts and early conversations — works for either domain.')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tid FROM landing_page_templates WHERE name = 'Universal Startup Pitch';
  IF NOT EXISTS (SELECT 1 FROM landing_page_template_blocks WHERE template_id = v_tid) THEN
    INSERT INTO landing_page_template_blocks (template_id, block_type, layout_x, layout_y, layout_w, layout_h, config, sort_order) VALUES
      (v_tid,'Hero',0,0,12,8,'{"headline":"Built for teams moving fast","subheadline":"Let''s talk about what you''re building.","image_url":"","cta_label":"Start the Conversation"}'::jsonb,1),
      (v_tid,'TrustBar',0,8,12,3,'{"items":["Partnered with founders and incubators"]}'::jsonb,2),
      (v_tid,'FeatureCard',0,11,4,6,'{"icon":"🤝","title":"Hands-on partnership","description":"We work with you directly."}'::jsonb,3),
      (v_tid,'FeatureCard',4,11,4,6,'{"icon":"💡","title":"Flexible terms","description":"Built for early-stage needs."}'::jsonb,4),
      (v_tid,'FeatureCard',8,11,4,6,'{"icon":"🌱","title":"Grow together","description":"Scale up as you do."}'::jsonb,5),
      (v_tid,'ProductCard',0,17,12,8,'{"product_part_number":"","override_title":"","override_description":""}'::jsonb,6),
      (v_tid,'HowItWorksStep',0,25,4,5,'{"step_number":1,"title":"Intro Call","description":"Tell us about your project."}'::jsonb,7),
      (v_tid,'HowItWorksStep',4,25,4,5,'{"step_number":2,"title":"Pilot Setup","description":"Get set up at no upfront cost."}'::jsonb,8),
      (v_tid,'HowItWorksStep',8,25,4,5,'{"step_number":3,"title":"Grow Together","description":"Scale as your needs grow."}'::jsonb,9),
      (v_tid,'TestimonialCard',0,30,6,6,'{"quote":"They worked with us like a true partner.","author":"Founder","role":"Portfolio Startup"}'::jsonb,10),
      (v_tid,'TestimonialCard',6,30,6,6,'{"quote":"Flexible and genuinely helpful.","author":"Co-founder","role":"Portfolio Startup"}'::jsonb,11),
      (v_tid,'StatBlock',0,36,4,4,'{"number":"20+","label":"Startups partnered"}'::jsonb,12),
      (v_tid,'StatBlock',4,36,4,4,'{"number":"0","label":"Upfront cost"}'::jsonb,13),
      (v_tid,'StatBlock',8,36,4,4,'{"number":"Fast","label":"Time to pilot"}'::jsonb,14),
      (v_tid,'ComparisonTable',0,40,12,8,'{"rows":[{"feature":"Upfront cost","us":"None","competitor":"Varies"},{"feature":"Dedicated contact","us":"Yes","competitor":"No"}]}'::jsonb,15),
      (v_tid,'PricingCard',0,48,12,8,'{"plan_name":"Startup Program","price":"By application","features":["No upfront cost","Dedicated support"],"cta_label":"Apply Now"}'::jsonb,16),
      (v_tid,'FAQItem',0,56,12,3,'{"question":"Who is this for?","answer":"Early-stage teams and startups."}'::jsonb,17),
      (v_tid,'FAQItem',0,59,12,3,'{"question":"Is there a cost to join?","answer":"No upfront cost for qualifying startups."}'::jsonb,18),
      (v_tid,'FAQItem',0,62,12,3,'{"question":"How long is the pilot?","answer":"Typically a few weeks, flexible to your needs."}'::jsonb,19),
      (v_tid,'FAQItem',0,65,12,3,'{"question":"What happens after the pilot?","answer":"We discuss a path to a full partnership."}'::jsonb,20),
      (v_tid,'LeadForm',0,68,12,7,'{"headline":"Apply to the program"}'::jsonb,21);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

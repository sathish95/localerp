-- STEP179: First-run product walkthrough + in-app guided tour.
--
-- Two admin-editable, per-organization content tables (mirrors the
-- Sales Config / Roles & Modules pattern: an org's admin/ceo edits
-- content from Settings, every member of that org sees it) — no new
-- code deploy needed to change the copy or add/remove a step.
--
-- onboarding_slides: the 3-screen intro carousel shown once, right
-- after first login, on web and/or mobile.
-- tour_steps: sequential spotlight/tooltip steps pointing at specific
-- UI anchors (target_key), shown once automatically (and re-runnable
-- on demand from a "Take a tour" entry point) after the walkthrough.
-- target_key values are a closed vocabulary defined in the client code
-- (web: src/lib/appTourTargets.js, mobile: mobile/src/lib/appTourTargets.ts)
-- — the admin UI offers a dropdown built from that list rather than
-- free text, so a typo can't silently produce a step that never finds
-- its anchor.
--
-- profiles gains two nullable "seen" timestamps so each user only gets
-- the walkthrough/tour once; profiles already has a permissive
-- self-update RLS policy (STEP96 — USING (... OR id = auth.uid())), so
-- no RLS change is needed for a user to mark their own row seen.

CREATE TABLE IF NOT EXISTS onboarding_slides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  order_index     INT NOT NULL DEFAULT 0,
  title           TEXT NOT NULL,
  body            TEXT,
  icon            TEXT,   -- lucide icon name, e.g. 'Sparkles'
  platform        TEXT NOT NULL DEFAULT 'both' CHECK (platform IN ('web','mobile','both')),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_slides_org_idx ON onboarding_slides(organization_id, platform, order_index);

CREATE TABLE IF NOT EXISTS tour_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  order_index     INT NOT NULL DEFAULT 0,
  target_key      TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  platform        TEXT NOT NULL DEFAULT 'web' CHECK (platform IN ('web','mobile')),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tour_steps_org_idx ON tour_steps(organization_id, platform, order_index);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS walkthrough_seen_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tour_seen_at TIMESTAMPTZ;

ALTER TABLE onboarding_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tour_steps        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_slides_select ON onboarding_slides;
DROP POLICY IF EXISTS onboarding_slides_write  ON onboarding_slides;
CREATE POLICY onboarding_slides_select ON onboarding_slides FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
CREATE POLICY onboarding_slides_write ON onboarding_slides FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);

DROP POLICY IF EXISTS tour_steps_select ON tour_steps;
DROP POLICY IF EXISTS tour_steps_write  ON tour_steps;
CREATE POLICY tour_steps_select ON tour_steps FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
CREATE POLICY tour_steps_write ON tour_steps FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_slides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tour_steps TO authenticated;

-- Seed 3 default slides + a few default tour steps for every existing
-- organization, so Settings shows editable starting content instead of
-- an empty state on first visit.
INSERT INTO onboarding_slides (organization_id, order_index, title, body, icon, platform)
SELECT o.id, s.order_index, s.title, s.body, s.icon, 'both'
FROM organizations o
CROSS JOIN (VALUES
  (0, 'Welcome to ThingsAlive NeoX', 'Your team''s expenses, projects, tasks and approvals — all in one place.', 'Sparkles'),
  (1, 'Track work as it happens', 'Check in/out, log hours against projects, and manage tasks from a single board.', 'ListChecks'),
  (2, 'Approvals without the chase', 'Expenses, travel and timesheets route themselves to the right approver, automatically.', 'CheckCircle2')
) AS s(order_index, title, body, icon)
WHERE NOT EXISTS (SELECT 1 FROM onboarding_slides x WHERE x.organization_id = o.id);

INSERT INTO tour_steps (organization_id, order_index, target_key, title, body, platform)
SELECT o.id, s.order_index, s.target_key, s.title, s.body, 'web'
FROM organizations o
CROSS JOIN (VALUES
  (0, 'web-nav-dashboard', 'Your dashboard', 'A live snapshot of what needs your attention today.'),
  (1, 'web-nav-tasks', 'Tasks board', 'Everything assigned to you, organised by status.'),
  (2, 'web-topbar-notifications', 'Notifications', 'Approvals, mentions and updates land here in real time.')
) AS s(order_index, target_key, title, body)
WHERE NOT EXISTS (SELECT 1 FROM tour_steps x WHERE x.organization_id = o.id AND x.platform = 'web');

INSERT INTO tour_steps (organization_id, order_index, target_key, title, body, platform)
SELECT o.id, s.order_index, s.target_key, s.title, s.body, 'mobile'
FROM organizations o
CROSS JOIN (VALUES
  (0, 'mobile-tab-discover', 'Discover', 'Every module you have access to, one tap away.'),
  (1, 'mobile-tab-tasks', 'Your tasks', 'Check status, update progress, all from your phone.'),
  (2, 'mobile-tab-profile', 'Profile & settings', 'Manage your account and notification preferences here.')
) AS s(order_index, target_key, title, body)
WHERE NOT EXISTS (SELECT 1 FROM tour_steps x WHERE x.organization_id = o.id AND x.platform = 'mobile');

NOTIFY pgrst, 'reload schema';

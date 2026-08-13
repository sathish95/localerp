-- ============================================================
-- STEP124: Customizable, à-la-carte module billing — org admins pick
-- which of the 11 dependency-safe module bundles (from the cross-module
-- dependency audit) their organization pays for, priced per seat.
--
-- This EXTENDS the existing seat-tier billing (STEP107's billing_plans /
-- organizations.plan_key) rather than replacing it: plan_key still
-- governs how many people can log in; bundle subscriptions now govern
-- which modules those people can use. Enterprise keeps its existing
-- "all modules included" meaning via a bypass in org_has_bundle().
--
-- Follows STEP107's exact request/approval shape (no payment gateway is
-- wired up yet, same as the seat-tier flow): an org admin/ceo calls
-- request_bundle_change(), which validates hard-dependency ordering,
-- logs a billing_bundle_requests row, and notifies every platform super
-- admin. A super admin actions it from /super-admin via
-- super_admin_set_org_bundle(), which is the only writer of
-- organization_bundle_subscriptions.
--
-- Tables:
--   billing_bundles                 — the 11-row catalog (+ which
--                                      module keys each one covers,
--                                      + its hard prerequisite bundles)
--   organization_bundle_subscriptions — which bundles an org has active
--   billing_bundle_requests         — pending/fulfilled/dismissed asks
--
-- Enforcement scope (be clear about what this migration does NOT do):
-- org_has_bundle()/module_bundle_key() are provided so the app's
-- existing isTabVisible() gate (src/context/TabVisibilityContext.jsx)
-- can hide nav items for unpurchased bundles, same UI-only enforcement
-- posture this app already has for the modules/module_role_visibility
-- kill-switch. Retrofitting RLS on every table inside all 11 bundles is
-- a separate, larger migration — deliberately out of scope here.
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_bundles (
  key                    TEXT        PRIMARY KEY,
  name                   TEXT        NOT NULL,
  module_keys            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  requires               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  price_per_seat_monthly NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_per_seat_yearly  NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order             INT         NOT NULL DEFAULT 0,
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ DEFAULT now()
);

INSERT INTO billing_bundles (key, name, module_keys, requires, price_per_seat_monthly, price_per_seat_yearly, sort_order) VALUES
  ('operations_core', 'Operations Core',
    '["projects","tasks","neo-task-ai","budget","assets"]',
    '[]', 99, 990, 1),
  ('resourcing', 'Resourcing',
    '["skill-matrix","allocations","capacity"]',
    '["operations_core"]', 79, 790, 2),
  ('expenses_travel', 'Expenses & Travel',
    '["expenses","travel","approvals"]',
    '["operations_core"]', 79, 790, 3),
  ('procurement_inventory', 'Procurement & Inventory',
    '["products","bom","inventory","devices","procurement","warranty","pos","invoices","grn","fundflow"]',
    '[]', 149, 1490, 4),
  ('finance_billing', 'Finance & Billing Ops',
    '["role-rates","customer-invoices","delivery-notes","payments","aging-report","profit-margins","spend-analyzer"]',
    '["operations_core"]', 129, 1290, 5),
  ('pre_sales', 'Pre-Sales',
    '["proposals"]',
    '["finance_billing","procurement_inventory"]', 99, 990, 6),
  ('sales_crm', 'Sales CRM',
    '["sales-leads","sales-landing-links","sales-meeting-pages","sales-opportunities","sales-tasks","sales-product-launches","sales-tenders","sales-pilot-projects","sales-bootstrap-programs","sales-timeline","sales-dashboard"]',
    '["pre_sales"]', 149, 1490, 7),
  ('marketing', 'Marketing',
    '["marketing-campaigns","marketing-landing-pages","marketing-content-assets","marketing-calendar"]',
    '["sales_crm"]', 99, 990, 8),
  ('performance_reviews', 'Performance Reviews',
    '["performance-cycles","my-performance","team-reviews","calibration","performance-dashboard"]',
    '[]', 79, 790, 9),
  ('recognition_awards', 'Recognition & Awards',
    '["award-management","my-awards","team-awards","certificate-templates"]',
    '[]', 99, 990, 10),
  ('hr_resources', 'HR & Resources',
    '["leave","resources","timesheet","timesheet-approvals","data-assistant"]',
    '["resourcing"]', 99, 990, 11)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_bundle_subscriptions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bundle_key      TEXT        NOT NULL REFERENCES billing_bundles(key),
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  activated_at    TIMESTAMPTZ DEFAULT now(),
  deactivated_at  TIMESTAMPTZ,
  UNIQUE (organization_id, bundle_key)
);
CREATE INDEX IF NOT EXISTS organization_bundle_subscriptions_org_idx ON organization_bundle_subscriptions(organization_id);

CREATE TABLE IF NOT EXISTS billing_bundle_requests (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bundle_key      TEXT        NOT NULL REFERENCES billing_bundles(key),
  action          TEXT        NOT NULL CHECK (action IN ('activate','deactivate')),
  note            TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','dismissed')),
  created_by      UUID        REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  resolved_by     UUID        REFERENCES profiles(id),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS billing_bundle_requests_org_idx ON billing_bundle_requests(organization_id);

ALTER TABLE billing_bundles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_bundle_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_bundle_requests            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_bundles_select ON billing_bundles;
CREATE POLICY billing_bundles_select ON billing_bundles FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.billing_bundles TO authenticated;

DROP POLICY IF EXISTS organization_bundle_subscriptions_select ON organization_bundle_subscriptions;
CREATE POLICY organization_bundle_subscriptions_select ON organization_bundle_subscriptions FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
GRANT SELECT ON public.organization_bundle_subscriptions TO authenticated;

DROP POLICY IF EXISTS billing_bundle_requests_select ON billing_bundle_requests;
DROP POLICY IF EXISTS billing_bundle_requests_insert ON billing_bundle_requests;
DROP POLICY IF EXISTS billing_bundle_requests_update ON billing_bundle_requests;
CREATE POLICY billing_bundle_requests_select ON billing_bundle_requests FOR SELECT USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
CREATE POLICY billing_bundle_requests_insert ON billing_bundle_requests FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY billing_bundle_requests_update ON billing_bundle_requests FOR UPDATE USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);
GRANT SELECT, INSERT, UPDATE ON public.billing_bundle_requests TO authenticated;

-- ── module_bundle_key() — which bundle (if any) owns a given nav module
-- key. NULL means the module is Foundational (never gated). ──
CREATE OR REPLACE FUNCTION module_bundle_key(p_module_key TEXT) RETURNS TEXT AS $$
  SELECT key FROM billing_bundles WHERE module_keys ? p_module_key LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ── org_has_bundle() — the actual gate. Enterprise plan bypasses
-- entirely, matching billing_plans' existing "All modules" meaning for
-- that tier — bundle subscriptions are additive on top of every OTHER
-- plan, not a replacement for what Enterprise already promises. ──
CREATE OR REPLACE FUNCTION org_has_bundle(p_bundle_key TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_bundle_subscriptions
    WHERE organization_id = current_org_id() AND bundle_key = p_bundle_key AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM organizations WHERE id = current_org_id() AND plan_key = 'enterprise'
  );
$$ LANGUAGE sql STABLE;

-- ── org_bundle_monthly_total() — sum of active bundles' per-seat price,
-- multiplied once by the org's active headcount (equivalent to summing
-- each bundle's own per-seat contribution across every seat). ──
CREATE OR REPLACE FUNCTION org_bundle_monthly_total(p_org_id UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(bb.price_per_seat_monthly), 0) * (
    SELECT count(*) FROM profiles WHERE organization_id = p_org_id AND is_active = true
  )
  FROM organization_bundle_subscriptions obs
  JOIN billing_bundles bb ON bb.key = obs.bundle_key
  WHERE obs.organization_id = p_org_id AND obs.status = 'active';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION org_bundle_monthly_total(UUID) TO authenticated;

-- ── request_bundle_change() — org admin/ceo asks to activate or
-- deactivate one bundle. Validates the dependency chain BOTH ways
-- before logging the request: activating something requires its hard
-- prerequisites already active; deactivating something already relied
-- on by another active bundle is blocked with a clear message, rather
-- than silently auto-cascading either direction. ──
CREATE OR REPLACE FUNCTION request_bundle_change(p_bundle_key TEXT, p_action TEXT, p_note TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_org_id   UUID := current_org_id();
  v_org_name TEXT;
  v_req_id   UUID;
  v_bundle   billing_bundles%ROWTYPE;
  v_missing  TEXT;
  v_dependent TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can request a module change';
  END IF;
  IF p_action NOT IN ('activate','deactivate') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;
  SELECT * INTO v_bundle FROM billing_bundles WHERE key = p_bundle_key AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown module bundle';
  END IF;

  IF p_action = 'activate' THEN
    SELECT string_agg(bb2.name, ', ') INTO v_missing
    FROM jsonb_array_elements_text(v_bundle.requires) req
    JOIN billing_bundles bb2 ON bb2.key = req
    WHERE NOT org_has_bundle(req);
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'This module requires % to be active first', v_missing;
    END IF;
  ELSE
    SELECT string_agg(bb.name, ', ') INTO v_dependent
    FROM organization_bundle_subscriptions obs
    JOIN billing_bundles bb ON bb.key = obs.bundle_key
    WHERE obs.organization_id = v_org_id AND obs.status = 'active' AND bb.requires ? p_bundle_key;
    IF v_dependent IS NOT NULL THEN
      RAISE EXCEPTION 'Deactivate % first — it depends on this module', v_dependent;
    END IF;
  END IF;

  INSERT INTO billing_bundle_requests (organization_id, bundle_key, action, note, created_by)
  VALUES (v_org_id, p_bundle_key, p_action, p_note, auth.uid())
  RETURNING id INTO v_req_id;

  SELECT name INTO v_org_name FROM organizations WHERE id = v_org_id;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT id,
    'billing_bundle_request',
    CASE WHEN p_action = 'activate' THEN 'Module activation requested' ELSE 'Module deactivation requested' END,
    COALESCE(v_org_name, 'An organization') || ' requested to ' || p_action || ' "' || v_bundle.name || '".',
    '/super-admin'
  FROM profiles WHERE is_super_admin = true;

  RETURN v_req_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION request_bundle_change(TEXT, TEXT, TEXT) TO authenticated;

-- ── super_admin_list_bundle_requests() ──
CREATE OR REPLACE FUNCTION super_admin_list_bundle_requests()
RETURNS TABLE (
  id UUID, organization_id UUID, org_name TEXT, bundle_key TEXT, bundle_name TEXT,
  action TEXT, note TEXT, status TEXT, created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT r.id, r.organization_id, o.name, r.bundle_key, bb.name, r.action, r.note, r.status, r.created_at
    FROM billing_bundle_requests r
    JOIN organizations o ON o.id = r.organization_id
    JOIN billing_bundles bb ON bb.key = r.bundle_key
    ORDER BY r.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_bundle_requests() TO authenticated;

-- ── super_admin_set_org_bundle() — the only writer of
-- organization_bundle_subscriptions; upserts so re-activating a
-- previously-cancelled bundle updates the same row rather than
-- duplicating it. ──
CREATE OR REPLACE FUNCTION super_admin_set_org_bundle(
  p_org_id UUID, p_bundle_key TEXT, p_active BOOLEAN, p_request_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM billing_bundles WHERE key = p_bundle_key) THEN
    RAISE EXCEPTION 'Unknown module bundle';
  END IF;

  INSERT INTO organization_bundle_subscriptions (organization_id, bundle_key, status, activated_at, deactivated_at)
  VALUES (
    p_org_id, p_bundle_key,
    CASE WHEN p_active THEN 'active' ELSE 'cancelled' END,
    CASE WHEN p_active THEN now() ELSE NULL END,
    CASE WHEN p_active THEN NULL ELSE now() END
  )
  ON CONFLICT (organization_id, bundle_key) DO UPDATE SET
    status         = EXCLUDED.status,
    activated_at   = CASE WHEN EXCLUDED.status = 'active' THEN now() ELSE organization_bundle_subscriptions.activated_at END,
    deactivated_at = CASE WHEN EXCLUDED.status = 'cancelled' THEN now() ELSE NULL END;

  IF p_request_id IS NOT NULL THEN
    UPDATE billing_bundle_requests SET status = 'fulfilled', resolved_at = now(), resolved_by = auth.uid() WHERE id = p_request_id;
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id,
    'billing_bundle_resolved',
    CASE WHEN p_active THEN 'Module activated' ELSE 'Module deactivated' END,
    (SELECT name FROM billing_bundles WHERE key = p_bundle_key) || ' has been ' ||
      (CASE WHEN p_active THEN 'activated' ELSE 'deactivated' END) || ' for your organization.',
    '/settings'
  FROM profiles p WHERE p.organization_id = p_org_id AND p.role IN ('admin','ceo');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_set_org_bundle(UUID, TEXT, BOOLEAN, UUID) TO authenticated;

-- ── super_admin_dismiss_bundle_request() — reject without change ──
CREATE OR REPLACE FUNCTION super_admin_dismiss_bundle_request(p_request_id UUID) RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE billing_bundle_requests SET status = 'dismissed', resolved_at = now(), resolved_by = auth.uid() WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_dismiss_bundle_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

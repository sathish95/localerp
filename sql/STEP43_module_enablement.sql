-- ============================================================
-- STEP43: Module Enablement — replaces TabVisibilityContext.jsx's
-- localStorage-only (per-browser, not org-wide) tab visibility with real
-- Supabase-backed state, plus a company-wide enable/disable switch that
-- didn't exist in any form before.
--
-- Two axes:
--   modules.enabled              — company-wide kill switch, applies to
--                                   EVERY role including admin/ceo
--   module_role_visibility.visible — per-role nav/page visibility within
--                                   an enabled module (mirrors the old
--                                   DEFAULT_TABS behavior: default visible
--                                   unless a row says otherwise)
--
-- Run AFTER STEP42 (roles table). module_role_visibility.role is a SOFT
-- ref to roles.role_key (no REFERENCES) so deleting a custom role never
-- cascades unexpectedly into permission rows.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS modules (
  key        TEXT        PRIMARY KEY,
  label      TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  updated_by UUID        REFERENCES profiles(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed from src/config/modules.js's key list (kept in sync manually —
-- src/lib/modules.js's syncModulesFromConfig() also self-heals any key
-- added to modules.js later without a matching row here).
INSERT INTO modules (key, label) VALUES
  ('dashboard','Dashboard'),
  ('expenses','Expenses'), ('travel','Travel Requests'), ('approvals','Approvals'),
  ('projects','Projects'), ('tasks','Task Management'), ('neo-task-ai','Neo Task AI'), ('budget','Budget'), ('assets','Assets'),
  ('skill-matrix','Skill Matrix'), ('allocations','Allocations'), ('capacity','Capacity'),
  ('customers','Customers'), ('vendors','Vendors'), ('products','Products'), ('devices','Devices'), ('warranty','Warranty'),
  ('procurement','Purchase Req.'), ('invoices','Invoices'), ('fundflow','Fund Flow'), ('pos','Purchase Orders'), ('grn','GRN'),
  ('role-rates','Role Rates'), ('customer-invoices','Customer Invoices'), ('payments','Payments'),
  ('aging-report','Aging Report'), ('profit-margins','Profit Margins'), ('spend-analyzer','Spend Analyzer'),
  ('leave','Leave Management'), ('resources','Resource Tracking'), ('timesheet','Timesheet'),
  ('timesheet-approvals','Timesheet Approvals'), ('chat','Chat'),
  ('users','Users'), ('reports','Reports'), ('settings','Settings'), ('content','Landing Content'), ('app-monitor','App Monitor')
ON CONFLICT (key) DO NOTHING;

DROP TRIGGER IF EXISTS modules_updated_at ON modules;
CREATE TRIGGER modules_updated_at BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS module_role_visibility (
  module_key TEXT        NOT NULL REFERENCES modules(key) ON DELETE CASCADE,
  role       TEXT        NOT NULL,   -- soft ref -> roles.role_key
  visible    BOOLEAN     NOT NULL DEFAULT true,
  PRIMARY KEY (module_key, role)
);

ALTER TABLE modules                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_role_visibility  ENABLE ROW LEVEL SECURITY;

-- Permissive SELECT (every authenticated user needs to read these to
-- render their own sidebar); writes restricted to admin/ceo, same
-- bootstrapping reasoning as roles (STEP42).
CREATE POLICY modules_select ON modules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY modules_update ON modules FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY modules_insert ON modules FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

CREATE POLICY module_role_visibility_select ON module_role_visibility FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY module_role_visibility_write ON module_role_visibility FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

GRANT SELECT, INSERT, UPDATE ON public.modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_role_visibility TO authenticated;

NOTIFY pgrst, 'reload schema';

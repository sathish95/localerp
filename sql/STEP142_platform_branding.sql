-- ============================================================
-- STEP142: Platform-wide app name, admin-configurable — replaces the
-- "ThingsAlive NeoX" literal hardcoded across the sidebar, auth page,
-- landing page, and public lead/meeting forms. Platform-wide (super
-- admin only), not per-organization: the public landing/auth/lead-
-- capture pages render before any org context exists at all, so a
-- per-org name wouldn't make sense for most of the places this shows.
--
-- Single-row config table (the `singleton` boolean-with-CHECK trick
-- guarantees exactly one row can ever exist). Publicly readable
-- (anon included) since the app name has to render before login.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  singleton  BOOLEAN     PRIMARY KEY DEFAULT true CHECK (singleton),
  app_name   TEXT        NOT NULL DEFAULT 'ThingsAlive NeoX',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID        REFERENCES profiles(id)
);
INSERT INTO platform_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_settings_select ON platform_settings;
DROP POLICY IF EXISTS platform_settings_write ON platform_settings;

CREATE POLICY platform_settings_select ON platform_settings FOR SELECT USING (true);
GRANT SELECT ON public.platform_settings TO anon, authenticated;

CREATE POLICY platform_settings_write ON platform_settings FOR UPDATE USING (
  is_platform_super_admin()
) WITH CHECK (
  is_platform_super_admin()
);
GRANT UPDATE ON public.platform_settings TO authenticated;

NOTIFY pgrst, 'reload schema';

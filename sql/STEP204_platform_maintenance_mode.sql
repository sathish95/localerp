-- ============================================================
-- STEP204: Platform-wide maintenance mode.
--
-- Reuses platform_settings (STEP142's singleton branding row) rather
-- than a new table — same "one config row, publicly readable, only a
-- platform super admin can write it" shape maintenance mode needs.
--
-- Enforcement is client-side (App.jsx's AppRoutes swaps the whole
-- routes tree for <MaintenancePage/>), same posture as the existing
-- org-suspended / account-deactivated gates in this app — there is no
-- RLS lockout, since regular users must still be able to SELECT their
-- own org's data once maintenance ends. platform_settings itself stays
-- readable by anon too, so the flag could later gate the public
-- landing/auth pages as well if ever needed.
--
-- Realtime enabled (same recipe as STEP21_task_realtime_sync.sql) so a
-- super admin flipping this on/off is reflected immediately in every
-- already-open session, not just on next login.
-- ============================================================

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS maintenance_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS maintenance_message TEXT;

ALTER TABLE platform_settings REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'platform_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE platform_settings;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- STEP211: Optional GIF/image on the maintenance-mode page (STEP204).
-- Same singleton platform_settings row — a super admin pastes a URL
-- (e.g. their own hosted asset, or a Giphy/Tenor embed link) from
-- Settings; MaintenancePage.jsx just falls back to the plain Wrench
-- icon when this is unset, so nothing breaks for orgs that never set one.
-- ============================================================

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS maintenance_gif_url TEXT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- STEP61: Add the "Sales Lead" role for the Proposal Module.
--
-- profiles.role stopped being a native Postgres enum in STEP42 — it's now
-- TEXT with a real `roles` table behind it (FK profiles_role_fkey), so
-- adding a role is a plain INSERT, not an ALTER TYPE ... ADD VALUE (the
-- gotcha that bit purchase_requisitions.status in STEP60). Seeded here as
-- is_system so it can't be accidentally deleted from Settings → Roles,
-- matching the 11 built-in roles seeded in STEP42.
-- ============================================================

INSERT INTO roles (role_key, label, is_system, color) VALUES
  ('sales_lead', 'Sales Lead', true, '#f97316')
ON CONFLICT (role_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

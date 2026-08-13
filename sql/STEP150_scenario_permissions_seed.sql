-- ============================================================
-- STEP150: Register the 7 SCENARIO_* permission keys used throughout
-- STEP143-149's RLS policies into the STEP125 permission matrix, and
-- grant admin/ceo everything — matching that migration's own seeding
-- convention exactly (it CROSS JOINs admin/ceo against every row in
-- `permissions`, but that INSERT already ran once and won't retroactively
-- pick up rows added after it — so these need their own explicit grant).
-- ============================================================

INSERT INTO permissions (key, label, category, sort_order) VALUES
  ('SCENARIO_CREATE',            'Create Scenarios',              'Scenario Center', 1),
  ('SCENARIO_EDIT',              'Edit Scenarios',                'Scenario Center', 2),
  ('SCENARIO_SIMULATE',          'Run Simulations',                'Scenario Center', 3),
  ('SCENARIO_SUBMIT',            'Submit Scenarios for Approval', 'Scenario Center', 4),
  ('SCENARIO_APPROVE',           'Approve/Reject Scenarios',      'Scenario Center', 5),
  ('SCENARIO_EXECUTE',           'Execute Approved Scenarios',    'Scenario Center', 6),
  ('SCENARIO_TEMPLATE_MANAGE',   'Manage Scenario Templates',     'Scenario Center', 7)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_key, permission_key)
SELECT r.role_key, p.key FROM (VALUES ('admin'), ('ceo')) AS r(role_key)
CROSS JOIN (VALUES
  ('SCENARIO_CREATE'), ('SCENARIO_EDIT'), ('SCENARIO_SIMULATE'), ('SCENARIO_SUBMIT'),
  ('SCENARIO_APPROVE'), ('SCENARIO_EXECUTE'), ('SCENARIO_TEMPLATE_MANAGE')
) AS p(key)
ON CONFLICT DO NOTHING;

-- Sensible non-admin defaults matching this migration's own fallback-role
-- arrays baked into the RLS policies (STEP143-148), so a fresh org that
-- hasn't touched Settings -> Roles & Permissions still behaves exactly
-- like those hardcoded fallbacks describe.
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'manager', k FROM (VALUES ('SCENARIO_CREATE'), ('SCENARIO_EDIT'), ('SCENARIO_SIMULATE'), ('SCENARIO_SUBMIT')) AS v(k)
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'department_head', k FROM (VALUES ('SCENARIO_CREATE'), ('SCENARIO_EDIT'), ('SCENARIO_SIMULATE'), ('SCENARIO_SUBMIT'), ('SCENARIO_APPROVE')) AS v(k)
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'finance', k FROM (VALUES ('SCENARIO_CREATE'), ('SCENARIO_EDIT'), ('SCENARIO_SIMULATE'), ('SCENARIO_SUBMIT'), ('SCENARIO_APPROVE'), ('SCENARIO_EXECUTE')) AS v(k)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

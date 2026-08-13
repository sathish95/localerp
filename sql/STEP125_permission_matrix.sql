-- ============================================================
-- STEP125: Fine-grained permission matrix — replaces scattered
-- `role IN ('admin','ceo',...)` checks with atomic, HR/admin-configurable
-- permissions (EMPLOYEE_VIEW, AWARD_APPROVE, etc.), starting as an
-- ADDITIVE layer rather than a wholesale rewrite.
--
-- Scope decision: this migration does NOT touch the ~20 existing
-- hardcoded role-check sites across App.jsx/RLS policies — replacing
-- every one of those in one pass would be a large, high-risk sweep
-- across code this app already depends on. Instead, this lands the
-- full, real permission system (schema + seed + Settings UI to edit
-- it), proven on ONE concrete, low-blast-radius consumer: the Award
-- module's "Approve & Grant" action in TeamAwardsPage, gated by
-- AWARD_APPROVE/AWARD_GRANT instead of an inline role array. Migrating
-- the rest of the app's role checks to this system is a separate,
-- larger follow-up — same reasoning as STEP124 leaving RLS-level bundle
-- enforcement for a later pass.
--
-- role_permissions is intentionally NOT organization-scoped, matching
-- the `roles` table itself (STEP42): role_key is a global PK shared
-- across every org (an org's custom role is visible platform-wide
-- today, a pre-existing quirk this migration doesn't change), and
-- write access mirrors roles' own convention exactly — hardcoded to
-- admin/ceo, not further configurable, since this table bootstraps the
-- permission system itself.
--
-- Seed grants reproduce TODAY'S actual behavior exactly (App.jsx's
-- isPerformanceAdmin/isPerformanceReviewer/isHR patterns) — turning this
-- on changes nothing until an admin deliberately edits the matrix.
-- ============================================================

CREATE TABLE IF NOT EXISTS permissions (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  category   TEXT NOT NULL,
  sort_order INT  NOT NULL DEFAULT 0
);

INSERT INTO permissions (key, label, category, sort_order) VALUES
  ('EMPLOYEE_VIEW',        'View Employees',                       'Employees',    1),
  ('EMPLOYEE_CREATE',      'Create Employees',                     'Employees',    2),
  ('EMPLOYEE_EDIT',        'Edit Employees',                       'Employees',    3),
  ('PERFORMANCE_VIEW',     'View Performance',                     'Performance',  4),
  ('PERFORMANCE_CREATE',   'Create Performance Cycles & Goals',    'Performance',  5),
  ('PERFORMANCE_EDIT',     'Edit Reviews & Ratings',                'Performance',  6),
  ('AWARD_VIEW',           'View Awards',                          'Awards',       7),
  ('AWARD_CREATE',         'Create & Configure Awards',            'Awards',       8),
  ('AWARD_APPROVE',        'Approve / Reject Award Recommendations','Awards',      9),
  ('AWARD_GRANT',          'Grant Awards',                         'Awards',      10),
  ('CERTIFICATE_VIEW',     'View Certificates',                    'Certificates', 11),
  ('CERTIFICATE_DOWNLOAD', 'Download Certificates',                'Certificates', 12),
  ('CERTIFICATE_MANAGE',   'Manage Certificate Templates',         'Certificates', 13),
  ('BILLING_VIEW',         'View Billing',                         'Billing',      14),
  ('BILLING_MANAGE',       'Manage Billing & Subscription',        'Billing',      15),
  ('USER_MANAGE',          'Manage Users',                         'Organization', 16),
  ('ROLE_MANAGE',          'Manage Roles & Permissions',           'Organization', 17),
  ('ORGANIZATION_MANAGE',  'Manage Organization Settings',         'Organization', 18)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key       TEXT NOT NULL REFERENCES roles(role_key) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

-- admin/ceo get everything, matching every existing isAdmin-style bypass.
INSERT INTO role_permissions (role_key, permission_key)
SELECT r.role_key, p.key FROM (VALUES ('admin'), ('ceo')) AS r(role_key) CROSS JOIN permissions p
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('hr','EMPLOYEE_VIEW'), ('hr','EMPLOYEE_CREATE'), ('hr','EMPLOYEE_EDIT'),
  ('hr','PERFORMANCE_VIEW'), ('hr','PERFORMANCE_CREATE'), ('hr','PERFORMANCE_EDIT'),
  ('hr','AWARD_VIEW'), ('hr','AWARD_CREATE'), ('hr','AWARD_APPROVE'), ('hr','AWARD_GRANT'),
  ('hr','CERTIFICATE_VIEW'), ('hr','CERTIFICATE_DOWNLOAD'), ('hr','CERTIFICATE_MANAGE'),
  ('hr','USER_MANAGE'),

  ('manager','EMPLOYEE_VIEW'), ('manager','PERFORMANCE_VIEW'), ('manager','PERFORMANCE_EDIT'),
  ('manager','AWARD_VIEW'), ('manager','AWARD_APPROVE'), ('manager','AWARD_GRANT'),
  ('manager','CERTIFICATE_VIEW'), ('manager','CERTIFICATE_DOWNLOAD'),

  ('department_head','EMPLOYEE_VIEW'), ('department_head','PERFORMANCE_VIEW'), ('department_head','PERFORMANCE_EDIT'),
  ('department_head','AWARD_VIEW'), ('department_head','AWARD_APPROVE'), ('department_head','AWARD_GRANT'),
  ('department_head','CERTIFICATE_VIEW'), ('department_head','CERTIFICATE_DOWNLOAD'),

  ('finance','BILLING_VIEW'), ('finance','BILLING_MANAGE'), ('finance','EMPLOYEE_VIEW'),

  ('employee','AWARD_VIEW'), ('employee','CERTIFICATE_VIEW'), ('employee','CERTIFICATE_DOWNLOAD'), ('employee','PERFORMANCE_VIEW')
ON CONFLICT DO NOTHING;

ALTER TABLE permissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permissions_select ON permissions;
CREATE POLICY permissions_select ON permissions FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.permissions TO authenticated;

DROP POLICY IF EXISTS role_permissions_select ON role_permissions;
DROP POLICY IF EXISTS role_permissions_write  ON role_permissions;
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY role_permissions_write ON role_permissions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
GRANT SELECT, INSERT, DELETE ON public.role_permissions TO authenticated;

NOTIFY pgrst, 'reload schema';

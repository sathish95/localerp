-- ============================================================================
-- DEV: repair the missing profile for the emulator's auth user, then seed +
-- unlock every module for every org. Pure SQL, run the whole file at once.
-- ============================================================================

-- ---- 0. sanity: which DB, how many users/profiles/orgs ----------------------
SELECT current_database()                              AS db,
       (SELECT count(*) FROM auth.users)              AS auth_users,
       (SELECT count(*) FROM profiles)                AS profiles,
       (SELECT count(*) FROM organizations)           AS orgs;

-- ---- 1. create the profiles row for auth user 3fa8d08d… --------------------
INSERT INTO profiles (id, email, full_name, role, organization_id, is_active)
SELECT u.id,
       u.email,
       COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
       'employee',
       (SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1),
       true
FROM auth.users u
WHERE u.id = '3fa8d08d-4967-40ca-b172-409047ce2b57'
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id);

-- make sure it has an org + is active even if a row already existed
UPDATE profiles
SET organization_id = COALESCE(organization_id,
      (SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1)),
    role = COALESCE(role, 'employee'),
    is_active = true
WHERE id = '3fa8d08d-4967-40ca-b172-409047ce2b57';

-- ---- 2. seed every mobile-capable module for every org --------------------
INSERT INTO modules (key, label, organization_id, enabled)
SELECT k.key, initcap(replace(k.key, '-', ' ')), o.id, true
FROM organizations o
CROSS JOIN (VALUES
  ('dashboard'), ('org-home'), ('knowledge-base'),
  ('tasks'), ('expenses'), ('travel'), ('approvals'),
  ('it-helpdesk'), ('leave'), ('timesheet')
) AS k(key)
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.organization_id = o.id AND m.key = k.key);

UPDATE modules SET enabled = true WHERE enabled = false;

-- ---- 3. clear all gates ---------------------------------------------------
DELETE FROM module_role_visibility WHERE visible = false;
DELETE FROM mobile_module_config;
UPDATE organizations SET allocation_enforcement_enabled = false WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_plans WHERE key = 'enterprise') THEN
    UPDATE organizations SET plan_key = 'enterprise' WHERE deleted_at IS NULL;
  ELSE
    INSERT INTO organization_bundle_subscriptions (organization_id, bundle_key, status)
    SELECT o.id, b.key, 'active'
    FROM organizations o
    CROSS JOIN billing_bundles b
    WHERE o.deleted_at IS NULL AND b.is_active
      AND NOT EXISTS (SELECT 1 FROM organization_bundle_subscriptions s
                      WHERE s.organization_id = o.id AND s.bundle_key = b.key);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---- 4. verify ----------------------------------------------------------
SELECT id, email, role, organization_id, is_active
FROM profiles WHERE id = '3fa8d08d-4967-40ca-b172-409047ce2b57';

SELECT count(*) AS module_rows_for_that_org
FROM modules
WHERE organization_id = (SELECT organization_id FROM profiles
                         WHERE id = '3fa8d08d-4967-40ca-b172-409047ce2b57');

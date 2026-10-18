-- ============================================================
-- STEP191: Bulk-create 10 employee accounts under the 'thingsalive'
-- organization, all with the same password.
--
-- LOGIN — every account below uses the SAME password:
--     123456
--
-- Same technique as STEP130 (see that file's comment for the full
-- rationale): this app's client only ever holds the anon key, so
-- there's no supabase.auth.admin.createUser() available from the
-- browser. This inserts directly into auth.users (with the standard
-- empty-string token columns a NULL is known to break password-grant
-- login on), then upserts the matching `profiles` row directly rather
-- than relying on the handle_new_user() signup trigger. This bypasses
-- Supabase Auth's own signup validation — fine for admin-provisioned
-- internal accounts, not a substitute for the real signup flow.
--
-- Idempotent: re-running is safe — an existing auth.users row (matched
-- by email) is reused as-is (password NOT reset on re-run), and the
-- profiles row is upserted every time.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_org_id UUID;
  v_uid    UUID;
  v_row    RECORD;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'thingsalive';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organizations row with slug=thingsalive not found — run RUN_ME_ALL.sql / STEP159 first';
  END IF;

  FOR v_row IN SELECT * FROM (VALUES
    ('Prem',       'Prem@gmail.com'),
    ('Tapas',      'Tapas@gmail.com'),
    ('Tagore',     'Tagore@gmail.com'),
    ('Akash',      'Akash@gmail.com'),
    ('Guru',       'Guru@gmail.com'),
    ('Sai',        'Sai@gmail.com'),
    ('Thippesh',   'Thippesh@gmail.com'),
    ('Manjula',    'Manjula@gmail.com'),
    ('Maheshwari', 'Maheshwari@gmail.com'),
    ('Mansoor',    'Mansoor@gmail.com')
  ) AS t(full_name, email)
  LOOP
    -- Supabase Auth normalizes emails to lowercase for login lookups;
    -- lowercase here so a real sign-in matches regardless of the case
    -- someone types (the source list above has capitalized names).
    SELECT id INTO v_uid FROM auth.users WHERE email = lower(v_row.email);

    IF v_uid IS NULL THEN
      v_uid := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        lower(v_row.email), extensions.crypt('123456', extensions.gen_salt('bf')),
        now(), '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', v_row.full_name, 'role', 'employee'),
        now(), now(), '', '', '', ''
      );
    END IF;

    INSERT INTO profiles (id, email, full_name, role, is_active, organization_id)
    VALUES (v_uid, lower(v_row.email), v_row.full_name, 'employee', true, v_org_id)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = EXCLUDED.role,
      is_active = true, organization_id = EXCLUDED.organization_id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- STEP190: Admin/HR password reset from User Management
--
-- The client only ever holds the anon key (see src/lib/supabase.js) —
-- there is no service-role key available in the browser, so
-- supabase.auth.admin.updateUserById() can't be called client-side to
-- reset someone else's password. Postgres itself has direct write
-- access to auth.users though, so a SECURITY DEFINER function that
-- rewrites encrypted_password via pgcrypto's crypt()/gen_salt('bf') is
-- the same trick GoTrue's own admin API uses internally, just run from
-- our side. Same admin/ceo/hr gate as UsersPage.jsx's canEdit.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION admin_reset_user_password(p_user_id UUID, p_new_password TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION admin_reset_user_password(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

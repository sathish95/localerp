-- ============================================================
-- STEP224: fix "column reference \"id\" is ambiguous" (42702) still
-- coming from get_peer_feedback() after STEP221.
--
-- STEP221 qualified the bare `id` inside is_hr_admin_ceo()/is_manager_of()
-- (the two SQL-language helpers get_peer_feedback() calls), but missed
-- that get_peer_feedback() ITSELF (the STEP94 version) has the same bug
-- in its own body:
--
--   IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_subject_employee_id ...)
--
-- get_peer_feedback() declares RETURNS TABLE(id UUID, ...), making `id` a
-- PL/pgSQL variable for the whole function body — so this bare `id`
-- reference is ambiguous between that variable and profiles.id, same as
-- before, just one level up. Fix: qualify it to profiles.id.
-- ============================================================

CREATE OR REPLACE FUNCTION get_peer_feedback(p_subject_employee_id UUID, p_cycle_id UUID)
RETURNS TABLE (
  id UUID, feedback_request_id UUID, is_anonymous BOOLEAN,
  strengths_noted TEXT, improvement_areas_noted TEXT, rating TEXT, submitted_at TIMESTAMPTZ,
  provider_id UUID, provider_name TEXT, request_status TEXT
) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = p_subject_employee_id AND profiles.organization_id = current_org_id()) THEN
    RAISE EXCEPTION 'Not authorized to view this employee''s feedback';
  END IF;
  IF NOT (
    auth.uid() = p_subject_employee_id
    OR is_manager_of(p_subject_employee_id)
    OR is_hr_admin_ceo()
  ) THEN
    RAISE EXCEPTION 'Not authorized to view this employee''s feedback';
  END IF;

  RETURN QUERY
  SELECT
    pf.id, pf.feedback_request_id, fr.is_anonymous,
    pf.strengths_noted, pf.improvement_areas_noted, pf.rating, pf.submitted_at,
    CASE WHEN fr.is_anonymous AND NOT is_hr_admin_ceo() THEN NULL ELSE fr.feedback_provider_id END,
    CASE WHEN fr.is_anonymous AND NOT is_hr_admin_ceo() THEN NULL ELSE provider.full_name END,
    fr.status
  FROM feedback_requests fr
  JOIN peer_feedback pf ON pf.feedback_request_id = fr.id
  LEFT JOIN profiles provider ON provider.id = fr.feedback_provider_id
  WHERE fr.subject_employee_id = p_subject_employee_id AND fr.cycle_id = p_cycle_id
    AND fr.organization_id = current_org_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';

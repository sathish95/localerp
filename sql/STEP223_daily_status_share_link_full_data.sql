-- ============================================================
-- STEP223: expand the Daily Status external share link (STEP222) to
-- return the FULL dataset instead of an anonymized one — per explicit
-- confirmation, the external (no-login) link should render byte-for-byte
-- the same view as the internal Daily Status page: employee names, hours
-- logged (both work_logs and time_logs), department names/efficiency, and
-- IT Helpdesk / Support Desk tickets are now all included.
--
-- This CREATE OR REPLACEs get_daily_status_public_raw() from STEP222 in
-- place — same token/table, just a bigger payload. Table + RLS block
-- repeated here (all idempotent) so this migration is self-sufficient
-- even if STEP222 was never run.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_status_share_links (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  token            TEXT          NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  expires_at       TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  created_by       UUID          REFERENCES profiles(id),
  created_at       TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_status_share_links_org_idx ON daily_status_share_links(organization_id);

ALTER TABLE daily_status_share_links ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE mgmt_roles TEXT[] := ARRAY['admin', 'ceo', 'manager', 'department_head'];
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS daily_status_share_links_select ON daily_status_share_links';
  EXECUTE 'DROP POLICY IF EXISTS daily_status_share_links_write ON daily_status_share_links';
  EXECUTE 'CREATE POLICY daily_status_share_links_select ON daily_status_share_links FOR SELECT USING (organization_id = current_org_id())';
  EXECUTE format($p$CREATE POLICY daily_status_share_links_write ON daily_status_share_links FOR ALL USING (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = ANY (%1$L::text[]))
  ) WITH CHECK (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = ANY (%1$L::text[]))
  )$p$, mgmt_roles);
END $$;

CREATE OR REPLACE FUNCTION get_daily_status_public_raw(p_token TEXT, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE v_link RECORD; v_result JSONB;
BEGIN
  SELECT * INTO v_link FROM daily_status_share_links
    WHERE token = p_token AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF v_link IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'task_id', t.task_id, 'task_name', t.task_name, 'status', t.status,
        'department_id', t.department_id, 'assigned_to', t.assigned_to, 'planned_end_date', t.planned_end_date
      ))
      FROM project_tasks t WHERE t.organization_id = v_link.organization_id
    ), '[]'::jsonb),
    'change_log', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'task_id', c.task_id, 'changed_by', c.changed_by, 'old_value', c.old_value, 'new_value', c.new_value, 'created_at', c.created_at
      ))
      FROM task_change_log c
      WHERE c.organization_id = v_link.organization_id AND c.field_name = 'status'
        AND c.created_at >= p_start AND c.created_at <= p_end
    ), '[]'::jsonb),
    'flows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'department_id', f.department_id,
        'steps', (
          SELECT jsonb_agg(jsonb_build_object('status_key', s.status_key, 'label', s.label, 'color', s.color, 'is_closed', s.is_closed) ORDER BY s.sort_order)
          FROM department_status_steps s WHERE s.flow_id = f.id
        )
      ))
      FROM department_status_flows f WHERE f.organization_id = v_link.organization_id
    ), '[]'::jsonb),
    'work_logs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'employee_id', w.employee_id, 'task_id', w.task_id, 'duration_minutes', w.duration_minutes, 'started_at', w.started_at
      ))
      FROM work_logs w WHERE w.organization_id = v_link.organization_id AND w.started_at >= p_start AND w.started_at <= p_end
    ), '[]'::jsonb),
    -- time_logs has no organization_id of its own — scoped via the
    -- employee's own org, same join TimesheetPage.jsx's queries rely on.
    'time_logs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('employee_id', tl.employee_id, 'work_date', tl.work_date, 'hours_worked', tl.hours_worked))
      FROM time_logs tl
      JOIN profiles p ON p.id = tl.employee_id
      WHERE p.organization_id = v_link.organization_id AND tl.work_date >= p_start::date AND tl.work_date <= p_end::date
    ), '[]'::jsonb),
    'it_tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', it.id, 'subject', it.subject, 'status', it.status, 'assigned_to', it.assigned_to,
        'resolution_due_at', it.resolution_due_at, 'resolved_at', it.resolved_at, 'closed_at', it.closed_at, 'updated_at', it.updated_at
      ))
      FROM it_helpdesk_tickets it WHERE it.organization_id = v_link.organization_id
    ), '[]'::jsonb),
    'support_tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', st.id, 'subject', st.subject, 'status', st.status, 'assigned_agent_id', st.assigned_agent_id,
        'resolution_due_at', st.resolution_due_at, 'resolved_at', st.resolved_at, 'closed_at', st.closed_at, 'updated_at', st.updated_at
      ))
      FROM support_tickets st WHERE st.organization_id = v_link.organization_id
    ), '[]'::jsonb),
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'full_name', pr.full_name))
      FROM profiles pr WHERE pr.organization_id = v_link.organization_id
    ), '[]'::jsonb),
    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name))
      FROM departments d WHERE d.organization_id = v_link.organization_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_daily_status_public_raw(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

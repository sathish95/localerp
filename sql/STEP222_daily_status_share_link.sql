-- ============================================================
-- STEP222: External, tokenized share link for the Daily Status report
-- (mirrors STEP213's roi_customer_portal_link / STEP220's
-- proposal_share_links pattern — durable secret link + SECURITY DEFINER
-- RPC, no client login system).
--
-- Deliberately anonymized/reduced payload: the RPC below returns ONLY
-- project_tasks (id/task_id/task_name/status/department_id/planned_end_date),
-- task_change_log status transitions, and department status flows. It
-- never selects employee names, department names, hours (work_logs/
-- time_logs), or IT Helpdesk / Support Desk tickets — an external viewer
-- of this link sees consolidated task movement/planned/completed/overdue
-- counts and titles only, never who did what or how the org's internal
-- support queues look. The Moved/Planned/Completed/Overdue AGGREGATION
-- logic itself is never duplicated here — src/lib/dailyStatus.js's
-- computeDailyStatus() is a pure function shared by both the internal and
-- external report paths, so this RPC only ever needs to hand back raw rows.
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

-- Public, tokenized read RPC — anon gets EXECUTE only, no direct table
-- grants at all (same as get_proposal_public / get_roi_customer_view_public
-- / get_landing_link_public). p_start/p_end bound task_change_log only —
-- project_tasks itself is returned in full (unbounded by date) because
-- Planned/Overdue need the live snapshot of every open task, exactly like
-- the internal (authenticated) report does.
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
        'department_id', t.department_id, 'planned_end_date', t.planned_end_date
      ))
      FROM project_tasks t WHERE t.organization_id = v_link.organization_id
    ), '[]'::jsonb),
    'change_log', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'task_id', c.task_id, 'old_value', c.old_value, 'new_value', c.new_value, 'created_at', c.created_at
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
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_daily_status_public_raw(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

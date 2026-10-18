-- ============================================================
-- STEP202: HR/manager alerts for (a) missed daily check-in and (b) no
-- task activity for N days. Neither existed before — this app's
-- "check-in" (CheckInWidget/time_logs) has never had anything watching
-- for who DIDN'T do it. Both functions are safe to call repeatedly
-- (each employee is only ever alerted once per day per alert type —
-- guarded via a NOT EXISTS check against today's own notifications), so
-- they can be scheduled with pg_cron (wired up below, if available on
-- this Supabase project) or just run by hand.
--
-- Recipients: the employee's own reporting_manager_id (not every
-- manager org-wide — see notifyManagers() in src/lib/notifications.js
-- for that broader blast, deliberately NOT reused here) plus every HR
-- user in the SAME organization.
--
-- Scope: every active profile whose role is neither 'admin' nor 'ceo'
-- (executives aren't tracked for daily check-in/task activity).
-- ============================================================

CREATE OR REPLACE FUNCTION notify_missing_checkins()
RETURNS INT AS $$
DECLARE
  emp RECORD;
  v_recipients UUID[];
  v_count INT := 0;
BEGIN
  FOR emp IN
    SELECT p.id, p.full_name, p.organization_id, p.reporting_manager_id
    FROM profiles p
    WHERE p.is_active = true
      AND p.role NOT IN ('admin','ceo')
      AND NOT EXISTS (SELECT 1 FROM time_logs t WHERE t.employee_id = p.id AND t.work_date = CURRENT_DATE)
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'missed_checkin' AND (n.metadata->>'employee_id')::uuid = p.id
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    SELECT array_remove(array_agg(id), NULL) INTO v_recipients FROM (
      SELECT emp.reporting_manager_id AS id
      UNION
      SELECT id FROM profiles WHERE role = 'hr' AND organization_id = emp.organization_id
    ) r;
    IF v_recipients IS NOT NULL AND array_length(v_recipients,1) > 0 THEN
      INSERT INTO notifications (recipient_id, type, title, body, link, metadata)
      SELECT rid, 'missed_checkin', '⚠ Missed check-in',
             emp.full_name || ' has not checked in today', '/dashboard',
             jsonb_build_object('employee_id', emp.id)
      FROM unnest(v_recipients) AS rid;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- p_days: how many consecutive days of silence counts as "inactive" —
-- no Daily Update comment AND no logged task change from this person.
-- Only considers employees who actually have an open (non-"done", per
-- their OWN department's flow — STEP198) assigned task; someone with
-- nothing currently assigned has nothing to be inactive on.
CREATE OR REPLACE FUNCTION notify_task_inactivity(p_days INT DEFAULT 3)
RETURNS INT AS $$
DECLARE
  emp RECORD;
  v_recipients UUID[];
  v_count INT := 0;
BEGIN
  FOR emp IN
    SELECT p.id, p.full_name, p.organization_id, p.reporting_manager_id
    FROM profiles p
    WHERE p.is_active = true
      AND p.role NOT IN ('admin','ceo')
      AND EXISTS (
        SELECT 1 FROM project_tasks pt
        WHERE pt.assigned_to = p.id
          AND NOT EXISTS (
            SELECT 1 FROM department_status_steps s
            JOIN department_status_flows f ON f.id = s.flow_id
            WHERE s.status_key = pt.status
              AND (f.department_id = pt.department_id OR (f.department_id IS NULL AND pt.department_id IS NULL))
              AND s.is_closed = true
          )
      )
      AND NOT EXISTS (SELECT 1 FROM task_comments c WHERE c.user_id = p.id AND c.created_at > now() - (p_days || ' days')::interval)
      AND NOT EXISTS (SELECT 1 FROM task_change_log l WHERE l.changed_by = p.id AND l.created_at > now() - (p_days || ' days')::interval)
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'task_inactivity' AND (n.metadata->>'employee_id')::uuid = p.id
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    SELECT array_remove(array_agg(id), NULL) INTO v_recipients FROM (
      SELECT emp.reporting_manager_id AS id
      UNION
      SELECT id FROM profiles WHERE role = 'hr' AND organization_id = emp.organization_id
    ) r;
    IF v_recipients IS NOT NULL AND array_length(v_recipients,1) > 0 THEN
      INSERT INTO notifications (recipient_id, type, title, body, link, metadata)
      SELECT rid, 'task_inactivity', '⏸ No task activity',
             emp.full_name || ' has not updated any task in ' || p_days || '+ days', '/tasks',
             jsonb_build_object('employee_id', emp.id)
      FROM unnest(v_recipients) AS rid;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION notify_missing_checkins() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_task_inactivity(INT) TO authenticated;

-- ── Schedule both daily via pg_cron, only if that extension is actually
-- enabled on this Supabase project (not every plan has it — this block
-- silently does nothing rather than erroring if it's unavailable).
-- 11:00 UTC below is a placeholder cutoff — edit the '0 11 * * *' cron
-- expressions to match when your org's workday should reasonably have
-- started (cron times are UTC, not org-local).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('daily-missed-checkin-alerts','daily-task-inactivity-alerts');
    PERFORM cron.schedule('daily-missed-checkin-alerts', '0 11 * * *', 'SELECT notify_missing_checkins();');
    PERFORM cron.schedule('daily-task-inactivity-alerts', '0 11 * * *', 'SELECT notify_task_inactivity(3);');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

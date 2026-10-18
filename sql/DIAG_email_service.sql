-- ============================================================
-- DIAG: why aren't emails arriving? (read-only — changes nothing)
-- Run the whole file in the Supabase SQL Editor and read the result
-- table top to bottom: the first row that isn't "OK" is the problem.
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.email_diag()
RETURNS TABLE (step int, check_name text, status text, detail text) LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE v text; n int; r record;
BEGIN
  -- 1. Migration
  IF to_regclass('public.email_outbox') IS NULL THEN
    RETURN QUERY SELECT 1, 'STEP228 migration applied', 'MISSING', 'Run sql/STEP228_email_service.sql first.'; RETURN;
  END IF;
  RETURN QUERY SELECT 1, 'STEP228 migration applied', 'OK', 'email_outbox exists';

  -- 2. Org switched on
  SELECT string_agg(o.name || ' = ' || CASE WHEN s.enabled THEN 'on' ELSE 'OFF' END, ', ') INTO v
  FROM org_email_settings s JOIN organizations o ON o.id = s.organization_id;
  SELECT count(*) INTO n FROM org_email_settings WHERE enabled;
  RETURN QUERY SELECT 2, 'Email turned on (Settings → Email)', CASE WHEN n > 0 THEN 'OK' ELSE 'OFF' END,
    COALESCE(v, 'No organization has saved email settings yet — open Settings → Email, tick "Email is on", Save.');

  -- 3. Admin profiles have an email address
  SELECT count(*) INTO n FROM profiles WHERE role IN ('admin','ceo') AND COALESCE(email,'') = '';
  RETURN QUERY SELECT 3, 'Admin profiles have an email address', CASE WHEN n = 0 THEN 'OK' ELSE 'CHECK' END,
    CASE WHEN n = 0 THEN 'all admin/ceo profiles have email' ELSE n || ' admin/ceo profile(s) have no email in profiles.email' END;

  -- 4. Queue contents
  SELECT string_agg(status || ': ' || c, ', ' ORDER BY status) INTO v FROM (SELECT status, count(*) c FROM email_outbox GROUP BY status) x;
  RETURN QUERY SELECT 4, 'Emails queued (email_outbox by status)',
    CASE WHEN v IS NULL THEN 'EMPTY' WHEN v LIKE '%pending%' OR v LIKE '%sending%' THEN 'STUCK?' ELSE 'OK' END,
    COALESCE(v, 'Nothing has ever been queued — send a test from Settings → Email (email must be on).');

  FOR r IN SELECT template, to_email, status, attempts, last_error, created_at FROM email_outbox
           WHERE last_error IS NOT NULL ORDER BY created_at DESC LIMIT 3 LOOP
    RETURN QUERY SELECT 4, 'Last send error', 'ERROR',
      r.template || ' → ' || r.to_email || ' (attempt ' || r.attempts || ', ' || r.status || '): ' || r.last_error;
  END LOOP;

  SELECT count(*) INTO n FROM email_outbox WHERE status = 'pending' AND attempts = 0 AND created_at < now() - interval '3 minutes';
  IF n > 0 THEN
    RETURN QUERY SELECT 4, 'Pending emails never picked up', 'NOT RUNNING',
      n || ' email(s) waiting 3+ minutes with 0 attempts → the send-email function is not being called (see steps 5–6).';
  END IF;

  -- 5. Scheduler
  IF to_regclass('cron.job') IS NULL THEN
    RETURN QUERY SELECT 5, 'pg_cron installed', 'MISSING', 'Database → Extensions → enable pg_cron (and pg_net), then create the schedule from the bottom of STEP228.';
  ELSE
    EXECUTE $q$SELECT string_agg(jobname || ' [' || schedule || ']' || CASE WHEN active THEN '' ELSE ' INACTIVE' END, ', ') FROM cron.job WHERE command ILIKE '%send-email%'$q$ INTO v;
    RETURN QUERY SELECT 5, 'Every-minute job calling send-email', CASE WHEN v IS NULL THEN 'MISSING' ELSE 'OK' END,
      COALESCE(v, 'No cron job calls send-email — create it with the cron.schedule(...) at the bottom of STEP228.');
    IF v IS NOT NULL AND to_regclass('cron.job_run_details') IS NOT NULL THEN
      EXECUTE $q$SELECT d.status || ' at ' || to_char(d.start_time, 'DD Mon HH24:MI') || COALESCE(' — ' || left(d.return_message, 200), '')
                 FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
                 WHERE j.command ILIKE '%send-email%' ORDER BY d.start_time DESC LIMIT 1$q$ INTO v;
      RETURN QUERY SELECT 5, 'Last cron run', CASE WHEN v LIKE 'succeeded%' THEN 'OK' WHEN v IS NULL THEN 'NEVER RAN' ELSE 'FAILED' END,
        COALESCE(v, 'The job exists but has never run.');
    END IF;
  END IF;

  -- 6. What the function answered (pg_net keeps responses ~6h)
  IF to_regclass('net._http_response') IS NULL THEN
    RETURN QUERY SELECT 6, 'pg_net installed', 'MISSING', 'Database → Extensions → enable pg_net (the cron job uses net.http_post).';
  ELSE
    FOR r IN EXECUTE $q$SELECT status_code, left(COALESCE(error_msg, content::text), 300) AS body, created
                        FROM net._http_response ORDER BY created DESC LIMIT 3$q$ LOOP
      RETURN QUERY SELECT 6, 'send-email HTTP response',
        CASE WHEN r.status_code = 200 THEN 'OK' WHEN r.status_code = 401 THEN 'BAD KEY' WHEN r.status_code = 404 THEN 'NOT DEPLOYED' ELSE 'ERROR' END,
        COALESCE(r.status_code::text, 'no status') || ' at ' || to_char(r.created, 'DD Mon HH24:MI') || ': ' || COALESCE(r.body, '');
    END LOOP;
  END IF;
END $$;

SELECT * FROM pg_temp.email_diag() ORDER BY step;

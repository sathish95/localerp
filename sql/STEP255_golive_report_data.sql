-- STEP255 — Go-Live report data: daily summary + executive overview
--
--   golive_daily_summary_payload(eng, date, customer)  one IST day: check counts,
--       observations / failing checks, device notes & issues, incidents raised /
--       resolved / status changes / updates / overdue, open incidents, devices
--       with no check. Same content as the Overview "Daily summary" card
--       (src/lib/goLiveDailySummary.js — keep the two in step).
--   golive_overview_payload(eng, date, customer, from)  the executive overview
--       (health inputs, timeline, readiness, 14-day KPI series, incident KPIs,
--       site performance) + the daily summary under 'summary'.
--   get_golive_report_overview(token, date)  public shared-report sections
--       'overview' and 'daily' (anon-executable, token-checked).
--
-- customer = true trims for external readers: only customer-visible incidents,
-- no internal names, no internal incident comments, device issues only.
-- Email delivery of this report is STEP256. Requires STEP235, STEP237.
-- Safe to re-run.

/* ═══ 1. Daily summary payload ═══ */
-- p_customer = true trims it for an external (customer) shared report:
-- only customer-visible incidents, no internal names, no internal incident
-- comments, device issues only (not free-form notes).
DROP FUNCTION IF EXISTS golive_daily_summary_payload(UUID, DATE);
CREATE OR REPLACE FUNCTION golive_daily_summary_payload(p_eng UUID, p_date DATE, p_customer BOOLEAN DEFAULT false) RETURNS JSONB AS $$
DECLARE
  g golive_engagements;
  v_from TIMESTAMPTZ := (p_date::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   TIMESTAMPTZ := ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_stats JSONB; v_obs JSONB; v_missing JSONB; v_notes JSONB; v_raised JSONB; v_resolved JSONB;
  v_changes JSONB; v_updates JSONB; v_overdue JSONB; v_open JSONB;
  v_open_issues INT; v_issues_resolved INT; v_open_count INT; v_critical INT;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- devices live on that day, with a readable label
  -- scratch tables live for the transaction (the email job builds several payloads in one)
  IF to_regclass('pg_temp._gds_dev') IS NULL THEN
    CREATE TEMP TABLE _gds_dev (id UUID PRIMARY KEY, label TEXT, site TEXT, live BOOLEAN) ON COMMIT DROP;
  END IF;
  TRUNCATE _gds_dev;
  INSERT INTO _gds_dev
  SELECT e.id,
         -- Equipment name · Equipment ID · device code (blank / repeated parts skipped)
         concat_ws(' · ', NULLIF(trim(e.equipment_name), ''),
           CASE WHEN lower(trim(e.equipment_id)) IS DISTINCT FROM lower(trim(e.equipment_name)) THEN NULLIF(trim(e.equipment_id), '') END,
           CASE WHEN lower(COALESCE(d.device_code, d.serial_number)) NOT IN (lower(COALESCE(trim(e.equipment_name), '')), lower(COALESCE(trim(e.equipment_id), ''))) THEN COALESCE(d.device_code, d.serial_number) END),
         e.site,
         e.deleted_at IS NULL AND (e.unenrolled_at IS NULL OR e.unenrolled_at >= v_to) AND (e.enrolled_at IS NULL OR e.enrolled_at < v_to)
  FROM golive_enrollments e LEFT JOIN device_instances d ON d.id = e.device_id
  WHERE e.engagement_id = p_eng;

  IF to_regclass('pg_temp._gds_chk') IS NULL THEN
    CREATE TEMP TABLE _gds_chk ON COMMIT DROP AS SELECT * FROM golive_daily_checks WHERE false;
  END IF;
  TRUNCATE _gds_chk;
  INSERT INTO _gds_chk SELECT * FROM golive_daily_checks
  WHERE engagement_id = p_eng AND check_date = p_date AND deleted_at IS NULL AND COALESCE(daily_result, '') <> 'DUPLICATE';

  SELECT jsonb_build_object(
    'devices', (SELECT count(*) FROM _gds_dev WHERE live),
    'checked', (SELECT count(DISTINCT enrollment_id) FROM _gds_chk),
    'healthy', count(*) FILTER (WHERE daily_result = 'HEALTHY'),
    'attention', count(*) FILTER (WHERE daily_result = 'ATTENTION'),
    'incomplete', count(*) FILTER (WHERE daily_result = 'INCOMPLETE'),
    'maintenance', count(*) FILTER (WHERE equipment_maintenance),
    'missing', (SELECT count(*) FROM _gds_dev x WHERE x.live AND NOT EXISTS (SELECT 1 FROM _gds_chk c WHERE c.enrollment_id = x.id)))
  INTO v_stats FROM _gds_chk;

  SELECT COALESCE(jsonb_agg(o ORDER BY o->>'rank', o->>'device'), '[]') INTO v_obs FROM (
    SELECT jsonb_build_object(
      'rank', CASE c.daily_result WHEN 'ATTENTION' THEN 0 WHEN 'INCOMPLETE' THEN 1 ELSE 2 END,
      'device', COALESCE(x.label, 'Unknown device'), 'site', COALESCE(c.site_snapshot, x.site, ''),
      'result', c.daily_result, 'severity', CASE WHEN c.daily_result = 'ATTENTION' THEN c.attention_severity END, 'maintenance', COALESCE(c.equipment_maintenance, false),
      'failing', to_jsonb(array_remove(ARRAY[
          CASE WHEN c.power_check = 'FAIL' THEN 'Power' END,
          CASE WHEN c.cable_indicator_check = 'FAIL' THEN 'Cable / indicator' END,
          CASE WHEN c.connectivity = 'OFFLINE' AND NOT COALESCE(c.equipment_maintenance, false) THEN 'Operation: No' END,
          CASE WHEN c.connectivity = 'INTERMITTENT' AND NOT COALESCE(c.equipment_maintenance, false) THEN 'Operation intermittent' END,
          CASE WHEN c.firmware_health = 'FAIL' THEN 'Firmware' END,
          CASE WHEN c.application_health = 'FAIL' THEN 'Application' END,
          CASE WHEN c.data_quality = 'FAIL' THEN 'Data quality' END,
          CASE WHEN p.down > 0 THEN p.down || ' parameter' || CASE WHEN p.down = 1 THEN '' ELSE 's' END || ' not working' END
        ], NULL)),
      'text', COALESCE(trim(c.observation_action), '')) AS o
    FROM _gds_chk c
    LEFT JOIN _gds_dev x ON x.id = c.enrollment_id
    LEFT JOIN LATERAL (SELECT count(*) AS down FROM jsonb_each_text(COALESCE(c.parameter_checks, '{}'::jsonb)) WHERE value = 'NOT_WORKING') p ON true
    WHERE c.daily_result = 'ATTENTION' OR NULLIF(trim(c.observation_action), '') IS NOT NULL
  ) s;

  SELECT COALESCE(jsonb_agg(x.label ORDER BY x.label), '[]') INTO v_missing
  FROM _gds_dev x WHERE x.live AND NOT EXISTS (SELECT 1 FROM _gds_chk c WHERE c.enrollment_id = x.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'device', COALESCE(x.label, 'Unknown device'), 'body', n.body, 'is_issue', n.is_issue, 'category', n.issue_category,
      'severity', n.severity, 'status', n.issue_status, 'by', CASE WHEN p_customer THEN NULL ELSE p.full_name END, 'at', n.created_at) ORDER BY n.created_at), '[]')
  INTO v_notes
  FROM golive_device_notes n LEFT JOIN _gds_dev x ON x.id = n.enrollment_id LEFT JOIN profiles p ON p.id = n.created_by
  WHERE n.engagement_id = p_eng AND n.deleted_at IS NULL AND n.created_at >= v_from AND n.created_at < v_to
    AND (NOT p_customer OR n.is_issue);

  SELECT count(*) FILTER (WHERE issue_status = 'OPEN' AND created_at < v_to),
         count(*) FILTER (WHERE issue_status = 'RESOLVED' AND resolved_at >= v_from AND resolved_at < v_to)
  INTO v_open_issues, v_issues_resolved
  FROM golive_device_notes WHERE engagement_id = p_eng AND deleted_at IS NULL AND is_issue;

  -- incidents: one brief per row, reused below
  IF to_regclass('pg_temp._gds_inc') IS NULL THEN
    CREATE TEMP TABLE _gds_inc (id UUID PRIMARY KEY, brief JSONB, i golive_incidents) ON COMMIT DROP;
  END IF;
  TRUNCATE _gds_inc;
  INSERT INTO _gds_inc
  SELECT i.id, jsonb_build_object(
      'id', i.id, 'number', i.number, 'title', i.title, 'priority', i.priority, 'status', i.status, 'category', i.category,
      'owner', CASE WHEN p_customer THEN NULL ELSE COALESCE(p.full_name, i.assigned_owner_legacy, 'Unassigned') END, 'next_action', i.next_action, 'due', i.action_due_at,
      'resolution', i.root_cause_resolution, 'reported_at', i.reported_at,
      'devices', (SELECT COALESCE(jsonb_agg(x.label), '[]') FROM _gds_dev x WHERE x.id = ANY (i.device_enrollment_ids)),
      'site', i.site, 'scope', i.scope_type), i
  FROM golive_incidents i LEFT JOIN profiles p ON p.id = i.assigned_owner_user_id
  WHERE i.engagement_id = p_eng AND i.deleted_at IS NULL AND (NOT p_customer OR i.customer_visible);

  SELECT COALESCE(jsonb_agg(brief ORDER BY (i).reported_at), '[]') INTO v_raised FROM _gds_inc WHERE (i).reported_at >= v_from AND (i).reported_at < v_to;
  SELECT COALESCE(jsonb_agg(brief ORDER BY COALESCE((i).closed_at, (i).resolved_at)), '[]') INTO v_resolved FROM _gds_inc
   WHERE ((i).resolved_at >= v_from AND (i).resolved_at < v_to) OR ((i).closed_at >= v_from AND (i).closed_at < v_to);
  SELECT COALESCE(jsonb_agg(brief ORDER BY CASE (i).priority WHEN 'P1_CRITICAL' THEN 0 WHEN 'P2_HIGH' THEN 1 WHEN 'P3_NORMAL' THEN 2 ELSE 3 END, (i).reported_at), '[]'),
         count(*), count(*) FILTER (WHERE (i).priority IN ('P1_CRITICAL','P2_HIGH'))
  INTO v_open, v_open_count, v_critical
  FROM _gds_inc WHERE (i).status NOT IN ('RESOLVED','CLOSED') AND (i).reported_at < v_to;
  SELECT COALESCE(jsonb_agg(brief ORDER BY (i).action_due_at), '[]') INTO v_overdue FROM _gds_inc
   WHERE (i).status NOT IN ('RESOLVED','CLOSED') AND (i).reported_at < v_to AND (i).action_due_at < v_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('number', (x.i).number, 'title', (x.i).title, 'from', ev.changes->'status'->>'from',
      'to', ev.changes->'status'->>'to', 'by', CASE WHEN p_customer THEN NULL ELSE p.full_name END, 'at', ev.created_at) ORDER BY ev.created_at), '[]')
  INTO v_changes
  FROM golive_events ev JOIN _gds_inc x ON x.id = ev.entity_id LEFT JOIN profiles p ON p.id = ev.actor_id
  WHERE ev.engagement_id = p_eng AND ev.entity = 'incident' AND ev.event_type = 'status_changed' AND ev.changes ? 'status'
    AND ev.created_at >= v_from AND ev.created_at < v_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('number', (x.i).number, 'body', c.body, 'by', p.full_name, 'hours', c.hours_spent, 'at', c.created_at)
      ORDER BY c.created_at), '[]')
  INTO v_updates
  FROM golive_incident_comments c JOIN _gds_inc x ON x.id = c.incident_id LEFT JOIN profiles p ON p.id = c.created_by
  WHERE c.created_at >= v_from AND c.created_at < v_to AND NOT p_customer;

  RETURN jsonb_build_object(
    'engagement', jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name, 'sites', to_jsonb(g.sites), 'status', g.status,
      'pm', CASE WHEN p_customer THEN NULL ELSE (SELECT full_name FROM profiles WHERE id = g.pm_user_id) END, 'link', '/golive/' || g.id),
    'date', p_date, 'stats', v_stats, 'observations', v_obs, 'missing', v_missing,
    'notes', v_notes, 'open_issues', v_open_issues, 'issues_resolved', v_issues_resolved,
    'incidents', jsonb_build_object('raised', v_raised, 'resolved', v_resolved, 'changes', v_changes, 'updates', v_updates,
      'overdue', v_overdue, 'open', v_open, 'open_count', v_open_count, 'critical_open', v_critical));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/* ═══ 2. Executive overview payload (includes the daily summary) ═══ */
-- Health inputs, hypercare timeline, exit readiness, KPI series (14 days to
-- the date), incident KPIs, per-site performance, plus 'summary' = the daily
-- summary payload. Used by the shared report and the report email.
-- p_from (optional) stops the series at the start of a report period.
CREATE OR REPLACE FUNCTION golive_overview_payload(p_eng UUID, p_date DATE, p_customer BOOLEAN DEFAULT false, p_from DATE DEFAULT NULL) RETURNS JSONB AS $$
DECLARE
  g golive_engagements;
  v_cust BOOLEAN := p_customer; v_from DATE; v_date DATE := p_date; v_end TIMESTAMPTZ;
  v_series JSONB; v_sites JSONB; v_inc JSONB; v_repeat INT;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_from := COALESCE(p_from, v_date - 13);
  v_end := ((v_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');

  -- 14-day series ending on the date (never before the report period)
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'date'), '[]') INTO v_series FROM (
    SELECT jsonb_build_object('date', d::date,
      'devices', (SELECT count(*) FROM golive_enrollments e WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.support_status <> 'DECOMMISSIONED'
                   AND (e.enrolled_at IS NULL OR e.enrolled_at < ((d::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
                   AND (e.unenrolled_at IS NULL OR e.unenrolled_at >= ((d::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))),
      'checked', (SELECT count(DISTINCT k.enrollment_id) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d::date AND k.deleted_at IS NULL AND COALESCE(k.daily_result, '') <> 'DUPLICATE'),
      'records', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d::date AND k.deleted_at IS NULL AND COALESCE(k.daily_result, '') <> 'DUPLICATE'),
      'healthy', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d::date AND k.deleted_at IS NULL AND k.daily_result = 'HEALTHY'),
      'attention', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d::date AND k.deleted_at IS NULL AND k.daily_result = 'ATTENTION'),
      'incomplete', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d::date AND k.deleted_at IS NULL AND k.daily_result = 'INCOMPLETE'),
      'open_incidents', (SELECT count(*) FROM golive_incidents i WHERE i.engagement_id = g.id AND i.deleted_at IS NULL AND (NOT v_cust OR i.customer_visible)
                   AND i.reported_at < ((d::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
                   AND NOT COALESCE(i.resolved_at < ((d::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'), false)
                   AND NOT COALESCE(i.closed_at < ((d::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'), false))) AS x
    FROM generate_series(GREATEST(v_date - 13, v_from, COALESCE(g.hypercare_start, v_from)), v_date, interval '1 day') d
  ) s;

  -- incident KPIs as of the end of the date
  SELECT jsonb_build_object(
      'open', count(*) FILTER (WHERE open_then),
      'critical_open', count(*) FILTER (WHERE open_then AND priority = 'P1_CRITICAL'),
      'high_open', count(*) FILTER (WHERE open_then AND priority IN ('P1_CRITICAL','P2_HIGH')),
      'overdue', count(*) FILTER (WHERE open_then AND action_due_at < v_end),
      'mtta', avg(EXTRACT(EPOCH FROM (acknowledged_at - reported_at)) / 60) FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at < v_end),
      'mttr', avg(EXTRACT(EPOCH FROM (resolved_at - reported_at)) / 60) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at < v_end))
  INTO v_inc
  FROM (
    SELECT i.*, (i.reported_at < v_end AND NOT COALESCE(i.resolved_at < v_end, false) AND NOT COALESCE(i.closed_at < v_end, false)) AS open_then
    FROM golive_incidents i WHERE i.engagement_id = g.id AND i.deleted_at IS NULL AND (NOT v_cust OR i.customer_visible) AND i.reported_at < v_end
  ) z;

  SELECT count(*) INTO v_repeat FROM (
    SELECT enrollment_id FROM golive_daily_checks
    WHERE engagement_id = g.id AND deleted_at IS NULL AND daily_result = 'ATTENTION' AND check_date > v_date - 7 AND check_date <= v_date
    GROUP BY enrollment_id HAVING count(*) >= 3) r;

  -- per-site performance on the date
  WITH q AS (
    SELECT e.id, COALESCE(NULLIF(trim(e.site), ''), 'Unassigned') AS site,
      (SELECT k.daily_result FROM golive_daily_checks k WHERE k.enrollment_id = e.id AND k.check_date = v_date AND k.deleted_at IS NULL
         AND COALESCE(k.daily_result, '') <> 'DUPLICATE' LIMIT 1) AS res
    FROM golive_enrollments e
    WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.support_status <> 'DECOMMISSIONED'
      AND (e.enrolled_at IS NULL OR e.enrolled_at < v_end) AND (e.unenrolled_at IS NULL OR e.unenrolled_at >= v_end)
  ), st AS (
    SELECT site, array_agg(id) AS ids, count(*) AS devices, count(res) AS checked,
      count(*) FILTER (WHERE res = 'HEALTHY') AS healthy, count(*) FILTER (WHERE res = 'ATTENTION') AS attention
    FROM q GROUP BY site
  ), oi AS (
    SELECT i.* FROM golive_incidents i
    WHERE i.engagement_id = g.id AND i.deleted_at IS NULL AND (NOT v_cust OR i.customer_visible)
      AND i.reported_at < v_end AND NOT COALESCE(i.resolved_at < v_end, false) AND NOT COALESCE(i.closed_at < v_end, false)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('site', st.site, 'devices', st.devices, 'checked', st.checked,
      'healthy', st.healthy, 'attention', st.attention,
      'open', (SELECT count(*) FROM oi WHERE oi.device_enrollment_ids && st.ids OR (oi.scope_type = 'SITE' AND oi.site = st.site)),
      'critical', (SELECT count(*) FROM oi WHERE oi.priority IN ('P1_CRITICAL','P2_HIGH')
                     AND (oi.device_enrollment_ids && st.ids OR (oi.scope_type = 'SITE' AND oi.site = st.site))))
    ORDER BY st.site), '[]')
  INTO v_sites FROM st;

  RETURN jsonb_build_object(
    'date', v_date, 'customer_view', v_cust, 'link', '/golive/' || g.id,
    'engagement', jsonb_build_object('code', g.code, 'name', g.name, 'status', g.status, 'sites', to_jsonb(g.sites),
      'go_live_date', g.go_live_date, 'hypercare_start', g.hypercare_start, 'hypercare_planned_end', g.hypercare_planned_end,
      'pm', CASE WHEN v_cust THEN NULL ELSE (SELECT full_name FROM profiles WHERE id = g.pm_user_id) END),
    'series', v_series, 'incident_kpis', v_inc, 'repeat_failures', v_repeat, 'sites', v_sites,
    'readiness', golive_exit_readiness_sys(g.id),
    'summary', golive_daily_summary_payload(g.id, v_date, v_cust));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/* ═══ 3. Shared report section (public, token-checked) ═══ */
-- Powers the 'overview' and 'daily' sections of /golive-report/:token. The
-- date defaults to the report's end date and is clamped to its period. Same
-- rules as get_golive_report(): the CUSTOMER audience only counts
-- customer-visible incidents and carries no internal names or comments.
-- Doesn't bump the view counter (get_golive_report already does).
CREATE OR REPLACE FUNCTION get_golive_report_overview(p_token TEXT, p_date DATE DEFAULT NULL) RETURNS JSONB AS $$
DECLARE
  l golive_report_links; v_from DATE; v_to DATE; v_date DATE; v JSONB;
BEGIN
  SELECT * INTO l FROM golive_report_links WHERE token = p_token AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_to := LEAST(COALESCE(l.period_to, golive_ist_today()), golive_ist_today());
  v_from := COALESCE(l.period_from, v_to - (COALESCE(l.period_days, 30) - 1));
  v_date := LEAST(GREATEST(COALESCE(p_date, v_to), v_from), v_to);
  v := golive_overview_payload(l.engagement_id, v_date, l.audience <> 'MANAGEMENT', GREATEST(v_from, v_date - 13));
  IF v IS NULL THEN RETURN NULL; END IF;
  RETURN v || jsonb_build_object('period', jsonb_build_object('from', v_from, 'to', v_to), 'audience', l.audience);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Payload builders are SECURITY DEFINER and take any engagement id: only the
-- service role (send-email worker) and the token-checked RPC may use them.
REVOKE ALL ON FUNCTION golive_daily_summary_payload(UUID, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION golive_overview_payload(UUID, DATE, BOOLEAN, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION golive_daily_summary_payload(UUID, DATE, BOOLEAN), golive_overview_payload(UUID, DATE, BOOLEAN, DATE) TO service_role;
REVOKE ALL ON FUNCTION get_golive_report_overview(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_golive_report_overview(TEXT, DATE) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

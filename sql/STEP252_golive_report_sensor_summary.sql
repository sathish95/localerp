-- ============================================================
-- STEP252: Sensor count per sensor type in the shared report.
--
-- get_golive_report() (STEP250) re-created with one addition:
--   sensor_summary[]  per sensor type across the engagement's live devices —
--                     sensor, type (sensor_kind), devices, installed, working,
--                     not_working (not working or faulty), not_reviewed, na
-- The report's Equipment overview shows it as the "Sensor count" table next
-- to the equipment summary.
--
-- Requires STEP250 and STEP251. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sensor_types' AND column_name = 'sensor_kind') THEN
    RAISE EXCEPTION 'STEP252 needs STEP251 — run sql/STEP251_sensor_kind.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION get_golive_report(p_token TEXT) RETURNS JSONB AS $$
DECLARE
  l golive_report_links; g golive_engagements; v_from DATE; v_to DATE; v_mgmt BOOLEAN; v JSONB := '{}';
  v_customer TEXT; v_project TEXT;
BEGIN
  SELECT * INTO l FROM golive_report_links WHERE token = p_token AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO g FROM golive_engagements WHERE id = l.engagement_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE golive_report_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = l.id;

  v_mgmt := l.audience = 'MANAGEMENT';
  v_to := COALESCE(l.period_to, golive_ist_today());
  v_from := COALESCE(l.period_from, v_to - (COALESCE(l.period_days, 30) - 1));
  SELECT name INTO v_customer FROM customers WHERE id = g.customer_id;
  SELECT name INTO v_project FROM projects WHERE id = g.project_id;

  v := jsonb_build_object(
    'audience', l.audience, 'title', COALESCE(l.title, g.name || ' — hypercare report'), 'sections', l.sections,
    'period', jsonb_build_object('from', v_from, 'to', v_to), 'generated_at', now(),
    'engagement', jsonb_build_object('code', g.code, 'name', g.name, 'status', g.status, 'customer', v_customer, 'project', v_project,
      'sites', to_jsonb(g.sites), 'go_live_date', g.go_live_date, 'hypercare_start', g.hypercare_start,
      'hypercare_planned_end', g.hypercare_planned_end, 'hypercare_actual_end', g.hypercare_actual_end),
    -- STEP245: acknowledgement targets (minutes) per priority, for the SLA section
    'sla_targets', COALESCE(g.config->'ack_minutes', '{"P1_CRITICAL":30,"P2_HIGH":120,"P3_NORMAL":480,"P4_REQUEST":1440}'::jsonb)
  );

  -- daily health (check records) across the period
  v := v || jsonb_build_object('health', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('date', d::date,
      'expected', (SELECT count(*) FROM golive_enrollments e WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.support_status = 'ACTIVE'
                    AND (e.enrolled_at AT TIME ZONE 'Asia/Kolkata')::date <= d AND (e.unenrolled_at IS NULL OR (e.unenrolled_at AT TIME ZONE 'Asia/Kolkata')::date > d)),
      'logged', (SELECT count(DISTINCT k.enrollment_id) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL),
      'healthy', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL AND k.daily_result = 'HEALTHY'),
      'attention', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL AND k.daily_result = 'ATTENTION'),
      'incomplete', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL AND k.daily_result = 'INCOMPLETE')
    ) ORDER BY d)
    FROM generate_series(GREATEST(v_from, COALESCE(g.hypercare_start, v_from)), v_to, interval '1 day') d), '[]'::jsonb));

  -- hours reconciliation, per equipment-day
  v := v || jsonb_build_object('hours', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('date', c.reading_date, 'equipment', COALESCE(c.equipment_name, c.equipment_id, di.device_code, di.serial_number),
      'equipment_id', c.equipment_id, 'category', c.equipment_category, 'manual', c.manual_hours, 'iot', c.iot_hours,
      'manual_offline', c.manual_offline_hours, 'iot_offline', c.iot_offline_hours, 'diff', c.diff_hours, 'diff_pct', c.diff_pct,
      'fuel', c.iot_fuel_litres, 'fuel_lph', c.iot_fuel_lph,
      'tolerance_pct', c.tolerance_pct, 'status', c.status, 'action_status', c.action_status) ORDER BY c.reading_date, c.equipment_category)
    FROM golive_hours_compare c LEFT JOIN device_instances di ON di.id = c.device_id
    WHERE c.engagement_id = g.id AND c.reading_date BETWEEN v_from AND v_to), '[]'::jsonb));

  -- equipment status within the period: the latest onsite check's
  -- connectivity, or — when there's no newer check — the latest IoT hours
  -- (ran / didn't run); plus manual vs IoT hours, fuel and open issues.
  v := v || jsonb_build_object('equipment', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'category', x->>'equipment') FROM (
      SELECT jsonb_build_object(
        'equipment', COALESCE(NULLIF(trim(e.equipment_name), ''), NULLIF(trim(e.equipment_id), ''), di.device_code, di.serial_number),
        'equipment_id', e.equipment_id, 'device', COALESCE(di.device_code, di.serial_number),
        'category', COALESCE(NULLIF(trim(e.equipment_category), ''), 'Uncategorised'), 'site', e.site, 'support_status', e.support_status,
        'last_check_date', lc.check_date, 'last_result', lc.daily_result, 'connectivity', lc.connectivity,
        'last_hours_date', lh.reading_date, 'last_manual', lh.manual_hours, 'last_iot', lh.iot_hours, 'last_hours_status', lh.status,
        'hour_days', hs.days, 'manual_hours', hs.manual, 'iot_hours', hs.iot,
        'manual_uptime_pct', CASE WHEN hs.both_days > 0 THEN round(hs.manual_both / (hs.both_days * 24) * 100, 1) END,
        'iot_uptime_pct', CASE WHEN hs.both_days > 0 THEN round(hs.iot_both / (hs.both_days * 24) * 100, 1) END,
        'fuel', hs.fuel, 'fuel_lph', CASE WHEN hs.fuel_hours > 0 THEN round(hs.fuel / hs.fuel_hours, 2) END,
        'status', CASE
          WHEN e.support_status <> 'ACTIVE' THEN e.support_status
          WHEN lc.connectivity IN ('ONLINE','OFFLINE','INTERMITTENT') AND (lh.reading_date IS NULL OR lc.check_date >= lh.reading_date) THEN lc.connectivity
          WHEN lh.iot_hours IS NOT NULL THEN CASE WHEN lh.iot_hours > 0 THEN 'RUNNING' ELSE 'NOT_RUNNING' END
          WHEN lc.connectivity IN ('ONLINE','OFFLINE','INTERMITTENT') THEN lc.connectivity
          ELSE 'NO_DATA' END,
        'open_issues', (SELECT count(*) FROM golive_device_notes n WHERE n.enrollment_id = e.id AND n.is_issue AND n.issue_status = 'OPEN' AND n.deleted_at IS NULL)
      ) || jsonb_build_object(
        -- STEP245: device-level detail
        'serial', di.serial_number, 'part_number', di.part_number,
        'checked_days', ck.days, 'healthy_days', ck.healthy, 'attention_days', ck.attention, 'incomplete_days', ck.incomplete,
        'firmware_version', e.firmware_version, 'firmware_current', fw.current_version, 'firmware_status', fws.status,
        'sensors_total', sn.total, 'sensors_working', sn.working, 'sensors_down', sn.down, 'sensors_unchecked', sn.unchecked,
        'sensors_down_names', sn.down_names,
        -- STEP250: consolidated fleet summary
        'last_maintenance', COALESCE(lc.equipment_maintenance, false),
        'sensors_missing', sm.missing
      ) AS x
      FROM golive_enrollments e
      LEFT JOIN device_instances di ON di.id = e.device_id
      LEFT JOIN LATERAL (SELECT k.check_date, k.daily_result, k.connectivity, k.equipment_maintenance FROM golive_daily_checks k
                         WHERE k.enrollment_id = e.id AND k.deleted_at IS NULL AND k.check_date BETWEEN v_from AND v_to
                         ORDER BY k.check_date DESC LIMIT 1) lc ON true
      LEFT JOIN LATERAL (SELECT c.reading_date, c.manual_hours, c.iot_hours, c.status FROM golive_hours_compare c
                         WHERE c.enrollment_id = e.id AND c.reading_date BETWEEN v_from AND v_to
                         ORDER BY c.reading_date DESC LIMIT 1) lh ON true
      LEFT JOIN LATERAL (SELECT count(*) AS days, sum(c.manual_hours) AS manual, sum(c.iot_hours) AS iot,
                                count(*) FILTER (WHERE c.manual_hours IS NOT NULL AND c.iot_hours IS NOT NULL) AS both_days,
                                sum(c.manual_hours) FILTER (WHERE c.iot_hours IS NOT NULL) AS manual_both,
                                sum(c.iot_hours) FILTER (WHERE c.manual_hours IS NOT NULL) AS iot_both,
                                sum(c.iot_fuel_litres) AS fuel,
                                sum(c.iot_hours) FILTER (WHERE c.iot_fuel_litres IS NOT NULL) AS fuel_hours
                         FROM golive_hours_compare c
                         WHERE c.enrollment_id = e.id AND c.reading_date BETWEEN v_from AND v_to) hs ON true
      LEFT JOIN LATERAL (SELECT count(*) AS days,
                                count(*) FILTER (WHERE k.daily_result = 'HEALTHY') AS healthy,
                                count(*) FILTER (WHERE k.daily_result = 'ATTENTION') AS attention,
                                count(*) FILTER (WHERE k.daily_result = 'INCOMPLETE') AS incomplete
                         FROM golive_daily_checks k
                         WHERE k.enrollment_id = e.id AND k.deleted_at IS NULL AND k.check_date BETWEEN v_from AND v_to) ck ON true
      LEFT JOIN LATERAL (SELECT f.version AS current_version FROM product_firmware_versions f
                         WHERE f.organization_id = g.organization_id AND f.part_number = di.part_number AND f.status = 'CURRENT' LIMIT 1) fw ON true
      LEFT JOIN LATERAL (SELECT f.status FROM product_firmware_versions f
                         WHERE f.organization_id = g.organization_id AND f.part_number = di.part_number AND f.version = e.firmware_version LIMIT 1) fws ON true
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE s.health <> 'REMOVED') AS total,
                                count(*) FILTER (WHERE s.health = 'WORKING') AS working,
                                count(*) FILTER (WHERE s.health IN ('NOT_WORKING','FAULTY')) AS down,
                                count(*) FILTER (WHERE s.health = 'NOT_REVIEWED') AS unchecked,
                                string_agg(s.sensor_name, ', ' ORDER BY s.sensor_name) FILTER (WHERE s.health IN ('NOT_WORKING','FAULTY')) AS down_names
                         FROM device_sensor_status s WHERE s.device_id = e.device_id) sn ON true
      LEFT JOIN LATERAL (SELECT count(*) AS missing FROM equipment_sensor_defaults sd JOIN sensor_types st ON st.id = sd.sensor_type_id AND st.is_active
                         WHERE sd.organization_id = g.organization_id AND lower(sd.equipment_category) = lower(trim(COALESCE(e.equipment_category, di.equipment_category)))
                           AND NOT EXISTS (SELECT 1 FROM device_sensors ds WHERE ds.device_id = e.device_id AND ds.sensor_type_id = sd.sensor_type_id AND ds.status <> 'REMOVED')) sm ON true
      WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
    ) s), '[]'::jsonb));

  -- STEP252: sensor count per sensor type across the engagement's live devices
  v := v || jsonb_build_object('sensor_summary', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('sensor', x.sensor, 'kind', x.kind, 'devices', x.devices, 'installed', x.installed,
             'working', x.working, 'not_working', x.not_working, 'not_reviewed', x.not_reviewed, 'na', x.na) ORDER BY x.kind, x.installed DESC, x.sensor)
    FROM (
      SELECT s.sensor_name AS sensor, COALESCE(st.sensor_kind, 'Other') AS kind,
             count(DISTINCT s.device_id) AS devices, count(*) AS installed,
             count(*) FILTER (WHERE s.health = 'WORKING') AS working,
             count(*) FILTER (WHERE s.health IN ('NOT_WORKING','FAULTY')) AS not_working,
             count(*) FILTER (WHERE s.health = 'NOT_REVIEWED') AS not_reviewed,
             count(*) FILTER (WHERE s.health = 'NA') AS na
      FROM golive_enrollments e
      JOIN device_sensor_status s ON s.device_id = e.device_id AND s.health <> 'REMOVED'
      JOIN sensor_types st ON st.id = s.sensor_type_id
      WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
      GROUP BY s.sensor_name, st.sensor_kind
    ) x), '[]'::jsonb));

  -- incidents
  v := v || jsonb_build_object('incidents', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('number', i.number, 'title', i.title, 'priority', i.priority, 'category', i.category, 'status', i.status,
      'reported_at', i.reported_at, 'acknowledged_at', i.acknowledged_at, 'resolved_at', i.resolved_at, 'closed_at', i.closed_at,
      'next_action', i.next_action, 'action_due_at', i.action_due_at, 'follow_up_flag', golive_compute_follow_up_flag(i, now()),
      'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = i.assigned_owner_user_id) END,
      'root_cause', CASE WHEN v_mgmt THEN i.root_cause_resolution END) ORDER BY i.reported_at DESC)
    FROM golive_incidents i
    WHERE i.engagement_id = g.id AND i.deleted_at IS NULL AND (v_mgmt OR i.customer_visible)
      AND (i.status <> 'CLOSED' OR i.closed_at >= v_from)), '[]'::jsonb));

  -- improvement actions: open hours actions, open device issues, open incident next actions
  v := v || jsonb_build_object('actions', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'kind', x->>'date') FROM (
      SELECT jsonb_build_object('kind', 'hours', 'date', a.reading_date,
        'equipment', COALESCE(e.equipment_name, e.equipment_id, di.device_code),
        'text', 'Hours mismatch ' || COALESCE(a.diff_pct::text || '%', a.diff_hours::text || ' h') || ' (manual ' || COALESCE(a.manual_hours::text, '—') || ' h vs IoT ' || COALESCE(a.iot_hours::text, '—') || ' h)',
        'status', a.status, 'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = a.assigned_to) END,
        'note', CASE WHEN v_mgmt THEN a.note END) AS x
      FROM golive_hours_actions a JOIN golive_enrollments e ON e.id = a.enrollment_id LEFT JOIN device_instances di ON di.id = e.device_id
      WHERE a.engagement_id = g.id AND a.status = 'OPEN'
      UNION ALL
      SELECT jsonb_build_object('kind', 'device_issue', 'date', (n.created_at AT TIME ZONE 'Asia/Kolkata')::date,
        'equipment', COALESCE(e.equipment_name, e.equipment_id, di.device_code),
        'text', CASE WHEN v_mgmt THEN left(n.body, 200) ELSE initcap(n.severity) || ' ' || lower(replace(COALESCE(n.issue_category, 'device'), '_', ' ')) || ' issue under follow-up' END,
        'status', n.issue_status, 'severity', n.severity, 'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = n.created_by) END)
      FROM golive_device_notes n JOIN golive_enrollments e ON e.id = n.enrollment_id LEFT JOIN device_instances di ON di.id = e.device_id
      WHERE n.engagement_id = g.id AND n.is_issue AND n.issue_status = 'OPEN' AND n.deleted_at IS NULL
      UNION ALL
      SELECT jsonb_build_object('kind', 'incident', 'date', (i.reported_at AT TIME ZONE 'Asia/Kolkata')::date, 'equipment', i.number,
        'text', COALESCE(i.next_action, i.title), 'status', i.status, 'due', i.action_due_at,
        'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = i.assigned_owner_user_id) END)
      FROM golive_incidents i
      WHERE i.engagement_id = g.id AND i.deleted_at IS NULL AND i.status NOT IN ('RESOLVED','CLOSED') AND (v_mgmt OR i.customer_visible)
    ) s), '[]'::jsonb));

  v := v || jsonb_build_object('readiness', golive_exit_readiness_sys(g.id));
  RETURN v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_golive_report(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

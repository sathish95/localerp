-- ============================================================
-- STEP247: Per-seat software cost from check-in / check-out.
--
-- A project software line (project_software_costs) can be priced per user:
--   per_seat = true, seat_price = price per user per billing cycle.
-- Its cost then follows the people who actually checked in to the project
-- (time_logs.project_id — the Check-In widget / Resources page):
--   one seat for every person with at least one check-in on the project in
--   a billing period — month (monthly), quarter (quarterly), year (yearly),
--   or once for the whole project (one_time).
--   cost_company = seat-periods to date × seat_price
--   qty          = people checked in during the current period
-- cost_client / proposal_cost keep the line's mark-up ratio (×1.3 / ×1.5 by
-- default). Lines without per_seat are unchanged.
--
-- Kept in sync by triggers on time_logs and on the line's per-seat fields;
-- sync_project_software_seats(project) can also be called directly.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE project_software_costs ADD COLUMN IF NOT EXISTS per_seat BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_software_costs ADD COLUMN IF NOT EXISTS seat_price NUMERIC(14,2);
ALTER TABLE project_software_costs ADD COLUMN IF NOT EXISTS seat_periods INT;   -- seat-months (etc.) counted to date

CREATE OR REPLACE FUNCTION sync_project_software_seats(p_project UUID) RETURNS VOID AS $$
DECLARE
  l project_software_costs; v_unit TEXT; v_periods INT; v_now INT; v_co NUMERIC; v_label TEXT;
BEGIN
  IF p_project IS NULL THEN RETURN; END IF;
  FOR l IN SELECT * FROM project_software_costs WHERE project_id = p_project AND per_seat LOOP
    v_unit := CASE lower(COALESCE(l.billing_cycle, 'monthly'))
                WHEN 'yearly' THEN 'year' WHEN 'annual' THEN 'year' WHEN 'quarterly' THEN 'quarter' WHEN 'one_time' THEN NULL ELSE 'month' END;
    v_label := CASE v_unit WHEN 'year' THEN 'year' WHEN 'quarter' THEN 'quarter' WHEN 'month' THEN 'month' ELSE 'project' END;
    IF v_unit IS NULL THEN
      SELECT count(DISTINCT employee_id) INTO v_periods FROM time_logs WHERE project_id = p_project AND employee_id IS NOT NULL;
      v_now := v_periods;
    ELSE
      SELECT count(DISTINCT (employee_id, date_trunc(v_unit, work_date::timestamp))) INTO v_periods
      FROM time_logs WHERE project_id = p_project AND employee_id IS NOT NULL AND work_date IS NOT NULL;
      SELECT count(DISTINCT employee_id) INTO v_now FROM time_logs
      WHERE project_id = p_project AND employee_id IS NOT NULL
        AND date_trunc(v_unit, work_date::timestamp) = date_trunc(v_unit, (now() AT TIME ZONE 'Asia/Kolkata'));
    END IF;
    v_co := round(v_periods * COALESCE(l.seat_price, 0), 2);
    UPDATE project_software_costs SET
      qty = v_now, unit_price = COALESCE(l.seat_price, 0), seat_periods = v_periods, cost_company = v_co,
      cost_client = round(v_co * COALESCE(NULLIF(l.cost_client, 0) / NULLIF(l.cost_company, 0), 1.3), 2),
      proposal_cost = round(v_co * COALESCE(NULLIF(l.proposal_cost, 0) / NULLIF(l.cost_company, 0), 1.5), 2)
    WHERE id = l.id
      AND (qty, unit_price, seat_periods, cost_company) IS DISTINCT FROM (v_now::numeric, COALESCE(l.seat_price, 0), v_periods, v_co);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION sync_project_software_seats(UUID) TO authenticated;

-- a check-in / check-out (or its edit) re-counts the project's seats
CREATE OR REPLACE FUNCTION time_logs_software_seats() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM sync_project_software_seats(OLD.project_id); END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.project_id, NEW.employee_id, NEW.work_date) IS DISTINCT FROM (OLD.project_id, OLD.employee_id, OLD.work_date)) THEN
    PERFORM sync_project_software_seats(NEW.project_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS time_logs_software_seats ON time_logs;
CREATE TRIGGER time_logs_software_seats AFTER INSERT OR DELETE OR UPDATE OF project_id, employee_id, work_date ON time_logs
  FOR EACH ROW EXECUTE FUNCTION time_logs_software_seats();

-- turning a line per-seat, or changing its seat price / billing cycle, re-prices it
CREATE OR REPLACE FUNCTION project_software_costs_seats() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.per_seat THEN PERFORM sync_project_software_seats(NEW.project_id); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS project_software_costs_seats ON project_software_costs;
CREATE TRIGGER project_software_costs_seats AFTER INSERT OR UPDATE OF per_seat, seat_price, billing_cycle ON project_software_costs
  FOR EACH ROW EXECUTE FUNCTION project_software_costs_seats();

NOTIFY pgrst, 'reload schema';

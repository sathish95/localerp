-- STEP259 — Go-Live: per-device "Go-live" Yes / No flag
--
-- Each enrolled device (golive_enrollments) carries whether it has actually
-- gone live. Set on the Devices tab (edit, bulk "Set go-live", Excel round
-- trip) and shown / filtered / counted on every Go-Live tab.
--
--   is_golive     BOOLEAN, default false (No)
--   golive_since  DATE (IST) — stamped when the flag turns Yes, cleared on No;
--                 an explicit date sent with the change is kept
--   custom_fields JSONB { key: value } — values for the engagement's custom
--                 device fields, defined in golive_engagements.config.device_fields
--                 ([{ key, label, type: list|text|yesno, options }], edited in the
--                 engagement form). Filterable on every Go-Live tab.
--
-- Requires STEP235. Safe to re-run.

ALTER TABLE golive_enrollments ADD COLUMN IF NOT EXISTS is_golive    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE golive_enrollments ADD COLUMN IF NOT EXISTS golive_since DATE;
ALTER TABLE golive_enrollments ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS golive_enrollments_is_golive ON golive_enrollments (engagement_id, is_golive);

CREATE OR REPLACE FUNCTION golive_enrollment_live_flag() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_golive THEN
    IF TG_OP = 'INSERT' OR NOT OLD.is_golive THEN
      NEW.golive_since := COALESCE(NEW.golive_since, golive_ist_today());
    ELSE
      NEW.golive_since := COALESCE(NEW.golive_since, OLD.golive_since, golive_ist_today());
    END IF;
  ELSE
    NEW.golive_since := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS golive_enrollments_live_flag ON golive_enrollments;
CREATE TRIGGER golive_enrollments_live_flag BEFORE INSERT OR UPDATE OF is_golive, golive_since ON golive_enrollments
  FOR EACH ROW EXECUTE FUNCTION golive_enrollment_live_flag();

NOTIFY pgrst, 'reload schema';

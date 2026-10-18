-- ============================================================
-- STEP235: Go-Live Support (Hypercare) module
-- Replaces the manual IoT_Daily_Support_Tracker.xlsx (Device Register /
-- Daily Checks / Incidents) with engagement-scoped data that links to the
-- existing masters instead of re-keying them.
--
--   golive_engagements            one per project go-live / hypercare window
--   golive_roster                 role → primary + backup user, effective-dated
--   golive_enrollments            device_instances linked into an engagement
--   golive_daily_checks           one per enrolled device per IST day
--   golive_incidents              go-live incident tracker (see A9 note below)
--   golive_incident_comments      incident updates / activity
--   golive_check_incident_links   check ↔ incident, many-to-many
--   golive_device_notes           per-device comments; a note can be flagged as an issue
--   golive_events                 timeline + field-level audit (before/after)
--
-- Conventions / deliberate deviations from the build brief (existing
-- NeoX patterns win):
--   * tenant_id  → organization_id DEFAULT current_org_id() (app-wide).
--   * Device master = device_instances (STEP25). It has no firmware
--     version, equipment id or SIM/connectivity ref, so those are captured
--     on the enrollment row, and site falls back to device_instances.
--     current_location. There is no sites table — sites are text.
--   * Warranty = device_warranties / warranty_claims (STEP37), read-through.
--   * Budget line = budgets.id (STEP25 budgets with project_id).
--   * A9 fallback: the existing Support Desk (STEP153) is the *platform*
--     desk (org → ThingsAlive staff), not an internal ticket engine, so
--     go-live incidents live in their own table with the same fields.
--   * No generic approval engine exists (approvalFlow.js is expense-role
--     chains, procurementApproval.js is cost-branched). Hypercare exit uses
--     the same per-step columns pattern: PM submit → customer sign-off
--     record → CTO/admin decision (golive_submit_exit / golive_decide_exit).
--   * No project-membership table exists, so reads are org-wide (same as
--     the rest of the app); writes are roster/role gated.
--   * No generic audit log exists, so golive_events carries field diffs.
--
-- The daily-result and follow-up-flag logic below is mirrored exactly by
-- src/lib/goLiveRules.js (pure JS, unit-tested in goLiveRules.test.mjs).
-- Change both together.
--
-- Safe to re-run.
-- ============================================================

/* ═══ Prerequisites — fail fast with a clear message ═══ */

DO $$
DECLARE v_missing TEXT[] := '{}';
BEGIN
  IF to_regprocedure('public.current_org_id()') IS NULL THEN v_missing := array_append(v_missing, 'current_org_id() (STEP89)'); END IF;
  IF to_regclass('public.organizations') IS NULL THEN v_missing := array_append(v_missing, 'organizations (STEP89)'); END IF;
  IF to_regclass('public.device_instances') IS NULL THEN v_missing := array_append(v_missing, 'device_instances (STEP25)');
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_instances' AND column_name = 'organization_id') THEN
    v_missing := array_append(v_missing, 'device_instances.organization_id (STEP97)');
  END IF;
  IF to_regclass('public.device_warranties') IS NULL THEN v_missing := array_append(v_missing, 'device_warranties (STEP37)'); END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modules' AND column_name = 'organization_id') THEN
    v_missing := array_append(v_missing, 'modules.organization_id (STEP89)');
  END IF;
  IF to_regclass('public.billing_bundles') IS NULL THEN v_missing := array_append(v_missing, 'billing_bundles (STEP124)'); END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'organization_id') THEN
    v_missing := array_append(v_missing, 'notifications.organization_id');
  END IF;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'STEP235 needs earlier migrations that this database does not have: %. Run the missing sql/STEP* scripts first (or check you are connected to the right Supabase project).',
      array_to_string(v_missing, ', ');
  END IF;
END $$;

/* ═══ Helpers ═══ */

CREATE OR REPLACE FUNCTION golive_ist_today() RETURNS DATE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION golive_is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text IN ('admin','ceo'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION golive_is_manager_role() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
                 AND role::text IN ('admin','ceo','manager','department_head','cto','project_manager'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Org in scope: the caller's org, or — only for cron jobs, which have no
-- auth.uid() and no session org — the engagement org set by the job.
CREATE OR REPLACE FUNCTION golive_scope_org() RETURNS UUID AS $$
  SELECT CASE WHEN auth.uid() IS NULL AND NULLIF(current_setting('golive.sys_org', true), '') IS NOT NULL
              THEN current_setting('golive.sys_org', true)::uuid
              ELSE current_org_id() END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

/* ═══ Tables ═══ */

CREATE TABLE IF NOT EXISTS golive_engagements (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        UUID        NOT NULL DEFAULT current_org_id(),
  code                   TEXT,
  name                   TEXT        NOT NULL,
  department_id          UUID        NOT NULL,   -- soft ref → departments; primary (first) of department_ids
  project_id             UUID        NOT NULL,   -- soft ref → projects
  budget_line_id         UUID        NOT NULL,   -- soft ref → budgets
  customer_id            UUID,                   -- soft ref → customers (defaulted from project)
  sites                  TEXT[]      NOT NULL DEFAULT '{}',
  pm_user_id             UUID,                   -- soft ref → profiles (engagement PM)
  go_live_date           DATE        NOT NULL,
  hypercare_start        DATE,
  hypercare_planned_end  DATE,
  hypercare_actual_end   DATE,
  status                 TEXT        NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT','ACTIVE','EXIT_REVIEW','CLOSED','CANCELLED')),
  status_reason          TEXT,
  -- Thresholds + rule toggles. Defaults are the brief's assumptions A1–A7.
  exit_criteria          JSONB       NOT NULL DEFAULT '{"consecutive_days":7,"coverage_pct":100,"healthy_pct":95,"max_open_p1":0,"max_open_p2":0,"max_overdue":0,"require_customer_signoff":true}',
  config                 JSONB       NOT NULL DEFAULT '{"stale_multiplier":2,"back_date_days":1,"verifier_must_differ":true,"require_incident_on_attention":true,"stale_data_warning":true,"ack_minutes":{"P1_CRITICAL":30,"P2_HIGH":120,"P3_NORMAL":480,"P4_REQUEST":1440}}',
  review_date_default    TEXT        NOT NULL DEFAULT 'TODAY',
  handover_to            TEXT,                   -- steady-state support team / queue
  -- exit approval (single-step, see header)
  customer_signoff_name  TEXT,
  customer_signoff_date  DATE,
  customer_signoff_ref   TEXT,
  exit_submitted_by      UUID,
  exit_submitted_at      TIMESTAMPTZ,
  exit_override_comment  TEXT,
  exit_decided_by        UUID,
  exit_decided_at        TIMESTAMPTZ,
  exit_decision_comment  TEXT,
  created_by             UUID        DEFAULT auth.uid(),
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_by             UUID,
  updated_at             TIMESTAMPTZ DEFAULT now(),
  deleted_at             TIMESTAMPTZ,
  version                INT         NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS golive_engagements_code ON golive_engagements (organization_id, code);
CREATE INDEX IF NOT EXISTS golive_engagements_project ON golive_engagements (project_id);
CREATE INDEX IF NOT EXISTS golive_engagements_org_status ON golive_engagements (organization_id, status) WHERE deleted_at IS NULL;
-- An engagement can span several departments. department_id stays as the
-- primary one (kept in sync by golive_engagement_before) so the single
-- Department → Project → Budget spine still resolves.
ALTER TABLE golive_engagements ADD COLUMN IF NOT EXISTS department_ids UUID[] NOT NULL DEFAULT '{}';
-- Backfill without the row triggers (lifecycle guards, version bump, audit):
-- it's a pure data migration, and deleted engagements must be included.
ALTER TABLE golive_engagements DISABLE TRIGGER USER;
UPDATE golive_engagements SET department_ids = ARRAY[department_id] WHERE cardinality(department_ids) = 0 AND department_id IS NOT NULL;
ALTER TABLE golive_engagements ENABLE TRIGGER USER;
CREATE INDEX IF NOT EXISTS golive_engagements_departments ON golive_engagements USING GIN (department_ids);

CREATE TABLE IF NOT EXISTS golive_roster (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id       UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  role                TEXT        NOT NULL,   -- ONSITE_COORDINATOR / FIRMWARE_ENGINEER / APPLICATION_ENGINEER / ESCALATION_OWNER (+ extensible)
  primary_user_id     UUID        NOT NULL,
  backup_user_id      UUID,
  primary_unavailable BOOLEAN     NOT NULL DEFAULT false,  -- manual "on leave" toggle → route to backup
  responsibility_note TEXT,
  effective_from      DATE        NOT NULL DEFAULT golive_ist_today(),
  effective_to        DATE,
  created_by          UUID        DEFAULT auth.uid(),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_by          UUID,
  updated_at          TIMESTAMPTZ DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  version             INT         NOT NULL DEFAULT 1,
  CHECK (backup_user_id IS NULL OR backup_user_id <> primary_user_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- One open-ended (current) assignment per role. Changing a role closes the
-- current row (effective_to) and inserts a new one, keeping history.
CREATE UNIQUE INDEX IF NOT EXISTS golive_roster_one_current
  ON golive_roster (engagement_id, role) WHERE effective_to IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS golive_roster_primary ON golive_roster (primary_user_id);
CREATE INDEX IF NOT EXISTS golive_roster_backup ON golive_roster (backup_user_id);

CREATE TABLE IF NOT EXISTS golive_enrollments (
  id                               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id                  UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id                    UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  device_id                        UUID        NOT NULL,   -- soft ref → device_instances
  site                             TEXT,                   -- defaults to device_instances.current_location
  equipment_id                     TEXT,                   -- customer equipment the device monitors
  firmware_version                 TEXT,                   -- not on device master; changes logged as events
  connectivity_ref                 TEXT,                   -- SIM / network ref; not on device master
  expected_reporting_interval_min  INT         NOT NULL DEFAULT 15 CHECK (expected_reporting_interval_min > 0),
  support_status                   TEXT        NOT NULL DEFAULT 'ACTIVE'
                                   CHECK (support_status IN ('ACTIVE','MAINTENANCE','DECOMMISSIONED')),
  status_reason                    TEXT,
  onsite_coordinator_user_id       UUID,   -- null = inherit roster primary
  firmware_engineer_user_id        UUID,
  application_engineer_user_id     UUID,
  deployment_override_reason       TEXT,   -- admin override when the device isn't deployed to this project
  enrolled_at                      TIMESTAMPTZ DEFAULT now(),
  unenrolled_at                    TIMESTAMPTZ,
  unenroll_reason                  TEXT,   -- e.g. 'REPLACED_BY <device code>'
  replaced_by_enrollment_id        UUID,
  import_batch_id                  UUID,
  notes                            TEXT,
  created_by                       UUID        DEFAULT auth.uid(),
  created_at                       TIMESTAMPTZ DEFAULT now(),
  updated_by                       UUID,
  updated_at                       TIMESTAMPTZ DEFAULT now(),
  deleted_at                       TIMESTAMPTZ,
  version                          INT         NOT NULL DEFAULT 1,
  CHECK (support_status = 'ACTIVE' OR NULLIF(trim(status_reason), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS golive_enrollments_device
  ON golive_enrollments (engagement_id, device_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS golive_enrollments_device_idx ON golive_enrollments (device_id);

CREATE TABLE IF NOT EXISTS golive_daily_checks (
  id                              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id                 UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id                   UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  enrollment_id                   UUID        NOT NULL REFERENCES golive_enrollments(id) ON DELETE CASCADE,
  check_date                      DATE        NOT NULL,           -- IST calendar day
  site_snapshot                   TEXT,
  equipment_snapshot              TEXT,
  onsite_coordinator_user_id      UUID,
  onsite_coordinator_legacy       TEXT,       -- unmatched Excel name (imports only)
  power_check                     TEXT CHECK (power_check IN ('PASS','FAIL','NOT_CHECKED','NOT_APPLICABLE')),
  cable_indicator_check           TEXT CHECK (cable_indicator_check IN ('PASS','FAIL','NOT_CHECKED','NOT_APPLICABLE')),
  connectivity                    TEXT CHECK (connectivity IN ('ONLINE','OFFLINE','INTERMITTENT','NOT_CHECKED','NOT_APPLICABLE')),
  last_data_received_at           TIMESTAMPTZ,
  data_gap_minutes                INT,
  firmware_health                 TEXT CHECK (firmware_health IN ('PASS','FAIL','NOT_CHECKED','NOT_APPLICABLE')),
  firmware_reviewer_user_id       UUID,
  firmware_reviewer_legacy        TEXT,
  firmware_version_snapshot       TEXT,
  application_health              TEXT CHECK (application_health IN ('PASS','FAIL','NOT_CHECKED','NOT_APPLICABLE')),
  application_reviewer_user_id    UUID,
  application_reviewer_legacy     TEXT,
  data_quality                    TEXT CHECK (data_quality IN ('PASS','FAIL','NOT_CHECKED','NOT_APPLICABLE')),
  observation_action              TEXT,
  attention_waiver_reason         TEXT,       -- R-A1: ATTENTION saved without an incident
  evidence                        JSONB       NOT NULL DEFAULT '[]',  -- [{path,name,size,uploaded_by,uploaded_at}]
  daily_result                    TEXT        CHECK (daily_result IN ('HEALTHY','ATTENTION','INCOMPLETE','DUPLICATE','CHECK_DEVICE_ID')),
  result_computed_at              TIMESTAMPTZ,
  onsite_submitted_by             UUID,
  onsite_submitted_at             TIMESTAMPTZ,
  firmware_submitted_by           UUID,
  firmware_submitted_at           TIMESTAMPTZ,
  application_submitted_by        UUID,
  application_submitted_at        TIMESTAMPTZ,
  reviewed_complete_at            TIMESTAMPTZ,
  edit_reason                     TEXT,       -- required for edits after check_date + back_date_days (A7)
  customer_visible                BOOLEAN     NOT NULL DEFAULT false,
  import_batch_id                 UUID,
  created_by                      UUID        DEFAULT auth.uid(),
  created_at                      TIMESTAMPTZ DEFAULT now(),
  updated_by                      UUID,
  updated_at                      TIMESTAMPTZ DEFAULT now(),
  deleted_at                      TIMESTAMPTZ,
  version                         INT         NOT NULL DEFAULT 1
);
-- Replaces Excel's duplicate detection for live entry (→ 409 in the client).
CREATE UNIQUE INDEX IF NOT EXISTS golive_daily_checks_one_per_day
  ON golive_daily_checks (enrollment_id, check_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS golive_daily_checks_eng_date ON golive_daily_checks (engagement_id, check_date);

CREATE TABLE IF NOT EXISTS golive_incidents (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id           UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id             UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  number                    TEXT,        -- GLI-00001, per org
  legacy_ref                TEXT,        -- Excel incident id (imports)
  title                     TEXT        NOT NULL,
  scope_type                TEXT        NOT NULL DEFAULT 'DEVICE' CHECK (scope_type IN ('DEVICE','MULTI_DEVICE','SITE','PLATFORM')),
  device_enrollment_ids     UUID[]      NOT NULL DEFAULT '{}',
  site                      TEXT,
  reported_at               TIMESTAMPTZ DEFAULT now(),
  priority                  TEXT        CHECK (priority IN ('P1_CRITICAL','P2_HIGH','P3_NORMAL','P4_REQUEST')),
  category                  TEXT        CHECK (category IN ('HARDWARE','FIRMWARE','CONNECTIVITY','APPLICATION','DATA_QUALITY','REQUEST')),
  issue_business_impact     TEXT,
  assigned_owner_user_id    UUID,
  assigned_owner_legacy     TEXT,
  status                    TEXT        NOT NULL DEFAULT 'OPEN'
                            CHECK (status IN ('OPEN','IN_PROGRESS','AWAITING_SITE','AWAITING_VENDOR','RESOLVED','CLOSED')),
  acknowledged_at           TIMESTAMPTZ,
  next_action               TEXT,
  action_due_at             TIMESTAMPTZ,
  last_update_at            TIMESTAMPTZ DEFAULT now(),
  resolved_at               TIMESTAMPTZ,
  root_cause_resolution     TEXT,
  verified_by_user_id       UUID,
  verified_by_legacy        TEXT,
  closed_at                 TIMESTAMPTZ,
  follow_up_flag            TEXT        CHECK (follow_up_flag IN ('CLOSED','CLOSURE_INCOMPLETE','COMPLETE_TICKET','OVERDUE','ON_TRACK')),
  reopen_reason             TEXT,
  reopen_count              INT         NOT NULL DEFAULT 0,
  ack_escalation_level      INT         NOT NULL DEFAULT 0,   -- 0 none, 1 owner, 2 backup, 3 escalation owner
  warranty_claim_id         UUID,        -- soft ref → warranty_claims
  chargeable_candidate      BOOLEAN     NOT NULL DEFAULT false,  -- out-of-warranty hardware, for Finance review
  vendor_ref                TEXT,
  origin_check_id           UUID,        -- soft ref → golive_daily_checks
  handed_over_to            TEXT,        -- set on hypercare exit for open P3/P4
  handed_over_at            TIMESTAMPTZ,
  customer_visible          BOOLEAN     NOT NULL DEFAULT false,
  import_batch_id           UUID,
  created_by                UUID        DEFAULT auth.uid(),
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_by                UUID,
  updated_at                TIMESTAMPTZ DEFAULT now(),
  deleted_at                TIMESTAMPTZ,
  version                   INT         NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS golive_incidents_number ON golive_incidents (organization_id, number);
CREATE INDEX IF NOT EXISTS golive_incidents_eng_status ON golive_incidents (engagement_id, status);
CREATE INDEX IF NOT EXISTS golive_incidents_owner ON golive_incidents (assigned_owner_user_id) WHERE status <> 'CLOSED';
CREATE INDEX IF NOT EXISTS golive_incidents_devices ON golive_incidents USING GIN (device_enrollment_ids);

CREATE TABLE IF NOT EXISTS golive_incident_comments (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  incident_id     UUID        NOT NULL REFERENCES golive_incidents(id) ON DELETE CASCADE,
  body            TEXT        NOT NULL,
  hours_spent     NUMERIC(6,2),     -- optional effort note (not posted to timesheets in v1)
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS golive_incident_comments_incident ON golive_incident_comments (incident_id, created_at);

CREATE TABLE IF NOT EXISTS golive_check_incident_links (
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  check_id        UUID        NOT NULL REFERENCES golive_daily_checks(id) ON DELETE CASCADE,
  incident_id     UUID        NOT NULL REFERENCES golive_incidents(id) ON DELETE CASCADE,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (check_id, incident_id)
);
CREATE INDEX IF NOT EXISTS golive_check_incident_links_incident ON golive_check_incident_links (incident_id);

CREATE TABLE IF NOT EXISTS golive_events (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id   UUID        NOT NULL,
  entity          TEXT        NOT NULL,     -- engagement / roster / enrollment / check / incident
  entity_id       UUID,
  event_type      TEXT        NOT NULL,     -- created / updated / status_changed / firmware_changed / exit_submitted …
  summary         TEXT,
  changes         JSONB       NOT NULL DEFAULT '{}',  -- {field: {from, to}}
  actor_id        UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS golive_events_eng ON golive_events (engagement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS golive_events_entity ON golive_events (entity_id);

-- Per-device comment thread. A note flagged is_issue carries a category,
-- severity and open/resolved status, and can be escalated to an incident.
CREATE TABLE IF NOT EXISTS golive_device_notes (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id    UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  enrollment_id    UUID        NOT NULL REFERENCES golive_enrollments(id) ON DELETE CASCADE,
  body             TEXT        NOT NULL CHECK (trim(body) <> ''),
  is_issue         BOOLEAN     NOT NULL DEFAULT false,
  issue_category   TEXT        CHECK (issue_category IN ('HARDWARE','FIRMWARE','CONNECTIVITY','APPLICATION','DATA_QUALITY','REQUEST')),
  severity         TEXT        CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  issue_status     TEXT        CHECK (issue_status IN ('OPEN','RESOLVED')),
  resolution       TEXT,
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ,
  incident_id      UUID,       -- soft ref → golive_incidents, when escalated
  created_by       UUID        DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_by       UUID,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  version          INT         NOT NULL DEFAULT 1,
  CHECK (NOT is_issue OR (issue_status IS NOT NULL AND severity IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS golive_device_notes_enrollment ON golive_device_notes (enrollment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS golive_device_notes_open ON golive_device_notes (engagement_id) WHERE is_issue AND issue_status = 'OPEN' AND deleted_at IS NULL;

/* ═══ Role resolution ═══ */

-- Current roster row for a role (effective today).
CREATE OR REPLACE FUNCTION golive_current_roster(p_eng UUID, p_role TEXT) RETURNS golive_roster AS $$
  SELECT r.* FROM golive_roster r
  WHERE r.engagement_id = p_eng AND r.role = p_role AND r.deleted_at IS NULL
    AND r.effective_from <= golive_ist_today() AND (r.effective_to IS NULL OR r.effective_to >= golive_ist_today())
  ORDER BY r.effective_from DESC LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Who a role routes to right now: primary, or backup when primary is unavailable.
CREATE OR REPLACE FUNCTION golive_role_user(p_eng UUID, p_role TEXT) RETURNS UUID AS $$
  SELECT CASE WHEN r.primary_unavailable AND r.backup_user_id IS NOT NULL THEN r.backup_user_id ELSE r.primary_user_id END
  FROM golive_current_roster(p_eng, p_role) r
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Does the current user hold a roster role (primary or backup), or the
-- matching per-device override on any enrollment of the engagement?
CREATE OR REPLACE FUNCTION golive_has_role(p_eng UUID, p_role TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM golive_current_roster(p_eng, p_role) r
    WHERE auth.uid() IN (r.primary_user_id, r.backup_user_id)
  ) OR EXISTS (
    SELECT 1 FROM golive_enrollments e
    WHERE e.engagement_id = p_eng AND e.deleted_at IS NULL
      AND auth.uid() = CASE p_role
        WHEN 'ONSITE_COORDINATOR'   THEN e.onsite_coordinator_user_id
        WHEN 'FIRMWARE_ENGINEER'    THEN e.firmware_engineer_user_id
        WHEN 'APPLICATION_ENGINEER' THEN e.application_engineer_user_id
      END
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- PM-level rights: create/edit engagement, roster, enrollments, verify/close.
CREATE OR REPLACE FUNCTION golive_can_manage(p_eng UUID) RETURNS BOOLEAN AS $$
  SELECT golive_is_manager_role()
      OR EXISTS (SELECT 1 FROM golive_engagements g WHERE g.id = p_eng AND g.pm_user_id = auth.uid())
      OR golive_has_role(p_eng, 'ESCALATION_OWNER')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION golive_on_engagement(p_eng UUID) RETURNS BOOLEAN AS $$
  SELECT golive_can_manage(p_eng)
      OR EXISTS (SELECT 1 FROM golive_roster r WHERE r.engagement_id = p_eng AND r.deleted_at IS NULL
                 AND (r.effective_to IS NULL OR r.effective_to >= golive_ist_today())
                 AND auth.uid() IN (r.primary_user_id, r.backup_user_id))
      OR EXISTS (SELECT 1 FROM golive_enrollments e WHERE e.engagement_id = p_eng AND e.deleted_at IS NULL
                 AND auth.uid() IN (e.onsite_coordinator_user_id, e.firmware_engineer_user_id, e.application_engineer_user_id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION golive_ist_today(), golive_is_admin(), golive_is_manager_role(),
  golive_role_user(UUID, TEXT), golive_has_role(UUID, TEXT), golive_can_manage(UUID), golive_on_engagement(UUID)
  TO authenticated;

/* ═══ Business rules (mirror of src/lib/goLiveRules.js) ═══ */

-- §5.1 Daily result, first match wins. DUPLICATE / CHECK_DEVICE_ID only
-- arise in import staging (client side) — live rows can't be duplicates.
CREATE OR REPLACE FUNCTION golive_compute_daily_result(c golive_daily_checks) RETURNS TEXT AS $$
BEGIN
  IF c.check_date IS NULL THEN RETURN 'INCOMPLETE'; END IF;
  IF c.power_check = 'FAIL' OR c.cable_indicator_check = 'FAIL'
     OR c.connectivity IN ('OFFLINE','INTERMITTENT')
     OR c.firmware_health = 'FAIL' OR c.application_health = 'FAIL' OR c.data_quality = 'FAIL' THEN
    RETURN 'ATTENTION';
  END IF;
  IF NULLIF(trim(c.site_snapshot), '') IS NULL
     OR (c.onsite_coordinator_user_id IS NULL AND NULLIF(trim(c.onsite_coordinator_legacy), '') IS NULL)
     OR c.power_check IS NULL OR c.cable_indicator_check IS NULL OR c.connectivity IS NULL
     OR c.last_data_received_at IS NULL
     OR c.firmware_health IS NULL
     OR (c.firmware_reviewer_user_id IS NULL AND NULLIF(trim(c.firmware_reviewer_legacy), '') IS NULL)
     OR c.application_health IS NULL
     OR (c.application_reviewer_user_id IS NULL AND NULLIF(trim(c.application_reviewer_legacy), '') IS NULL)
     OR c.data_quality IS NULL
     OR 'NOT_CHECKED' IN (c.power_check, c.cable_indicator_check, c.connectivity, c.firmware_health, c.application_health, c.data_quality) THEN
    RETURN 'INCOMPLETE';
  END IF;
  RETURN 'HEALTHY';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- §5.2 Follow-up flag. Calendar time; due exactly = now is ON_TRACK.
CREATE OR REPLACE FUNCTION golive_compute_follow_up_flag(i golive_incidents, p_now TIMESTAMPTZ DEFAULT now()) RETURNS TEXT AS $$
BEGIN
  IF i.status = 'CLOSED' THEN
    IF i.resolved_at IS NOT NULL AND NULLIF(trim(i.root_cause_resolution), '') IS NOT NULL
       AND (i.verified_by_user_id IS NOT NULL OR NULLIF(trim(i.verified_by_legacy), '') IS NOT NULL)
       AND i.closed_at IS NOT NULL THEN
      RETURN 'CLOSED';
    END IF;
    RETURN 'CLOSURE_INCOMPLETE';
  END IF;
  IF i.reported_at IS NULL OR i.priority IS NULL
     OR (i.assigned_owner_user_id IS NULL AND NULLIF(trim(i.assigned_owner_legacy), '') IS NULL)
     OR i.status IS NULL OR NULLIF(trim(i.next_action), '') IS NULL OR i.action_due_at IS NULL THEN
    RETURN 'COMPLETE_TICKET';
  END IF;
  IF i.action_due_at < p_now THEN RETURN 'OVERDUE'; END IF;
  RETURN 'ON_TRACK';
END;
$$ LANGUAGE plpgsql STABLE;

/* ═══ Common row maintenance (updated_at/by, optimistic version) ═══ */

CREATE OR REPLACE FUNCTION golive_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  NEW.version    := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['golive_engagements','golive_roster','golive_enrollments','golive_daily_checks','golive_incidents','golive_device_notes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %1$s_touch ON %1$s', tbl);
    EXECUTE format('CREATE TRIGGER %1$s_touch BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION golive_touch()', tbl);
  END LOOP;
END $$;

/* ═══ Engagement: code, defaults, lifecycle ═══ */

CREATE OR REPLACE FUNCTION golive_engagement_before() RETURNS TRIGGER AS $$
DECLARE
  v_code TEXT; v_seq INT; v_yy TEXT;
BEGIN
  -- departments: de-duplicated list, at least one; department_id = primary
  -- (order kept: the first picked is the primary)
  NEW.department_ids := ARRAY(
    SELECT x FROM unnest(CASE WHEN cardinality(COALESCE(NEW.department_ids, '{}')) = 0 THEN ARRAY[NEW.department_id] ELSE NEW.department_ids END)
      WITH ORDINALITY AS u(x, ord)
    WHERE x IS NOT NULL GROUP BY x ORDER BY min(ord));
  IF cardinality(NEW.department_ids) = 0 THEN RAISE EXCEPTION 'At least one department is required'; END IF;
  IF NEW.department_id IS NULL OR NOT (NEW.department_id = ANY(NEW.department_ids)) THEN
    NEW.department_id := NEW.department_ids[1];
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(NULLIF(upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')), ''), 'PRJ'),
           COALESCE(NEW.customer_id, customer_id)
      INTO v_code, NEW.customer_id
      FROM projects WHERE id = NEW.project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
    v_yy := to_char(COALESCE(NEW.go_live_date, golive_ist_today()), 'YY');
    SELECT count(*) + 1 INTO v_seq FROM golive_engagements
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
        AND to_char(go_live_date, 'YY') = v_yy;
    NEW.code := 'GL-' || COALESCE(v_code, 'PRJ') || '-' || v_yy || lpad(v_seq::text, 2, '0');
    NEW.hypercare_start := COALESCE(NEW.hypercare_start, NEW.go_live_date);
    NEW.hypercare_planned_end := COALESCE(NEW.hypercare_planned_end, NEW.hypercare_start + 30);  -- A1
    NEW.pm_user_id := COALESCE(NEW.pm_user_id, auth.uid());
    IF NEW.status NOT IN ('DRAFT') THEN NEW.status := 'DRAFT'; END IF;
    IF NOT golive_is_manager_role() AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Only project managers / managers can create a go-live engagement';
    END IF;
  END IF;

  IF NEW.hypercare_planned_end < NEW.hypercare_start THEN
    RAISE EXCEPTION 'Hypercare end must be on or after the start';
  END IF;
  IF cardinality(NEW.sites) = 0 AND NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'At least one site is required';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This engagement has been deleted';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- EXIT_REVIEW / CLOSED only via golive_submit_exit / golive_decide_exit
    IF NEW.status IN ('EXIT_REVIEW','CLOSED') AND current_setting('golive.exit_rpc', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Use Submit exit / exit approval to move to %', NEW.status;
    END IF;
    IF NEW.status = 'ACTIVE' AND OLD.status = 'DRAFT' THEN
      IF EXISTS (
        SELECT 1 FROM unnest(ARRAY['ONSITE_COORDINATOR','FIRMWARE_ENGINEER','APPLICATION_ENGINEER','ESCALATION_OWNER']) AS req(role)
        WHERE NOT EXISTS (SELECT 1 FROM golive_current_roster(NEW.id, req.role) r WHERE r.id IS NOT NULL)
      ) THEN
        RAISE EXCEPTION 'Complete the support roster (all four roles) before activating';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM golive_enrollments WHERE engagement_id = NEW.id AND deleted_at IS NULL AND unenrolled_at IS NULL) THEN
        RAISE EXCEPTION 'Enroll at least one device before activating';
      END IF;
      IF cardinality(NEW.sites) = 0 THEN RAISE EXCEPTION 'At least one site is required'; END IF;
    ELSIF NEW.status = 'CANCELLED' THEN
      IF NULLIF(trim(NEW.status_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required to cancel'; END IF;
    ELSIF NEW.status = 'ACTIVE' AND OLD.status IN ('EXIT_REVIEW','CLOSED','CANCELLED') THEN
      -- back to ACTIVE only via golive_decide_exit (send back) or golive_reopen_engagement
      IF current_setting('golive.exit_rpc', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Use % to move back to ACTIVE', CASE OLD.status WHEN 'EXIT_REVIEW' THEN 'exit approval' ELSE 'Reopen' END;
      END IF;
    ELSIF NEW.status = 'ACTIVE' THEN
      RAISE EXCEPTION 'Cannot move from % to ACTIVE', OLD.status;
    ELSIF NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION 'Cannot move back to DRAFT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_engagements_before ON golive_engagements;
CREATE TRIGGER golive_engagements_before BEFORE INSERT OR UPDATE ON golive_engagements
  FOR EACH ROW EXECUTE FUNCTION golive_engagement_before();

/* ═══ Enrollment: device must be in the master and deployed to the project ═══ */

CREATE OR REPLACE FUNCTION golive_enrollment_before() RETURNS TRIGGER AS $$
DECLARE
  d RECORD; g RECORD;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = NEW.engagement_id;
  IF TG_OP = 'INSERT' OR NEW.device_id IS DISTINCT FROM OLD.device_id THEN
    SELECT id, project_id, status, current_location INTO d
      FROM device_instances WHERE id = NEW.device_id AND organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Device is not in the device master — register it in Devices first';
    END IF;
    IF d.status = 'decommissioned' THEN
      RAISE EXCEPTION 'Device is decommissioned in the device master';
    END IF;
    IF d.project_id IS DISTINCT FROM g.project_id THEN
      IF NEW.import_batch_id IS NULL AND (NULLIF(trim(NEW.deployment_override_reason), '') IS NULL OR NOT golive_is_admin()) THEN
        RAISE EXCEPTION 'Device is not deployed to this engagement''s project (admin override with a reason required)';
      END IF;
    END IF;
    NEW.site := COALESCE(NULLIF(trim(NEW.site), ''), d.current_location);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.support_status <> 'DECOMMISSIONED' AND NEW.support_status = 'DECOMMISSIONED' AND NEW.unenrolled_at IS NULL THEN
    NEW.unenrolled_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_enrollments_before ON golive_enrollments;
CREATE TRIGGER golive_enrollments_before BEFORE INSERT OR UPDATE ON golive_enrollments
  FOR EACH ROW EXECUTE FUNCTION golive_enrollment_before();

/* ═══ Daily check: validation, snapshots, sections, result ═══ */

CREATE OR REPLACE FUNCTION golive_check_before() RETURNS TRIGGER AS $$
DECLARE
  e RECORD; g RECORD;
  v_onsite BOOLEAN; v_fw BOOLEAN; v_app BOOLEAN;
  v_is_import BOOLEAN := NEW.import_batch_id IS NOT NULL;
  v_uid UUID := auth.uid();
BEGIN
  SELECT * INTO e FROM golive_enrollments WHERE id = NEW.enrollment_id;
  IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Device is not enrolled in this engagement'; END IF;
  SELECT * INTO g FROM golive_engagements WHERE id = e.engagement_id;
  NEW.engagement_id := e.engagement_id;

  IF TG_OP = 'INSERT' AND NOT v_is_import THEN
    IF NEW.check_date > golive_ist_today() THEN RAISE EXCEPTION 'Check date cannot be in the future'; END IF;
    IF e.support_status = 'DECOMMISSIONED' OR e.unenrolled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Device is decommissioned / unenrolled — no new checks';
    END IF;
    IF g.status NOT IN ('ACTIVE','EXIT_REVIEW') THEN
      RAISE EXCEPTION 'Checks can only be logged while the engagement is active';
    END IF;
  END IF;

  -- §3.4 snapshots so history doesn't shift with the master
  IF TG_OP = 'INSERT' THEN
    NEW.site_snapshot := COALESCE(NULLIF(trim(NEW.site_snapshot), ''), e.site);
    NEW.equipment_snapshot := COALESCE(NULLIF(trim(NEW.equipment_snapshot), ''), e.equipment_id);
    NEW.firmware_version_snapshot := COALESCE(NEW.firmware_version_snapshot, e.firmware_version);
  END IF;

  -- A7: back-dated edits need a fresh reason
  IF TG_OP = 'UPDATE' AND NOT v_is_import
     AND golive_ist_today() > NEW.check_date + COALESCE((g.config->>'back_date_days')::int, 1)
     AND (NULLIF(trim(NEW.edit_reason), '') IS NULL OR NEW.edit_reason IS NOT DISTINCT FROM OLD.edit_reason) THEN
    RAISE EXCEPTION 'This check is older than % day(s) — give a reason for the edit', COALESCE((g.config->>'back_date_days')::int, 1);
  END IF;

  v_onsite := CASE WHEN TG_OP = 'INSERT' THEN
      COALESCE(NEW.power_check, NEW.cable_indicator_check, NEW.connectivity) IS NOT NULL OR NEW.last_data_received_at IS NOT NULL
      OR NEW.onsite_coordinator_user_id IS NOT NULL OR NEW.evidence <> '[]'::jsonb
    ELSE
      (NEW.power_check, NEW.cable_indicator_check, NEW.connectivity, NEW.last_data_received_at, NEW.onsite_coordinator_user_id, NEW.site_snapshot, NEW.equipment_snapshot, NEW.evidence)
      IS DISTINCT FROM (OLD.power_check, OLD.cable_indicator_check, OLD.connectivity, OLD.last_data_received_at, OLD.onsite_coordinator_user_id, OLD.site_snapshot, OLD.equipment_snapshot, OLD.evidence)
    END;
  v_fw := CASE WHEN TG_OP = 'INSERT' THEN NEW.firmware_health IS NOT NULL OR NEW.firmware_reviewer_user_id IS NOT NULL
    ELSE (NEW.firmware_health, NEW.firmware_reviewer_user_id) IS DISTINCT FROM (OLD.firmware_health, OLD.firmware_reviewer_user_id) END;
  v_app := CASE WHEN TG_OP = 'INSERT' THEN NEW.application_health IS NOT NULL OR NEW.application_reviewer_user_id IS NOT NULL OR NEW.data_quality IS NOT NULL
    ELSE (NEW.application_health, NEW.application_reviewer_user_id, NEW.data_quality) IS DISTINCT FROM (OLD.application_health, OLD.application_reviewer_user_id, OLD.data_quality) END;

  -- §11 section permissions (admins always; imports and system jobs skip)
  IF NOT v_is_import AND v_uid IS NOT NULL AND NOT golive_is_admin() THEN
    IF v_onsite AND NOT (golive_has_role(e.engagement_id, 'ONSITE_COORDINATOR') OR golive_can_manage(e.engagement_id)) THEN
      RAISE EXCEPTION 'Only the onsite coordinator or PM can fill the onsite section';
    END IF;
    IF v_fw AND NOT golive_has_role(e.engagement_id, 'FIRMWARE_ENGINEER') THEN
      RAISE EXCEPTION 'Only a firmware engineer on this engagement can complete the firmware review';
    END IF;
    IF v_app AND NOT golive_has_role(e.engagement_id, 'APPLICATION_ENGINEER') THEN
      RAISE EXCEPTION 'Only an application engineer on this engagement can complete the application review';
    END IF;
  END IF;

  IF v_onsite AND NOT v_is_import THEN NEW.onsite_submitted_by := v_uid; NEW.onsite_submitted_at := now(); END IF;
  IF v_fw AND NOT v_is_import THEN NEW.firmware_submitted_by := v_uid; NEW.firmware_submitted_at := now(); END IF;
  IF v_app AND NOT v_is_import THEN NEW.application_submitted_by := v_uid; NEW.application_submitted_at := now(); END IF;

  NEW.data_gap_minutes := CASE WHEN NEW.last_data_received_at IS NULL THEN NULL
    ELSE GREATEST(0, floor(extract(epoch FROM (COALESCE(NEW.onsite_submitted_at, now()) - NEW.last_data_received_at)) / 60))::int END;

  NEW.daily_result := golive_compute_daily_result(NEW);
  NEW.result_computed_at := now();
  NEW.reviewed_complete_at := CASE
    WHEN NEW.firmware_health IS NOT NULL AND NEW.application_health IS NOT NULL
     AND (NEW.firmware_reviewer_user_id IS NOT NULL OR NEW.firmware_reviewer_legacy IS NOT NULL)
     AND (NEW.application_reviewer_user_id IS NOT NULL OR NEW.application_reviewer_legacy IS NOT NULL)
    THEN COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.reviewed_complete_at END, now()) END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_daily_checks_before ON golive_daily_checks;
CREATE TRIGGER golive_daily_checks_before BEFORE INSERT OR UPDATE ON golive_daily_checks
  FOR EACH ROW EXECUTE FUNCTION golive_check_before();

/* ═══ Incident: numbering, §7.3 transition guards, auto stamps, flag ═══ */

CREATE OR REPLACE FUNCTION golive_incident_guard(i golive_incidents, p_from TEXT, g golive_engagements) RETURNS VOID AS $$
BEGIN
  IF i.status <> 'OPEN' AND i.assigned_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Assign an owner before moving the incident out of OPEN';
  END IF;
  IF i.status IN ('IN_PROGRESS','AWAITING_SITE','AWAITING_VENDOR') THEN
    IF NULLIF(trim(i.next_action), '') IS NULL OR i.action_due_at IS NULL THEN
      RAISE EXCEPTION 'Next action and action due are required for %', i.status;
    END IF;
  END IF;
  IF i.status = 'AWAITING_VENDOR' AND NULLIF(trim(i.vendor_ref), '') IS NULL THEN
    RAISE EXCEPTION 'Vendor reference is required while awaiting vendor';
  END IF;
  IF i.status = 'RESOLVED' AND NULLIF(trim(i.root_cause_resolution), '') IS NULL THEN
    RAISE EXCEPTION 'Root cause / resolution is required to resolve';
  END IF;
  IF i.status = 'CLOSED' THEN
    IF p_from <> 'RESOLVED' THEN RAISE EXCEPTION 'An incident can only be closed from RESOLVED'; END IF;
    IF i.verified_by_user_id IS NULL THEN RAISE EXCEPTION 'Verified by is required to close'; END IF;
    IF COALESCE((g.config->>'verifier_must_differ')::boolean, true) AND i.verified_by_user_id = i.assigned_owner_user_id THEN
      RAISE EXCEPTION 'The verifier must be different from the assigned owner';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT golive_can_manage(g.id) THEN
      RAISE EXCEPTION 'Only the PM or escalation owner can verify and close';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION golive_incident_before() RETURNS TRIGGER AS $$
DECLARE
  g golive_engagements; v_seq INT;
  v_is_import BOOLEAN := NEW.import_batch_id IS NOT NULL;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = NEW.engagement_id;

  -- System updates (cron flag refresh, exit handover) skip guards and stamps.
  IF TG_OP = 'UPDATE' AND current_setting('golive.system', true) = 'on' THEN
    NEW.follow_up_flag := golive_compute_follow_up_flag(NEW, now());
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(max(NULLIF(regexp_replace(number, '\D', '', 'g'), '')::int), 0) + 1 INTO v_seq
      FROM golive_incidents WHERE organization_id = NEW.organization_id;
    NEW.number := 'GLI-' || lpad(v_seq::text, 5, '0');
    IF NOT v_is_import THEN
      IF NEW.status NOT IN ('OPEN','IN_PROGRESS') THEN RAISE EXCEPTION 'New incidents start OPEN or IN_PROGRESS'; END IF;
      IF NULLIF(trim(NEW.issue_business_impact), '') IS NULL THEN RAISE EXCEPTION 'Issue / business impact is required'; END IF;
      IF NEW.priority IS NULL OR NEW.category IS NULL THEN RAISE EXCEPTION 'Priority and category are required'; END IF;
      IF NEW.scope_type IN ('DEVICE','MULTI_DEVICE') AND cardinality(NEW.device_enrollment_ids) = 0 THEN
        RAISE EXCEPTION 'Pick the affected device(s)';
      END IF;
      NEW.reported_at := COALESCE(NEW.reported_at, now());
      PERFORM golive_incident_guard(NEW, 'OPEN', g);
      IF NEW.status <> 'OPEN' THEN NEW.acknowledged_at := COALESCE(NEW.acknowledged_at, now()); END IF;
    END IF;
  ELSIF NOT v_is_import OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status IN ('RESOLVED','CLOSED') AND NEW.status IN ('OPEN','IN_PROGRESS','AWAITING_SITE','AWAITING_VENDOR') THEN
        -- reopen: keep history (events), clear resolution stamps
        IF NULLIF(trim(NEW.reopen_reason), '') IS NULL OR NEW.reopen_reason IS NOT DISTINCT FROM OLD.reopen_reason THEN
          RAISE EXCEPTION 'A reason is required to reopen';
        END IF;
        NEW.resolved_at := NULL; NEW.closed_at := NULL; NEW.verified_by_user_id := NULL; NEW.verified_by_legacy := NULL;
        NEW.reopen_count := OLD.reopen_count + 1;
      ELSIF OLD.status = 'CLOSED' THEN
        RAISE EXCEPTION 'A closed incident can only be reopened';
      END IF;
      PERFORM golive_incident_guard(NEW, OLD.status, g);
      IF NEW.status = 'RESOLVED' THEN NEW.resolved_at := COALESCE(NEW.resolved_at, now()); END IF;
      IF NEW.status = 'CLOSED' THEN NEW.closed_at := now(); END IF;
      IF OLD.status = 'OPEN' AND NEW.acknowledged_at IS NULL THEN NEW.acknowledged_at := now(); END IF;
    ELSIF NEW.status NOT IN ('RESOLVED','CLOSED') THEN
      PERFORM golive_incident_guard(NEW, OLD.status, g);
    END IF;
    -- first action by the owner acknowledges
    IF NEW.acknowledged_at IS NULL AND auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_owner_user_id THEN
      NEW.acknowledged_at := now();
    END IF;
    IF NEW.assigned_owner_user_id IS DISTINCT FROM OLD.assigned_owner_user_id THEN NEW.ack_escalation_level := 0; END IF;
    NEW.last_update_at := now();
  END IF;

  -- §6.4 out-of-warranty hardware → chargeable candidate for Finance
  IF NEW.category = 'HARDWARE' AND cardinality(NEW.device_enrollment_ids) > 0 THEN
    NEW.chargeable_candidate := NOT EXISTS (
      SELECT 1 FROM golive_enrollments en
      JOIN device_warranties w ON w.device_id = en.device_id AND w.status = 'Active'
      WHERE en.id = ANY(NEW.device_enrollment_ids)
        AND w.warranty_end_date >= COALESCE(NEW.reported_at, now())::date
    ) AND NOT EXISTS (
      SELECT 1 FROM golive_enrollments en JOIN device_instances di ON di.id = en.device_id
      WHERE en.id = ANY(NEW.device_enrollment_ids) AND di.warranty_end >= COALESCE(NEW.reported_at, now())::date
    );
  ELSE
    NEW.chargeable_candidate := false;
  END IF;

  NEW.follow_up_flag := golive_compute_follow_up_flag(NEW, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_incidents_before ON golive_incidents;
CREATE TRIGGER golive_incidents_before BEFORE INSERT OR UPDATE ON golive_incidents
  FOR EACH ROW EXECUTE FUNCTION golive_incident_before();

-- Comments count as an update (Excel "last update").
CREATE OR REPLACE FUNCTION golive_comment_after() RETURNS TRIGGER AS $$
BEGIN
  UPDATE golive_incidents SET last_update_at = now(),
    acknowledged_at = COALESCE(acknowledged_at, CASE WHEN assigned_owner_user_id = NEW.created_by THEN now() END)
  WHERE id = NEW.incident_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_incident_comments_after ON golive_incident_comments;
CREATE TRIGGER golive_incident_comments_after AFTER INSERT ON golive_incident_comments
  FOR EACH ROW EXECUTE FUNCTION golive_comment_after();

/* ═══ Audit / timeline (field-level before → after) ═══ */

CREATE OR REPLACE FUNCTION golive_audit() RETURNS TRIGGER AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW); v_old JSONB; v_changes JSONB := '{}'; k TEXT;
  v_entity TEXT := CASE TG_TABLE_NAME
    WHEN 'golive_engagements' THEN 'engagement' WHEN 'golive_roster' THEN 'roster'
    WHEN 'golive_enrollments' THEN 'enrollment' WHEN 'golive_daily_checks' THEN 'check'
    WHEN 'golive_device_notes' THEN 'device_note'
    ELSE 'incident' END;
  v_eng UUID := CASE WHEN TG_TABLE_NAME = 'golive_engagements' THEN NEW.id ELSE (v_new->>'engagement_id')::uuid END;
  v_type TEXT := 'created';
  v_summary TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN k IN ('updated_at','updated_by','version','result_computed_at','last_update_at','data_gap_minutes','follow_up_flag','ack_escalation_level');
      IF v_new->k IS DISTINCT FROM v_old->k THEN
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old->k, 'to', v_new->k));
      END IF;
    END LOOP;
    IF v_changes = '{}' THEN RETURN NEW; END IF;
    v_type := CASE
      WHEN v_changes ? 'status' THEN 'status_changed'
      WHEN v_changes ? 'support_status' THEN 'status_changed'
      WHEN v_changes ? 'firmware_version' THEN 'firmware_changed'
      WHEN v_changes ? 'deleted_at' THEN 'deleted'
      ELSE 'updated' END;
  END IF;
  v_summary := CASE v_entity
    WHEN 'engagement' THEN COALESCE(v_new->>'code', '') || ' ' || COALESCE(v_new->>'status', '')
    WHEN 'roster' THEN v_new->>'role'
    WHEN 'enrollment' THEN COALESCE(v_new->>'support_status', '')
    WHEN 'check' THEN COALESCE(v_new->>'check_date', '') || ' ' || COALESCE(v_new->>'daily_result', '')
    WHEN 'device_note' THEN CASE WHEN (v_new->>'is_issue')::boolean THEN 'Issue ' || COALESCE(v_new->>'issue_status', '') || ': ' ELSE 'Note: ' END || left(v_new->>'body', 80)
    ELSE COALESCE(v_new->>'number', '') || ' ' || COALESCE(v_new->>'status', '') END;
  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes, actor_id)
  VALUES ((v_new->>'organization_id')::uuid, v_eng, v_entity, NEW.id, v_type, v_summary, v_changes, auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['golive_engagements','golive_roster','golive_enrollments','golive_daily_checks','golive_incidents','golive_device_notes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %1$s_audit ON %1$s', tbl);
    EXECUTE format('CREATE TRIGGER %1$s_audit AFTER INSERT OR UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION golive_audit()', tbl);
  END LOOP;
END $$;

/* ═══ Event notifications (§12) ═══ */

CREATE OR REPLACE FUNCTION golive_notify(p_org UUID, p_recipients UUID[], p_type TEXT, p_title TEXT, p_body TEXT, p_link TEXT, p_meta JSONB DEFAULT '{}')
RETURNS VOID AS $$
  INSERT INTO notifications (organization_id, recipient_id, sender_id, type, title, body, link, metadata)
  SELECT DISTINCT p_org, rid, auth.uid(), p_type, p_title, p_body, p_link, p_meta
  FROM unnest(p_recipients) AS rid
  WHERE rid IS NOT NULL AND rid IS DISTINCT FROM auth.uid()
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Resolved engineer for a device: per-device override, else roster (with backup fallback).
CREATE OR REPLACE FUNCTION golive_device_user(p_enrollment UUID, p_role TEXT) RETURNS UUID AS $$
  SELECT COALESCE(CASE p_role
      WHEN 'ONSITE_COORDINATOR'   THEN e.onsite_coordinator_user_id
      WHEN 'FIRMWARE_ENGINEER'    THEN e.firmware_engineer_user_id
      WHEN 'APPLICATION_ENGINEER' THEN e.application_engineer_user_id END,
    golive_role_user(e.engagement_id, p_role))
  FROM golive_enrollments e WHERE e.id = p_enrollment
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_device_user(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION golive_check_after() RETURNS TRIGGER AS $$
DECLARE
  v_dev TEXT; v_link TEXT := '/golive/' || NEW.engagement_id || '?tab=checks&date=' || NEW.check_date;
BEGIN
  IF NEW.import_batch_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(di.device_code, di.serial_number) INTO v_dev
    FROM golive_enrollments e JOIN device_instances di ON di.id = e.device_id WHERE e.id = NEW.enrollment_id;
  IF NEW.onsite_submitted_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.onsite_submitted_at IS NULL)
     AND NEW.firmware_health IS NULL AND NEW.application_health IS NULL THEN
    PERFORM golive_notify(NEW.organization_id,
      ARRAY[golive_device_user(NEW.enrollment_id, 'FIRMWARE_ENGINEER'), golive_device_user(NEW.enrollment_id, 'APPLICATION_ENGINEER')],
      'golive_review_task', 'Check ready for review', v_dev || ' onsite check saved for ' || NEW.check_date, v_link,
      jsonb_build_object('check_id', NEW.id));
  END IF;
  IF NEW.daily_result = 'ATTENTION' AND (TG_OP = 'INSERT' OR OLD.daily_result IS DISTINCT FROM 'ATTENTION') THEN
    PERFORM golive_notify(NEW.organization_id,
      ARRAY[golive_device_user(NEW.enrollment_id, 'FIRMWARE_ENGINEER'), golive_device_user(NEW.enrollment_id, 'APPLICATION_ENGINEER'),
            golive_role_user(NEW.engagement_id, 'ESCALATION_OWNER')],
      'golive_check_attention', 'Device needs attention', v_dev || ' failed a check on ' || NEW.check_date, v_link,
      jsonb_build_object('check_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_daily_checks_after ON golive_daily_checks;
CREATE TRIGGER golive_daily_checks_after AFTER INSERT OR UPDATE ON golive_daily_checks
  FOR EACH ROW EXECUTE FUNCTION golive_check_after();

CREATE OR REPLACE FUNCTION golive_incident_after() RETURNS TRIGGER AS $$
DECLARE
  g golive_engagements; v_link TEXT := '/golive/' || NEW.engagement_id || '?tab=incidents&incident=' || NEW.id;
BEGIN
  IF NEW.import_batch_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO g FROM golive_engagements WHERE id = NEW.engagement_id;
  IF NEW.priority = 'P1_CRITICAL' AND (TG_OP = 'INSERT' OR OLD.priority IS DISTINCT FROM 'P1_CRITICAL') AND NEW.status <> 'CLOSED' THEN
    PERFORM golive_notify(NEW.organization_id,
      ARRAY[g.pm_user_id, golive_role_user(g.id, 'ESCALATION_OWNER'), golive_role_user(g.id, 'ONSITE_COORDINATOR'),
            golive_role_user(g.id, 'FIRMWARE_ENGINEER'), golive_role_user(g.id, 'APPLICATION_ENGINEER'), NEW.assigned_owner_user_id],
      'golive_p1', 'P1 critical incident ' || NEW.number, NEW.title, v_link, jsonb_build_object('incident_id', NEW.id));
  END IF;
  IF NEW.assigned_owner_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.assigned_owner_user_id IS DISTINCT FROM NEW.assigned_owner_user_id) THEN
    PERFORM golive_notify(NEW.organization_id, ARRAY[NEW.assigned_owner_user_id],
      'golive_incident_assigned', 'Incident assigned: ' || NEW.number, NEW.title, v_link, jsonb_build_object('incident_id', NEW.id));
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'RESOLVED' AND OLD.status IS DISTINCT FROM 'RESOLVED' THEN
    PERFORM golive_notify(NEW.organization_id, ARRAY[g.pm_user_id, golive_role_user(g.id, 'ESCALATION_OWNER')],
      'golive_incident_resolved', 'Verify & close ' || NEW.number, NEW.title, v_link, jsonb_build_object('incident_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_incidents_after ON golive_incidents;
CREATE TRIGGER golive_incidents_after AFTER INSERT OR UPDATE ON golive_incidents
  FOR EACH ROW EXECUTE FUNCTION golive_incident_after();

CREATE OR REPLACE FUNCTION golive_roster_after() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.primary_unavailable AND (TG_OP = 'INSERT' OR NOT OLD.primary_unavailable) THEN
    PERFORM golive_notify(NEW.organization_id, ARRAY[NEW.backup_user_id], 'golive_backup_active',
      'You are covering as backup', initcap(replace(NEW.role, '_', ' ')) || ' — the primary is unavailable',
      '/golive/' || NEW.engagement_id || '?tab=roster', jsonb_build_object('roster_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_roster_after ON golive_roster;
CREATE TRIGGER golive_roster_after AFTER INSERT OR UPDATE ON golive_roster
  FOR EACH ROW EXECUTE FUNCTION golive_roster_after();

/* ═══ Exit readiness (§7.4) — single source for the panel and the job ═══ */

CREATE OR REPLACE FUNCTION golive_exit_readiness(p_eng UUID) RETURNS JSONB AS $$
DECLARE
  g golive_engagements;
  c JSONB;
  v_need INT; v_cov NUMERIC; v_healthy NUMERIC; v_streak INT := 0;
  d DATE; v_expected INT; v_logged INT; v_ok INT; v_first BOOLEAN := true;
  v_p1 INT; v_p2 INT; v_overdue INT; v_handover INT; v_days JSONB := '[]';
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND organization_id = golive_scope_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  c := g.exit_criteria;
  v_need    := COALESCE((c->>'consecutive_days')::int, 7);
  v_cov     := COALESCE((c->>'coverage_pct')::numeric, 100);
  v_healthy := COALESCE((c->>'healthy_pct')::numeric, 95);

  -- Walk back from today; today is skipped (not broken) while it's still in progress.
  d := golive_ist_today();
  WHILE d >= g.hypercare_start AND v_streak < GREATEST(v_need, 1) + 30 LOOP
    SELECT count(*) INTO v_expected FROM golive_enrollments e
      WHERE e.engagement_id = p_eng AND e.deleted_at IS NULL AND e.support_status = 'ACTIVE'
        AND (e.enrolled_at AT TIME ZONE 'Asia/Kolkata')::date <= d
        AND (e.unenrolled_at IS NULL OR (e.unenrolled_at AT TIME ZONE 'Asia/Kolkata')::date > d);
    SELECT count(DISTINCT k.enrollment_id), count(*) FILTER (WHERE k.daily_result = 'HEALTHY')
      INTO v_logged, v_ok
      FROM golive_daily_checks k JOIN golive_enrollments e ON e.id = k.enrollment_id
      WHERE k.engagement_id = p_eng AND k.check_date = d AND k.deleted_at IS NULL AND e.support_status = 'ACTIVE';
    IF v_expected > 0 AND v_logged * 100.0 / v_expected >= v_cov AND v_logged > 0 AND v_ok * 100.0 / v_logged >= v_healthy THEN
      v_streak := v_streak + 1;
      v_days := v_days || jsonb_build_object('date', d, 'ok', true, 'expected', v_expected, 'logged', v_logged, 'healthy', v_ok);
    ELSIF v_first AND d = golive_ist_today() THEN
      v_days := v_days || jsonb_build_object('date', d, 'ok', null, 'expected', v_expected, 'logged', v_logged, 'healthy', v_ok);
    ELSE
      v_days := v_days || jsonb_build_object('date', d, 'ok', false, 'expected', v_expected, 'logged', v_logged, 'healthy', v_ok);
      EXIT;
    END IF;
    v_first := false;
    d := d - 1;
  END LOOP;

  SELECT count(*) FILTER (WHERE priority = 'P1_CRITICAL' AND status NOT IN ('RESOLVED','CLOSED')),
         count(*) FILTER (WHERE priority = 'P2_HIGH' AND status NOT IN ('RESOLVED','CLOSED')),
         count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED') AND golive_compute_follow_up_flag(i, now()) = 'OVERDUE'),
         count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED') AND priority IN ('P3_NORMAL','P4_REQUEST'))
    INTO v_p1, v_p2, v_overdue, v_handover
    FROM golive_incidents i WHERE i.engagement_id = p_eng AND i.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'criteria', jsonb_build_array(
      jsonb_build_object('key','stable_days','label', v_need || ' consecutive days with ' || v_cov || '% coverage and ≥ ' || v_healthy || '% healthy',
                         'met', v_streak >= v_need, 'value', v_streak, 'target', v_need),
      jsonb_build_object('key','open_p1','label','No open P1 incidents','met', v_p1 <= COALESCE((c->>'max_open_p1')::int, 0), 'value', v_p1),
      jsonb_build_object('key','open_p2','label','No open P2 incidents','met', v_p2 <= COALESCE((c->>'max_open_p2')::int, 0), 'value', v_p2),
      jsonb_build_object('key','overdue','label','No overdue incident actions','met', v_overdue <= COALESCE((c->>'max_overdue')::int, 0), 'value', v_overdue),
      jsonb_build_object('key','handover','label','Open P3/P4 have a handover queue','met', v_handover = 0 OR NULLIF(trim(g.handover_to), '') IS NOT NULL, 'value', v_handover),
      jsonb_build_object('key','signoff','label','Customer sign-off recorded',
                         'met', NOT COALESCE((c->>'require_customer_signoff')::boolean, true) OR (g.customer_signoff_name IS NOT NULL AND g.customer_signoff_date IS NOT NULL),
                         'value', g.customer_signoff_name)
    ),
    'days', v_days,
    'streak', v_streak
  ) || jsonb_build_object('all_met', v_streak >= v_need
       AND v_p1 <= COALESCE((c->>'max_open_p1')::int, 0) AND v_p2 <= COALESCE((c->>'max_open_p2')::int, 0)
       AND v_overdue <= COALESCE((c->>'max_overdue')::int, 0)
       AND (v_handover = 0 OR NULLIF(trim(g.handover_to), '') IS NOT NULL));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_exit_readiness(UUID) TO authenticated;

-- PM submits exit. Blocked while P1/P2 are open unless an override comment is given (acceptance #12).
CREATE OR REPLACE FUNCTION golive_submit_exit(p_eng UUID, p_override_comment TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE
  g golive_engagements; r JSONB;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND organization_id = current_org_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT (golive_is_admin() OR g.pm_user_id = auth.uid() OR golive_is_manager_role()) THEN
    RAISE EXCEPTION 'Only the PM can submit hypercare exit';
  END IF;
  IF g.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Only an ACTIVE engagement can be submitted for exit'; END IF;
  r := golive_exit_readiness(p_eng);
  IF NOT (r->>'all_met')::boolean AND NULLIF(trim(p_override_comment), '') IS NULL THEN
    RAISE EXCEPTION 'Exit criteria are not met — add an override comment for the approver';
  END IF;
  PERFORM set_config('golive.exit_rpc', 'on', true);
  UPDATE golive_engagements SET status = 'EXIT_REVIEW', exit_submitted_by = auth.uid(), exit_submitted_at = now(),
    exit_override_comment = NULLIF(trim(p_override_comment), ''), exit_decided_by = NULL, exit_decided_at = NULL, exit_decision_comment = NULL
  WHERE id = p_eng;
  PERFORM set_config('golive.exit_rpc', 'off', true);
  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes)
  VALUES (g.organization_id, p_eng, 'engagement', p_eng, 'exit_submitted', 'Hypercare exit submitted', jsonb_build_object('readiness', r, 'override', p_override_comment));
  PERFORM golive_notify(g.organization_id,
    ARRAY(SELECT id FROM profiles WHERE organization_id = g.organization_id AND role::text IN ('cto','ceo','admin') AND COALESCE(is_active, true)),
    'golive_exit_approval', 'Hypercare exit to approve: ' || g.code, g.name, '/golive/' || p_eng, jsonb_build_object('engagement_id', p_eng));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_submit_exit(UUID, TEXT) TO authenticated;

-- CTO / CEO / admin decision. Approve → CLOSED, actual end, hand over open P3/P4.
CREATE OR REPLACE FUNCTION golive_decide_exit(p_eng UUID, p_approve BOOLEAN, p_comment TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE
  g golive_engagements;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND organization_id = current_org_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text IN ('cto','ceo','admin')) THEN
    RAISE EXCEPTION 'Only the CTO / CEO / admin can decide hypercare exit';
  END IF;
  IF g.status <> 'EXIT_REVIEW' THEN RAISE EXCEPTION 'Engagement is not in exit review'; END IF;
  IF NOT p_approve AND NULLIF(trim(p_comment), '') IS NULL THEN RAISE EXCEPTION 'A comment is required to send it back'; END IF;
  IF p_approve AND COALESCE((g.exit_criteria->>'require_customer_signoff')::boolean, true)
     AND (g.customer_signoff_name IS NULL OR g.customer_signoff_date IS NULL) THEN
    RAISE EXCEPTION 'Record the customer sign-off before approving';
  END IF;

  PERFORM set_config('golive.exit_rpc', 'on', true);
  UPDATE golive_engagements SET
    status = CASE WHEN p_approve THEN 'CLOSED' ELSE 'ACTIVE' END,
    hypercare_actual_end = CASE WHEN p_approve THEN golive_ist_today() END,
    exit_decided_by = auth.uid(), exit_decided_at = now(), exit_decision_comment = NULLIF(trim(p_comment), '')
  WHERE id = p_eng;
  PERFORM set_config('golive.exit_rpc', 'off', true);

  IF p_approve THEN
    PERFORM set_config('golive.system', 'on', true);
    UPDATE golive_incidents SET handed_over_to = COALESCE(g.handover_to, 'Steady-state support'), handed_over_at = now()
    WHERE engagement_id = p_eng AND deleted_at IS NULL AND status NOT IN ('RESOLVED','CLOSED') AND priority IN ('P3_NORMAL','P4_REQUEST');
    PERFORM set_config('golive.system', 'off', true);
  END IF;
  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes)
  VALUES (g.organization_id, p_eng, 'engagement', p_eng, CASE WHEN p_approve THEN 'exit_approved' ELSE 'exit_rejected' END,
          CASE WHEN p_approve THEN 'Hypercare exit approved' ELSE 'Hypercare exit sent back' END, jsonb_build_object('comment', p_comment));
  PERFORM golive_notify(g.organization_id, ARRAY[g.pm_user_id, g.exit_submitted_by],
    CASE WHEN p_approve THEN 'golive_exit_approved' ELSE 'golive_exit_rejected' END,
    CASE WHEN p_approve THEN 'Hypercare closed: ' ELSE 'Hypercare exit sent back: ' END || g.code,
    COALESCE(p_comment, g.name), '/golive/' || p_eng, jsonb_build_object('engagement_id', p_eng));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_decide_exit(UUID, BOOLEAN, TEXT) TO authenticated;

/* ═══ Scheduled jobs (§12) — cron runs as postgres: no auth.uid() ═══ */

-- Every 15 min: recompute follow-up flags (OVERDUE is time-driven),
-- notify newly overdue, and walk the acknowledgement-SLA ladder (A6):
-- 1× target → owner, 2× → owner's backup, 3× → escalation owner.
CREATE OR REPLACE FUNCTION golive_refresh_incidents() RETURNS INT AS $$
DECLARE
  i RECORD; v_flag TEXT; v_n INT := 0; v_target INT; v_age NUMERIC; v_level INT; v_to UUID; v_link TEXT;
BEGIN
  PERFORM set_config('golive.system', 'on', true);
  FOR i IN
    SELECT x.*, g.config AS g_config, g.id AS g_id FROM golive_incidents x
    JOIN golive_engagements g ON g.id = x.engagement_id
    WHERE x.deleted_at IS NULL AND x.status <> 'CLOSED' AND g.status IN ('ACTIVE','EXIT_REVIEW') AND g.deleted_at IS NULL
  LOOP
    v_link := '/golive/' || i.engagement_id || '?tab=incidents&incident=' || i.id;
    SELECT golive_compute_follow_up_flag(x, now()) INTO v_flag FROM golive_incidents x WHERE x.id = i.id;
    IF v_flag IS DISTINCT FROM i.follow_up_flag THEN
      UPDATE golive_incidents SET follow_up_flag = v_flag WHERE id = i.id;  -- trigger recomputes the same value
      v_n := v_n + 1;
      IF v_flag = 'OVERDUE' THEN
        PERFORM golive_notify(i.organization_id, ARRAY[i.assigned_owner_user_id, golive_role_user(i.g_id, 'ESCALATION_OWNER')],
          'golive_incident_overdue', 'Overdue action: ' || i.number, COALESCE(i.next_action, i.title), v_link, jsonb_build_object('incident_id', i.id));
      END IF;
    END IF;

    IF i.acknowledged_at IS NULL AND i.priority IS NOT NULL THEN
      v_target := COALESCE((i.g_config->'ack_minutes'->>i.priority)::int,
                           CASE i.priority WHEN 'P1_CRITICAL' THEN 30 WHEN 'P2_HIGH' THEN 120 WHEN 'P3_NORMAL' THEN 480 ELSE 1440 END);
      v_age := extract(epoch FROM now() - i.reported_at) / 60;
      v_level := LEAST(3, floor(v_age / v_target))::int;
      IF v_level > i.ack_escalation_level THEN
        v_to := CASE v_level
          WHEN 1 THEN i.assigned_owner_user_id
          WHEN 2 THEN (SELECT r.backup_user_id FROM golive_roster r WHERE r.engagement_id = i.engagement_id AND r.primary_user_id = i.assigned_owner_user_id
                         AND r.deleted_at IS NULL AND r.effective_to IS NULL LIMIT 1)
          ELSE golive_role_user(i.g_id, 'ESCALATION_OWNER') END;
        PERFORM golive_notify(i.organization_id, ARRAY[COALESCE(v_to, golive_role_user(i.g_id, 'ESCALATION_OWNER'))],
          'golive_ack_sla', 'Unacknowledged ' || replace(i.priority, '_', ' ') || ': ' || i.number, i.title, v_link,
          jsonb_build_object('incident_id', i.id, 'level', v_level));
        UPDATE golive_incidents SET ack_escalation_level = v_level WHERE id = i.id;
      END IF;
    END IF;
  END LOOP;
  PERFORM set_config('golive.system', 'off', true);
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 09:00 IST: today's check list to each coordinator; yesterday's gaps → escalation owner.
CREATE OR REPLACE FUNCTION golive_morning_jobs() RETURNS INT AS $$
DECLARE
  g RECORD; v_n INT := 0; v_missing INT; v_pending INT; v_today DATE := golive_ist_today();
  r JSONB;
BEGIN
  FOR g IN SELECT * FROM golive_engagements WHERE status = 'ACTIVE' AND deleted_at IS NULL LOOP
    PERFORM golive_notify(g.organization_id,
      ARRAY(SELECT DISTINCT golive_device_user(e.id, 'ONSITE_COORDINATOR') FROM golive_enrollments e
            WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.support_status = 'ACTIVE' AND e.unenrolled_at IS NULL),
      'golive_checks_due', 'Today''s device checks — ' || g.code,
      (SELECT count(*) FROM golive_enrollments e WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.support_status = 'ACTIVE' AND e.unenrolled_at IS NULL)
        || ' active device(s) to check', '/golive/' || g.id || '?tab=checks', jsonb_build_object('engagement_id', g.id));

    SELECT count(*) INTO v_missing FROM golive_enrollments e
      WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.support_status = 'ACTIVE' AND e.unenrolled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM golive_daily_checks k WHERE k.enrollment_id = e.id AND k.check_date = v_today - 1 AND k.deleted_at IS NULL);
    SELECT count(*) INTO v_pending FROM golive_daily_checks k
      WHERE k.engagement_id = g.id AND k.check_date = v_today - 1 AND k.deleted_at IS NULL AND k.reviewed_complete_at IS NULL;
    IF v_missing + v_pending > 0 THEN
      PERFORM golive_notify(g.organization_id, ARRAY[golive_role_user(g.id, 'ESCALATION_OWNER')],
        'golive_missed_escalation', 'Yesterday''s gaps — ' || g.code,
        v_missing || ' missing check(s), ' || v_pending || ' pending review(s) for ' || (v_today - 1),
        '/golive/' || g.id || '?tab=checks&date=' || (v_today - 1), jsonb_build_object('engagement_id', g.id));
    END IF;

    r := golive_exit_readiness_sys(g.id);
    IF (r->>'all_met')::boolean AND NOT EXISTS (
      SELECT 1 FROM notifications n WHERE n.type = 'golive_exit_ready' AND (n.metadata->>'engagement_id')::uuid = g.id
    ) THEN
      PERFORM golive_notify(g.organization_id, ARRAY[g.pm_user_id], 'golive_exit_ready', 'Exit criteria met — ' || g.code,
        'Hypercare exit can be submitted', '/golive/' || g.id, jsonb_build_object('engagement_id', g.id));
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- golive_exit_readiness() is org-scoped to the caller; the job has no
-- session org, so put the engagement's org in scope (see golive_scope_org).
CREATE OR REPLACE FUNCTION golive_exit_readiness_sys(p_eng UUID) RETURNS JSONB AS $$
DECLARE v_org UUID; v JSONB;
BEGIN
  SELECT organization_id INTO v_org FROM golive_engagements WHERE id = p_eng;
  PERFORM set_config('golive.sys_org', v_org::text, true);
  v := golive_exit_readiness(p_eng);
  PERFORM set_config('golive.sys_org', '', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN '{"all_met": false}'::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 18:00 IST cut-off (A2): missing checks → coordinator, pending reviews → engineers, digest → PM.
CREATE OR REPLACE FUNCTION golive_cutoff_jobs() RETURNS INT AS $$
DECLARE
  g RECORD; e RECORD; k RECORD; v_n INT := 0; v_today DATE := golive_ist_today();
  v_logged INT; v_expected INT; v_healthy INT; v_attention INT; v_new INT; v_closed INT; v_overdue INT;
BEGIN
  FOR g IN SELECT * FROM golive_engagements WHERE status IN ('ACTIVE','EXIT_REVIEW') AND deleted_at IS NULL LOOP
    FOR e IN
      SELECT en.id, COALESCE(di.device_code, di.serial_number) AS dev FROM golive_enrollments en
      JOIN device_instances di ON di.id = en.device_id
      WHERE en.engagement_id = g.id AND en.deleted_at IS NULL AND en.support_status = 'ACTIVE' AND en.unenrolled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM golive_daily_checks c WHERE c.enrollment_id = en.id AND c.check_date = v_today AND c.deleted_at IS NULL)
    LOOP
      PERFORM golive_notify(g.organization_id, ARRAY[golive_device_user(e.id, 'ONSITE_COORDINATOR')],
        'golive_check_missing', 'Missing check: ' || e.dev, 'No check logged today for ' || e.dev,
        '/golive/' || g.id || '?tab=checks', jsonb_build_object('enrollment_id', e.id));
    END LOOP;
    FOR k IN SELECT * FROM golive_daily_checks WHERE engagement_id = g.id AND check_date = v_today AND deleted_at IS NULL AND reviewed_complete_at IS NULL LOOP
      PERFORM golive_notify(g.organization_id,
        ARRAY[CASE WHEN k.firmware_health IS NULL THEN golive_device_user(k.enrollment_id, 'FIRMWARE_ENGINEER') END,
              CASE WHEN k.application_health IS NULL THEN golive_device_user(k.enrollment_id, 'APPLICATION_ENGINEER') END],
        'golive_review_pending', 'Review pending', 'A device check from today still needs your review',
        '/golive/' || g.id || '?tab=checks', jsonb_build_object('check_id', k.id));
    END LOOP;

    SELECT count(*) INTO v_expected FROM golive_enrollments WHERE engagement_id = g.id AND deleted_at IS NULL AND support_status = 'ACTIVE' AND unenrolled_at IS NULL;
    SELECT count(*), count(*) FILTER (WHERE daily_result = 'HEALTHY'), count(*) FILTER (WHERE daily_result = 'ATTENTION')
      INTO v_logged, v_healthy, v_attention FROM golive_daily_checks WHERE engagement_id = g.id AND check_date = v_today AND deleted_at IS NULL;
    SELECT count(*) FILTER (WHERE (reported_at AT TIME ZONE 'Asia/Kolkata')::date = v_today),
           count(*) FILTER (WHERE (closed_at AT TIME ZONE 'Asia/Kolkata')::date = v_today),
           count(*) FILTER (WHERE follow_up_flag = 'OVERDUE' AND status <> 'CLOSED')
      INTO v_new, v_closed, v_overdue FROM golive_incidents WHERE engagement_id = g.id AND deleted_at IS NULL;
    PERFORM golive_notify(g.organization_id, ARRAY[g.pm_user_id], 'golive_digest', 'Hypercare digest — ' || g.code,
      'Coverage ' || v_logged || '/' || v_expected || ' · Healthy ' || v_healthy || ' · Attention ' || v_attention
        || ' · Incidents +' || v_new || ' / closed ' || v_closed || ' · Overdue ' || v_overdue,
      '/golive/' || g.id, jsonb_build_object('engagement_id', g.id, 'date', v_today));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- cron times are UTC: 03:30 UTC = 09:00 IST, 12:30 UTC = 18:00 IST (A2).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('golive-refresh-incidents','golive-morning','golive-cutoff');
    PERFORM cron.schedule('golive-refresh-incidents', '*/15 * * * *', 'SELECT golive_refresh_incidents();');
    PERFORM cron.schedule('golive-morning', '30 3 * * *', 'SELECT golive_morning_jobs();');
    PERFORM cron.schedule('golive-cutoff', '30 12 * * *', 'SELECT golive_cutoff_jobs();');
  END IF;
END $$;

/* ═══ RLS ═══ */

ALTER TABLE golive_engagements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_roster               ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_enrollments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_daily_checks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_incidents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_incident_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_check_incident_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_events               ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS golive_engagements_select ON golive_engagements;
CREATE POLICY golive_engagements_select ON golive_engagements FOR SELECT USING (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_engagements_insert ON golive_engagements;
CREATE POLICY golive_engagements_insert ON golive_engagements FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND golive_is_manager_role());
DROP POLICY IF EXISTS golive_engagements_update ON golive_engagements;
CREATE POLICY golive_engagements_update ON golive_engagements FOR UPDATE
  USING (organization_id = current_org_id() AND golive_can_manage(id)) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_engagements_delete ON golive_engagements;
CREATE POLICY golive_engagements_delete ON golive_engagements FOR DELETE
  USING (organization_id = current_org_id() AND golive_is_admin());

-- roster + enrollments: PM-level writes
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['golive_roster','golive_enrollments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON %1$s', tbl);
    EXECUTE format('CREATE POLICY %1$s_select ON %1$s FOR SELECT USING (organization_id = current_org_id())', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON %1$s', tbl);
    EXECUTE format('CREATE POLICY %1$s_write ON %1$s FOR ALL USING (organization_id = current_org_id() AND golive_can_manage(engagement_id)) WITH CHECK (organization_id = current_org_id() AND golive_can_manage(engagement_id))', tbl);
  END LOOP;
END $$;

-- checks: anyone on the engagement; the BEFORE trigger enforces per-section rights
DROP POLICY IF EXISTS golive_daily_checks_select ON golive_daily_checks;
CREATE POLICY golive_daily_checks_select ON golive_daily_checks FOR SELECT USING (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_daily_checks_write ON golive_daily_checks;
CREATE POLICY golive_daily_checks_write ON golive_daily_checks FOR ALL
  USING (organization_id = current_org_id() AND golive_on_engagement(engagement_id))
  WITH CHECK (organization_id = current_org_id() AND golive_on_engagement(engagement_id));

-- incidents: anyone in the org can raise (support agents included); the
-- engagement team or the owner works them; close rights are in the trigger
DROP POLICY IF EXISTS golive_incidents_select ON golive_incidents;
CREATE POLICY golive_incidents_select ON golive_incidents FOR SELECT USING (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_incidents_insert ON golive_incidents;
CREATE POLICY golive_incidents_insert ON golive_incidents FOR INSERT WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_incidents_update ON golive_incidents;
CREATE POLICY golive_incidents_update ON golive_incidents FOR UPDATE
  USING (organization_id = current_org_id() AND (golive_on_engagement(engagement_id) OR assigned_owner_user_id = auth.uid()))
  WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS golive_incident_comments_select ON golive_incident_comments;
CREATE POLICY golive_incident_comments_select ON golive_incident_comments FOR SELECT USING (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_incident_comments_insert ON golive_incident_comments;
CREATE POLICY golive_incident_comments_insert ON golive_incident_comments FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND created_by = auth.uid());

DROP POLICY IF EXISTS golive_check_incident_links_select ON golive_check_incident_links;
CREATE POLICY golive_check_incident_links_select ON golive_check_incident_links FOR SELECT USING (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_check_incident_links_write ON golive_check_incident_links;
CREATE POLICY golive_check_incident_links_write ON golive_check_incident_links FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS golive_events_select ON golive_events;
CREATE POLICY golive_events_select ON golive_events FOR SELECT USING (organization_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.golive_engagements, public.golive_roster, public.golive_enrollments,
  public.golive_daily_checks, public.golive_incidents, public.golive_check_incident_links TO authenticated;
GRANT SELECT, INSERT ON public.golive_incident_comments TO authenticated;
GRANT SELECT ON public.golive_events TO authenticated;

/* ═══ Device notes & issues ═══ */

CREATE OR REPLACE FUNCTION golive_note_before() RETURNS TRIGGER AS $$
DECLARE e RECORD;
BEGIN
  SELECT engagement_id, deleted_at INTO e FROM golive_enrollments WHERE id = NEW.enrollment_id;
  IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Device is not enrolled in this engagement'; END IF;
  NEW.engagement_id := e.engagement_id;
  IF NEW.is_issue THEN
    NEW.issue_status := COALESCE(NEW.issue_status, 'OPEN');
    NEW.severity := COALESCE(NEW.severity, 'MEDIUM');
  ELSE
    NEW.issue_status := NULL; NEW.severity := NULL; NEW.issue_category := NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- anyone on the engagement can resolve / reopen an issue; only the
    -- author or the PM can change what the note says or delete it
    IF auth.uid() IS NOT NULL AND OLD.created_by IS DISTINCT FROM auth.uid() AND NOT golive_can_manage(NEW.engagement_id)
       AND (NEW.body, NEW.is_issue, NEW.issue_category, NEW.severity, NEW.deleted_at)
           IS DISTINCT FROM (OLD.body, OLD.is_issue, OLD.issue_category, OLD.severity, OLD.deleted_at) THEN
      RAISE EXCEPTION 'Only the author or the PM can edit or delete this note';
    END IF;
    IF NEW.issue_status = 'RESOLVED' AND OLD.issue_status IS DISTINCT FROM 'RESOLVED' THEN
      NEW.resolved_by := auth.uid(); NEW.resolved_at := now();
    ELSIF NEW.issue_status IS DISTINCT FROM 'RESOLVED' THEN
      NEW.resolved_by := NULL; NEW.resolved_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_device_notes_before ON golive_device_notes;
CREATE TRIGGER golive_device_notes_before BEFORE INSERT OR UPDATE ON golive_device_notes
  FOR EACH ROW EXECUTE FUNCTION golive_note_before();

-- A new issue notifies the PM + escalation owner; HIGH also the device's engineers.
CREATE OR REPLACE FUNCTION golive_note_after() RETURNS TRIGGER AS $$
DECLARE g golive_engagements; v_dev TEXT;
BEGIN
  IF NOT NEW.is_issue OR (TG_OP = 'UPDATE' AND OLD.is_issue) THEN RETURN NEW; END IF;
  SELECT * INTO g FROM golive_engagements WHERE id = NEW.engagement_id;
  SELECT COALESCE(di.device_code, di.serial_number) INTO v_dev
    FROM golive_enrollments e JOIN device_instances di ON di.id = e.device_id WHERE e.id = NEW.enrollment_id;
  PERFORM golive_notify(NEW.organization_id,
    ARRAY[g.pm_user_id, golive_role_user(g.id, 'ESCALATION_OWNER'),
          CASE WHEN NEW.severity = 'HIGH' THEN golive_device_user(NEW.enrollment_id, 'FIRMWARE_ENGINEER') END,
          CASE WHEN NEW.severity = 'HIGH' THEN golive_device_user(NEW.enrollment_id, 'APPLICATION_ENGINEER') END],
    'golive_device_issue', initcap(NEW.severity) || ' issue on ' || COALESCE(v_dev, 'device'), left(NEW.body, 200),
    '/golive/' || NEW.engagement_id || '?tab=devices&notes=' || NEW.enrollment_id, jsonb_build_object('note_id', NEW.id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_device_notes_after ON golive_device_notes;
CREATE TRIGGER golive_device_notes_after AFTER INSERT OR UPDATE ON golive_device_notes
  FOR EACH ROW EXECUTE FUNCTION golive_note_after();

ALTER TABLE golive_device_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS golive_device_notes_select ON golive_device_notes;
CREATE POLICY golive_device_notes_select ON golive_device_notes FOR SELECT USING (organization_id = current_org_id());
DROP POLICY IF EXISTS golive_device_notes_insert ON golive_device_notes;
CREATE POLICY golive_device_notes_insert ON golive_device_notes FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND created_by = auth.uid() AND golive_on_engagement(engagement_id));
DROP POLICY IF EXISTS golive_device_notes_update ON golive_device_notes;
CREATE POLICY golive_device_notes_update ON golive_device_notes FOR UPDATE
  USING (organization_id = current_org_id() AND (created_by = auth.uid() OR golive_on_engagement(engagement_id)))
  WITH CHECK (organization_id = current_org_id());
GRANT SELECT, INSERT, UPDATE ON public.golive_device_notes TO authenticated;

/* ═══ Engagement delete / reopen / resend reminders ═══ */

-- Soft delete: hides the engagement and its incidents and stops the
-- scheduled jobs; rows and timeline are kept.
CREATE OR REPLACE FUNCTION golive_delete_engagement(p_eng UUID, p_reason TEXT) RETURNS VOID AS $$
DECLARE g golive_engagements;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND organization_id = current_org_id();
  IF NOT FOUND OR g.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT (golive_is_admin() OR g.pm_user_id = auth.uid() OR golive_is_manager_role()) THEN
    RAISE EXCEPTION 'Only the PM or an admin can delete an engagement';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required to delete'; END IF;
  PERFORM set_config('golive.system', 'on', true);
  UPDATE golive_incidents SET deleted_at = now() WHERE engagement_id = p_eng AND deleted_at IS NULL;
  PERFORM set_config('golive.system', 'off', true);
  UPDATE golive_engagements SET deleted_at = now(), status_reason = 'Deleted: ' || trim(p_reason) WHERE id = p_eng;
  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes)
  VALUES (g.organization_id, p_eng, 'engagement', p_eng, 'deleted', 'Engagement deleted', jsonb_build_object('reason', p_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_delete_engagement(UUID, TEXT) TO authenticated;

-- Reopen a CLOSED / CANCELLED engagement back into ACTIVE hypercare.
CREATE OR REPLACE FUNCTION golive_reopen_engagement(p_eng UUID, p_reason TEXT, p_planned_end DATE DEFAULT NULL) RETURNS VOID AS $$
DECLARE g golive_engagements;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND organization_id = current_org_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT golive_can_manage(p_eng) THEN RAISE EXCEPTION 'Only the PM or escalation owner can reopen'; END IF;
  IF g.status NOT IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'Only a closed or cancelled engagement can be reopened'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required to reopen'; END IF;
  IF NOT EXISTS (SELECT 1 FROM golive_enrollments WHERE engagement_id = p_eng AND deleted_at IS NULL AND unenrolled_at IS NULL) THEN
    RAISE EXCEPTION 'Enroll at least one device before reopening';
  END IF;
  PERFORM set_config('golive.exit_rpc', 'on', true);
  UPDATE golive_engagements SET status = 'ACTIVE', status_reason = 'Reopened: ' || trim(p_reason),
    hypercare_actual_end = NULL,
    hypercare_planned_end = COALESCE(p_planned_end, GREATEST(hypercare_planned_end, golive_ist_today() + 7)),
    exit_submitted_by = NULL, exit_submitted_at = NULL, exit_override_comment = NULL,
    exit_decided_by = NULL, exit_decided_at = NULL, exit_decision_comment = NULL
  WHERE id = p_eng;
  PERFORM set_config('golive.exit_rpc', 'off', true);
  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes)
  VALUES (g.organization_id, p_eng, 'engagement', p_eng, 'reopened', 'Hypercare reopened', jsonb_build_object('reason', p_reason, 'from', g.status));
  PERFORM golive_notify(g.organization_id,
    ARRAY[g.pm_user_id, golive_role_user(p_eng, 'ONSITE_COORDINATOR'), golive_role_user(p_eng, 'FIRMWARE_ENGINEER'),
          golive_role_user(p_eng, 'APPLICATION_ENGINEER'), golive_role_user(p_eng, 'ESCALATION_OWNER')],
    'golive_reopened', 'Hypercare reopened: ' || g.code, p_reason, '/golive/' || p_eng, jsonb_build_object('engagement_id', p_eng));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_reopen_engagement(UUID, TEXT, DATE) TO authenticated;

-- Re-send today's reminders on demand: missing checks → coordinators,
-- pending reviews → engineers, stuck incidents → owners. Returns how many
-- reminders were sent.
CREATE OR REPLACE FUNCTION golive_resend_reminders(p_eng UUID) RETURNS INT AS $$
DECLARE
  g golive_engagements; r RECORD; v_n INT := 0; v_today DATE := golive_ist_today();
  v_link TEXT := '/golive/' || p_eng;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND organization_id = current_org_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT golive_can_manage(p_eng) THEN RAISE EXCEPTION 'Only the PM or escalation owner can send reminders'; END IF;
  IF g.status NOT IN ('ACTIVE','EXIT_REVIEW') THEN RAISE EXCEPTION 'Reminders can only be sent while hypercare is active'; END IF;

  FOR r IN
    SELECT golive_device_user(e.id, 'ONSITE_COORDINATOR') AS uid, count(*) AS n FROM golive_enrollments e
    WHERE e.engagement_id = p_eng AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL AND e.support_status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM golive_daily_checks k WHERE k.enrollment_id = e.id AND k.check_date = v_today AND k.deleted_at IS NULL)
    GROUP BY 1
  LOOP
    CONTINUE WHEN r.uid IS NULL OR r.uid = auth.uid();
    PERFORM golive_notify(g.organization_id, ARRAY[r.uid], 'golive_checks_due', 'Reminder: device checks — ' || g.code,
      r.n || ' device(s) still to check today', v_link || '?tab=checks', jsonb_build_object('engagement_id', p_eng, 'resend', true));
    v_n := v_n + 1;
  END LOOP;

  FOR r IN
    SELECT uid, count(*) AS n FROM (
      SELECT golive_device_user(k.enrollment_id, 'FIRMWARE_ENGINEER') AS uid FROM golive_daily_checks k
       WHERE k.engagement_id = p_eng AND k.check_date = v_today AND k.deleted_at IS NULL AND k.firmware_health IS NULL
      UNION ALL
      SELECT golive_device_user(k.enrollment_id, 'APPLICATION_ENGINEER') FROM golive_daily_checks k
       WHERE k.engagement_id = p_eng AND k.check_date = v_today AND k.deleted_at IS NULL AND k.application_health IS NULL
    ) x GROUP BY uid
  LOOP
    CONTINUE WHEN r.uid IS NULL OR r.uid = auth.uid();
    PERFORM golive_notify(g.organization_id, ARRAY[r.uid], 'golive_review_pending', 'Reminder: reviews pending — ' || g.code,
      r.n || ' check review(s) waiting for you today', v_link || '?tab=checks', jsonb_build_object('engagement_id', p_eng, 'resend', true));
    v_n := v_n + 1;
  END LOOP;

  FOR r IN
    SELECT i.id, i.number, i.title, i.next_action, COALESCE(i.assigned_owner_user_id, golive_role_user(p_eng, 'ESCALATION_OWNER')) AS uid
    FROM golive_incidents i
    WHERE i.engagement_id = p_eng AND i.deleted_at IS NULL AND i.status NOT IN ('RESOLVED','CLOSED')
      AND (i.acknowledged_at IS NULL OR golive_compute_follow_up_flag(i, now()) IN ('OVERDUE','COMPLETE_TICKET'))
  LOOP
    CONTINUE WHEN r.uid IS NULL OR r.uid = auth.uid();
    PERFORM golive_notify(g.organization_id, ARRAY[r.uid], 'golive_incident_reminder', 'Reminder: ' || r.number,
      COALESCE(r.next_action, r.title), v_link || '?tab=incidents&incident=' || r.id, jsonb_build_object('incident_id', r.id, 'resend', true));
    v_n := v_n + 1;
  END LOOP;

  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes)
  VALUES (g.organization_id, p_eng, 'engagement', p_eng, 'reminders_sent', v_n || ' reminder(s) re-sent', '{}');
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_resend_reminders(UUID) TO authenticated;

/* ═══ Evidence storage (private; org-folder scoped, signed URLs) ═══ */

INSERT INTO storage.buckets (id, name, public) VALUES ('golive-evidence', 'golive-evidence', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS golive_evidence_select ON storage.objects;
DROP POLICY IF EXISTS golive_evidence_insert ON storage.objects;
DROP POLICY IF EXISTS golive_evidence_delete ON storage.objects;
CREATE POLICY golive_evidence_select ON storage.objects FOR SELECT USING (
  bucket_id = 'golive-evidence' AND (storage.foldername(name))[1] = current_org_id()::text);
CREATE POLICY golive_evidence_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'golive-evidence' AND (storage.foldername(name))[1] = current_org_id()::text);
CREATE POLICY golive_evidence_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'golive-evidence' AND (storage.foldername(name))[1] = current_org_id()::text);

/* ═══ Module registry + billing ═══ */

INSERT INTO modules (organization_id, key, label)
SELECT o.id, 'golive-support', 'Go-Live Support' FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM modules m WHERE m.organization_id = o.id AND m.key = 'golive-support');

UPDATE billing_bundles
SET module_keys = module_keys || '["golive-support"]'::jsonb
WHERE key = 'procurement_inventory' AND NOT (module_keys ? 'golive-support');

NOTIFY pgrst, 'reload schema';

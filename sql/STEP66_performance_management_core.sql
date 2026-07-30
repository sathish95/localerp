-- ============================================================
-- STEP66: Performance Management Module — core schema
-- (goal-setting, self-appraisal, 360 feedback, manager review,
--  calibration, final rating, development plan, dashboard rollup)
--
-- Design notes, matching this codebase's established conventions:
--
-- * Reuses existing entities directly — profiles.reporting_manager_id,
--   employment_type, date_joined (STEP29), employee_skills/skills (STEP29),
--   allocations + capacity_snapshots (STEP29/30), departments, projects.
--   Nothing here duplicates those; it references them (soft refs by
--   convention, except where the target is stable/pre-existing, matching
--   proposal_vendor_costs.vendor_id's precedent).
--
-- * "AllocationEffectiveness" does not exist anywhere in this app today —
--   confirmed the closest real signal is capacity_snapshots.utilization_percent
--   (see src/lib/resourceFlow.js). Per stakeholder decision, the composite
--   score's objective/system-tracked component uses utilization_percent
--   directly rather than inventing a new unproven "effectiveness" formula.
--
-- * Rating scale is BANDED text throughout (Unsatisfactory / Needs
--   Improvement / Meets Expectations / Exceeds Expectations) — matches
--   the "banded only" stakeholder decision. A numeric mapping (1-4) is
--   applied only in application code (src/lib/performance.js) for
--   averaging/composite math and trend charts — never stored as a raw
--   number, so the UI never has to translate a number back into a label.
--
-- * Calibration is OPTIONAL per cycle (performance_cycles.calibration_required,
--   HR-toggled), not mandatory — per stakeholder decision.
--
-- * This is a STAGE-STATUS model (one row per employee per cycle per
--   stage, explicit status columns), not a bolt-on to the generic
--   approval_chains/approval_chain_steps engine (STEP48) — that engine
--   models a single linear sequential sign-off; this module's shape is
--   parallel 360-feedback fan-out + independent per-employee manager
--   review + optional department-wide calibration, which doesn't fit
--   that shape. Matches this app's existing precedent of timesheet_approvals
--   using its own explicit per-level columns rather than the shared chain engine.
--
-- * RLS follows this app's DOMINANT convention (see STEP29/STEP30: blanket
--   auth.uid() IS NOT NULL, role-gating done client-side via the
--   isAdmin/isManager/isHR helpers documented in CLAUDE.md) for every
--   table EXCEPT feedback_requests/peer_feedback. Anonymous peer feedback
--   identity protection is called out as a hard, explicit requirement
--   that must be enforced server-side, not just client-side — so those
--   two tables get real row-level restriction, and subject/manager reads
--   of feedback content go through a SECURITY DEFINER function
--   (get_peer_feedback below) that redacts provider identity when
--   is_anonymous = true, the same pattern this codebase already uses for
--   save_proposal_version()/save_bom_version() (a definer function is the
--   unambiguous way to get this right, vs. relying on view/RLS interaction
--   subtleties that are hard to verify without a live service-role session).
--
-- * Goal.weight_percent summing to 100% per employee per cycle is
--   validated in application code (lib/performance.js), not a DB
--   constraint — goals are entered one at a time and a partial state
--   (60% allocated, more still being added) is normal mid-entry, same
--   reasoning as proposal_cost_sections not enforcing category totals in SQL.
--
-- Run after STEP29 (profiles reporting line + skills), STEP30 (capacity_snapshots).
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── Helper functions (reused across RLS policies + the redaction function) ──
CREATE OR REPLACE FUNCTION is_hr_admin_ceo() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('hr','admin','ceo'));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_manager_of(p_employee_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_employee_id AND reporting_manager_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── 1. PERFORMANCE CYCLES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_cycles (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_name            TEXT        NOT NULL,   -- e.g. "Q3 FY26"
  cycle_type            TEXT        NOT NULL CHECK (cycle_type IN ('Quarterly','Half-Yearly','Annual')),
  start_date            DATE        NOT NULL,
  end_date              DATE        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'Planning' CHECK (status IN (
                          'Planning','Goal-Setting Open','In Progress','Feedback Open',
                          'Manager Review','Calibration','Closed'
                        )),
  calibration_required  BOOLEAN     NOT NULL DEFAULT false,  -- HR toggle — calibration stage is optional per cycle
  created_by            UUID        REFERENCES profiles(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS performance_cycles_status_idx ON performance_cycles(status);
DROP TRIGGER IF EXISTS performance_cycles_updated_at ON performance_cycles;
CREATE TRIGGER performance_cycles_updated_at BEFORE UPDATE ON performance_cycles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. COMPOSITE SCORE WEIGHTS (singleton settings row — HR-editable, not hardcoded) ──
CREATE TABLE IF NOT EXISTS performance_score_weights (
  id                              INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  goal_achievement_weight_percent NUMERIC(5,2) NOT NULL DEFAULT 60,
  manager_rating_weight_percent   NUMERIC(5,2) NOT NULL DEFAULT 30,
  utilization_weight_percent      NUMERIC(5,2) NOT NULL DEFAULT 10,  -- objective/system-tracked signal, per stakeholder decision
  updated_by                     UUID        REFERENCES profiles(id),
  updated_at                     TIMESTAMPTZ DEFAULT now()
);
INSERT INTO performance_score_weights (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
DROP TRIGGER IF EXISTS performance_score_weights_updated_at ON performance_score_weights;
CREATE TRIGGER performance_score_weights_updated_at BEFORE UPDATE ON performance_score_weights
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. GOALS (per employee, per cycle) ────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       UUID          NOT NULL REFERENCES profiles(id),
  cycle_id          UUID          NOT NULL REFERENCES performance_cycles(id),
  goal_title        TEXT          NOT NULL,
  description       TEXT,
  weight_percent    NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (weight_percent >= 0 AND weight_percent <= 100),
  linked_project_id UUID          REFERENCES projects(id),   -- ties a goal to actual tracked project work
  target_metric     TEXT,
  status            TEXT          NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started','In Progress','Completed','Missed')),
  self_rating       TEXT          CHECK (self_rating IS NULL OR self_rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  manager_rating    TEXT          CHECK (manager_rating IS NULL OR manager_rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  created_at        TIMESTAMPTZ   DEFAULT now(),
  updated_at        TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goals_employee_cycle_idx ON goals(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS goals_cycle_idx ON goals(cycle_id);
DROP TRIGGER IF EXISTS goals_updated_at ON goals;
CREATE TRIGGER goals_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. SELF APPRAISAL ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_appraisals (
  id                   UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id          UUID          NOT NULL REFERENCES profiles(id),
  cycle_id             UUID          NOT NULL REFERENCES performance_cycles(id),
  key_achievements     TEXT,
  challenges_faced     TEXT,
  skills_developed     TEXT,                     -- free-text summary
  skill_ids            UUID[]        DEFAULT '{}', -- soft ref -> employee_skills.id rows touched this cycle
  self_overall_rating  TEXT          CHECK (self_overall_rating IS NULL OR self_overall_rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  submitted_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   DEFAULT now(),
  updated_at           TIMESTAMPTZ   DEFAULT now(),
  UNIQUE (employee_id, cycle_id)
);
DROP TRIGGER IF EXISTS self_appraisals_updated_at ON self_appraisals;
CREATE TRIGGER self_appraisals_updated_at BEFORE UPDATE ON self_appraisals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. FEEDBACK REQUESTS (360-degree fan-out) ─────────────────
CREATE TABLE IF NOT EXISTS feedback_requests (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id              UUID        NOT NULL REFERENCES performance_cycles(id),
  subject_employee_id   UUID        NOT NULL REFERENCES profiles(id),   -- the person being reviewed
  feedback_provider_id  UUID        NOT NULL REFERENCES profiles(id),   -- peer/colleague giving feedback
  requested_by          UUID        NOT NULL REFERENCES profiles(id),
  status                TEXT        NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Submitted','Declined')),
  is_anonymous          BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_requests_subject_idx  ON feedback_requests(subject_employee_id);
CREATE INDEX IF NOT EXISTS feedback_requests_provider_idx ON feedback_requests(feedback_provider_id);
CREATE INDEX IF NOT EXISTS feedback_requests_cycle_idx    ON feedback_requests(cycle_id);

-- ── 6. PEER FEEDBACK ───────────────────────────────────────────
-- rating is nullable — numeric peer rating is optional per stakeholder
-- framing (avoid turning peer feedback into a popularity-driven number);
-- HR/the requester can choose whether to ask for it in the UI, schema
-- just doesn't force it either way.
CREATE TABLE IF NOT EXISTS peer_feedback (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_request_id       UUID          NOT NULL REFERENCES feedback_requests(id) UNIQUE,
  strengths_noted           TEXT,
  improvement_areas_noted   TEXT,
  rating                    TEXT          CHECK (rating IS NULL OR rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  submitted_at              TIMESTAMPTZ   DEFAULT now()
);

-- ── 7. MANAGER REVIEW ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manager_reviews (
  id                      UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id             UUID          NOT NULL REFERENCES profiles(id),
  cycle_id                UUID          NOT NULL REFERENCES performance_cycles(id),
  reviewer_id             UUID          NOT NULL REFERENCES profiles(id),
  strengths               TEXT,
  improvement_areas       TEXT,
  goal_ratings_summary    JSONB         NOT NULL DEFAULT '[]',  -- rollup snapshot of Goal.manager_rating at submit time
  overall_rating          TEXT          CHECK (overall_rating IS NULL OR overall_rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  promotion_recommendation BOOLEAN,
  submitted_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ   DEFAULT now(),
  updated_at              TIMESTAMPTZ   DEFAULT now(),
  UNIQUE (employee_id, cycle_id)
);
DROP TRIGGER IF EXISTS manager_reviews_updated_at ON manager_reviews;
CREATE TRIGGER manager_reviews_updated_at BEFORE UPDATE ON manager_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 8. CALIBRATION ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calibration_sessions (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id       UUID          NOT NULL REFERENCES performance_cycles(id),
  department_id  UUID          REFERENCES departments(id),
  participants   UUID[]        DEFAULT '{}',   -- HR + department managers (profiles.id)
  notes          TEXT,
  status         TEXT          NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Completed')),
  created_by     UUID          REFERENCES profiles(id),
  created_at     TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_sessions_cycle_idx ON calibration_sessions(cycle_id);

CREATE TABLE IF NOT EXISTS calibration_adjustments (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  calibration_session_id    UUID          NOT NULL REFERENCES calibration_sessions(id),
  employee_id               UUID          NOT NULL REFERENCES profiles(id),
  cycle_id                  UUID          NOT NULL REFERENCES performance_cycles(id),
  original_manager_rating   TEXT          NOT NULL CHECK (original_manager_rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  calibrated_final_rating   TEXT          NOT NULL CHECK (calibrated_final_rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  adjustment_reason         TEXT          NOT NULL,   -- required — "why did my rating change" must always have an answer
  adjusted_by               UUID          REFERENCES profiles(id),
  adjusted_at               TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_adjustments_employee_cycle_idx ON calibration_adjustments(employee_id, cycle_id);

-- ── 9. FINAL RATING (settled outcome per employee per cycle) ──
CREATE TABLE IF NOT EXISTS final_ratings (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id    UUID          NOT NULL REFERENCES profiles(id),
  cycle_id       UUID          NOT NULL REFERENCES performance_cycles(id),
  final_rating   TEXT          NOT NULL CHECK (final_rating IN ('Unsatisfactory','Needs Improvement','Meets Expectations','Exceeds Expectations')),
  rating_source  TEXT          NOT NULL CHECK (rating_source IN ('Manager Direct','Calibrated')),
  finalized_at   TIMESTAMPTZ   DEFAULT now(),
  finalized_by   UUID          REFERENCES profiles(id),
  UNIQUE (employee_id, cycle_id)
);
CREATE INDEX IF NOT EXISTS final_ratings_cycle_idx ON final_ratings(cycle_id);

-- ── 10. DEVELOPMENT PLAN ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS development_plans (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id         UUID          NOT NULL REFERENCES profiles(id),
  cycle_id            UUID          NOT NULL REFERENCES performance_cycles(id),
  improvement_area    TEXT          NOT NULL,
  recommended_action  TEXT,
  target_date         DATE,
  linked_skill_id     UUID          REFERENCES skills(id),   -- ties the improvement to the Skill Matrix catalog
  status              TEXT          NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Achieved','Not Achieved')),
  created_at          TIMESTAMPTZ   DEFAULT now(),
  updated_at          TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS development_plans_employee_cycle_idx ON development_plans(employee_id, cycle_id);
DROP TRIGGER IF EXISTS development_plans_updated_at ON development_plans;
CREATE TRIGGER development_plans_updated_at BEFORE UPDATE ON development_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 11. PERFORMANCE SCORE (cached rollup — powers the dashboard) ──
-- Recomputed by recompute_performance_score() below whenever an input
-- changes (goal rating, final rating, utilization data, skill growth) —
-- never computed live on dashboard load, per the non-functional requirement.
CREATE TABLE IF NOT EXISTS performance_scores (
  id                       UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id              UUID          NOT NULL REFERENCES profiles(id),
  cycle_id                 UUID          NOT NULL REFERENCES performance_cycles(id),
  goal_achievement_score   NUMERIC(6,2)  DEFAULT 0,   -- weighted average of Goal.manager_rating (banded->numeric), 0-100
  self_manager_rating_gap  NUMERIC(6,2)  DEFAULT 0,   -- self band value minus manager band value (signed)
  utilization_percent      NUMERIC(6,2)  DEFAULT 0,   -- avg capacity_snapshots.utilization_percent over the cycle window
  skill_growth_count       INT           DEFAULT 0,   -- employee_skills rows updated during the cycle window
  final_rating             TEXT,                       -- denormalized copy of final_ratings.final_rating
  composite_score          NUMERIC(6,2)  DEFAULT 0,   -- weighted blend per performance_score_weights
  computed_at              TIMESTAMPTZ   DEFAULT now(),
  UNIQUE (employee_id, cycle_id)
);
CREATE INDEX IF NOT EXISTS performance_scores_cycle_idx ON performance_scores(cycle_id);

-- ── 12. ANONYMOUS-FEEDBACK-SAFE READ PATH ─────────────────────
-- SECURITY DEFINER so the redaction logic is enforced regardless of who
-- calls it or how — the subject/manager NEVER receive feedback_provider_id
-- or the provider's name when is_anonymous = true, only HR/admin/ceo do.
CREATE OR REPLACE FUNCTION get_peer_feedback(p_subject_employee_id UUID, p_cycle_id UUID)
RETURNS TABLE (
  id UUID, feedback_request_id UUID, is_anonymous BOOLEAN,
  strengths_noted TEXT, improvement_areas_noted TEXT, rating TEXT, submitted_at TIMESTAMPTZ,
  provider_id UUID, provider_name TEXT, request_status TEXT
) AS $$
BEGIN
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
  WHERE fr.subject_employee_id = p_subject_employee_id AND fr.cycle_id = p_cycle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_peer_feedback(UUID, UUID) TO authenticated;

-- ── 13. recompute_performance_score() — the cached-rollup writer ─────
-- SECURITY DEFINER so managers (who can't directly write performance_scores,
-- see RLS below) can still trigger a recompute after submitting their review.
CREATE OR REPLACE FUNCTION recompute_performance_score(p_employee_id UUID, p_cycle_id UUID)
RETURNS UUID AS $$
DECLARE
  v_cycle              performance_cycles%ROWTYPE;
  v_weights            performance_score_weights%ROWTYPE;
  v_goal_score         NUMERIC := 0;
  v_total_weight       NUMERIC := 0;
  v_self_gap           NUMERIC := 0;
  v_self_band          NUMERIC;
  v_manager_band       NUMERIC;
  v_utilization        NUMERIC := 0;
  v_skill_growth       INT := 0;
  v_final_rating       TEXT;
  v_composite          NUMERIC := 0;
  v_id                 UUID;
BEGIN
  IF NOT (auth.uid() = p_employee_id OR is_manager_of(p_employee_id) OR is_hr_admin_ceo()) THEN
    RAISE EXCEPTION 'Not authorized to recompute this employee''s performance score';
  END IF;

  SELECT * INTO v_cycle FROM performance_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  SELECT * INTO v_weights FROM performance_score_weights WHERE id = 1;

  -- Goal achievement: weighted average of Goal.manager_rating (band -> 1..4 -> 0..100 scale)
  SELECT
    COALESCE(SUM(weight_percent * (
      CASE manager_rating
        WHEN 'Unsatisfactory' THEN 1 WHEN 'Needs Improvement' THEN 2
        WHEN 'Meets Expectations' THEN 3 WHEN 'Exceeds Expectations' THEN 4 ELSE NULL END
    )), 0),
    COALESCE(SUM(weight_percent) FILTER (WHERE manager_rating IS NOT NULL), 0)
  INTO v_goal_score, v_total_weight
  FROM goals WHERE employee_id = p_employee_id AND cycle_id = p_cycle_id;
  IF v_total_weight > 0 THEN v_goal_score := (v_goal_score / v_total_weight / 4) * 100; ELSE v_goal_score := 0; END IF;

  -- Self vs manager rating gap (self_appraisals.self_overall_rating vs manager_reviews.overall_rating)
  SELECT CASE self_overall_rating WHEN 'Unsatisfactory' THEN 1 WHEN 'Needs Improvement' THEN 2 WHEN 'Meets Expectations' THEN 3 WHEN 'Exceeds Expectations' THEN 4 END
    INTO v_self_band FROM self_appraisals WHERE employee_id = p_employee_id AND cycle_id = p_cycle_id;
  SELECT CASE overall_rating WHEN 'Unsatisfactory' THEN 1 WHEN 'Needs Improvement' THEN 2 WHEN 'Meets Expectations' THEN 3 WHEN 'Exceeds Expectations' THEN 4 END
    INTO v_manager_band FROM manager_reviews WHERE employee_id = p_employee_id AND cycle_id = p_cycle_id;
  v_self_gap := COALESCE(v_self_band, 0) - COALESCE(v_manager_band, 0);

  -- Utilization: average of capacity_snapshots.utilization_percent within the cycle window
  SELECT COALESCE(AVG(utilization_percent), 0) INTO v_utilization
  FROM capacity_snapshots WHERE employee_id = p_employee_id
    AND week_start_date >= v_cycle.start_date AND week_start_date <= v_cycle.end_date;

  -- Skill growth: employee_skills rows touched within the cycle window
  SELECT COUNT(*) INTO v_skill_growth FROM employee_skills
    WHERE employee_id = p_employee_id AND last_updated >= v_cycle.start_date AND last_updated <= (v_cycle.end_date + INTERVAL '1 day');

  SELECT fr.final_rating INTO v_final_rating FROM final_ratings fr WHERE fr.employee_id = p_employee_id AND fr.cycle_id = p_cycle_id;

  v_composite :=
    v_goal_score * (v_weights.goal_achievement_weight_percent / 100) +
    (COALESCE(v_manager_band, 0) / 4 * 100) * (v_weights.manager_rating_weight_percent / 100) +
    LEAST(v_utilization, 100) * (v_weights.utilization_weight_percent / 100);

  INSERT INTO performance_scores (employee_id, cycle_id, goal_achievement_score, self_manager_rating_gap, utilization_percent, skill_growth_count, final_rating, composite_score, computed_at)
  VALUES (p_employee_id, p_cycle_id, ROUND(v_goal_score,2), v_self_gap, ROUND(v_utilization,2), v_skill_growth, v_final_rating, ROUND(v_composite,2), now())
  ON CONFLICT (employee_id, cycle_id) DO UPDATE SET
    goal_achievement_score = EXCLUDED.goal_achievement_score, self_manager_rating_gap = EXCLUDED.self_manager_rating_gap,
    utilization_percent = EXCLUDED.utilization_percent, skill_growth_count = EXCLUDED.skill_growth_count,
    final_rating = EXCLUDED.final_rating, composite_score = EXCLUDED.composite_score, computed_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION recompute_performance_score(UUID, UUID) TO authenticated;

-- ── 14. ROW LEVEL SECURITY ────────────────────────────────────
ALTER TABLE performance_cycles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_score_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE self_appraisals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_reviews           ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_adjustments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE final_ratings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE development_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_scores        ENABLE ROW LEVEL SECURITY;

-- Cycles + weights: blanket read (matches app convention), HR/admin/ceo write.
CREATE POLICY performance_cycles_select ON performance_cycles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY performance_cycles_write  ON performance_cycles FOR ALL USING (is_hr_admin_ceo()) WITH CHECK (is_hr_admin_ceo());
CREATE POLICY performance_score_weights_select ON performance_score_weights FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY performance_score_weights_write  ON performance_score_weights FOR ALL USING (is_hr_admin_ceo()) WITH CHECK (is_hr_admin_ceo());

-- Goals: blanket read (dashboards/cto need company-wide visibility); write limited
-- to the employee themselves, their manager, or HR/admin/ceo.
CREATE POLICY goals_select ON goals FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY goals_write  ON goals FOR ALL
  USING (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo())
  WITH CHECK (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo());

-- Self-appraisal: blanket read; only the employee (or HR override) writes their own.
CREATE POLICY self_appraisals_select ON self_appraisals FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY self_appraisals_write  ON self_appraisals FOR ALL
  USING (employee_id = auth.uid() OR is_hr_admin_ceo()) WITH CHECK (employee_id = auth.uid() OR is_hr_admin_ceo());

-- Feedback requests + peer feedback: the ONE deliberate exception to blanket
-- read in this module — direct table access is restricted to the provider
-- and HR/admin/ceo; subject/manager reads MUST go through get_peer_feedback()
-- above, which enforces the anonymity redaction server-side.
CREATE POLICY feedback_requests_select ON feedback_requests FOR SELECT
  USING (feedback_provider_id = auth.uid() OR requested_by = auth.uid() OR is_hr_admin_ceo());
CREATE POLICY feedback_requests_insert ON feedback_requests FOR INSERT
  WITH CHECK (requested_by = auth.uid() OR is_hr_admin_ceo());
CREATE POLICY feedback_requests_update ON feedback_requests FOR UPDATE
  USING (feedback_provider_id = auth.uid() OR is_hr_admin_ceo())
  WITH CHECK (feedback_provider_id = auth.uid() OR is_hr_admin_ceo());

CREATE POLICY peer_feedback_select ON peer_feedback FOR SELECT
  USING (
    is_hr_admin_ceo() OR
    EXISTS (SELECT 1 FROM feedback_requests fr WHERE fr.id = peer_feedback.feedback_request_id AND fr.feedback_provider_id = auth.uid())
  );
CREATE POLICY peer_feedback_insert ON peer_feedback FOR INSERT
  WITH CHECK (
    is_hr_admin_ceo() OR
    EXISTS (SELECT 1 FROM feedback_requests fr WHERE fr.id = peer_feedback.feedback_request_id AND fr.feedback_provider_id = auth.uid())
  );

-- Manager review: blanket read (employee should be able to see their own
-- finished review; dashboards need cross-employee visibility); write
-- limited to the assigned reviewer or HR/admin/ceo.
CREATE POLICY manager_reviews_select ON manager_reviews FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY manager_reviews_write  ON manager_reviews FOR ALL
  USING (reviewer_id = auth.uid() OR is_hr_admin_ceo()) WITH CHECK (reviewer_id = auth.uid() OR is_hr_admin_ceo());

-- Calibration: HR/admin/ceo only, both read and write (department managers
-- see their own session via the app querying by department_id server-side,
-- but the raw table stays HR/leadership-scoped since this is inherently a
-- cross-employee, rating-adjustment-authoring surface).
CREATE POLICY calibration_sessions_all     ON calibration_sessions    FOR ALL USING (is_hr_admin_ceo()) WITH CHECK (is_hr_admin_ceo());
CREATE POLICY calibration_adjustments_all  ON calibration_adjustments FOR ALL USING (is_hr_admin_ceo()) WITH CHECK (is_hr_admin_ceo());

-- Final rating + development plan + performance scores: blanket read
-- (employee views their own, dashboards need company-wide); write limited
-- to HR/admin/ceo for final ratings, employee/manager/HR for dev plans,
-- and manager/HR for the cached score rollup (written mainly via the
-- recompute_performance_score() definer function above).
-- Write also allows is_manager_of(employee_id) — a manager can lock a
-- Final Rating directly (rating_source='Manager Direct') for their own
-- direct report when the cycle doesn't require calibration; HR/admin/ceo
-- always can (both direct locks and calibration-driven ones).
CREATE POLICY final_ratings_select ON final_ratings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY final_ratings_write  ON final_ratings FOR ALL
  USING (is_manager_of(employee_id) OR is_hr_admin_ceo()) WITH CHECK (is_manager_of(employee_id) OR is_hr_admin_ceo());

CREATE POLICY development_plans_select ON development_plans FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY development_plans_write  ON development_plans FOR ALL
  USING (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo())
  WITH CHECK (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo());

CREATE POLICY performance_scores_select ON performance_scores FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY performance_scores_write  ON performance_scores FOR ALL
  USING (is_manager_of(employee_id) OR is_hr_admin_ceo()) WITH CHECK (is_manager_of(employee_id) OR is_hr_admin_ceo());

-- ── 15. GRANTS (RLS alone is not enough — base table privileges required too) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_cycles        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_score_weights TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals                     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.self_appraisals           TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.feedback_requests         TO authenticated;
GRANT SELECT, INSERT                 ON public.peer_feedback             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manager_reviews           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calibration_sessions      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calibration_adjustments   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.final_ratings             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.development_plans         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_scores        TO authenticated;

NOTIFY pgrst, 'reload schema';

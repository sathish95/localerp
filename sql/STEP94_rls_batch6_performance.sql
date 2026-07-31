-- ============================================================
-- STEP94: Multi-tenant RLS retrofit — Batch 6 (Performance
-- Management, STEP66/67).
--
-- Fully self-contained tracked module — 12 tables, all created in
-- STEP66, no dependency on any untracked table. Reuses is_hr_admin_ceo()
-- / is_manager_of() (STEP66) inside every rewritten policy, adding
-- organization_id = current_org_id() alongside rather than replacing
-- them, matching the plan's "adapt, don't duplicate" call for this
-- batch.
--
-- Two SECURITY DEFINER RPCs in this module (get_peer_feedback,
-- recompute_performance_score) bypass RLS entirely by design (that's
-- why they're SECURITY DEFINER) — org-scoping the underlying tables
-- alone does NOT stop them from being called with a cross-org
-- employee_id/cycle_id. Both get an explicit organization check added
-- at the top of their body.
--
-- performance_score_weights was a hardcoded singleton (`id INT PRIMARY
-- KEY DEFAULT 1 CHECK (id=1)`) — same structural problem as
-- capacity_settings in STEP90, same fix: one row per org, PK'd by
-- organization_id, plus the matching src/lib/performance.js fix (two
-- call sites queried it by id=1).
-- ============================================================

-- ── organization_id on all 12 tables ──
ALTER TABLE performance_cycles ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE performance_cycles SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE performance_cycles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE performance_cycles ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE goals ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE goals SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE goals ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE goals ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE self_appraisals ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE self_appraisals SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE self_appraisals ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE self_appraisals ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE feedback_requests ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE feedback_requests SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE feedback_requests ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE feedback_requests ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE peer_feedback ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE peer_feedback SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE peer_feedback ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE peer_feedback ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE manager_reviews ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE manager_reviews SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE manager_reviews ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE manager_reviews ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE calibration_sessions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE calibration_sessions SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE calibration_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE calibration_sessions ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE calibration_adjustments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE calibration_adjustments SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE calibration_adjustments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE calibration_adjustments ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE final_ratings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE final_ratings SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE final_ratings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE final_ratings ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE development_plans ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE development_plans SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE development_plans ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE development_plans ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE performance_scores SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE performance_scores ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE performance_scores ALTER COLUMN organization_id SET DEFAULT current_org_id();

-- ── performance_score_weights: singleton -> per-org redesign ──
ALTER TABLE performance_score_weights ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE performance_score_weights SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE performance_score_weights ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE performance_score_weights DROP CONSTRAINT IF EXISTS performance_score_weights_pkey;
ALTER TABLE performance_score_weights DROP CONSTRAINT IF EXISTS performance_score_weights_id_check;
ALTER TABLE performance_score_weights DROP CONSTRAINT IF EXISTS performance_score_weights_org_pkey;
ALTER TABLE performance_score_weights ADD CONSTRAINT performance_score_weights_org_pkey PRIMARY KEY (organization_id);
ALTER TABLE performance_score_weights DROP COLUMN IF EXISTS id;

-- ── policies: adapt existing ones, add organization_id = current_org_id() ──
DROP POLICY IF EXISTS performance_cycles_select ON performance_cycles;
DROP POLICY IF EXISTS performance_cycles_write  ON performance_cycles;
CREATE POLICY performance_cycles_select ON performance_cycles FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY performance_cycles_write  ON performance_cycles FOR ALL USING (organization_id = current_org_id() AND is_hr_admin_ceo()) WITH CHECK (organization_id = current_org_id() AND is_hr_admin_ceo());

DROP POLICY IF EXISTS performance_score_weights_select ON performance_score_weights;
DROP POLICY IF EXISTS performance_score_weights_write  ON performance_score_weights;
CREATE POLICY performance_score_weights_select ON performance_score_weights FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY performance_score_weights_write  ON performance_score_weights FOR ALL USING (organization_id = current_org_id() AND is_hr_admin_ceo()) WITH CHECK (organization_id = current_org_id() AND is_hr_admin_ceo());

DROP POLICY IF EXISTS goals_select ON goals;
DROP POLICY IF EXISTS goals_write  ON goals;
CREATE POLICY goals_select ON goals FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY goals_write  ON goals FOR ALL
  USING (organization_id = current_org_id() AND (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()))
  WITH CHECK (organization_id = current_org_id() AND (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()));

DROP POLICY IF EXISTS self_appraisals_select ON self_appraisals;
DROP POLICY IF EXISTS self_appraisals_write  ON self_appraisals;
CREATE POLICY self_appraisals_select ON self_appraisals FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY self_appraisals_write  ON self_appraisals FOR ALL
  USING (organization_id = current_org_id() AND (employee_id = auth.uid() OR is_hr_admin_ceo()))
  WITH CHECK (organization_id = current_org_id() AND (employee_id = auth.uid() OR is_hr_admin_ceo()));

DROP POLICY IF EXISTS feedback_requests_select ON feedback_requests;
DROP POLICY IF EXISTS feedback_requests_insert ON feedback_requests;
DROP POLICY IF EXISTS feedback_requests_update ON feedback_requests;
CREATE POLICY feedback_requests_select ON feedback_requests FOR SELECT
  USING (organization_id = current_org_id() AND (feedback_provider_id = auth.uid() OR requested_by = auth.uid() OR is_hr_admin_ceo()));
CREATE POLICY feedback_requests_insert ON feedback_requests FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND (requested_by = auth.uid() OR is_hr_admin_ceo()));
CREATE POLICY feedback_requests_update ON feedback_requests FOR UPDATE
  USING (organization_id = current_org_id() AND (feedback_provider_id = auth.uid() OR is_hr_admin_ceo()))
  WITH CHECK (organization_id = current_org_id() AND (feedback_provider_id = auth.uid() OR is_hr_admin_ceo()));

DROP POLICY IF EXISTS peer_feedback_select ON peer_feedback;
DROP POLICY IF EXISTS peer_feedback_insert ON peer_feedback;
CREATE POLICY peer_feedback_select ON peer_feedback FOR SELECT
  USING (
    organization_id = current_org_id() AND (
      is_hr_admin_ceo() OR
      EXISTS (SELECT 1 FROM feedback_requests fr WHERE fr.id = peer_feedback.feedback_request_id AND fr.feedback_provider_id = auth.uid())
    )
  );
CREATE POLICY peer_feedback_insert ON peer_feedback FOR INSERT
  WITH CHECK (
    organization_id = current_org_id() AND (
      is_hr_admin_ceo() OR
      EXISTS (SELECT 1 FROM feedback_requests fr WHERE fr.id = peer_feedback.feedback_request_id AND fr.feedback_provider_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS manager_reviews_select ON manager_reviews;
DROP POLICY IF EXISTS manager_reviews_write  ON manager_reviews;
CREATE POLICY manager_reviews_select ON manager_reviews FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY manager_reviews_write  ON manager_reviews FOR ALL
  USING (organization_id = current_org_id() AND (reviewer_id = auth.uid() OR is_hr_admin_ceo()))
  WITH CHECK (organization_id = current_org_id() AND (reviewer_id = auth.uid() OR is_hr_admin_ceo()));

DROP POLICY IF EXISTS calibration_sessions_all    ON calibration_sessions;
DROP POLICY IF EXISTS calibration_adjustments_all ON calibration_adjustments;
CREATE POLICY calibration_sessions_all    ON calibration_sessions    FOR ALL USING (organization_id = current_org_id() AND is_hr_admin_ceo()) WITH CHECK (organization_id = current_org_id() AND is_hr_admin_ceo());
CREATE POLICY calibration_adjustments_all ON calibration_adjustments FOR ALL USING (organization_id = current_org_id() AND is_hr_admin_ceo()) WITH CHECK (organization_id = current_org_id() AND is_hr_admin_ceo());

DROP POLICY IF EXISTS final_ratings_select ON final_ratings;
DROP POLICY IF EXISTS final_ratings_write  ON final_ratings;
CREATE POLICY final_ratings_select ON final_ratings FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY final_ratings_write  ON final_ratings FOR ALL
  USING (organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo()))
  WITH CHECK (organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo()));

DROP POLICY IF EXISTS development_plans_select ON development_plans;
DROP POLICY IF EXISTS development_plans_write  ON development_plans;
CREATE POLICY development_plans_select ON development_plans FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY development_plans_write  ON development_plans FOR ALL
  USING (organization_id = current_org_id() AND (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()))
  WITH CHECK (organization_id = current_org_id() AND (employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()));

DROP POLICY IF EXISTS performance_scores_select ON performance_scores;
DROP POLICY IF EXISTS performance_scores_write  ON performance_scores;
CREATE POLICY performance_scores_select ON performance_scores FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY performance_scores_write  ON performance_scores FOR ALL
  USING (organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo()))
  WITH CHECK (organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo()));

-- ── SECURITY DEFINER RPCs: bypass RLS by design, need an explicit
-- cross-org guard added since org-scoping the underlying tables alone
-- doesn't stop them being invoked with a cross-org employee_id/cycle_id. ──
CREATE OR REPLACE FUNCTION get_peer_feedback(p_subject_employee_id UUID, p_cycle_id UUID)
RETURNS TABLE (
  id UUID, feedback_request_id UUID, is_anonymous BOOLEAN,
  strengths_noted TEXT, improvement_areas_noted TEXT, rating TEXT, submitted_at TIMESTAMPTZ,
  provider_id UUID, provider_name TEXT, request_status TEXT
) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_subject_employee_id AND organization_id = current_org_id()) THEN
    RAISE EXCEPTION 'Not authorized to view this employee''s feedback';
  END IF;
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
  WHERE fr.subject_employee_id = p_subject_employee_id AND fr.cycle_id = p_cycle_id
    AND fr.organization_id = current_org_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION recompute_performance_score(p_employee_id UUID, p_cycle_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id             UUID;
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
  v_org_id := current_org_id();
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_employee_id AND organization_id = v_org_id) THEN
    RAISE EXCEPTION 'Not authorized to recompute this employee''s performance score';
  END IF;
  IF NOT (auth.uid() = p_employee_id OR is_manager_of(p_employee_id) OR is_hr_admin_ceo()) THEN
    RAISE EXCEPTION 'Not authorized to recompute this employee''s performance score';
  END IF;

  SELECT * INTO v_cycle FROM performance_cycles WHERE id = p_cycle_id AND organization_id = v_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  SELECT * INTO v_weights FROM performance_score_weights WHERE organization_id = v_org_id;

  SELECT
    COALESCE(SUM(weight_percent * (
      CASE manager_rating
        WHEN 'Unsatisfactory' THEN 1 WHEN 'Needs Improvement' THEN 2
        WHEN 'Meets Expectations' THEN 3 WHEN 'Exceeds Expectations' THEN 4 ELSE NULL END
    )), 0),
    COALESCE(SUM(weight_percent) FILTER (WHERE manager_rating IS NOT NULL), 0)
  INTO v_goal_score, v_total_weight
  FROM goals WHERE employee_id = p_employee_id AND cycle_id = p_cycle_id AND organization_id = v_org_id;
  IF v_total_weight > 0 THEN v_goal_score := (v_goal_score / v_total_weight / 4) * 100; ELSE v_goal_score := 0; END IF;

  SELECT CASE self_overall_rating WHEN 'Unsatisfactory' THEN 1 WHEN 'Needs Improvement' THEN 2 WHEN 'Meets Expectations' THEN 3 WHEN 'Exceeds Expectations' THEN 4 END
    INTO v_self_band FROM self_appraisals WHERE employee_id = p_employee_id AND cycle_id = p_cycle_id AND organization_id = v_org_id;
  SELECT CASE overall_rating WHEN 'Unsatisfactory' THEN 1 WHEN 'Needs Improvement' THEN 2 WHEN 'Meets Expectations' THEN 3 WHEN 'Exceeds Expectations' THEN 4 END
    INTO v_manager_band FROM manager_reviews WHERE employee_id = p_employee_id AND cycle_id = p_cycle_id AND organization_id = v_org_id;
  v_self_gap := COALESCE(v_self_band, 0) - COALESCE(v_manager_band, 0);

  SELECT COALESCE(AVG(utilization_percent), 0) INTO v_utilization
  FROM capacity_snapshots WHERE employee_id = p_employee_id
    AND week_start_date >= v_cycle.start_date AND week_start_date <= v_cycle.end_date
    AND organization_id = v_org_id;

  SELECT COUNT(*) INTO v_skill_growth FROM employee_skills
    WHERE employee_id = p_employee_id AND last_updated >= v_cycle.start_date AND last_updated <= (v_cycle.end_date + INTERVAL '1 day')
    AND organization_id = v_org_id;

  SELECT fr.final_rating INTO v_final_rating FROM final_ratings fr WHERE fr.employee_id = p_employee_id AND fr.cycle_id = p_cycle_id AND fr.organization_id = v_org_id;

  v_composite :=
    v_goal_score * (v_weights.goal_achievement_weight_percent / 100) +
    (COALESCE(v_manager_band, 0) / 4 * 100) * (v_weights.manager_rating_weight_percent / 100) +
    LEAST(v_utilization, 100) * (v_weights.utilization_weight_percent / 100);

  INSERT INTO performance_scores (employee_id, cycle_id, organization_id, goal_achievement_score, self_manager_rating_gap, utilization_percent, skill_growth_count, final_rating, composite_score, computed_at)
  VALUES (p_employee_id, p_cycle_id, v_org_id, ROUND(v_goal_score,2), v_self_gap, ROUND(v_utilization,2), v_skill_growth, v_final_rating, ROUND(v_composite,2), now())
  ON CONFLICT (employee_id, cycle_id) DO UPDATE SET
    goal_achievement_score = EXCLUDED.goal_achievement_score, self_manager_rating_gap = EXCLUDED.self_manager_rating_gap,
    utilization_percent = EXCLUDED.utilization_percent, skill_growth_count = EXCLUDED.skill_growth_count,
    final_rating = EXCLUDED.final_rating, composite_score = EXCLUDED.composite_score, computed_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';

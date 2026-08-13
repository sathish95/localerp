-- ============================================================
-- STEP123: End-to-end demo data for the Performance Award Management
-- module — one fully worked-through award ("Q3 Excellence Award 2026",
-- code DEMO-Q3-2026) per organization, built around a REAL manager and
-- their REAL direct reports (found via profiles.reporting_manager_id)
-- rather than fabricated people, so the seeded rows show up correctly
-- when that actual manager logs into Team Awards / that actual employee
-- logs into My Awards.
--
-- Requires STEP115-STEP122 already applied (uses performance_awards,
-- award_categories incl. the "Best Performer" category seeded by
-- STEP122, and — if STEP122 ran — its certificate template, though
-- certificate generation is skipped gracefully if no template exists).
--
-- What gets created, per organization that has a manager with 2+ direct
-- reports (skipped otherwise, with a NOTICE):
--   * The award itself: workflow (self feedback, manager feedback, peer
--     nomination, final approval enabled; additional evaluation off),
--     2 self-feedback questions, 2 manager-feedback questions, 1 peer-
--     nomination question, scoring weights 20/40/20/20.
--   * Up to 5 of that manager's direct reports as participants, each
--     with a SUBMITTED self feedback and a SUBMITTED manager feedback
--     (varied ratings so the score spread is realistic, not flat).
--   * Peer nominations skewed so participant #1 clearly leads.
--   * award_scores computed with the SAME weights as above, ranked,
--     and a recommendation label per participant from the award's
--     configured thresholds — so all four recommendation bands
--     (Strongly Recommended / Recommended / Consider / Not Recommended)
--     are represented across the 5 participants.
--   * The #1-ranked participant is GRANTED (an award_approvals row +
--     status='granted'); everyone else is left at status='recommended'
--     so HR/the manager can practice deciding on them in Team Awards ->
--     Award Decisions.
--   * A real certificate is generated for the granted participant from
--     the org's "Best Performer" template if STEP122 was run.
--
-- Idempotent: skipped entirely for an org that already has a
-- DEMO-Q3-2026 award.
-- ============================================================

DO $$
DECLARE
  v_org_id UUID;
  v_manager_id UUID;
  v_hr_id UUID;
  v_cat_id UUID;
  v_participant_ids UUID[];
  v_n INT;
  v_award_id UUID;
  v_q_self_rating UUID;
  v_q_self_text UUID;
  v_q_mgr_rating UUID;
  v_q_mgr_text UUID;
  v_q_peer UUID;
  v_self_ratings INT[] := ARRAY[5,4,3,4,3];
  v_mgr_ratings INT[] := ARRAY[5,4,4,3,3];
  v_perf_scores NUMERIC[] := ARRAY[95,82,74,68,60];
  v_self_texts TEXT[] := ARRAY[
    'Led the migration project end to end and mentored two teammates along the way.',
    'Closed out every sprint commitment this quarter and picked up extra scope twice.',
    'Improved our test coverage significantly and reduced regression bugs.',
    'Took ownership of the customer escalation process and made it faster for everyone.',
    'Kept documentation current and helped onboard a new hire smoothly.'
  ];
  v_mgr_texts TEXT[] := ARRAY[
    'Consistently the person others rely on when something is urgent.',
    'Reliable, proactive, and a great team collaborator.',
    'Solid technical execution with room to grow on cross-team communication.',
    'Good individual output; still building consistency quarter over quarter.',
    'Meets expectations; encouraged to take on more initiative next quarter.'
  ];
  v_emp_id UUID;
  v_self_pct NUMERIC;
  v_mgr_pct NUMERIC;
  v_template_version_id UUID;
  v_top_employee UUID;
  v_cert_year INT := date_part('year', now())::INT;
  v_cert_seq INT;
  v_cert_no TEXT;
  v_emp_name TEXT; v_emp_code TEXT; v_emp_desig TEXT; v_emp_dept TEXT;
  v_mgr_name TEXT; v_hr_name TEXT; v_company_name TEXT; v_company_logo TEXT;
  v_top_final_score NUMERIC;
BEGIN
  FOR v_org_id IN SELECT id FROM organizations LOOP
    IF EXISTS (SELECT 1 FROM performance_awards WHERE organization_id = v_org_id AND code = 'DEMO-Q3-2026') THEN
      CONTINUE;
    END IF;

    SELECT p.reporting_manager_id INTO v_manager_id
    FROM profiles p
    WHERE p.organization_id = v_org_id AND p.reporting_manager_id IS NOT NULL
    GROUP BY p.reporting_manager_id
    HAVING count(*) >= 2
    ORDER BY count(*) DESC
    LIMIT 1;

    IF v_manager_id IS NULL THEN
      RAISE NOTICE 'STEP123: skipping org % — no manager with 2+ direct reports found', v_org_id;
      CONTINUE;
    END IF;

    SELECT array_agg(id) INTO v_participant_ids FROM (
      SELECT id FROM profiles WHERE organization_id = v_org_id AND reporting_manager_id = v_manager_id ORDER BY full_name LIMIT 5
    ) x;
    v_n := array_length(v_participant_ids, 1);

    SELECT id INTO v_hr_id FROM profiles WHERE organization_id = v_org_id AND role IN ('hr','admin','ceo') ORDER BY created_at LIMIT 1;
    SELECT id INTO v_cat_id FROM award_categories WHERE organization_id = v_org_id AND name = 'Best Performer' LIMIT 1;

    INSERT INTO performance_awards (
      organization_id, name, code, category_id, description, objective, frequency,
      start_date, end_date, nomination_start_date, nomination_end_date,
      evaluation_start_date, evaluation_end_date, announcement_date, status, created_by
    ) VALUES (
      v_org_id, 'Q3 Excellence Award 2026', 'DEMO-Q3-2026', v_cat_id,
      'Seed data demonstrating the full award workflow end to end.',
      'Recognize top-performing team members for Q3 2026.',
      'Quarterly', '2026-07-01', '2026-09-30', '2026-07-01', '2026-07-15',
      '2026-07-16', '2026-08-15', '2026-08-20', 'active', v_hr_id
    ) RETURNING id INTO v_award_id;

    INSERT INTO award_eligibility_rules (organization_id, award_id, rule_type, rule_value)
    VALUES (v_org_id, v_award_id, 'employment_status', jsonb_build_object('statuses', jsonb_build_array('active')));

    INSERT INTO award_workflow_steps (organization_id, award_id, step_key, is_enabled, step_order, config) VALUES
      (v_org_id, v_award_id, 'self_feedback', true, 0, '{}'::jsonb),
      (v_org_id, v_award_id, 'manager_feedback', true, 1, '{}'::jsonb),
      (v_org_id, v_award_id, 'peer_nomination', true, 2, jsonb_build_object('allow_self_nomination', false, 'allow_anonymous_nomination', false, 'max_nominations_per_employee', 2)),
      (v_org_id, v_award_id, 'additional_evaluation', false, 3, '{}'::jsonb),
      (v_org_id, v_award_id, 'final_approval', true, 4, '{}'::jsonb);

    INSERT INTO award_questions (organization_id, award_id, step_key, question_text, question_type, is_required, sort_order)
    VALUES (v_org_id, v_award_id, 'self_feedback', 'Rate your overall contribution this quarter', 'rating', true, 0)
    RETURNING id INTO v_q_self_rating;
    INSERT INTO award_questions (organization_id, award_id, step_key, question_text, question_type, is_required, sort_order)
    VALUES (v_org_id, v_award_id, 'self_feedback', 'Describe your key achievement this quarter', 'long_text', true, 1)
    RETURNING id INTO v_q_self_text;
    INSERT INTO award_questions (organization_id, award_id, step_key, question_text, question_type, is_required, sort_order)
    VALUES (v_org_id, v_award_id, 'manager_feedback', 'Rate this team member overall performance', 'rating', true, 0)
    RETURNING id INTO v_q_mgr_rating;
    INSERT INTO award_questions (organization_id, award_id, step_key, question_text, question_type, is_required, sort_order)
    VALUES (v_org_id, v_award_id, 'manager_feedback', 'What evidence supports this rating', 'long_text', false, 1)
    RETURNING id INTO v_q_mgr_text;
    INSERT INTO award_questions (organization_id, award_id, step_key, question_text, question_type, is_required, sort_order)
    VALUES (v_org_id, v_award_id, 'peer_nomination', 'What makes this colleague stand out', 'long_text', true, 0)
    RETURNING id INTO v_q_peer;

    INSERT INTO award_scoring_config (organization_id, award_id, self_feedback_weight, manager_feedback_weight, peer_feedback_weight, performance_weight)
    VALUES (v_org_id, v_award_id, 20, 40, 20, 20);

    FOR i IN 1..v_n LOOP
      v_emp_id := v_participant_ids[i];

      INSERT INTO award_participants (organization_id, award_id, employee_id, status)
      VALUES (v_org_id, v_award_id, v_emp_id, 'nominated');

      INSERT INTO award_self_feedback (organization_id, award_id, employee_id, answers, status, submitted_at)
      VALUES (v_org_id, v_award_id, v_emp_id,
        jsonb_build_object(v_q_self_rating::text, v_self_ratings[i], v_q_self_text::text, v_self_texts[i]),
        'submitted', now());

      INSERT INTO award_manager_feedback (organization_id, award_id, employee_id, reviewer_id, answers, rating, comments, evidence, recommendation, status, submitted_at)
      VALUES (v_org_id, v_award_id, v_emp_id, v_manager_id,
        jsonb_build_object(v_q_mgr_rating::text, v_mgr_ratings[i], v_q_mgr_text::text, v_mgr_texts[i]),
        v_mgr_ratings[i], v_mgr_texts[i], 'See linked project/ticket history for this quarter.',
        CASE WHEN v_mgr_ratings[i] >= 4 THEN 'Recommended' ELSE 'Neutral' END, 'submitted', now());
    END LOOP;

    IF v_n >= 2 THEN
      INSERT INTO award_peer_nominations (organization_id, award_id, nominator_id, nominee_id, reason)
      VALUES (v_org_id, v_award_id, v_participant_ids[2], v_participant_ids[1], 'Always willing to help the team, even outside their own workstream.');
    END IF;
    IF v_n >= 3 THEN
      INSERT INTO award_peer_nominations (organization_id, award_id, nominator_id, nominee_id, reason)
      VALUES (v_org_id, v_award_id, v_participant_ids[3], v_participant_ids[1], 'Solved a critical issue under pressure and kept everyone informed.');
    END IF;
    IF v_n >= 4 THEN
      INSERT INTO award_peer_nominations (organization_id, award_id, nominator_id, nominee_id, reason)
      VALUES (v_org_id, v_award_id, v_participant_ids[4], v_participant_ids[2], 'Great mentor to newer team members this quarter.');
    END IF;
    IF v_n >= 5 THEN
      INSERT INTO award_peer_nominations (organization_id, award_id, nominator_id, nominee_id, reason)
      VALUES (v_org_id, v_award_id, v_participant_ids[5], v_participant_ids[1], 'Went well above and beyond what the role required this quarter.');
    END IF;

    FOR i IN 1..v_n LOOP
      v_emp_id := v_participant_ids[i];
      v_self_pct := round(v_self_ratings[i] / 5.0 * 100, 2);
      v_mgr_pct := round(v_mgr_ratings[i] / 5.0 * 100, 2);

      INSERT INTO award_scores (organization_id, award_id, employee_id, self_score, manager_score, peer_score, performance_score, final_score, weights_snapshot)
      SELECT
        v_org_id, v_award_id, v_emp_id, v_self_pct, v_mgr_pct,
        peer_pct, v_perf_scores[i],
        round(v_self_pct * 0.2 + v_mgr_pct * 0.4 + peer_pct * 0.2 + v_perf_scores[i] * 0.2, 2),
        jsonb_build_object('self', 20, 'manager', 40, 'peer', 20, 'performance', 20)
      FROM (
        SELECT CASE WHEN max_cnt > 0 THEN round((this_cnt::numeric / max_cnt) * 100, 2) ELSE 0 END AS peer_pct
        FROM (
          SELECT
            (SELECT count(*) FROM award_peer_nominations WHERE award_id = v_award_id AND nominee_id = v_emp_id) AS this_cnt,
            (SELECT max(cnt) FROM (SELECT nominee_id, count(*) AS cnt FROM award_peer_nominations WHERE award_id = v_award_id GROUP BY nominee_id) c) AS max_cnt
        ) counts
      ) peer;
    END LOOP;

    UPDATE award_participants ap
    SET rank = r.rnk,
        recommendation_label = CASE
          WHEN r.final_score >= 90 THEN 'Strongly Recommended'
          WHEN r.final_score >= 80 THEN 'Recommended'
          WHEN r.final_score >= 70 THEN 'Consider'
          ELSE 'Not Recommended'
        END,
        final_score = r.final_score,
        status = 'recommended'
    FROM (SELECT employee_id, final_score, rank() OVER (ORDER BY final_score DESC) AS rnk FROM award_scores WHERE award_id = v_award_id) r
    WHERE ap.award_id = v_award_id AND ap.employee_id = r.employee_id;

    SELECT employee_id, final_score INTO v_top_employee, v_top_final_score
    FROM award_participants WHERE award_id = v_award_id AND rank = 1 LIMIT 1;

    UPDATE award_participants SET status = 'granted' WHERE award_id = v_award_id AND employee_id = v_top_employee;

    INSERT INTO award_approvals (organization_id, award_id, employee_id, decided_by, decision, final_score, comments, award_date)
    VALUES (v_org_id, v_award_id, v_top_employee, v_manager_id, 'granted', v_top_final_score, 'Outstanding results this quarter — approved.', CURRENT_DATE);

    -- Best-effort certificate generation — skipped silently if STEP122
    -- was never run (no template) or the org has no matching template.
    SELECT tv.id INTO v_template_version_id
    FROM award_certificate_template_versions tv
    JOIN award_certificate_templates t ON t.id = tv.template_id
    WHERE t.organization_id = v_org_id AND t.award_category_id = v_cat_id AND t.status = 'active'
    ORDER BY tv.version DESC LIMIT 1;

    IF v_template_version_id IS NULL THEN
      SELECT tv.id INTO v_template_version_id
      FROM award_certificate_template_versions tv
      JOIN award_certificate_templates t ON t.id = tv.template_id
      WHERE t.organization_id = v_org_id AND t.award_category_id IS NULL AND t.status = 'active'
      ORDER BY tv.version DESC LIMIT 1;
    END IF;

    IF v_template_version_id IS NOT NULL THEN
      SELECT full_name, employee_id, designation, (SELECT name FROM departments WHERE id = profiles.department_id)
      INTO v_emp_name, v_emp_code, v_emp_desig, v_emp_dept
      FROM profiles WHERE id = v_top_employee;

      SELECT full_name INTO v_mgr_name FROM profiles WHERE id = v_manager_id;
      SELECT full_name INTO v_hr_name FROM profiles WHERE id = v_hr_id;
      SELECT business_name, header_logo INTO v_company_name, v_company_logo FROM document_settings WHERE organization_id = v_org_id LIMIT 1;

      SELECT count(*) INTO v_cert_seq FROM award_certificates WHERE organization_id = v_org_id AND certificate_number LIKE 'CERT-' || v_cert_year || '-%';
      v_cert_no := 'CERT-' || v_cert_year || '-' || lpad((v_cert_seq + 1)::text, 6, '0');

      INSERT INTO award_certificates (organization_id, award_id, employee_id, template_version_id, certificate_number, resolved_data, generated_by)
      VALUES (v_org_id, v_award_id, v_top_employee, v_template_version_id, v_cert_no,
        jsonb_build_object(
          'employee_name', v_emp_name, 'employee_code', coalesce(v_emp_code, ''),
          'designation', coalesce(v_emp_desig, ''), 'department', coalesce(v_emp_dept, ''),
          'award_name', 'Q3 Excellence Award 2026', 'award_category', 'Best Performer',
          'award_description', 'Seed data demonstrating the full award workflow end to end.',
          'award_period', '01 Jul 2026 - 30 Sep 2026', 'award_date', to_char(CURRENT_DATE, 'DD Mon YYYY'),
          'award_year', v_cert_year::text, 'final_score', v_top_final_score::text, 'rank', '#1',
          'manager_name', coalesce(v_mgr_name, ''), 'hr_name', coalesce(v_hr_name, ''),
          'company_name', coalesce(v_company_name, ''), 'company_logo', coalesce(v_company_logo, ''),
          'certificate_number', v_cert_no, 'issue_date', to_char(CURRENT_DATE, 'DD Mon YYYY')
        ), v_manager_id);
    ELSE
      RAISE NOTICE 'STEP123: org % — no active certificate template found, skipping certificate generation (run STEP122 first)', v_org_id;
    END IF;

    RAISE NOTICE 'STEP123: seeded demo award % for org % (manager %, % participants)', v_award_id, v_org_id, v_manager_id, v_n;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

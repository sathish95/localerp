-- ============================================================
-- STEP199: Seed the real status flows for the Application, Firmware and
-- Hardware departments (STEP198's per-department pipelines), so they
-- don't have to be typed in by hand through Settings -> Task Status
-- Flows one step at a time.
--
-- Departments are matched by name (case-insensitive) under the
-- 'thingsalive' org. This REPLACES each department's current step list
-- entirely (same full-replace semantics as the Settings panel's Save) —
-- if any of these three departments already has tasks sitting on a
-- status that doesn't exist in its new list below, this script does NOT
-- silently move them (unlike the Settings panel's guided remap flow) —
-- it just leaves those tasks on their old status value, invisible on the
-- new Kanban columns until manually reassigned. Check the NOTICE output
-- this script prints for exactly that, per department.
-- ============================================================

DO $$
DECLARE
  v_org_id UUID;
  v_dept_id UUID;
  v_flow_id UUID;
  v_orphaned TEXT;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'thingsalive';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organizations row with slug=thingsalive not found';
  END IF;

  -- ── Application ──
  SELECT id INTO v_dept_id FROM departments WHERE organization_id = v_org_id AND name ILIKE 'Application';
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'No department named "Application" found for this org — check Settings -> Departments for the exact name and edit this script to match';
  END IF;

  SELECT id INTO v_flow_id FROM department_status_flows WHERE department_id = v_dept_id;
  IF v_flow_id IS NULL THEN
    INSERT INTO department_status_flows (organization_id, department_id) VALUES (v_org_id, v_dept_id) RETURNING id INTO v_flow_id;
  END IF;

  SELECT string_agg(DISTINCT status, ', ') INTO v_orphaned
  FROM project_tasks WHERE department_id = v_dept_id
    AND status NOT IN ('to_do','in_progress','code_review','ready_for_deployment','deployed_to_qa','qa_testing','qa_failed','rework_required','ready_for_production','deployed_to_production','done');
  IF v_orphaned IS NOT NULL THEN RAISE NOTICE 'Application: existing tasks on status(es) [%] have no matching step in the new flow — reassign them manually', v_orphaned; END IF;

  DELETE FROM department_status_steps WHERE flow_id = v_flow_id;
  INSERT INTO department_status_steps (organization_id, flow_id, status_key, label, color, sort_order, is_closed)
  SELECT v_org_id, v_flow_id, key, label, color, ord, closed FROM (VALUES
    (0,  'to_do',                  'To Do',                    '#3b82f6', false),
    (1,  'in_progress',            'In Progress',               '#f59e0b', false),
    (2,  'code_review',            'Code Review',                '#8b5cf6', false),
    (3,  'ready_for_deployment',   'Ready for Deployment',       '#0ea5e9', false),
    (4,  'deployed_to_qa',         'Deployed to QA',            '#14b8a6', false),
    (5,  'qa_testing',             'QA Testing',                 '#8b5cf6', false),
    (6,  'qa_failed',              'QA Failed',                  '#e11d48', false),
    (7,  'rework_required',        'Rework Required',           '#f43f5e', false),
    (8,  'ready_for_production',   'Ready for Production',       '#0ea5e9', false),
    (9,  'deployed_to_production', 'Deployed to Production',    '#10b981', false),
    (10, 'done',                   'Done',                        '#94a3b8', true)
  ) AS t(ord, key, label, color, closed);

  -- ── Firmware ──
  SELECT id INTO v_dept_id FROM departments WHERE organization_id = v_org_id AND name ILIKE 'Firmware';
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'No department named "Firmware" found for this org — check Settings -> Departments for the exact name and edit this script to match';
  END IF;

  SELECT id INTO v_flow_id FROM department_status_flows WHERE department_id = v_dept_id;
  IF v_flow_id IS NULL THEN
    INSERT INTO department_status_flows (organization_id, department_id) VALUES (v_org_id, v_dept_id) RETURNING id INTO v_flow_id;
  END IF;

  SELECT string_agg(DISTINCT status, ', ') INTO v_orphaned
  FROM project_tasks WHERE department_id = v_dept_id
    AND status NOT IN ('backlog','requirement_analysis','technical_design','ready_for_development','firmware_development','code_review','build','developer_testing','hardware_integration_testing','ready_for_deployment','deployed_to_test','qa_testing','regression_testing','field_testing','release_candidate','release_approval','production_release','ota_deployment','done');
  IF v_orphaned IS NOT NULL THEN RAISE NOTICE 'Firmware: existing tasks on status(es) [%] have no matching step in the new flow — reassign them manually', v_orphaned; END IF;

  DELETE FROM department_status_steps WHERE flow_id = v_flow_id;
  INSERT INTO department_status_steps (organization_id, flow_id, status_key, label, color, sort_order, is_closed)
  SELECT v_org_id, v_flow_id, key, label, color, ord, closed FROM (VALUES
    (0,  'backlog',                       'Backlog',                       '#64748b', false),
    (1,  'requirement_analysis',          'Requirement Analysis',          '#3b82f6', false),
    (2,  'technical_design',              'Technical Design',              '#0ea5e9', false),
    (3,  'ready_for_development',         'Ready for Development',         '#14b8a6', false),
    (4,  'firmware_development',          'Firmware Development',          '#f59e0b', false),
    (5,  'code_review',                   'Code Review',                    '#8b5cf6', false),
    (6,  'build',                         'Build',                          '#6366f1', false),
    (7,  'developer_testing',             'Developer Testing',             '#a855f7', false),
    (8,  'hardware_integration_testing',  'Hardware Integration Testing',  '#ec4899', false),
    (9,  'ready_for_deployment',          'Ready for Deployment',          '#0ea5e9', false),
    (10, 'deployed_to_test',              'Deployed to Test',              '#14b8a6', false),
    (11, 'qa_testing',                    'QA Testing',                     '#8b5cf6', false),
    (12, 'regression_testing',            'Regression Testing',            '#a855f7', false),
    (13, 'field_testing',                 'Field Testing',                  '#f97316', false),
    (14, 'release_candidate',             'Release Candidate',             '#eab308', false),
    (15, 'release_approval',              'Release Approval',              '#84cc16', false),
    (16, 'production_release',            'Production Release',            '#10b981', false),
    (17, 'ota_deployment',                'OTA Deployment',                 '#06b6d4', false),
    (18, 'done',                          'Done',                            '#94a3b8', true)
  ) AS t(ord, key, label, color, closed);

  -- ── Hardware ──
  SELECT id INTO v_dept_id FROM departments WHERE organization_id = v_org_id AND name ILIKE 'Hardware';
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'No department named "Hardware" found for this org — check Settings -> Departments for the exact name and edit this script to match';
  END IF;

  SELECT id INTO v_flow_id FROM department_status_flows WHERE department_id = v_dept_id;
  IF v_flow_id IS NULL THEN
    INSERT INTO department_status_flows (organization_id, department_id) VALUES (v_org_id, v_dept_id) RETURNING id INTO v_flow_id;
  END IF;

  SELECT string_agg(DISTINCT status, ', ') INTO v_orphaned
  FROM project_tasks WHERE department_id = v_dept_id
    AND status NOT IN ('backlog','requirements','hardware_design','hardware_assembly','hardware_bring_up','firmware_development','integration_testing','qa_testing','field_testing','release_candidate','release_approval','production_release','deployment','done');
  IF v_orphaned IS NOT NULL THEN RAISE NOTICE 'Hardware: existing tasks on status(es) [%] have no matching step in the new flow — reassign them manually', v_orphaned; END IF;

  DELETE FROM department_status_steps WHERE flow_id = v_flow_id;
  INSERT INTO department_status_steps (organization_id, flow_id, status_key, label, color, sort_order, is_closed)
  SELECT v_org_id, v_flow_id, key, label, color, ord, closed FROM (VALUES
    (0,  'backlog',               'Backlog',                '#64748b', false),
    (1,  'requirements',          'Requirements',            '#3b82f6', false),
    (2,  'hardware_design',       'Hardware Design',        '#0ea5e9', false),
    (3,  'hardware_assembly',     'Hardware Assembly',      '#14b8a6', false),
    (4,  'hardware_bring_up',     'Hardware Bring-Up',      '#f59e0b', false),
    (5,  'firmware_development',  'Firmware Development',   '#8b5cf6', false),
    (6,  'integration_testing',   'Integration & Testing',  '#a855f7', false),
    (7,  'qa_testing',            'QA Testing',              '#ec4899', false),
    (8,  'field_testing',         'Field Testing',           '#f97316', false),
    (9,  'release_candidate',     'Release Candidate',      '#eab308', false),
    (10, 'release_approval',     'Release Approval',        '#84cc16', false),
    (11, 'production_release',   'Production Release',      '#10b981', false),
    (12, 'deployment',            'Deployment',              '#06b6d4', false),
    (13, 'done',                  'Done',                     '#94a3b8', true)
  ) AS t(ord, key, label, color, closed);

  RAISE NOTICE 'Application, Firmware and Hardware status flows seeded.';
END $$;

NOTIFY pgrst, 'reload schema';

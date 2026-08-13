-- ============================================================
-- STEP152: Seeds 6 ready-to-use, already-PUBLISHED scenario templates —
-- one per category the Scenario Builder already offers (general,
-- expansion, cost-reduction, hiring, product-launch, restructuring) —
-- so the Template Library isn't empty on a fresh install. This was
-- explicitly requested by Phase 7 ("Create ready-made templates") and
-- missed in the original pass; STEP143-151 never seeded any content.
--
-- Follows the same loop-over-every-org + IF NOT EXISTS pattern as
-- STEP122's certificate-template seed: idempotent (re-running skips any
-- org/name combination that already exists, so it won't duplicate or
-- clobber a template an admin has since edited), and admins can still
-- freely edit, duplicate, archive or delete any of these afterward —
-- this is starting content, not a hardcoded set.
--
-- `expected_revenue` is used deliberately in several of these — it's
-- the one variable key run_scenario_simulation() (STEP145) specifically
-- looks for to seed the revenue side of projected_margin/ROI.
-- ============================================================

DO $$
DECLARE
  org RECORD;
  tmpl RECORD;
  var RECORD;
  v_template_id UUID;
  v_sections JSONB := jsonb_build_array(
    jsonb_build_object('key','context','label','Context & Timeline','sort_order',0),
    jsonb_build_object('key','linked_data','label','Linked Data','sort_order',1),
    jsonb_build_object('key','assumptions','label','Assumptions & Variables','sort_order',2),
    jsonb_build_object('key','risks','label','Risks','sort_order',3)
  );
  templates JSONB := jsonb_build_array(
    jsonb_build_object(
      'name', 'Regional Market Expansion', 'category', 'expansion',
      'description', 'Model entering a new region or market segment — projected revenue vs. entry cost and ramp-up headcount.',
      'variables', jsonb_build_array(
        jsonb_build_object('key','expected_revenue','label','Expected Revenue','data_type','currency','default_value','0'),
        jsonb_build_object('key','market_entry_cost','label','Market Entry Cost','data_type','currency','default_value','0'),
        jsonb_build_object('key','headcount_needed','label','Headcount Needed','data_type','number','default_value','0'),
        jsonb_build_object('key','ramp_up_months','label','Ramp-Up (months)','data_type','number','default_value','6')
      )
    ),
    jsonb_build_object(
      'name', 'Cost Reduction Program', 'category', 'cost-reduction',
      'description', 'Model a cost-cutting initiative — target savings against the one-time cost of implementing it.',
      'variables', jsonb_build_array(
        jsonb_build_object('key','target_savings_percent','label','Target Savings %','data_type','percent','default_value','10'),
        jsonb_build_object('key','implementation_cost','label','Implementation Cost','data_type','currency','default_value','0'),
        jsonb_build_object('key','affected_headcount','label','Affected Headcount','data_type','number','default_value','0')
      )
    ),
    jsonb_build_object(
      'name', 'Team Scaling Plan', 'category', 'hiring',
      'description', 'Model growing a team — new hires, ramp-up time, and the revenue they''re expected to enable.',
      'variables', jsonb_build_array(
        jsonb_build_object('key','new_hires','label','New Hires','data_type','number','default_value','0'),
        jsonb_build_object('key','avg_salary','label','Average Salary','data_type','currency','default_value','0'),
        jsonb_build_object('key','ramp_up_months','label','Ramp-Up (months)','data_type','number','default_value','3'),
        jsonb_build_object('key','expected_revenue','label','Expected Revenue','data_type','currency','default_value','0')
      )
    ),
    jsonb_build_object(
      'name', 'Product Launch', 'category', 'product-launch',
      'description', 'Model launching a new product — launch budget, time to market, and expected revenue.',
      'variables', jsonb_build_array(
        jsonb_build_object('key','expected_revenue','label','Expected Revenue','data_type','currency','default_value','0'),
        jsonb_build_object('key','launch_budget','label','Launch Budget','data_type','currency','default_value','0'),
        jsonb_build_object('key','time_to_market_days','label','Time to Market (days)','data_type','number','default_value','90')
      )
    ),
    jsonb_build_object(
      'name', 'Organizational Restructuring', 'category', 'restructuring',
      'description', 'Model a team or department restructure — headcount change, severance cost, and expected savings.',
      'variables', jsonb_build_array(
        jsonb_build_object('key','headcount_change','label','Headcount Change','data_type','number','default_value','0'),
        jsonb_build_object('key','severance_cost','label','Severance Cost','data_type','currency','default_value','0'),
        jsonb_build_object('key','expected_savings','label','Expected Annual Savings','data_type','currency','default_value','0')
      )
    ),
    jsonb_build_object(
      'name', 'General Scenario', 'category', 'general',
      'description', 'A minimal starting point for any what-if scenario that doesn''t fit a specific category.',
      'variables', jsonb_build_array(
        jsonb_build_object('key','expected_revenue','label','Expected Revenue','data_type','currency','default_value','0')
      )
    )
  );
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    FOR tmpl IN SELECT * FROM jsonb_to_recordset(templates) AS t(name TEXT, category TEXT, description TEXT, variables JSONB) LOOP
      IF NOT EXISTS (SELECT 1 FROM scenario_templates WHERE organization_id = org.id AND name = tmpl.name) THEN
        INSERT INTO scenario_templates (organization_id, name, category, description, status, sections)
        VALUES (org.id, tmpl.name, tmpl.category, tmpl.description, 'published', v_sections)
        RETURNING id INTO v_template_id;

        FOR var IN SELECT * FROM jsonb_to_recordset(tmpl.variables) AS v(key TEXT, label TEXT, data_type TEXT, default_value TEXT) LOOP
          INSERT INTO scenario_template_variables (template_id, key, label, data_type, default_value, sort_order)
          VALUES (v_template_id, var.key, var.label, var.data_type, var.default_value,
            (SELECT count(*) FROM scenario_template_variables WHERE template_id = v_template_id));
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

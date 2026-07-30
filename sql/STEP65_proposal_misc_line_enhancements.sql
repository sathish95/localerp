-- ============================================================
-- STEP65: Miscellaneous line enhancements — line_type (so a Travel/Field
-- Visit expense is distinguishable from a generic misc cost) and
-- linked_resource_plan_id (so a travel expense can be tagged to the
-- specific resource plan/person it belongs to, e.g. "Field visit — Priya
-- Sharma, Application Development"). Nullable soft ref — a misc line
-- doesn't have to be tied to a resource.
-- ============================================================

ALTER TABLE proposal_misc_lines ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'Other'
  CHECK (line_type IN ('Travel', 'Field Visit', 'Other'));
ALTER TABLE proposal_misc_lines ADD COLUMN IF NOT EXISTS linked_resource_plan_id UUID; -- soft ref -> proposal_resource_plans

CREATE INDEX IF NOT EXISTS proposal_misc_lines_resource_idx ON proposal_misc_lines(linked_resource_plan_id);

-- save_proposal_version() (STEP62) needs updating to carry line_type
-- forward on clone. linked_resource_plan_id is deliberately RESET (not
-- remapped) on a revision, same convention already used for
-- proposal_timeline.linked_resource_plan_ids in STEP62 — the new version's
-- resource plans get new ids, and re-tagging a handful of travel lines to
-- them is a quick manual step rather than a fragile old-id->new-id
-- remapping through the clone.
CREATE OR REPLACE FUNCTION save_proposal_version(
  p_proposal_id  UUID,
  p_user_id      UUID,
  p_notes        TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_old        proposals%ROWTYPE;
  v_new_id     UUID;
  v_section    RECORD;
  v_new_section_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','sales_lead','finance')) THEN
    RAISE EXCEPTION 'Not authorized to revise a proposal';
  END IF;

  SELECT * INTO v_old FROM proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found'; END IF;

  UPDATE proposals SET is_current = false WHERE id = p_proposal_id;

  INSERT INTO proposals (
    proposal_group_id, version, is_current, proposal_number, proposal_name, customer_name, customer_contact,
    status, validity_until_date, overall_margin_percent, currency, linked_project_id, revision_notes, created_by
  ) VALUES (
    v_old.proposal_group_id, v_old.version + 1, true,
    regexp_replace(v_old.proposal_number, '-v[0-9]+$', '') || '-v' || (v_old.version + 1),
    v_old.proposal_name, v_old.customer_name, v_old.customer_contact,
    'Draft', v_old.validity_until_date, v_old.overall_margin_percent, v_old.currency, v_old.linked_project_id, p_notes, p_user_id
  ) RETURNING id INTO v_new_id;

  FOR v_section IN SELECT * FROM proposal_cost_sections WHERE proposal_id = p_proposal_id LOOP
    INSERT INTO proposal_cost_sections (proposal_id, category, margin_percent, notes)
      VALUES (v_new_id, v_section.category, v_section.margin_percent, v_section.notes)
      RETURNING id INTO v_new_section_id;

    INSERT INTO proposal_resource_plans (proposal_cost_section_id, designation, estimated_count, estimated_duration_weeks, rate_used, computed_cost, notes)
      SELECT v_new_section_id, designation, estimated_count, estimated_duration_weeks, rate_used, computed_cost, notes
      FROM proposal_resource_plans WHERE proposal_cost_section_id = v_section.id;

    INSERT INTO proposal_hardware_lines (proposal_cost_section_id, part_number, description, estimated_quantity, unit_cost, subtotal_internal_cost, notes)
      SELECT v_new_section_id, part_number, description, estimated_quantity, unit_cost, subtotal_internal_cost, notes
      FROM proposal_hardware_lines WHERE proposal_cost_section_id = v_section.id;

    INSERT INTO proposal_software_lines (proposal_cost_section_id, item_name, cost_type, unit_cost, duration_months, computed_cost, notes)
      SELECT v_new_section_id, item_name, cost_type, unit_cost, duration_months, computed_cost, notes
      FROM proposal_software_lines WHERE proposal_cost_section_id = v_section.id;

    INSERT INTO proposal_misc_lines (proposal_cost_section_id, item_name, cost, notes, line_type)
      SELECT v_new_section_id, item_name, cost, notes, line_type
      FROM proposal_misc_lines WHERE proposal_cost_section_id = v_section.id;
  END LOOP;

  INSERT INTO proposal_timeline (proposal_id, phase_name, start_offset_weeks, duration_weeks, linked_resource_plan_ids, sort_order)
    SELECT v_new_id, phase_name, start_offset_weeks, duration_weeks, '{}', sort_order
    FROM proposal_timeline WHERE proposal_id = p_proposal_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_proposal_version(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- STEP200: Assign each seeded employee (STEP191) to their real
-- department, so the Kanban board's default-to-your-department flow
-- (STEP198/199) actually applies to them.
--
--   Application: tapas, tagore, prem, akash, guru
--   Firmware:    sai, manjula, tharani
--   Hardware:    thippesh, maheshwari, mansoor
--
-- Matched by the email's local part (e.g. 'prem' matches prem@gmail.com)
-- rather than full_name, to avoid any typo/casing mismatch — same
-- approach as STEP194's keep-list matching.
-- ============================================================

DO $$
DECLARE
  v_org_id UUID;
  v_app_id UUID;
  v_fw_id  UUID;
  v_hw_id  UUID;
  v_count  INT;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'thingsalive';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organizations row with slug=thingsalive not found';
  END IF;

  SELECT id INTO v_app_id FROM departments WHERE organization_id = v_org_id AND name ILIKE 'Application';
  SELECT id INTO v_fw_id  FROM departments WHERE organization_id = v_org_id AND name ILIKE 'Firmware';
  SELECT id INTO v_hw_id  FROM departments WHERE organization_id = v_org_id AND name ILIKE 'Hardware';
  IF v_app_id IS NULL THEN RAISE EXCEPTION 'No department named "Application" found — check Settings -> Departments'; END IF;
  IF v_fw_id  IS NULL THEN RAISE EXCEPTION 'No department named "Firmware" found — check Settings -> Departments'; END IF;
  IF v_hw_id  IS NULL THEN RAISE EXCEPTION 'No department named "Hardware" found — check Settings -> Departments'; END IF;

  UPDATE profiles SET department_id = v_app_id
  WHERE organization_id = v_org_id
    AND split_part(email,'@',1) ILIKE ANY (ARRAY['tapas','tagore','prem','akash','guru']);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Application: % profile(s) updated', v_count;

  UPDATE profiles SET department_id = v_fw_id
  WHERE organization_id = v_org_id
    AND split_part(email,'@',1) ILIKE ANY (ARRAY['sai','manjula','tharani']);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Firmware: % profile(s) updated', v_count;

  UPDATE profiles SET department_id = v_hw_id
  WHERE organization_id = v_org_id
    AND split_part(email,'@',1) ILIKE ANY (ARRAY['thippesh','maheshwari','mansoor']);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Hardware: % profile(s) updated', v_count;
END $$;

-- Verify — full_name/email should each show the expected department
SELECT p.full_name, p.email, d.name AS department
FROM profiles p JOIN departments d ON d.id = p.department_id
WHERE d.name IN ('Application','Firmware','Hardware')
ORDER BY d.name, p.full_name;

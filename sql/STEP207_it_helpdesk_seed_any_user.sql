-- ============================================================
-- STEP207: let ANY authenticated org member trigger the IT Helpdesk
-- category/SLA seed, not just admin/ceo.
--
-- ensure_it_helpdesk_seed() (STEP160) previously no-op'd for anyone but
-- admin/ceo, and src/pages/ITHelpdeskPage.jsx only ever called it when
-- isAdmin — so the Category dropdown stayed completely empty for every
-- other role (manager/department_head agents, or a regular employee
-- submitting a ticket) until an admin/ceo happened to open this module
-- at least once. Seeding a handful of default category labels and SLA
-- targets is harmless, idempotent (WHERE NOT EXISTS) reference data —
-- there's no real reason to gate it behind a role check at all.
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_it_helpdesk_seed()
RETURNS VOID AS $$
DECLARE v_org UUID := current_org_id();
BEGIN
  INSERT INTO it_helpdesk_categories (organization_id, key, label, sort_order)
  SELECT v_org, x.key, x.label, x.ord FROM (VALUES
    ('hardware','Hardware',1),
    ('software','Software / Applications',2),
    ('access','Access & Accounts',3),
    ('network','Network / Connectivity',4),
    ('email','Email',5),
    ('security','Security',6),
    ('other','Other',7)
  ) AS x(key,label,ord)
  WHERE NOT EXISTS (SELECT 1 FROM it_helpdesk_categories c WHERE c.organization_id = v_org AND c.key = x.key);

  INSERT INTO it_helpdesk_sla_policies (organization_id, priority, first_response_minutes, resolution_minutes)
  SELECT v_org, x.priority, x.frm, x.rm FROM (VALUES
    ('urgent',30,240),
    ('high',120,1440),
    ('medium',480,4320),
    ('low',1440,10080)
  ) AS x(priority,frm,rm)
  WHERE NOT EXISTS (SELECT 1 FROM it_helpdesk_sla_policies s WHERE s.organization_id = v_org AND s.priority = x.priority);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION ensure_it_helpdesk_seed() TO authenticated;

NOTIFY pgrst, 'reload schema';

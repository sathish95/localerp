-- STEP267 — Project Portfolio dashboard (/portfolio)
-- Registers the module key so it can be toggled in Settings → Roles & Modules,
-- and hides it by default from roles outside management / finance. The route
-- itself is also limited to admin, ceo, manager, department_head and finance.
-- No new tables: the page reads existing project, task, cost and invoice data.

INSERT INTO modules (organization_id, key, label)
SELECT o.id, 'project-portfolio', 'Project Portfolio' FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM modules m WHERE m.organization_id = o.id AND m.key = 'project-portfolio');

INSERT INTO module_role_visibility (organization_id, module_key, role, visible)
SELECT m.organization_id, m.key, r.role_key, false
FROM modules m CROSS JOIN roles r
WHERE m.key = 'project-portfolio'
  AND r.role_key NOT IN ('admin','ceo','manager','department_head','finance')
ON CONFLICT (organization_id, module_key, role) DO NOTHING;

NOTIFY pgrst, 'reload schema';

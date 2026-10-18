-- STEP185: Industry-Adaptive Platform — Phase 8 (Enterprise Configuration).
--
-- One additive column only. Everything else this phase ships (Workspace
-- Administration tab, Task Templates admin, Work Types admin) is pure
-- application code against tables that already exist (workspace_profiles
-- from STEP180, task_templates/work_type_configs from STEP182) — no
-- migration needed for those.
--
-- dashboard_widget_keys follows the exact same "null = legacy, show
-- everything" posture as workspace_profiles.enabled_module_keys
-- (STEP180) and .terminology_overrides — every existing row gets NULL
-- (the column default), so DashboardPage.jsx's new per-section gates
-- (`!keys || keys.includes('x')`) resolve to "show it" unconditionally
-- for every org that hasn't opened the new Workspace Administration tab
-- and explicitly saved a widget selection.
--
-- Scope note: only the CEO and Finance dashboard branches in
-- DashboardPage.jsx get widget-visibility gates this phase (their
-- sections are comment-delimited, sibling <div>s in a flex column —
-- safe to wrap). The other ~8 role-branches (Employee, HR, Manager,
-- Procurement Lead, PM, CTO, Field Tech, the safe-fallback branch) do
-- not have that same easily-isolable structure; retrofitting them
-- safely is future work, not attempted blindly here.

ALTER TABLE workspace_profiles ADD COLUMN IF NOT EXISTS dashboard_widget_keys JSONB DEFAULT NULL;

NOTIFY pgrst, 'reload schema';

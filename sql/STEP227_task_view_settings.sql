-- ============================================================
-- STEP227: Task Detail View style — org-wide toggle between the
-- existing centered Task Detail modal ("modal", the default/original
-- design) and a new right-side sliding drawer ("drawer", Template 1),
-- configured from Settings → Task Detail View (admin/ceo only) and
-- read by every Task Management view (src/pages/TasksPage.jsx) so the
-- whole org sees the same presentation.
--
-- One row per organization (organization_id is the primary key, not a
-- separate id — there is exactly one setting per org, no list to key by
-- a secondary column).
-- ============================================================

CREATE TABLE IF NOT EXISTS task_view_settings (
  organization_id    UUID PRIMARY KEY DEFAULT current_org_id() REFERENCES organizations(id),
  detail_view_style  TEXT NOT NULL DEFAULT 'modal' CHECK (detail_view_style IN ('modal','drawer')),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE task_view_settings ENABLE ROW LEVEL SECURITY;

-- Any org member reads it (every role's Task Management page must know
-- which style to render); only admin/ceo can change it — same
-- convention as modules.js / llmSettings.js (see STEP47's kb_modules).
DROP POLICY IF EXISTS task_view_settings_select ON task_view_settings;
DROP POLICY IF EXISTS task_view_settings_write  ON task_view_settings;
CREATE POLICY task_view_settings_select ON task_view_settings FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY task_view_settings_write ON task_view_settings FOR ALL USING (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_view_settings TO authenticated;

NOTIFY pgrst, 'reload schema';

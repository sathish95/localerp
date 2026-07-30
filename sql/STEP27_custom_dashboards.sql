-- ============================================================
-- STEP27: Custom Dashboard Builder
-- Run in Supabase SQL editor after STEP26.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TABLE IF EXISTS custom_dashboard_widgets CASCADE;
DROP TABLE IF EXISTS custom_dashboards CASCADE;

CREATE TABLE custom_dashboards (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id     UUID        NOT NULL,        -- soft ref to projects
  name           TEXT        NOT NULL,
  period_type    TEXT        DEFAULT 'monthly' CHECK (period_type IN ('weekly','monthly','custom')),
  period_start   DATE,
  period_end     DATE,
  created_by     UUID,                         -- soft ref to profiles
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX custom_dash_project_idx ON custom_dashboards(project_id);
CREATE TRIGGER custom_dashboards_updated_at BEFORE UPDATE ON custom_dashboards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE custom_dashboard_widgets (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  dashboard_id UUID        NOT NULL,           -- soft ref to custom_dashboards
  widget_type  TEXT        NOT NULL,           -- e.g. 'sprint_progress','budget_health',...
  title        TEXT,                           -- user-editable label; defaults to widget catalog label
  config       JSONB       DEFAULT '{}'::jsonb,-- widget-specific settings, e.g. {"sprint_id":"..."}
  layout_x     INT         DEFAULT 0,
  layout_y     INT         DEFAULT 0,
  layout_w     INT         DEFAULT 4,
  layout_h     INT         DEFAULT 6,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX custom_dash_widgets_dash_idx ON custom_dashboard_widgets(dashboard_id);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
-- Matches this app's existing convention: readable by any authenticated user
-- (project visibility isn't restricted anywhere else in the app either);
-- edit/delete gated client-side by canEdit, same as ProjectsPage.jsx.
ALTER TABLE custom_dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dashboard_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_dash_select ON custom_dashboards FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY custom_dash_write  ON custom_dashboards FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY custom_dash_widgets_select ON custom_dashboard_widgets FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY custom_dash_widgets_write  ON custom_dashboard_widgets FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- RLS policies alone don't grant access — Postgres also requires base
-- table-level privileges for the PostgREST roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_dashboards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_dashboard_widgets TO authenticated;

NOTIFY pgrst, 'reload schema';

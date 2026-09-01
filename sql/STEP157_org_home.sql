-- ============================================================
-- STEP157: Org Home — a per-organization internal landing page
-- (Settings -> nothing new needed; admin/ceo/hr manage content
-- directly from the page itself, same pattern as AdminContentPage).
--
-- Three widgets, each backed by data that's either brand new
-- (announcements) or already exists and just needed a company-wide
-- read path (new joinees from profiles.date_joined, recent award
-- winners from award_approvals):
--
--   org_announcements        — new table. Read: permissive within org
--                               (matches this app's general RLS
--                               convention — see CLAUDE.md). Write:
--                               gated to is_hr_admin_ceo() (STEP66),
--                               the same helper award_participants_write
--                               (STEP120) already uses for HR-ish
--                               content ownership.
--   org_home_widget_config    — new table. Lets an org's admin/ceo
--                               turn a widget off entirely (e.g. an org
--                               that doesn't run awards yet). enabled
--                               defaults true so existing orgs see all
--                               three widgets with zero setup.
--   list_recent_award_winners — new SECURITY DEFINER function.
--                               award_approvals' own RLS (STEP120) is
--                               deliberately narrow (employee/manager/
--                               HR only) since it's a decision record;
--                               granted awards themselves are a
--                               celebration surface everyone in the org
--                               should see, so this function reads
--                               through that RLS the same way
--                               get_landing_link_public() (STEP75) and
--                               update_org_profile() (STEP126) read
--                               past a table's normal policy for one
--                               narrow, safe purpose.
-- New joinees need no new table or function — profiles' RLS (STEP96)
-- is already org-wide "open", and profiles.date_joined (STEP29)
-- already exists.
-- ============================================================

CREATE TABLE IF NOT EXISTS org_announcements (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL,
  pinned          BOOLEAN     NOT NULL DEFAULT false,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  publish_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE org_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_announcements_select ON org_announcements;
DROP POLICY IF EXISTS org_announcements_write  ON org_announcements;
CREATE POLICY org_announcements_select ON org_announcements FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY org_announcements_write ON org_announcements FOR ALL USING (
  organization_id = current_org_id() AND is_hr_admin_ceo()
) WITH CHECK (
  organization_id = current_org_id() AND is_hr_admin_ceo()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_announcements TO authenticated;

CREATE TABLE IF NOT EXISTS org_home_widget_config (
  organization_id UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  widget_key      TEXT    NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, widget_key)
);

ALTER TABLE org_home_widget_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_home_widget_config_select ON org_home_widget_config;
DROP POLICY IF EXISTS org_home_widget_config_write  ON org_home_widget_config;
CREATE POLICY org_home_widget_config_select ON org_home_widget_config FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY org_home_widget_config_write ON org_home_widget_config FOR ALL USING (
  organization_id = current_org_id() AND is_hr_admin_ceo()
) WITH CHECK (
  organization_id = current_org_id() AND is_hr_admin_ceo()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_home_widget_config TO authenticated;

CREATE OR REPLACE FUNCTION list_recent_award_winners(p_limit INT DEFAULT 8)
RETURNS TABLE (
  employee_id   UUID,
  employee_name TEXT,
  award_id      UUID,
  award_name    TEXT,
  category_name TEXT,
  award_date    DATE,
  final_score   NUMERIC
) AS $$
  SELECT
    p.id, p.full_name,
    a.id, a.name, c.name,
    aa.award_date, aa.final_score
  FROM award_approvals aa
  JOIN profiles p ON p.id = aa.employee_id
  JOIN performance_awards a ON a.id = aa.award_id
  LEFT JOIN award_categories c ON c.id = a.category_id
  WHERE aa.organization_id = current_org_id()
    AND aa.decision = 'granted'
  ORDER BY COALESCE(aa.award_date, aa.decided_at::date) DESC, aa.decided_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;

GRANT EXECUTE ON FUNCTION list_recent_award_winners(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

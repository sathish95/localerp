-- STEP175: ThingsAlive Wiki — Phase 8 (page-level access restrictions)
--
-- A page with zero rows here inherits normal org-wide access (matches
-- STEP168's comment that 'restricted' space visibility isn't enforced
-- either — both are handled together, here). A page with any row for a
-- given permission ('view'|'edit') becomes restricted to just those
-- subjects for that permission, plus admin/ceo and the page's own
-- creator (who can never lock themselves out).

CREATE TABLE IF NOT EXISTS wiki_page_restrictions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      UUID NOT NULL,                 -- soft ref -> wiki_pages(id)
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','role')),
  subject_id   TEXT NOT NULL,                 -- a profiles.id (as text) when subject_type='user', a role name when 'role'
  permission   TEXT NOT NULL CHECK (permission IN ('view','edit')),
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (page_id, subject_type, subject_id, permission)
);
CREATE INDEX IF NOT EXISTS wiki_page_restrictions_page_idx ON wiki_page_restrictions(page_id);

ALTER TABLE wiki_page_restrictions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION wiki_page_permitted(p_page_id UUID, p_permission TEXT DEFAULT 'view')
RETURNS BOOLEAN AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_role    TEXT;
  v_creator UUID;
  v_restricted BOOLEAN;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IN ('admin','ceo') THEN RETURN TRUE; END IF;

  SELECT created_by INTO v_creator FROM wiki_pages WHERE id = p_page_id;
  IF v_creator IS NOT NULL AND v_creator = v_uid THEN RETURN TRUE; END IF;

  SELECT EXISTS(SELECT 1 FROM wiki_page_restrictions WHERE page_id = p_page_id AND permission = p_permission) INTO v_restricted;
  IF NOT v_restricted THEN RETURN TRUE; END IF;

  RETURN EXISTS (
    SELECT 1 FROM wiki_page_restrictions r
    WHERE r.page_id = p_page_id AND r.permission = p_permission
      AND ((r.subject_type = 'user' AND r.subject_id = v_uid::text)
        OR (r.subject_type = 'role' AND r.subject_id = v_role))
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION wiki_page_permitted(UUID, TEXT) TO authenticated;

-- Managing restrictions themselves requires edit rights on the page.
DROP POLICY IF EXISTS wiki_page_restrictions_select ON wiki_page_restrictions;
DROP POLICY IF EXISTS wiki_page_restrictions_write  ON wiki_page_restrictions;
CREATE POLICY wiki_page_restrictions_select ON wiki_page_restrictions FOR SELECT USING (wiki_page_permitted(page_id, 'view'));
CREATE POLICY wiki_page_restrictions_write  ON wiki_page_restrictions FOR ALL
  USING (wiki_page_permitted(page_id, 'edit')) WITH CHECK (wiki_page_permitted(page_id, 'edit'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_page_restrictions TO authenticated;

-- Tighten the tables introduced in earlier wiki phases to respect
-- per-page restrictions now that they exist.
DROP POLICY IF EXISTS wiki_pages_select ON wiki_pages;
DROP POLICY IF EXISTS wiki_pages_write  ON wiki_pages;
CREATE POLICY wiki_pages_select ON wiki_pages FOR SELECT USING (organization_id = current_org_id() AND wiki_page_permitted(id, 'view'));
CREATE POLICY wiki_pages_write  ON wiki_pages FOR ALL
  USING (organization_id = current_org_id() AND wiki_page_permitted(id, 'edit'))
  WITH CHECK (organization_id = current_org_id() AND wiki_page_permitted(id, 'edit'));

DROP POLICY IF EXISTS wiki_page_versions_select ON wiki_page_versions;
CREATE POLICY wiki_page_versions_select ON wiki_page_versions FOR SELECT USING (
  organization_id = current_org_id() AND wiki_page_permitted(page_id, 'view')
);

DROP POLICY IF EXISTS wiki_page_comments_select ON wiki_page_comments;
DROP POLICY IF EXISTS wiki_page_comments_write  ON wiki_page_comments;
CREATE POLICY wiki_page_comments_select ON wiki_page_comments FOR SELECT USING (
  organization_id = current_org_id() AND wiki_page_permitted(page_id, 'view')
);
CREATE POLICY wiki_page_comments_write ON wiki_page_comments FOR ALL
  USING (organization_id = current_org_id() AND wiki_page_permitted(page_id, 'view'))
  WITH CHECK (organization_id = current_org_id() AND wiki_page_permitted(page_id, 'view'));

DROP POLICY IF EXISTS wiki_page_labels_select ON wiki_page_labels;
DROP POLICY IF EXISTS wiki_page_labels_write  ON wiki_page_labels;
CREATE POLICY wiki_page_labels_select ON wiki_page_labels FOR SELECT USING (wiki_page_permitted(page_id, 'view'));
CREATE POLICY wiki_page_labels_write  ON wiki_page_labels FOR ALL
  USING (wiki_page_permitted(page_id, 'edit')) WITH CHECK (wiki_page_permitted(page_id, 'edit'));

NOTIFY pgrst, 'reload schema';

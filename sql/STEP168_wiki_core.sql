-- STEP168: ThingsAlive Wiki — Phase 0/1 core schema (spaces, page tree)
--
-- First slice of a new Confluence-like docs module. Rich text + realtime
-- collaboration (Yjs state), version history, comments, search, labels,
-- page-level restrictions and attachments are separate, later migrations
-- (STEP169+) — this module ships phase-by-phase so each slice is testable
-- on its own.
--
-- wiki_spaces.visibility and wiki_space_members exist now so the shape is
-- in place, but 'restricted' visibility is NOT YET ENFORCED by the RLS
-- below (every org member can currently read every space/page) — that
-- enforcement lands with the page-level-restrictions phase, once
-- wiki_page_restrictions exists and the two can be designed together
-- rather than half-built twice.

CREATE TABLE IF NOT EXISTS wiki_spaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT,
  color           TEXT,
  visibility      TEXT NOT NULL DEFAULT 'org' CHECK (visibility IN ('org','restricted')),
  created_by      UUID REFERENCES profiles(id),
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS wiki_space_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   UUID NOT NULL,   -- soft ref -> wiki_spaces(id)
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (space_id, user_id)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  space_id        UUID NOT NULL,   -- soft ref -> wiki_spaces(id)
  parent_page_id  UUID,            -- soft self-ref -> wiki_pages(id)
  title           TEXT NOT NULL DEFAULT 'Untitled page',
  sort_order      INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by      UUID REFERENCES profiles(id),
  updated_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_pages_space_idx  ON wiki_pages(space_id);
CREATE INDEX IF NOT EXISTS wiki_pages_parent_idx ON wiki_pages(parent_page_id);

ALTER TABLE wiki_spaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_pages         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiki_spaces_select ON wiki_spaces;
DROP POLICY IF EXISTS wiki_spaces_write  ON wiki_spaces;
CREATE POLICY wiki_spaces_select ON wiki_spaces FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY wiki_spaces_write  ON wiki_spaces FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS wiki_space_members_select ON wiki_space_members;
DROP POLICY IF EXISTS wiki_space_members_write  ON wiki_space_members;
CREATE POLICY wiki_space_members_select ON wiki_space_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM wiki_spaces s WHERE s.id = space_id AND s.organization_id = current_org_id())
);
CREATE POLICY wiki_space_members_write ON wiki_space_members FOR ALL USING (
  EXISTS (SELECT 1 FROM wiki_spaces s WHERE s.id = space_id AND s.organization_id = current_org_id())
) WITH CHECK (
  EXISTS (SELECT 1 FROM wiki_spaces s WHERE s.id = space_id AND s.organization_id = current_org_id())
);

DROP POLICY IF EXISTS wiki_pages_select ON wiki_pages;
DROP POLICY IF EXISTS wiki_pages_write  ON wiki_pages;
CREATE POLICY wiki_pages_select ON wiki_pages FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY wiki_pages_write  ON wiki_pages FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_spaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_space_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_pages TO authenticated;

NOTIFY pgrst, 'reload schema';

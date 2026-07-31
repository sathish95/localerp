-- ============================================================
-- STEP90: Multi-tenant RLS retrofit — Batch 1 (Core/HR).
--
-- Covers the 14 tables in this module group whose CURRENT RLS policies
-- are fully known from tracked migrations (STEP23/27/28/29/30):
-- notifications, chat_rooms, chat_room_members, chat_messages,
-- app_events, custom_dashboards, custom_dashboard_widgets,
-- task_comments, employee_skills, allocations, leave_types, holidays,
-- capacity_snapshots, capacity_settings.
--
-- Deliberately NOT covered here:
--   profiles, departments — their current RLS policies are NOT in any
--     tracked SQL file (STEP89b diagnostic must run and be reviewed
--     first; touching these two blind risks silently leaving a real
--     policy in place or dropping something load-bearing).
--   skills, roles — explicitly commented as GLOBAL catalogs in their
--     own migrations (STEP29: "SKILLS (global catalog)"; STEP42's roles
--     table "bootstraps the permission system itself") — a deliberate
--     design choice to keep these shared across every organization
--     rather than force per-org duplication that wasn't asked for.
--     Revisit only if custom per-org roles/skill-catalogs become a
--     real requirement later.
--
-- Pattern per table: add organization_id (nullable) -> backfill every
-- existing row to the Default Organization -> SET NOT NULL -> set
-- DEFAULT current_org_id() (so existing, not-yet-updated app code that
-- inserts without knowing about this column still gets it populated
-- correctly for any REAL authenticated user going forward — the
-- default only resolves auth.uid() at insert time, so it's irrelevant
-- during this migration's own backfill, which is why backfill still
-- needs an explicit UPDATE first) -> rewrite every existing policy to
-- add "AND organization_id = current_org_id()" (or an
-- is_platform_super_admin() bypass on admin-only read policies, giving
-- the new platform Super Admin role real cross-org oversight).
-- ============================================================

-- ── 1. notifications ──
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE notifications SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE notifications ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN organization_id SET DEFAULT current_org_id();

DROP POLICY IF EXISTS notif_select ON notifications;
DROP POLICY IF EXISTS notif_update ON notifications;
DROP POLICY IF EXISTS notif_delete ON notifications;
DROP POLICY IF EXISTS notif_insert ON notifications;

CREATE POLICY notif_select ON notifications FOR SELECT USING (recipient_id = auth.uid() AND organization_id = current_org_id());
CREATE POLICY notif_update ON notifications FOR UPDATE USING (recipient_id = auth.uid() AND organization_id = current_org_id());
CREATE POLICY notif_delete ON notifications FOR DELETE USING (recipient_id = auth.uid() AND organization_id = current_org_id());
CREATE POLICY notif_insert ON notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND organization_id = current_org_id());

-- ── 2. chat_rooms / chat_room_members / chat_messages ──
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE chat_rooms SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE chat_rooms ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE chat_rooms ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE chat_room_members ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE chat_room_members SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE chat_room_members ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE chat_room_members ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE chat_messages SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE chat_messages ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN organization_id SET DEFAULT current_org_id();

DROP POLICY IF EXISTS chat_room_member_see       ON chat_rooms;
DROP POLICY IF EXISTS chat_room_admin_see         ON chat_rooms;
DROP POLICY IF EXISTS chat_room_canonical_lookup  ON chat_rooms;
DROP POLICY IF EXISTS chat_room_insert            ON chat_rooms;

CREATE POLICY chat_room_member_see ON chat_rooms FOR SELECT USING (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = id AND user_id = auth.uid())
);
CREATE POLICY chat_room_admin_see ON chat_rooms FOR SELECT USING (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY chat_room_canonical_lookup ON chat_rooms FOR SELECT USING (
  organization_id = current_org_id() AND canonical_id IS NOT NULL AND (
    canonical_id LIKE (auth.uid()::text || '::%')
    OR canonical_id LIKE ('%::' || auth.uid()::text)
  )
);
CREATE POLICY chat_room_insert ON chat_rooms FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND organization_id = current_org_id());

DROP POLICY IF EXISTS crm_own    ON chat_room_members;
DROP POLICY IF EXISTS crm_insert ON chat_room_members;

CREATE POLICY crm_own ON chat_room_members FOR SELECT USING (
  organization_id = current_org_id() AND (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
CREATE POLICY crm_insert ON chat_room_members FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND organization_id = current_org_id());

DROP POLICY IF EXISTS msg_member_see ON chat_messages;
DROP POLICY IF EXISTS msg_admin_see  ON chat_messages;
DROP POLICY IF EXISTS msg_insert     ON chat_messages;

CREATE POLICY msg_member_see ON chat_messages FOR SELECT USING (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = chat_messages.room_id AND user_id = auth.uid())
);
CREATE POLICY msg_admin_see ON chat_messages FOR SELECT USING (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY msg_insert ON chat_messages FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = chat_messages.room_id AND user_id = auth.uid())
);

-- ── 3. app_events ──
ALTER TABLE app_events ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE app_events SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE app_events ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE app_events ALTER COLUMN organization_id SET DEFAULT current_org_id();

DROP POLICY IF EXISTS ae_insert ON app_events;
DROP POLICY IF EXISTS ae_admin  ON app_events;

CREATE POLICY ae_insert ON app_events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND organization_id = current_org_id());
CREATE POLICY ae_admin ON app_events FOR SELECT USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);

-- ── 4. custom_dashboards / custom_dashboard_widgets ──
ALTER TABLE custom_dashboards ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE custom_dashboards SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE custom_dashboards ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE custom_dashboards ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE custom_dashboard_widgets ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE custom_dashboard_widgets SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE custom_dashboard_widgets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE custom_dashboard_widgets ALTER COLUMN organization_id SET DEFAULT current_org_id();

DROP POLICY IF EXISTS custom_dash_select ON custom_dashboards;
DROP POLICY IF EXISTS custom_dash_write  ON custom_dashboards;
DROP POLICY IF EXISTS custom_dash_widgets_select ON custom_dashboard_widgets;
DROP POLICY IF EXISTS custom_dash_widgets_write  ON custom_dashboard_widgets;

CREATE POLICY custom_dash_select ON custom_dashboards FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY custom_dash_write  ON custom_dashboards FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY custom_dash_widgets_select ON custom_dashboard_widgets FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY custom_dash_widgets_write  ON custom_dashboard_widgets FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- ── 5. task_comments ──
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE task_comments SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE task_comments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE task_comments ALTER COLUMN organization_id SET DEFAULT current_org_id();

DROP POLICY IF EXISTS task_comments_select ON task_comments;
DROP POLICY IF EXISTS task_comments_write  ON task_comments;

CREATE POLICY task_comments_select ON task_comments FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY task_comments_write  ON task_comments FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- ── 6. employee_skills / allocations ──
ALTER TABLE employee_skills ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE employee_skills SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE employee_skills ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE employee_skills ALTER COLUMN organization_id SET DEFAULT current_org_id();

ALTER TABLE allocations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE allocations SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE allocations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE allocations ALTER COLUMN organization_id SET DEFAULT current_org_id();

DROP POLICY IF EXISTS employee_skills_select ON employee_skills;
DROP POLICY IF EXISTS employee_skills_all    ON employee_skills;
DROP POLICY IF EXISTS allocations_select     ON allocations;
DROP POLICY IF EXISTS allocations_all        ON allocations;

CREATE POLICY employee_skills_select ON employee_skills FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY employee_skills_all    ON employee_skills FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY allocations_select ON allocations FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY allocations_all    ON allocations FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- ── 7. leave_types / holidays / capacity_snapshots ──
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE leave_types SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE leave_types ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE leave_types ALTER COLUMN organization_id SET DEFAULT current_org_id();
-- code was globally UNIQUE; now unique per-org so two orgs can each have their own 'sick' code.
ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_code_key;
ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_org_code_key;
ALTER TABLE leave_types ADD CONSTRAINT leave_types_org_code_key UNIQUE (organization_id, code);

ALTER TABLE holidays ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE holidays SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE holidays ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE holidays ALTER COLUMN organization_id SET DEFAULT current_org_id();
-- holiday_date was globally UNIQUE; now unique per-org so two orgs can each observe a holiday on the same date.
ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_holiday_date_key;
ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_org_date_key;
ALTER TABLE holidays ADD CONSTRAINT holidays_org_date_key UNIQUE (organization_id, holiday_date);

ALTER TABLE capacity_snapshots ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE capacity_snapshots SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE capacity_snapshots ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE capacity_snapshots ALTER COLUMN organization_id SET DEFAULT current_org_id();

DROP POLICY IF EXISTS leave_types_all        ON leave_types;
DROP POLICY IF EXISTS holidays_all           ON holidays;
DROP POLICY IF EXISTS capacity_snapshots_all ON capacity_snapshots;

CREATE POLICY leave_types_all        ON leave_types        FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY holidays_all           ON holidays           FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY capacity_snapshots_all ON capacity_snapshots FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- ── 8. capacity_settings — singleton-row redesign ──
-- Was `id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1)`, a hardcoded single
-- global row — structurally incompatible with per-org settings. Becomes
-- one row per organization, PK'd by organization_id directly (no
-- separate id column needed).
ALTER TABLE capacity_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE capacity_settings SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE capacity_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE capacity_settings DROP CONSTRAINT IF EXISTS capacity_settings_pkey;
ALTER TABLE capacity_settings DROP CONSTRAINT IF EXISTS capacity_settings_id_check;
ALTER TABLE capacity_settings ADD CONSTRAINT capacity_settings_pkey PRIMARY KEY (organization_id);
ALTER TABLE capacity_settings DROP COLUMN IF EXISTS id;

DROP POLICY IF EXISTS capacity_settings_all ON capacity_settings;
CREATE POLICY capacity_settings_all ON capacity_settings FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

NOTIFY pgrst, 'reload schema';

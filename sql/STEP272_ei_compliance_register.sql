-- STEP272 — Project lifecycle templates + Document Compliance Register
--
--  • ei_lifecycle_templates / _stages / _requirements: editable lifecycle
--    templates (government / public-sector with its 16 stages, EPC, IT …),
--    loaded on demand from supabase/functions/_shared/eiLifecycleData.js and
--    configurable per sector, authority, department and country. Never assumed
--    identical for every project.
--  • ei_project_registers: an OPTIONAL register per project, created from a
--    template; its stages and items are copied so each project can add, change,
--    waive or mark items not applicable.
--  • Items are satisfied by documents filed on the project by Email
--    Intelligence (matched by document type). Approval, waiver and N/A are only
--    ever recorded by a person — never inferred from an email. Expiry comes
--    from the item or the document's extracted expiry date.
--  • Evaluation lives in supabase/functions/_shared/eiCompliance.js
--    (evaluateRegister); ei_register_overview() is the cross-project summary.
-- Run after STEP263–271. Re-runnable.

CREATE OR REPLACE FUNCTION _ei_can_manage_registers() RETURNS BOOLEAN AS $$
  SELECT COALESCE(_outlook_role() IN ('admin','ceo','manager','department_head'), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── templates ──
CREATE TABLE IF NOT EXISTS ei_lifecycle_templates (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  key             TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  sector          TEXT,
  authority       TEXT,
  department      TEXT,
  country         TEXT,
  description     TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, key)
);
CREATE TABLE IF NOT EXISTS ei_lifecycle_stages (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  template_id     UUID        NOT NULL REFERENCES ei_lifecycle_templates(id) ON DELETE CASCADE,
  seq             INT         NOT NULL,
  name            TEXT        NOT NULL,
  description     TEXT
);
CREATE TABLE IF NOT EXISTS ei_lifecycle_requirements (
  id                 UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID     NOT NULL DEFAULT current_org_id(),
  template_id        UUID     NOT NULL REFERENCES ei_lifecycle_templates(id) ON DELETE CASCADE,
  stage_id           UUID     REFERENCES ei_lifecycle_stages(id) ON DELETE CASCADE,
  document_type_code TEXT     NOT NULL,
  label              TEXT,
  required           BOOLEAN  NOT NULL DEFAULT true,
  needs_approval     BOOLEAN  NOT NULL DEFAULT false,
  is_statutory       BOOLEAN  NOT NULL DEFAULT false,
  tracks_expiry      BOOLEAN  NOT NULL DEFAULT false,
  sort_order         INT      NOT NULL DEFAULT 100
);
CREATE INDEX IF NOT EXISTS ei_lifecycle_stages_t ON ei_lifecycle_stages (template_id, seq);
CREATE INDEX IF NOT EXISTS ei_lifecycle_requirements_t ON ei_lifecycle_requirements (template_id, stage_id);

-- ── per-project register ──
CREATE TABLE IF NOT EXISTS ei_project_registers (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  project_id      UUID        NOT NULL,              -- soft ref → projects
  template_id     UUID,
  name            TEXT        NOT NULL,
  expiring_days   INT         NOT NULL DEFAULT 30 CHECK (expiring_days BETWEEN 1 AND 365),
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id)
);
CREATE TABLE IF NOT EXISTS ei_project_register_stages (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  register_id     UUID        NOT NULL REFERENCES ei_project_registers(id) ON DELETE CASCADE,
  seq             INT         NOT NULL,
  name            TEXT        NOT NULL
);
CREATE TABLE IF NOT EXISTS ei_project_register_items (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID        NOT NULL DEFAULT current_org_id(),
  register_id        UUID        NOT NULL REFERENCES ei_project_registers(id) ON DELETE CASCADE,
  project_id         UUID        NOT NULL,
  stage_id           UUID        REFERENCES ei_project_register_stages(id) ON DELETE SET NULL,
  document_type_code TEXT        NOT NULL,
  label              TEXT,
  required           BOOLEAN     NOT NULL DEFAULT true,
  needs_approval     BOOLEAN     NOT NULL DEFAULT false,
  is_statutory       BOOLEAN     NOT NULL DEFAULT false,
  tracks_expiry      BOOLEAN     NOT NULL DEFAULT false,
  status             TEXT        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPROVED','WAIVED','NOT_APPLICABLE')),
  status_note        TEXT,
  approval_ref       TEXT,                           -- e.g. the authority's letter number
  approved_by        UUID,
  approved_at        TIMESTAMPTZ,
  expiry_date        DATE,
  due_date           DATE,
  owner_id           UUID,
  sort_order         INT         NOT NULL DEFAULT 100,
  updated_by         UUID,
  updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ei_register_items_reg ON ei_project_register_items (register_id, stage_id);
CREATE INDEX IF NOT EXISTS ei_register_items_proj ON ei_project_register_items (project_id);

CREATE TABLE IF NOT EXISTS ei_register_audit (
  id              BIGSERIAL   PRIMARY KEY,
  organization_id UUID        NOT NULL,
  project_id      UUID,
  item_id         UUID,
  action          TEXT        NOT NULL,
  before          JSONB,
  after           JSONB,
  actor_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ei_register_audit_proj ON ei_register_audit (project_id, created_at DESC);

-- Items: stamp who changed what; APPROVED needs a person; audit every change
CREATE OR REPLACE FUNCTION ei_register_items_trg() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := now();
    IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
      IF auth.uid() IS NULL THEN RAISE EXCEPTION 'An approval can only be recorded by a person'; END IF;
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    ELSIF NEW.status <> 'APPROVED' THEN NEW.approved_by := NULL; NEW.approved_at := NULL;
    END IF;
    IF NEW.status IN ('WAIVED','NOT_APPLICABLE') AND NULLIF(trim(NEW.status_note), '') IS NULL THEN
      RAISE EXCEPTION 'A note is required to waive an item or mark it not applicable';
    END IF;
  END IF;
  INSERT INTO ei_register_audit (organization_id, project_id, item_id, action, before, after, actor_id)
  VALUES (COALESCE(NEW.organization_id, OLD.organization_id), COALESCE(NEW.project_id, OLD.project_id), COALESCE(NEW.id, OLD.id), TG_OP,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END, auth.uid());
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS ei_register_items_before ON ei_project_register_items;
CREATE TRIGGER ei_register_items_before BEFORE INSERT OR UPDATE ON ei_project_register_items FOR EACH ROW EXECUTE FUNCTION ei_register_items_trg();
DROP TRIGGER IF EXISTS ei_register_items_after_delete ON ei_project_register_items;
CREATE TRIGGER ei_register_items_after_delete AFTER DELETE ON ei_project_register_items FOR EACH ROW EXECUTE FUNCTION ei_register_items_trg();

-- ── RLS ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ei_lifecycle_templates','ei_lifecycle_stages','ei_lifecycle_requirements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id())', t, t);
    EXECUTE format('CREATE POLICY %I_write ON %I FOR ALL USING (organization_id = current_org_id() AND _ei_can_manage_registers()) WITH CHECK (organization_id = current_org_id() AND _ei_can_manage_registers())', t, t);
  END LOOP;
END $$;

ALTER TABLE ei_project_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ei_project_register_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ei_project_register_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ei_register_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ei_project_registers_select ON ei_project_registers;
DROP POLICY IF EXISTS ei_project_registers_write ON ei_project_registers;
DROP POLICY IF EXISTS ei_register_stages_select ON ei_project_register_stages;
DROP POLICY IF EXISTS ei_register_stages_write ON ei_project_register_stages;
DROP POLICY IF EXISTS ei_register_items_select ON ei_project_register_items;
DROP POLICY IF EXISTS ei_register_items_write ON ei_project_register_items;
DROP POLICY IF EXISTS ei_register_audit_select ON ei_register_audit;
CREATE POLICY ei_project_registers_select ON ei_project_registers FOR SELECT USING (organization_id = current_org_id() AND _ei_project_member(project_id));
CREATE POLICY ei_project_registers_write ON ei_project_registers FOR ALL USING (organization_id = current_org_id() AND _ei_can_manage_registers()) WITH CHECK (organization_id = current_org_id() AND _ei_can_manage_registers());
CREATE POLICY ei_register_stages_select ON ei_project_register_stages FOR SELECT USING (organization_id = current_org_id()
  AND EXISTS (SELECT 1 FROM ei_project_registers r WHERE r.id = register_id AND _ei_project_member(r.project_id)));
CREATE POLICY ei_register_stages_write ON ei_project_register_stages FOR ALL USING (organization_id = current_org_id() AND _ei_can_manage_registers()) WITH CHECK (organization_id = current_org_id() AND _ei_can_manage_registers());
CREATE POLICY ei_register_items_select ON ei_project_register_items FOR SELECT USING (organization_id = current_org_id() AND _ei_project_member(project_id));
CREATE POLICY ei_register_items_write ON ei_project_register_items FOR ALL USING (organization_id = current_org_id() AND _ei_can_manage_registers()) WITH CHECK (organization_id = current_org_id() AND _ei_can_manage_registers());
CREATE POLICY ei_register_audit_select ON ei_register_audit FOR SELECT USING (organization_id = current_org_id() AND _ei_project_member(project_id));
REVOKE INSERT, UPDATE, DELETE ON ei_register_audit FROM anon, authenticated;

-- ── load starting templates (from eiLifecycleData.js); existing keys are kept ──
-- p = [{key,name,sector,description,stages:[{name, requirements:[{document_type_code,required,needs_approval,is_statutory,tracks_expiry}]}]}]
CREATE OR REPLACE FUNCTION ei_import_lifecycle_templates(p JSONB) RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); t JSONB; st JSONB; rq JSONB; v_tid UUID; v_sid UUID; v_seq INT; v_n INT := 0; v_sort INT;
BEGIN
  IF v_org IS NULL OR NOT _ei_can_manage_registers() THEN RAISE EXCEPTION 'Only admin, CEO or managers can load lifecycle templates'; END IF;
  FOR t IN SELECT * FROM jsonb_array_elements(p) LOOP
    IF EXISTS (SELECT 1 FROM ei_lifecycle_templates WHERE organization_id = v_org AND key = t->>'key') THEN CONTINUE; END IF;
    INSERT INTO ei_lifecycle_templates (organization_id, key, name, sector, description)
    VALUES (v_org, t->>'key', t->>'name', t->>'sector', t->>'description') RETURNING id INTO v_tid;
    v_seq := 0;
    FOR st IN SELECT * FROM jsonb_array_elements(t->'stages') LOOP
      v_seq := v_seq + 1;
      INSERT INTO ei_lifecycle_stages (organization_id, template_id, seq, name) VALUES (v_org, v_tid, v_seq, st->>'name') RETURNING id INTO v_sid;
      v_sort := 0;
      FOR rq IN SELECT * FROM jsonb_array_elements(st->'requirements') LOOP
        v_sort := v_sort + 10;
        INSERT INTO ei_lifecycle_requirements (organization_id, template_id, stage_id, document_type_code, label, required, needs_approval, is_statutory, tracks_expiry, sort_order)
        VALUES (v_org, v_tid, v_sid, rq->>'document_type_code',
                (SELECT name FROM ei_document_types d WHERE d.organization_id = v_org AND d.code = rq->>'document_type_code'),
                COALESCE((rq->>'required')::boolean, true), COALESCE((rq->>'needs_approval')::boolean, false),
                COALESCE((rq->>'is_statutory')::boolean, false), COALESCE((rq->>'tracks_expiry')::boolean, false), v_sort);
      END LOOP;
    END LOOP;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── create a project's register from a template (copies stages + items) ──
CREATE OR REPLACE FUNCTION ei_create_project_register(p_project UUID, p_template UUID) RETURNS UUID AS $$
DECLARE v_org UUID := current_org_id(); v_reg UUID; t ei_lifecycle_templates; s RECORD; v_sid UUID;
BEGIN
  IF NOT _ei_can_manage_registers() OR NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project AND organization_id = v_org) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF EXISTS (SELECT 1 FROM ei_project_registers WHERE project_id = p_project) THEN RAISE EXCEPTION 'This project already has a compliance register'; END IF;
  SELECT * INTO t FROM ei_lifecycle_templates WHERE id = p_template AND organization_id = v_org;
  INSERT INTO ei_project_registers (organization_id, project_id, template_id, name)
  VALUES (v_org, p_project, t.id, COALESCE(t.name, 'Compliance register')) RETURNING id INTO v_reg;
  IF t.id IS NOT NULL THEN
    FOR s IN SELECT * FROM ei_lifecycle_stages WHERE template_id = t.id ORDER BY seq LOOP
      INSERT INTO ei_project_register_stages (organization_id, register_id, seq, name) VALUES (v_org, v_reg, s.seq, s.name) RETURNING id INTO v_sid;
      INSERT INTO ei_project_register_items (organization_id, register_id, project_id, stage_id, document_type_code, label, required, needs_approval, is_statutory, tracks_expiry, sort_order)
      SELECT v_org, v_reg, p_project, v_sid, r.document_type_code,
             COALESCE(r.label, (SELECT name FROM ei_document_types d WHERE d.organization_id = v_org AND d.code = r.document_type_code), initcap(replace(lower(r.document_type_code), '_', ' '))),
             r.required, r.needs_approval, r.is_statutory, r.tracks_expiry, r.sort_order
      FROM ei_lifecycle_requirements r WHERE r.stage_id = s.id ORDER BY r.sort_order;
    END LOOP;
  END IF;
  RETURN v_reg;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── cross-project overview (approximate: a requirement counts as received when a
--    current filed document of its type exists on the project) ──
CREATE OR REPLACE FUNCTION ei_register_overview() RETURNS TABLE (
  project_id UUID, register_id UUID, register_name TEXT, required INT, satisfied INT, missing INT, statutory_missing INT,
  awaiting_approval INT, expired INT, expiring INT, overdue INT) AS $$
  WITH items AS (
    SELECT i.*, r.expiring_days,
      EXISTS (SELECT 1 FROM ei_attachments a WHERE a.project_id = i.project_id AND a.doc_type_code = i.document_type_code
              AND a.status = 'PROCESSED' AND a.project_status IN ('MATCHED','CONFIRMED') AND a.is_current) AS received,
      COALESCE(i.expiry_date, (SELECT max((a.extraction #>> '{expiry_date,value}')::date)
                               FROM ei_attachments a WHERE a.project_id = i.project_id AND a.doc_type_code = i.document_type_code AND a.is_current
                                 AND (a.extraction #>> '{expiry_date,value}') ~ '^\d{4}-\d{2}-\d{2}$')) AS exp
    FROM ei_project_register_items i JOIN ei_project_registers r ON r.id = i.register_id
    WHERE i.organization_id = current_org_id() AND _ei_project_member(i.project_id)
  )
  SELECT r.project_id, r.id, r.name,
    count(*) FILTER (WHERE i.required AND i.status <> 'NOT_APPLICABLE')::int,
    count(*) FILTER (WHERE i.required AND (i.status IN ('APPROVED','WAIVED') OR (i.received AND NOT i.needs_approval)) AND NOT (i.tracks_expiry AND i.exp < CURRENT_DATE))::int,
    count(*) FILTER (WHERE i.required AND i.status = 'OPEN' AND NOT i.received)::int,
    count(*) FILTER (WHERE i.required AND i.is_statutory AND i.status = 'OPEN' AND NOT i.received)::int,
    count(*) FILTER (WHERE i.status = 'OPEN' AND i.received AND i.needs_approval)::int,
    count(*) FILTER (WHERE i.tracks_expiry AND i.status NOT IN ('WAIVED','NOT_APPLICABLE') AND i.exp < CURRENT_DATE)::int,
    count(*) FILTER (WHERE i.tracks_expiry AND i.status NOT IN ('WAIVED','NOT_APPLICABLE') AND i.exp BETWEEN CURRENT_DATE AND CURRENT_DATE + i.expiring_days)::int,
    count(*) FILTER (WHERE i.status = 'OPEN' AND i.due_date < CURRENT_DATE AND NOT (i.received AND NOT i.needs_approval))::int
  FROM ei_project_registers r JOIN items i ON i.register_id = r.id
  GROUP BY r.project_id, r.id, r.name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION ei_import_lifecycle_templates(JSONB), ei_create_project_register(UUID, UUID), ei_register_overview() TO authenticated;

NOTIFY pgrst, 'reload schema';

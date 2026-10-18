-- STEP263 — Email Intelligence: admin-configurable classification, document
-- types, matching settings, versioned configuration (needs STEP261)
--
-- Routine business configuration lives in these tables, never in code:
--
--   ei_email_categories    business intents (Invoice Submission, Payment
--                          Follow-up …): priority, confidence threshold,
--                          workflow handler, department, review rule.
--   ei_keyword_rules       phrases → category and/or document type, with match
--                          locations (subject, body, sender, sender domain,
--                          attachment filename, attachment text), match mode
--                          (PHRASE / WORD / PARTIAL / REGEX), case
--                          sensitivity, ANY/ALL terms, exclusion rules, vendor
--                          scope, weight (priority), effective dates.
--   ei_document_types      attachment classes (Tax Invoice, Delivery Challan …):
--                          formats, extraction schema (fields + optional
--                          patterns), required fields, destination, duplicate
--                          keys, threshold, review rule.
--   ei_vendor_aliases      extra names / emails / domains / GSTINs that
--                          identify an EXISTING vendor (vendor master stays the
--                          single source of truth; aliases only point at it).
--   ei_settings            per-org JSON: AI use, confidence bands, matching
--                          tolerances, attachment limits.
--   ei_config_versions     immutable published snapshots (version 1, 2 …).
--                          The worker always processes with the latest
--                          published snapshot and stamps its number on every
--                          email / attachment, so history stays traceable.
--                          Rollback re-publishes an older snapshot as a new
--                          version and restores the editable tables from it.
--   ei_config_audit        before/after of every config change (triggers).
--
-- Workflow handlers (ei_email_categories.workflow_key) are the services
-- that actually exist in the app: AP_INVOICE (invoice intake into the
-- existing invoices register), PROJECT_ISSUE_TASK (the STEP261 flow),
-- REVIEW_QUEUE, VENDOR_VERIFICATION (sensitive vendor-master changes —
-- never auto-applied), RECORD_ONLY (link + log), IGNORE.
--
-- Defaults are seeded per organization by ei_seed_defaults(org) as editable
-- rows. Roles: admin/ceo/finance edit; managers read. Safe to re-run.

-- ── helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _ei_can_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(_outlook_role() IN ('admin','ceo','finance'), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _ei_can_view() RETURNS BOOLEAN AS $$
  SELECT COALESCE(_outlook_role() IN ('admin','ceo','finance','manager','department_head'), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── configuration tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ei_email_categories (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID        NOT NULL DEFAULT current_org_id(),
  code                  TEXT        NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  name                  TEXT        NOT NULL,
  description           TEXT,
  group_name            TEXT,
  default_priority      TEXT        NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low','medium','high','critical')),
  confidence_threshold  NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (confidence_threshold BETWEEN 0.30 AND 1.00),
  workflow_key          TEXT        NOT NULL DEFAULT 'REVIEW_QUEUE'
                        CHECK (workflow_key IN ('AP_INVOICE','PROJECT_ISSUE_TASK','REVIEW_QUEUE','VENDOR_VERIFICATION','RECORD_ONLY','IGNORE')),
  department_id         UUID,                      -- soft ref → departments (review routing)
  review_role           TEXT        NOT NULL DEFAULT 'manager' CHECK (review_role IN ('admin','ceo','finance','manager','department_head','hr')),
  requires_review       BOOLEAN     NOT NULL DEFAULT false,
  related_document_types TEXT[]     NOT NULL DEFAULT '{}',
  required_fields       TEXT[]      NOT NULL DEFAULT '{}',
  sort_order            INT         NOT NULL DEFAULT 100,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  effective_from        DATE,
  effective_to          DATE,
  created_by            UUID        DEFAULT auth.uid(),
  updated_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS ei_document_types (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID        NOT NULL DEFAULT current_org_id(),
  code                  TEXT        NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  name                  TEXT        NOT NULL,
  description           TEXT,
  formats               TEXT[]      NOT NULL DEFAULT ARRAY['pdf','jpg','jpeg','png','xlsx','xls','csv','docx','doc','xml'],
  fields                JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label,type:text|number|date|money|gstin,pattern?}]
  required_fields       TEXT[]      NOT NULL DEFAULT '{}',
  duplicate_keys        TEXT[]      NOT NULL DEFAULT '{}',          -- e.g. {vendor_id,invoice_number}
  destination           TEXT        NOT NULL DEFAULT 'NONE' CHECK (destination IN ('INVOICE_REGISTER','CREDIT_NOTE_REVIEW','REVIEW_QUEUE','NONE')),
  confidence_threshold  NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (confidence_threshold BETWEEN 0.30 AND 1.00),
  requires_review       BOOLEAN     NOT NULL DEFAULT false,
  sort_order            INT         NOT NULL DEFAULT 100,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        DEFAULT auth.uid(),
  updated_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS ei_keyword_rules (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID        NOT NULL DEFAULT current_org_id(),
  name                  TEXT        NOT NULL,
  terms                 TEXT[]      NOT NULL CHECK (cardinality(terms) BETWEEN 1 AND 20),
  combine               TEXT        NOT NULL DEFAULT 'ANY' CHECK (combine IN ('ANY','ALL')),
  locations             TEXT[]      NOT NULL DEFAULT ARRAY['SUBJECT','BODY'],
  match_mode            TEXT        NOT NULL DEFAULT 'PHRASE' CHECK (match_mode IN ('PHRASE','WORD','PARTIAL','REGEX')),
  case_sensitive        BOOLEAN     NOT NULL DEFAULT false,
  is_exclusion          BOOLEAN     NOT NULL DEFAULT false,         -- vetoes the category / document type
  category_code         TEXT,                                       -- target intent (or NULL)
  document_type_code    TEXT,                                       -- target attachment class (or NULL)
  weight                INT         NOT NULL DEFAULT 50 CHECK (weight BETWEEN 1 AND 100),
  vendor_ids            UUID[]      NOT NULL DEFAULT '{}',          -- empty = any sender
  proposed_action       TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  effective_from        DATE,
  effective_to          DATE,
  created_by            UUID        DEFAULT auth.uid(),
  updated_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  CHECK (category_code IS NOT NULL OR document_type_code IS NOT NULL),
  CHECK (locations <@ ARRAY['SUBJECT','BODY','SENDER','SENDER_DOMAIN','ATTACHMENT_NAME','ATTACHMENT_TEXT']::text[] AND cardinality(locations) > 0)
);
CREATE INDEX IF NOT EXISTS ei_keyword_rules_org ON ei_keyword_rules (organization_id, is_active);

CREATE TABLE IF NOT EXISTS ei_vendor_aliases (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL DEFAULT current_org_id(),
  vendor_id        UUID        NOT NULL,                  -- soft ref → vendors (must exist, checked by trigger)
  alias_type       TEXT        NOT NULL CHECK (alias_type IN ('NAME','EMAIL','DOMAIN','GSTIN')),
  value            TEXT        NOT NULL,
  verified         BOOLEAN     NOT NULL DEFAULT false,    -- only verified EMAIL/DOMAIN aliases identify a sender on their own
  note             TEXT,
  created_by       UUID        DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ei_vendor_aliases_uniq ON ei_vendor_aliases (organization_id, alias_type, lower(value));

CREATE TABLE IF NOT EXISTS ei_settings (
  organization_id  UUID        PRIMARY KEY DEFAULT current_org_id(),
  settings         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by       UUID,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ei_config_versions (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL,
  version          INT         NOT NULL,
  snapshot         JSONB       NOT NULL,
  note             TEXT,
  restored_from    INT,                                   -- set when this version is a rollback
  published_by     UUID,
  published_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, version)
);

CREATE TABLE IF NOT EXISTS ei_config_audit (
  id               BIGSERIAL   PRIMARY KEY,
  organization_id  UUID        NOT NULL,
  entity           TEXT        NOT NULL,
  entity_id        TEXT,
  action           TEXT        NOT NULL,                  -- INSERT | UPDATE | DELETE | PUBLISH | ROLLBACK | SEED
  before           JSONB,
  after            JSONB,
  actor_id         UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ei_config_audit_org ON ei_config_audit (organization_id, created_at DESC);

-- ── validation + audit triggers ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION ei_config_before() RETURNS TRIGGER AS $$
DECLARE t TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.organization_id := OLD.organization_id;
    NEW.updated_at := now();
    IF TG_TABLE_NAME <> 'ei_vendor_aliases' THEN NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by); END IF;
  END IF;
  IF TG_TABLE_NAME = 'ei_keyword_rules' THEN
    NEW.terms := ARRAY(SELECT left(trim(x), 200) FROM unnest(NEW.terms) x WHERE trim(x) <> '');
    IF cardinality(NEW.terms) = 0 THEN RAISE EXCEPTION 'A rule needs at least one keyword or phrase'; END IF;
    IF NEW.match_mode = 'REGEX' THEN
      FOREACH t IN ARRAY NEW.terms LOOP
        -- reject patterns prone to catastrophic backtracking, and invalid ones
        IF length(t) > 200 OR t ~ '\([^)]*[+*][^)]*\)[+*{]' THEN RAISE EXCEPTION 'Pattern "%" is too complex (nested repetition)', t; END IF;
        BEGIN PERFORM 'x' ~ t; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid pattern "%": %', t, SQLERRM; END;
      END LOOP;
    END IF;
    IF NEW.category_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ei_email_categories c WHERE c.organization_id = NEW.organization_id AND c.code = NEW.category_code) THEN
      RAISE EXCEPTION 'Unknown email category %', NEW.category_code;
    END IF;
    IF NEW.document_type_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ei_document_types d WHERE d.organization_id = NEW.organization_id AND d.code = NEW.document_type_code) THEN
      RAISE EXCEPTION 'Unknown document type %', NEW.document_type_code;
    END IF;
  ELSIF TG_TABLE_NAME = 'ei_vendor_aliases' THEN
    NEW.value := trim(NEW.value);
    IF NEW.alias_type IN ('EMAIL','DOMAIN','GSTIN') THEN NEW.value := lower(NEW.value); END IF;
    IF NEW.alias_type = 'GSTIN' THEN NEW.value := upper(NEW.value); END IF;
    IF NOT EXISTS (SELECT 1 FROM vendors v WHERE v.id = NEW.vendor_id AND v.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'Vendor not found in this organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'ei_document_types' THEN
    IF jsonb_typeof(NEW.fields) <> 'array' THEN RAISE EXCEPTION 'fields must be a JSON array'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('ei_email_categories','ei_keyword_rules') THEN   -- nested: other tables have no such columns
    IF NEW.effective_from IS NOT NULL AND NEW.effective_to IS NOT NULL AND NEW.effective_to < NEW.effective_from THEN
      RAISE EXCEPTION 'Effective-to date is before effective-from';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION ei_config_audit_trg() RETURNS TRIGGER AS $$
DECLARE v_org UUID; v_id TEXT;
BEGIN
  v_org := COALESCE((to_jsonb(NEW)->>'organization_id')::uuid, (to_jsonb(OLD)->>'organization_id')::uuid);
  v_id  := COALESCE(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id', to_jsonb(NEW)->>'organization_id');
  IF current_setting('ei.seeding', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  INSERT INTO ei_config_audit (organization_id, entity, entity_id, action, before, after, actor_id)
  VALUES (v_org, TG_TABLE_NAME, v_id, TG_OP,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END, auth.uid());
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ei_email_categories','ei_document_types','ei_keyword_rules','ei_vendor_aliases','ei_settings'] LOOP
    IF t <> 'ei_settings' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I_before ON %I', t, t);
      EXECUTE format('CREATE TRIGGER %I_before BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION ei_config_before()', t, t);
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ei_config_audit_trg()', t, t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (organization_id = current_org_id() AND _ei_can_view())', t, t);
    EXECUTE format('CREATE POLICY %I_write ON %I FOR ALL USING (organization_id = current_org_id() AND _ei_can_admin()) WITH CHECK (organization_id = current_org_id() AND _ei_can_admin())', t, t);
  END LOOP;
END $$;

ALTER TABLE ei_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ei_config_audit    ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ei_config_versions_select ON ei_config_versions;
DROP POLICY IF EXISTS ei_config_audit_select ON ei_config_audit;
CREATE POLICY ei_config_versions_select ON ei_config_versions FOR SELECT USING (organization_id = current_org_id() AND _ei_can_view());
CREATE POLICY ei_config_audit_select    ON ei_config_audit    FOR SELECT USING (organization_id = current_org_id() AND _ei_can_view());
REVOKE INSERT, UPDATE, DELETE ON ei_config_versions, ei_config_audit FROM anon, authenticated;

-- ── snapshot / publish / rollback ────────────────────────────────────────
CREATE OR REPLACE FUNCTION _ei_snapshot(p_org UUID) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'organization_id' - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' ORDER BY c.sort_order, c.code) FROM ei_email_categories c WHERE c.organization_id = p_org), '[]'::jsonb),
    'document_types', COALESCE((SELECT jsonb_agg(to_jsonb(d) - 'organization_id' - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' ORDER BY d.sort_order, d.code) FROM ei_document_types d WHERE d.organization_id = p_org), '[]'::jsonb),
    'rules', COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'organization_id' - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' ORDER BY r.weight DESC, r.name) FROM ei_keyword_rules r WHERE r.organization_id = p_org), '[]'::jsonb),
    'vendor_aliases', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'vendor_id', a.vendor_id, 'alias_type', a.alias_type, 'value', a.value, 'verified', a.verified)) FROM ei_vendor_aliases a WHERE a.organization_id = p_org), '[]'::jsonb),
    'settings', COALESCE((SELECT settings FROM ei_settings WHERE organization_id = p_org), '{}'::jsonb))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Draft vs published: what would a publish change?
CREATE OR REPLACE FUNCTION ei_config_diff() RETURNS JSONB AS $$
DECLARE v_org UUID := current_org_id(); v_cur JSONB; v_pub JSONB; v_ver INT; r JSONB := '{}'::jsonb; k TEXT;
BEGIN
  IF NOT _ei_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  v_cur := _ei_snapshot(v_org);
  SELECT snapshot, version INTO v_pub, v_ver FROM ei_config_versions WHERE organization_id = v_org ORDER BY version DESC LIMIT 1;
  FOREACH k IN ARRAY ARRAY['categories','document_types','rules','vendor_aliases'] LOOP
    r := r || jsonb_build_object(k, jsonb_build_object(
      'added',   (SELECT count(*) FROM jsonb_array_elements(v_cur->k) a WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_pub->k, '[]')) b WHERE b->>'id' = a->>'id')),
      'removed', (SELECT count(*) FROM jsonb_array_elements(COALESCE(v_pub->k, '[]')) b WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cur->k) a WHERE a->>'id' = b->>'id')),
      'changed', (SELECT count(*) FROM jsonb_array_elements(v_cur->k) a JOIN jsonb_array_elements(COALESCE(v_pub->k, '[]')) b ON b->>'id' = a->>'id' WHERE a <> b)));
  END LOOP;
  RETURN r || jsonb_build_object('settings_changed', COALESCE(v_cur->'settings' <> v_pub->'settings', true), 'published_version', v_ver,
                                 'unpublished', v_pub IS NULL OR v_cur <> v_pub);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Publish: validate, snapshot, version++. Only admin/ceo/finance.
CREATE OR REPLACE FUNCTION ei_publish_config(p_note TEXT DEFAULT NULL) RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); v_snap JSONB; v_ver INT; v_bad TEXT;
BEGIN
  IF v_org IS NULL OR NOT _ei_can_admin() THEN RAISE EXCEPTION 'Only admin, CEO or finance can publish configuration'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ei_publish:' || v_org));
  -- validation: active rules must point at active targets
  SELECT string_agg(r.name, ', ') INTO v_bad FROM ei_keyword_rules r
   WHERE r.organization_id = v_org AND r.is_active AND (
     (r.category_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ei_email_categories c WHERE c.organization_id = v_org AND c.code = r.category_code AND c.is_active))
     OR (r.document_type_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ei_document_types d WHERE d.organization_id = v_org AND d.code = r.document_type_code AND d.is_active)));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'These active rules point at an inactive or missing category / document type: %', v_bad; END IF;
  IF NOT EXISTS (SELECT 1 FROM ei_email_categories WHERE organization_id = v_org AND is_active) THEN RAISE EXCEPTION 'At least one active email category is required'; END IF;
  v_snap := _ei_snapshot(v_org);
  SELECT COALESCE(max(version), 0) + 1 INTO v_ver FROM ei_config_versions WHERE organization_id = v_org;
  INSERT INTO ei_config_versions (organization_id, version, snapshot, note, published_by) VALUES (v_org, v_ver, v_snap, NULLIF(trim(p_note), ''), auth.uid());
  INSERT INTO ei_config_audit (organization_id, entity, entity_id, action, after, actor_id)
  VALUES (v_org, 'ei_config_versions', v_ver::text, 'PUBLISH', jsonb_build_object('version', v_ver, 'note', p_note), auth.uid());
  RETURN v_ver;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Rollback: restore the editable tables from version N and publish that as a new version.
CREATE OR REPLACE FUNCTION ei_rollback_config(p_version INT, p_note TEXT DEFAULT NULL) RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); v_snap JSONB; v_ver INT;
BEGIN
  IF v_org IS NULL OR NOT _ei_can_admin() THEN RAISE EXCEPTION 'Only admin, CEO or finance can roll back configuration'; END IF;
  SELECT snapshot INTO v_snap FROM ei_config_versions WHERE organization_id = v_org AND version = p_version;
  IF v_snap IS NULL THEN RAISE EXCEPTION 'Version % not found', p_version; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ei_publish:' || v_org));
  PERFORM set_config('ei.seeding', 'on', true);    -- one ROLLBACK audit row instead of hundreds
  DELETE FROM ei_keyword_rules WHERE organization_id = v_org;
  DELETE FROM ei_email_categories WHERE organization_id = v_org;
  DELETE FROM ei_document_types WHERE organization_id = v_org;
  DELETE FROM ei_vendor_aliases WHERE organization_id = v_org;
  INSERT INTO ei_email_categories SELECT * FROM jsonb_populate_recordset(NULL::ei_email_categories,
    (SELECT jsonb_agg(x || jsonb_build_object('organization_id', v_org)) FROM jsonb_array_elements(v_snap->'categories') x));
  INSERT INTO ei_document_types SELECT * FROM jsonb_populate_recordset(NULL::ei_document_types,
    (SELECT jsonb_agg(x || jsonb_build_object('organization_id', v_org)) FROM jsonb_array_elements(v_snap->'document_types') x));
  INSERT INTO ei_keyword_rules SELECT * FROM jsonb_populate_recordset(NULL::ei_keyword_rules,
    (SELECT jsonb_agg(x || jsonb_build_object('organization_id', v_org)) FROM jsonb_array_elements(v_snap->'rules') x));
  INSERT INTO ei_vendor_aliases (id, organization_id, vendor_id, alias_type, value, verified)
  SELECT (x->>'id')::uuid, v_org, (x->>'vendor_id')::uuid, x->>'alias_type', x->>'value', (x->>'verified')::boolean
    FROM jsonb_array_elements(COALESCE(v_snap->'vendor_aliases', '[]')) x
   WHERE EXISTS (SELECT 1 FROM vendors v WHERE v.id = (x->>'vendor_id')::uuid);
  INSERT INTO ei_settings (organization_id, settings, updated_by) VALUES (v_org, COALESCE(v_snap->'settings', '{}'), auth.uid())
  ON CONFLICT (organization_id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = auth.uid(), updated_at = now();
  PERFORM set_config('ei.seeding', 'off', true);
  SELECT COALESCE(max(version), 0) + 1 INTO v_ver FROM ei_config_versions WHERE organization_id = v_org;
  INSERT INTO ei_config_versions (organization_id, version, snapshot, note, restored_from, published_by)
  VALUES (v_org, v_ver, _ei_snapshot(v_org), COALESCE(NULLIF(trim(p_note), ''), 'Rollback to version ' || p_version), p_version, auth.uid());
  INSERT INTO ei_config_audit (organization_id, entity, entity_id, action, after, actor_id)
  VALUES (v_org, 'ei_config_versions', v_ver::text, 'ROLLBACK', jsonb_build_object('version', v_ver, 'restored_from', p_version), auth.uid());
  RETURN v_ver;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Worker: the latest published config of an org (service role).
CREATE OR REPLACE FUNCTION ei_active_config(p_org UUID) RETURNS TABLE (version INT, snapshot JSONB) AS $$
  SELECT version, snapshot FROM ei_config_versions WHERE organization_id = p_org ORDER BY version DESC LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION ei_active_config(UUID), _ei_snapshot(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ei_active_config(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION ei_publish_config(TEXT), ei_rollback_config(INT, TEXT), ei_config_diff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ei_publish_config(TEXT), ei_rollback_config(INT, TEXT), ei_config_diff() TO authenticated;

NOTIFY pgrst, 'reload schema';

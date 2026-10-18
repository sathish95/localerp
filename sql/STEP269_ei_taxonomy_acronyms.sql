-- STEP269 — Email Intelligence: document taxonomy hierarchy + acronym registry
--
--  • ei_document_types gains family / category / industries / aliases. The
--    baseline taxonomy (≈500 types across 26 families, supabase/functions/
--    _shared/eiTaxonomyData.js) is loaded on demand from the configuration
--    centre through ei_import_taxonomy() — into the DRAFT config, like any
--    other edit; nothing changes for the worker until it is published.
--  • ei_acronyms: one row per MEANING of an acronym, optionally scoped to a
--    customer or project, with context words that support it. The worker only
--    uses a meaning when the context clearly prefers it; an acronym with
--    several plausible meanings never decides a document type on its own.
--  • Acronyms are part of the versioned configuration (snapshot, diff,
--    rollback) and audited like the other configuration tables.
-- Run after STEP263–268. Re-runnable.

-- ── 1. taxonomy columns ──
ALTER TABLE ei_document_types ADD COLUMN IF NOT EXISTS family     TEXT;
ALTER TABLE ei_document_types ADD COLUMN IF NOT EXISTS category   TEXT;
ALTER TABLE ei_document_types ADD COLUMN IF NOT EXISTS industries TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ei_document_types ADD COLUMN IF NOT EXISTS aliases    TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ei_document_types_family ON ei_document_types (organization_id, family);

-- ── 2. acronym registry ──
CREATE TABLE IF NOT EXISTS ei_acronyms (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL DEFAULT current_org_id(),
  acronym             TEXT        NOT NULL CHECK (length(trim(acronym)) BETWEEN 1 AND 20),
  expansion           TEXT        NOT NULL CHECK (length(trim(expansion)) BETWEEN 2 AND 200),
  document_type_code  TEXT,                         -- NULL = a meaning, not a document type
  industries          TEXT[]      NOT NULL DEFAULT '{}',
  context_terms       TEXT[]      NOT NULL DEFAULT '{}',   -- words that support this meaning
  customer_id         UUID,                         -- soft ref: only for this client
  project_id          UUID,                         -- soft ref: only for this project
  region              TEXT,
  notes               TEXT,
  is_approved         BOOLEAN     NOT NULL DEFAULT true,   -- false = suggested, waiting for an admin
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_by          UUID        DEFAULT auth.uid(),
  updated_by          UUID,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ei_acronyms_uniq ON ei_acronyms
  (organization_id, upper(acronym), lower(expansion), COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ei_acronyms_lookup ON ei_acronyms (organization_id, upper(acronym));

CREATE OR REPLACE FUNCTION ei_acronyms_norm() RETURNS TRIGGER AS $$
BEGIN
  NEW.acronym := trim(NEW.acronym);
  NEW.expansion := trim(NEW.expansion);
  NEW.context_terms := ARRAY(SELECT DISTINCT lower(trim(x)) FROM unnest(NEW.context_terms) x WHERE trim(x) <> '');
  NEW.industries := ARRAY(SELECT DISTINCT lower(trim(x)) FROM unnest(NEW.industries) x WHERE trim(x) <> '');
  IF NEW.document_type_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ei_document_types d WHERE d.organization_id = NEW.organization_id AND d.code = NEW.document_type_code) THEN
    RAISE EXCEPTION 'Unknown document type %', NEW.document_type_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS ei_acronyms_norm ON ei_acronyms;
CREATE TRIGGER ei_acronyms_norm BEFORE INSERT OR UPDATE ON ei_acronyms FOR EACH ROW EXECUTE FUNCTION ei_acronyms_norm();
DROP TRIGGER IF EXISTS ei_acronyms_before ON ei_acronyms;
CREATE TRIGGER ei_acronyms_before BEFORE INSERT OR UPDATE ON ei_acronyms FOR EACH ROW EXECUTE FUNCTION ei_config_before();
DROP TRIGGER IF EXISTS ei_acronyms_audit ON ei_acronyms;
CREATE TRIGGER ei_acronyms_audit AFTER INSERT OR UPDATE OR DELETE ON ei_acronyms FOR EACH ROW EXECUTE FUNCTION ei_config_audit_trg();
ALTER TABLE ei_acronyms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ei_acronyms_select ON ei_acronyms;
DROP POLICY IF EXISTS ei_acronyms_write ON ei_acronyms;
CREATE POLICY ei_acronyms_select ON ei_acronyms FOR SELECT USING (organization_id = current_org_id() AND _ei_can_view());
CREATE POLICY ei_acronyms_write ON ei_acronyms FOR ALL USING (organization_id = current_org_id() AND _ei_can_admin()) WITH CHECK (organization_id = current_org_id() AND _ei_can_admin());

-- ── 3. versioned configuration: snapshot / diff / rollback include acronyms ──
CREATE OR REPLACE FUNCTION _ei_snapshot(p_org UUID) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'organization_id' - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' ORDER BY c.sort_order, c.code) FROM ei_email_categories c WHERE c.organization_id = p_org), '[]'::jsonb),
    'document_types', COALESCE((SELECT jsonb_agg(to_jsonb(d) - 'organization_id' - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' ORDER BY d.sort_order, d.code) FROM ei_document_types d WHERE d.organization_id = p_org), '[]'::jsonb),
    'rules', COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'organization_id' - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' ORDER BY r.weight DESC, r.name) FROM ei_keyword_rules r WHERE r.organization_id = p_org), '[]'::jsonb),
    'vendor_aliases', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'vendor_id', a.vendor_id, 'alias_type', a.alias_type, 'value', a.value, 'verified', a.verified)) FROM ei_vendor_aliases a WHERE a.organization_id = p_org), '[]'::jsonb),
    'acronyms', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'organization_id' - 'created_at' - 'updated_at' - 'created_by' - 'updated_by' ORDER BY upper(x.acronym), x.expansion) FROM ei_acronyms x WHERE x.organization_id = p_org AND x.is_approved), '[]'::jsonb),
    'settings', COALESCE((SELECT settings FROM ei_settings WHERE organization_id = p_org), '{}'::jsonb))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION _ei_snapshot(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ei_config_diff() RETURNS JSONB AS $$
DECLARE v_org UUID := current_org_id(); v_cur JSONB; v_pub JSONB; v_ver INT; r JSONB := '{}'::jsonb; k TEXT;
BEGIN
  IF NOT _ei_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  v_cur := _ei_snapshot(v_org);
  SELECT snapshot, version INTO v_pub, v_ver FROM ei_config_versions WHERE organization_id = v_org ORDER BY version DESC LIMIT 1;
  FOREACH k IN ARRAY ARRAY['categories','document_types','rules','vendor_aliases','acronyms'] LOOP
    r := r || jsonb_build_object(k, jsonb_build_object(
      'added',   (SELECT count(*) FROM jsonb_array_elements(v_cur->k) a WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_pub->k, '[]')) b WHERE b->>'id' = a->>'id')),
      'removed', (SELECT count(*) FROM jsonb_array_elements(COALESCE(v_pub->k, '[]')) b WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cur->k) a WHERE a->>'id' = b->>'id')),
      'changed', (SELECT count(*) FROM jsonb_array_elements(v_cur->k) a JOIN jsonb_array_elements(COALESCE(v_pub->k, '[]')) b ON b->>'id' = a->>'id' WHERE a <> b)));
  END LOOP;
  RETURN r || jsonb_build_object('settings_changed', COALESCE(v_cur->'settings' <> v_pub->'settings', true), 'published_version', v_ver,
                                 'unpublished', v_pub IS NULL OR v_cur <> v_pub);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION ei_rollback_config(p_version INT, p_note TEXT DEFAULT NULL) RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); v_snap JSONB; v_ver INT;
BEGIN
  IF v_org IS NULL OR NOT _ei_can_admin() THEN RAISE EXCEPTION 'Only admin, CEO or finance can roll back configuration'; END IF;
  SELECT snapshot INTO v_snap FROM ei_config_versions WHERE organization_id = v_org AND version = p_version;
  IF v_snap IS NULL THEN RAISE EXCEPTION 'Version % not found', p_version; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ei_publish:' || v_org));
  PERFORM set_config('ei.seeding', 'on', true);
  DELETE FROM ei_keyword_rules WHERE organization_id = v_org;
  -- versions published before STEP269 have no acronyms: leave the registry as it is
  IF v_snap ? 'acronyms' THEN DELETE FROM ei_acronyms WHERE organization_id = v_org AND is_approved; END IF;
  DELETE FROM ei_email_categories WHERE organization_id = v_org;
  DELETE FROM ei_document_types WHERE organization_id = v_org;
  DELETE FROM ei_vendor_aliases WHERE organization_id = v_org;
  INSERT INTO ei_email_categories SELECT * FROM jsonb_populate_recordset(NULL::ei_email_categories,
    (SELECT jsonb_agg(x || jsonb_build_object('organization_id', v_org)) FROM jsonb_array_elements(v_snap->'categories') x));
  INSERT INTO ei_document_types SELECT * FROM jsonb_populate_recordset(NULL::ei_document_types,
    (SELECT jsonb_agg(x || jsonb_build_object('organization_id', v_org)) FROM jsonb_array_elements(v_snap->'document_types') x));
  INSERT INTO ei_keyword_rules SELECT * FROM jsonb_populate_recordset(NULL::ei_keyword_rules,
    (SELECT jsonb_agg(x || jsonb_build_object('organization_id', v_org)) FROM jsonb_array_elements(v_snap->'rules') x));
  IF v_snap ? 'acronyms' AND jsonb_array_length(v_snap->'acronyms') > 0 THEN
    INSERT INTO ei_acronyms SELECT * FROM jsonb_populate_recordset(NULL::ei_acronyms,
      (SELECT jsonb_agg(x || jsonb_build_object('organization_id', v_org)) FROM jsonb_array_elements(v_snap->'acronyms') x))
    ON CONFLICT DO NOTHING;   -- a pending suggestion with the same meaning stays as it is
  END IF;
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

-- ── 4. load the baseline taxonomy into the DRAFT configuration ──
-- p = { types: [{code,name,family,category,industries,aliases,area,primary_module,related_modules}],
--       acronyms: [{acronym,expansion,document_type_code,industries,context_terms}] }
-- New types are added; existing ones only get empty taxonomy fields filled in
-- (an admin's edits are never overwritten). Returns counts.
CREATE OR REPLACE FUNCTION ei_import_taxonomy(p JSONB) RETURNS JSONB AS $$
DECLARE v_org UUID := current_org_id(); v_new INT := 0; v_upd INT := 0; v_acr INT := 0; v_skip INT := 0; t JSONB; a JSONB; n INT;
BEGIN
  IF v_org IS NULL OR NOT _ei_can_admin() THEN RAISE EXCEPTION 'Only admin, CEO or finance can change the configuration'; END IF;
  IF jsonb_typeof(p->'types') <> 'array' THEN RAISE EXCEPTION 'types must be an array'; END IF;
  PERFORM set_config('ei.seeding', 'on', true);
  FOR t IN SELECT * FROM jsonb_array_elements(p->'types') LOOP
    IF (t->>'code') !~ '^[A-Z][A-Z0-9_]{1,59}$' OR NULLIF(trim(t->>'name'), '') IS NULL THEN v_skip := v_skip + 1; CONTINUE; END IF;
    INSERT INTO ei_document_types (organization_id, code, name, family, category, industries, aliases, area, primary_module, related_modules, fields, sort_order)
    VALUES (v_org, t->>'code', left(t->>'name', 200), t->>'family', t->>'category',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(t->'industries', '[]'))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(t->'aliases', '[]'))),
            t->>'area', t->>'primary_module', ARRAY(SELECT jsonb_array_elements_text(COALESCE(t->'related_modules', '[]'))),
            CASE WHEN jsonb_typeof(t->'fields') = 'array' THEN t->'fields' ELSE '[]'::jsonb END, 500)
    ON CONFLICT (organization_id, code) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_new := v_new + 1;
    ELSE
      UPDATE ei_document_types d SET
        family = COALESCE(d.family, t->>'family'),
        industries = CASE WHEN cardinality(d.industries) = 0 THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(t->'industries', '[]'))) ELSE d.industries END,
        aliases = CASE WHEN cardinality(d.aliases) = 0 THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(t->'aliases', '[]'))) ELSE d.aliases END,
        area = COALESCE(d.area, t->>'area'), primary_module = COALESCE(d.primary_module, t->>'primary_module')
      WHERE d.organization_id = v_org AND d.code = t->>'code' AND (d.family IS NULL OR cardinality(d.aliases) = 0 OR cardinality(d.industries) = 0);
      GET DIAGNOSTICS n = ROW_COUNT; v_upd := v_upd + n;
    END IF;
  END LOOP;
  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p->'acronyms', '[]')) LOOP
    INSERT INTO ei_acronyms (organization_id, acronym, expansion, document_type_code, industries, context_terms)
    SELECT v_org, a->>'acronym', a->>'expansion',
           CASE WHEN EXISTS (SELECT 1 FROM ei_document_types d WHERE d.organization_id = v_org AND d.code = a->>'document_type_code') THEN a->>'document_type_code' END,
           ARRAY(SELECT jsonb_array_elements_text(COALESCE(a->'industries', '[]'))),
           ARRAY(SELECT jsonb_array_elements_text(COALESCE(a->'context_terms', '[]')))
    WHERE NOT EXISTS (SELECT 1 FROM ei_acronyms x WHERE x.organization_id = v_org AND upper(x.acronym) = upper(a->>'acronym')
                        AND lower(x.expansion) = lower(a->>'expansion') AND x.customer_id IS NULL AND x.project_id IS NULL);
    GET DIAGNOSTICS n = ROW_COUNT; v_acr := v_acr + n;
  END LOOP;
  PERFORM set_config('ei.seeding', 'off', true);
  INSERT INTO ei_config_audit (organization_id, entity, entity_id, action, after, actor_id)
  VALUES (v_org, 'ei_document_types', NULL, 'SEED', jsonb_build_object('taxonomy', true, 'types_added', v_new, 'types_filled', v_upd, 'acronyms_added', v_acr), auth.uid());
  RETURN jsonb_build_object('types_added', v_new, 'types_filled', v_upd, 'acronyms_added', v_acr, 'skipped', v_skip);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION ei_import_taxonomy(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ei_import_taxonomy(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

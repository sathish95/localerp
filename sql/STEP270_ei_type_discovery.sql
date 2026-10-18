-- STEP270 — Email Intelligence: discovery of new document types
--
-- When no configured type fits a file, the AI describes it and the worker
-- records a PENDING suggestion (one per proposed code; repeated sightings add
-- to `occurrences` and the example list). The file itself keeps its unknown /
-- low-confidence type and stays in the Document filing queue — it is never
-- discarded or forced into a wrong type.
--
-- An admin (admin / ceo / finance) then:
--   APPROVE → a new document type is added to the DRAFT configuration (live
--             after publish) and the suggestion's files are re-typed to it
--   MERGE   → the suggested name + aliases become aliases of an existing type,
--             and the files are re-typed to that type
--   REJECT  → closed; files stay as they are
-- Re-typing only changes the type / filing of the document record (area,
-- modules, review state) — never a business transaction. Every decision is audited.
-- Run after STEP263–269. Re-runnable.

ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS suggested_type_code TEXT;
CREATE INDEX IF NOT EXISTS ei_attachments_suggested ON ei_attachments (organization_id, suggested_type_code) WHERE suggested_type_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS ei_type_suggestions (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        UUID        NOT NULL,
  proposed_code          TEXT        NOT NULL CHECK (proposed_code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  name                   TEXT        NOT NULL,
  family                 TEXT,
  aliases                TEXT[]      NOT NULL DEFAULT '{}',
  description            TEXT,
  rationale              TEXT,
  occurrences            INT         NOT NULL DEFAULT 1,
  example_attachment_ids UUID[]      NOT NULL DEFAULT '{}',
  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  config_version         INT,
  status                 TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','MERGED','REJECTED')),
  resulting_code         TEXT,                       -- type created (APPROVED) or merged into (MERGED)
  decided_by             UUID,
  decided_at             TIMESTAMPTZ,
  decision_note          TEXT,
  documents_retyped      INT
);
CREATE UNIQUE INDEX IF NOT EXISTS ei_type_suggestions_pending ON ei_type_suggestions (organization_id, proposed_code) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS ei_type_suggestions_org ON ei_type_suggestions (organization_id, status, last_seen_at DESC);

ALTER TABLE ei_type_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ei_type_suggestions_select ON ei_type_suggestions;
CREATE POLICY ei_type_suggestions_select ON ei_type_suggestions FOR SELECT USING (organization_id = current_org_id() AND _ei_can_view());
REVOKE INSERT, UPDATE, DELETE ON ei_type_suggestions FROM anon, authenticated;

-- Worker (service role): record / bump a suggestion. A code that already is a
-- document type, or was rejected, is ignored.
CREATE OR REPLACE FUNCTION ei_suggest_document_type(p_org UUID, p_code TEXT, p_name TEXT, p_family TEXT, p_aliases TEXT[],
  p_description TEXT, p_rationale TEXT, p_attachment UUID, p_version INT DEFAULT NULL) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF p_code !~ '^[A-Z][A-Z0-9_]{1,59}$' OR NULLIF(trim(p_name), '') IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM ei_document_types WHERE organization_id = p_org AND code = p_code) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM ei_type_suggestions WHERE organization_id = p_org AND proposed_code = p_code AND status = 'REJECTED'
             AND decided_at > now() - interval '180 days') THEN RETURN NULL; END IF;
  INSERT INTO ei_type_suggestions (organization_id, proposed_code, name, family, aliases, description, rationale, example_attachment_ids, config_version)
  VALUES (p_org, p_code, left(trim(p_name), 80), left(p_family, 80), COALESCE(p_aliases, '{}'), left(p_description, 300), left(p_rationale, 300),
          CASE WHEN p_attachment IS NULL THEN '{}' ELSE ARRAY[p_attachment] END, p_version)
  ON CONFLICT (organization_id, proposed_code) WHERE status = 'PENDING' DO UPDATE SET
    occurrences = ei_type_suggestions.occurrences + CASE WHEN p_attachment = ANY(ei_type_suggestions.example_attachment_ids) THEN 0 ELSE 1 END,
    example_attachment_ids = CASE WHEN p_attachment IS NULL OR p_attachment = ANY(ei_type_suggestions.example_attachment_ids)
                                  OR cardinality(ei_type_suggestions.example_attachment_ids) >= 20
                                  THEN ei_type_suggestions.example_attachment_ids
                                  ELSE ei_type_suggestions.example_attachment_ids || p_attachment END,
    aliases = ARRAY(SELECT DISTINCT x FROM unnest(ei_type_suggestions.aliases || COALESCE(p_aliases, '{}')) x LIMIT 12),
    last_seen_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION ei_suggest_document_type(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ei_suggest_document_type(UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, UUID, INT) TO service_role;

-- Re-type the files of a suggestion (and other still-unconfirmed files with
-- the same suggested code). Returns how many documents changed.
CREATE OR REPLACE FUNCTION _ei_retype_suggested(p_org UUID, p_suggested TEXT, p_code TEXT) RETURNS INT AS $$
DECLARE dt ei_document_types; n INT;
BEGIN
  SELECT * INTO dt FROM ei_document_types WHERE organization_id = p_org AND code = p_code;
  UPDATE ei_attachments a SET
    doc_type_code = dt.code, doc_confidence = 0.9,
    doc_rules = COALESCE(a.doc_rules, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('name', 'Re-typed after admin decision on suggested type ' || p_suggested, 'previous', a.doc_type_code)),
    area = COALESCE(dt.area, 'OTHER'), primary_module = dt.primary_module, related_modules = COALESCE(dt.related_modules, '{}'),
    review_state = CASE WHEN a.project_status IN ('MATCHED','CONFIRMED') THEN 'OK' ELSE 'NEEDS_PROJECT' END,
    updated_at = now()
  WHERE a.organization_id = p_org AND a.suggested_type_code = p_suggested AND a.status = 'PROCESSED'
    AND a.review_state IN ('NEEDS_TYPE','NEEDS_BOTH');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION _ei_retype_suggested(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Admin decision. p_type (APPROVE) may override: {code, name, family, aliases[], industries[], area, primary_module, related_modules[], description}
CREATE OR REPLACE FUNCTION ei_decide_type_suggestion(p_id UUID, p_action TEXT, p_target TEXT DEFAULT NULL, p_type JSONB DEFAULT '{}'::jsonb,
  p_note TEXT DEFAULT NULL, p_retype BOOLEAN DEFAULT true) RETURNS JSONB AS $$
DECLARE s ei_type_suggestions; v_code TEXT; v_n INT := 0;
BEGIN
  SELECT * INTO s FROM ei_type_suggestions WHERE id = p_id FOR UPDATE;
  IF s.id IS NULL OR s.organization_id <> current_org_id() OR NOT _ei_can_admin() THEN RAISE EXCEPTION 'Only admin, CEO or finance can decide on new document types'; END IF;
  IF s.status <> 'PENDING' THEN RAISE EXCEPTION 'This suggestion was already decided (%)', s.status; END IF;
  IF p_action NOT IN ('APPROVE','MERGE','REJECT') THEN RAISE EXCEPTION 'Bad action'; END IF;

  IF p_action = 'APPROVE' THEN
    v_code := COALESCE(NULLIF(p_type->>'code', ''), s.proposed_code);
    IF v_code !~ '^[A-Z][A-Z0-9_]{1,59}$' THEN RAISE EXCEPTION 'Invalid code %', v_code; END IF;
    IF EXISTS (SELECT 1 FROM ei_document_types WHERE organization_id = s.organization_id AND code = v_code) THEN
      RAISE EXCEPTION 'Document type % already exists — merge into it instead', v_code;
    END IF;
    INSERT INTO ei_document_types (organization_id, code, name, description, family, aliases, industries, area, primary_module, related_modules, destination, sort_order)
    VALUES (s.organization_id, v_code, COALESCE(NULLIF(p_type->>'name', ''), s.name), COALESCE(NULLIF(p_type->>'description', ''), s.description),
            COALESCE(NULLIF(p_type->>'family', ''), s.family),
            CASE WHEN jsonb_typeof(p_type->'aliases') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p_type->'aliases')) ELSE s.aliases END,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_type->'industries', '[]'))),
            NULLIF(p_type->>'area', ''), NULLIF(p_type->>'primary_module', ''),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_type->'related_modules', '[]'))), 'NONE', 600);
  ELSIF p_action = 'MERGE' THEN
    v_code := p_target;
    IF NOT EXISTS (SELECT 1 FROM ei_document_types WHERE organization_id = s.organization_id AND code = v_code) THEN RAISE EXCEPTION 'Choose an existing document type to merge into'; END IF;
    UPDATE ei_document_types SET aliases = ARRAY(SELECT DISTINCT x FROM unnest(aliases || s.name || s.aliases) x WHERE lower(x) <> lower(name))
    WHERE organization_id = s.organization_id AND code = v_code;
  ELSE
    IF NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'A reason is required to reject'; END IF;
  END IF;

  IF p_action <> 'REJECT' AND p_retype THEN v_n := _ei_retype_suggested(s.organization_id, s.proposed_code, v_code); END IF;
  UPDATE ei_type_suggestions SET status = CASE p_action WHEN 'APPROVE' THEN 'APPROVED' WHEN 'MERGE' THEN 'MERGED' ELSE 'REJECTED' END,
    resulting_code = v_code, decided_by = auth.uid(), decided_at = now(), decision_note = NULLIF(trim(p_note), ''), documents_retyped = v_n
  WHERE id = p_id;
  INSERT INTO ei_config_audit (organization_id, entity, entity_id, action, before, after, actor_id)
  VALUES (s.organization_id, 'ei_type_suggestions', s.id::text, 'SUGGESTION_' || p_action, to_jsonb(s),
          jsonb_build_object('code', v_code, 'documents_retyped', v_n, 'note', p_note), auth.uid());
  RETURN jsonb_build_object('code', v_code, 'documents_retyped', v_n);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION ei_decide_type_suggestion(UUID, TEXT, TEXT, JSONB, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ei_decide_type_suggestion(UUID, TEXT, TEXT, JSONB, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

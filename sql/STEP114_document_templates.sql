-- ============================================================
-- STEP114: Document Templates — one unified, admin-configurable template
-- system spanning Invoice, Delivery Note, Proposal, Warranty, and GRN.
-- Replaces two prior, narrower systems:
--   proposal_templates (STEP62/STEP100) — Proposal-only, is_default flag,
--     no lifecycle beyond default/not-default.
--   document_settings (STEP113) — a single flat row per org covering both
--     Invoice AND Delivery Note letterhead with no versioning at all.
--
-- Every document type now supports MULTIPLE named templates with a real
-- Draft -> Active -> Archived lifecycle (only one Active template per
-- (org, document_type, audience) is used by the real PDF exporters —
-- enforced in src/lib/documentTemplates.js the same way proposalTemplates.js
-- already clears sibling defaults, not by a DB constraint).
--
-- `audience` only applies to 'proposal' (Customer-Facing vs Internal
-- Review) — NULL for the other four types. `config` JSONB holds fields
-- that only make sense for specific document types (today: Proposal's
-- section_order / show_line_item_detail / company_details_override)
-- instead of a sprawling column list most rows would leave null.
--
-- This migration is additive and idempotent: proposal_templates and
-- document_settings are left in place (still readable), just no longer
-- the primary source once the app code is repointed. Re-running this
-- script is safe — every INSERT is guarded with WHERE NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS document_templates (
  id                         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id            UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  document_type              TEXT        NOT NULL CHECK (document_type IN ('invoice','delivery_note','proposal','warranty','grn')),
  audience                   TEXT        CHECK (audience IN ('customer','internal')),
  template_name              TEXT        NOT NULL,
  status                     TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  header_logo                TEXT,
  footer_text                TEXT,
  terms_and_conditions_text  TEXT,
  config                     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_by                 UUID        REFERENCES profiles(id),
  updated_by                 UUID        REFERENCES profiles(id),
  created_at                 TIMESTAMPTZ DEFAULT now(),
  updated_at                 TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_templates_org_type_idx ON document_templates(organization_id, document_type);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_templates_updated_at ON document_templates;
CREATE TRIGGER document_templates_updated_at BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_templates_select ON document_templates;
DROP POLICY IF EXISTS document_templates_write  ON document_templates;

-- Permissive SELECT within the org; write roles are the union of
-- proposal_templates' existing writers (admin/ceo/sales_lead/finance/cto)
-- so nothing that could edit a Proposal template before loses the
-- ability to, plus the finance-centric roles that manage Invoice/
-- Delivery Note/Warranty/GRN templates.
CREATE POLICY document_templates_select ON document_templates FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY document_templates_write ON document_templates FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_lead','cto')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance','sales_lead','cto')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_templates TO authenticated;

-- ── Migrate existing proposal_templates rows ──────────────────────────
INSERT INTO document_templates (
  organization_id, document_type, audience, template_name, status,
  header_logo, footer_text, terms_and_conditions_text, config,
  created_by, created_at, updated_at
)
SELECT
  pt.organization_id, 'proposal',
  CASE pt.template_type WHEN 'Customer-Facing' THEN 'customer' ELSE 'internal' END,
  pt.template_name,
  CASE WHEN pt.is_default THEN 'active' ELSE 'draft' END,
  pt.header_logo, pt.footer_text, pt.terms_and_conditions_text,
  jsonb_build_object(
    'section_order', to_jsonb(pt.section_order),
    'show_line_item_detail', pt.show_line_item_detail,
    'company_details_override', pt.company_details
  ),
  pt.created_by, pt.created_at, pt.updated_at
FROM proposal_templates pt
WHERE NOT EXISTS (
  SELECT 1 FROM document_templates dt
  WHERE dt.organization_id = pt.organization_id AND dt.document_type = 'proposal'
    AND dt.audience = (CASE pt.template_type WHEN 'Customer-Facing' THEN 'customer' ELSE 'internal' END)
    AND dt.template_name = pt.template_name
);

-- ── Seed one Active Invoice + Delivery Note template per org from the
-- letterhead already configured in document_settings, so a logo/footer/
-- T&C someone just uploaded via GST Settings isn't orphaned. ──
INSERT INTO document_templates (organization_id, document_type, template_name, status, header_logo, footer_text, terms_and_conditions_text, created_by)
SELECT ds.organization_id, v.doc_type, v.name, 'active', ds.header_logo, ds.footer_text, ds.terms_and_conditions_text, ds.updated_by
FROM document_settings ds
CROSS JOIN (VALUES ('invoice','Default Invoice Template'), ('delivery_note','Default Delivery Note Template')) AS v(doc_type, name)
WHERE (ds.header_logo IS NOT NULL OR ds.footer_text IS NOT NULL OR ds.terms_and_conditions_text IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM document_templates dt WHERE dt.organization_id = ds.organization_id AND dt.document_type = v.doc_type
  );

NOTIFY pgrst, 'reload schema';

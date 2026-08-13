-- ============================================================
-- STEP121: Performance Award Management — Phase 10-12 (certificate
-- template builder, generation, employee download + public
-- verification).
--
-- Three tables:
--   award_certificate_templates — the LIVE, HR-editable design (canvas
--     size/orientation/background + a JSONB `elements` array: each
--     element is a positioned text/variable/image/logo/signature/qrcode/
--     shape block). Editing this never touches anything already issued.
--   award_certificate_template_versions — an IMMUTABLE snapshot taken
--     every time HR clicks Publish (version column on the live template
--     increments to match). A generated certificate points at a
--     version_id, never at the live template — editing/republishing the
--     template after the fact cannot alter a certificate already handed
--     to an employee. Same immutability principle as document_templates
--     (STEP114), just made mandatory here via the version table instead
--     of relying on "don't touch a template once used."
--   award_certificates — one row per generated certificate.
--     `resolved_data` is a frozen snapshot of every variable's actual
--     value at generation time (employee name, award name, score, dates,
--     etc.) — so even if the employee's name changes or the award is
--     renamed later, the certificate's content doesn't silently drift.
--     No PDF binary is stored: the PDF is deterministically re-rendered
--     client-side from template_version.elements + resolved_data on
--     every download (src/lib/certificates.js), matching this codebase's
--     existing exporter pattern (grnExport.js etc: fetch data, build
--     PDF in-browser, no server-side render/storage step) — there's no
--     Supabase Storage bucket convention in this app to put a PDF in.
--
-- Public verification: get_certificate_public() is a SECURITY DEFINER
-- RPC (STEP75's get_landing_link_public() is the exact precedent) that
-- returns ONLY certificate_number/award_name/award_date/status pulled
-- from the frozen resolved_data — never the employee's name or any
-- score, matching the spec's stated verification-page example exactly
-- and avoiding exposing unnecessary private employee information.
-- ============================================================

CREATE TABLE IF NOT EXISTS award_certificate_templates (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  name              TEXT        NOT NULL,
  award_category_id UUID        REFERENCES award_categories(id) ON DELETE SET NULL,
  status            TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  page_size         TEXT        NOT NULL DEFAULT 'A4' CHECK (page_size IN ('A4','Letter','Custom')),
  orientation       TEXT        NOT NULL DEFAULT 'landscape' CHECK (orientation IN ('landscape','portrait')),
  canvas_width      INT         NOT NULL DEFAULT 1200,
  canvas_height     INT         NOT NULL DEFAULT 849,
  background_color  TEXT        DEFAULT '#ffffff',
  background_image  TEXT,
  elements          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  version           INT         NOT NULL DEFAULT 0,
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS award_certificate_templates_category_idx ON award_certificate_templates(award_category_id);

CREATE TABLE IF NOT EXISTS award_certificate_template_versions (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  template_id       UUID        NOT NULL REFERENCES award_certificate_templates(id) ON DELETE CASCADE,
  version           INT         NOT NULL,
  name              TEXT        NOT NULL,
  page_size         TEXT        NOT NULL,
  orientation       TEXT        NOT NULL,
  canvas_width      INT         NOT NULL,
  canvas_height     INT         NOT NULL,
  background_color  TEXT,
  background_image  TEXT,
  elements          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  published_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  published_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE TABLE IF NOT EXISTS award_certificates (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id            UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  employee_id         UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  template_version_id UUID        REFERENCES award_certificate_template_versions(id) ON DELETE SET NULL,
  certificate_number  TEXT        NOT NULL,
  resolved_data        JSONB      NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT        NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','revoked')),
  generated_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  generated_at        TIMESTAMPTZ DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, certificate_number),
  UNIQUE (award_id, employee_id)
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS award_certificate_templates_updated_at ON award_certificate_templates;
CREATE TRIGGER award_certificate_templates_updated_at BEFORE UPDATE ON award_certificate_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE award_certificate_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_certificate_template_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_certificates                   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS award_certificate_templates_select ON award_certificate_templates;
DROP POLICY IF EXISTS award_certificate_templates_write  ON award_certificate_templates;
CREATE POLICY award_certificate_templates_select ON award_certificate_templates FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY award_certificate_templates_write ON award_certificate_templates FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

-- Versions are read by anyone who can read a certificate that points at
-- one (the PDF is re-rendered client-side from this row), so SELECT is
-- permissive within the org; only HR/admin/ceo ever create a version
-- (Publish), and nothing should ever UPDATE/DELETE one.
DROP POLICY IF EXISTS award_certificate_template_versions_select ON award_certificate_template_versions;
DROP POLICY IF EXISTS award_certificate_template_versions_insert ON award_certificate_template_versions;
CREATE POLICY award_certificate_template_versions_select ON award_certificate_template_versions FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY award_certificate_template_versions_insert ON award_certificate_template_versions FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

DROP POLICY IF EXISTS award_certificates_select ON award_certificates;
DROP POLICY IF EXISTS award_certificates_insert ON award_certificates;
CREATE POLICY award_certificates_select ON award_certificates FOR SELECT USING (
  organization_id = current_org_id() AND (
    employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()
  )
);
-- Insert-only from the app's perspective (generateCertificate() runs once,
-- at grant time, from decideAward()) — no update/delete policy at all,
-- so even HR cannot alter a certificate row through the normal app; only
-- direct DB access could ever change one, matching "generated
-- certificates must remain immutable".
CREATE POLICY award_certificates_insert ON award_certificates FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_certificate_templates        TO authenticated;
GRANT SELECT, INSERT                ON public.award_certificate_template_versions TO authenticated;
GRANT SELECT, INSERT                ON public.award_certificates                  TO authenticated;

CREATE OR REPLACE FUNCTION get_certificate_public(p_certificate_number TEXT)
RETURNS TABLE (certificate_number TEXT, award_name TEXT, award_date TEXT, status TEXT) AS $$
  SELECT c.certificate_number, c.resolved_data->>'award_name', c.resolved_data->>'award_date', c.status
  FROM award_certificates c
  WHERE c.certificate_number = p_certificate_number;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_certificate_public(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

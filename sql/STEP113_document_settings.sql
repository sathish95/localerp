-- ============================================================
-- STEP113: Document Settings — the real, persisted backing store for
-- what SettingsPage.jsx's "GST Settings" tab has been showing since it
-- was first added: that tab was UI-only (local component state, `save()`
-- just flipped a "Saved!" flag and never touched Supabase), so nothing
-- typed into it ever survived a page reload. This is also the template/
-- letterhead data src/lib/customerInvoiceExport.js and
-- src/lib/deliveryNoteExport.js need — company name/address/GSTIN/logo/
-- footer/terms/bank details printed on every generated invoice and
-- delivery note PDF.
--
-- One row per organization (not a template *list* like proposal_templates
-- — a company only has one letterhead), upserted from the Settings tab.
-- ============================================================

CREATE TABLE IF NOT EXISTS document_settings (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  business_name             TEXT,
  gstin                     TEXT,
  address                   TEXT,
  state                     TEXT,
  state_code                TEXT,
  default_hsn               TEXT,
  cgst_rate                 NUMERIC     DEFAULT 9,
  sgst_rate                 NUMERIC     DEFAULT 9,
  igst_rate                 NUMERIC     DEFAULT 18,
  include_gst_in_invoices   BOOLEAN     NOT NULL DEFAULT true,
  auto_calculate            BOOLEAN     NOT NULL DEFAULT true,
  -- Letterhead / PDF template fields — read by customerInvoiceExport.js
  -- and deliveryNoteExport.js. header_logo is a data:image URI (same
  -- convention as proposal_templates.header_logo) so the PDF can embed
  -- it directly with no separate file storage/upload pipeline.
  header_logo                TEXT,
  bank_details               TEXT,
  footer_text                TEXT,
  terms_and_conditions_text  TEXT,
  updated_by                UUID        REFERENCES profiles(id),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id)
);

DROP TRIGGER IF EXISTS document_settings_updated_at ON document_settings;
CREATE TRIGGER document_settings_updated_at BEFORE UPDATE ON document_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE document_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_settings_select ON document_settings;
DROP POLICY IF EXISTS document_settings_write  ON document_settings;

-- Permissive SELECT — every role that can generate an invoice/delivery
-- note PDF (see delivery_notes_write's role set) needs to read this to
-- build the letterhead; write restricted to finance/admin/ceo, the same
-- set that can already edit GST-sensitive data elsewhere in this app.
CREATE POLICY document_settings_select ON document_settings FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY document_settings_write ON document_settings FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_settings TO authenticated;

NOTIFY pgrst, 'reload schema';

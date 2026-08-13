-- ============================================================
-- STEP111: Delivery Notes — outbound goods dispatch tracking, the
-- customer-facing counterpart to GRN (STEP55, which tracks INBOUND
-- receipt from vendors). Nothing in this app tracked what physically
-- shipped to a customer before this — Customer Invoices (STEP34) bill
-- for it, but billing and physical dispatch are different events with
-- different timing (a delivery note is often raised before the invoice,
-- or against a milestone with no invoice yet).
--
-- Multi-tenant from the start (this app is past STEP89): both tables
-- carry organization_id DEFAULT current_org_id(), including the child
-- items table — denormalized rather than joined through the parent for
-- RLS, matching the flat-organization_id-on-every-table convention the
-- STEP90-104 retrofit batches already established, not the nested-EXISTS
-- alternative.
--
-- project_id / customer_id / customer_invoice_id / part_number are all
-- soft references (plain UUID/TEXT, no FK) per this repo's documented
-- convention (CLAUDE.md) — a delivery note item may reference a part
-- that's a catalog product, or may be a freeform description with no
-- catalog entry at all (e.g. third-party pass-through goods), so
-- part_number is nullable and description is the one required field.
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_notes (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  delivery_note_number  TEXT        NOT NULL,
  project_id            UUID,       -- soft ref to projects
  customer_id           UUID,       -- soft ref to customers
  customer_invoice_id   UUID,       -- soft ref to customer_invoices (optional — dispatch can precede billing)
  delivery_date         DATE,
  delivery_address      TEXT,
  carrier                TEXT,       -- transporter / courier name
  tracking_number       TEXT,
  status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','dispatched','delivered','cancelled')),
  notes                 TEXT,
  created_by            UUID        REFERENCES profiles(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, delivery_note_number)
);
CREATE INDEX IF NOT EXISTS delivery_notes_project_idx  ON delivery_notes(project_id);
CREATE INDEX IF NOT EXISTS delivery_notes_customer_idx ON delivery_notes(customer_id);
CREATE INDEX IF NOT EXISTS delivery_notes_status_idx   ON delivery_notes(status);

DROP TRIGGER IF EXISTS delivery_notes_updated_at ON delivery_notes;
CREATE TRIGGER delivery_notes_updated_at BEFORE UPDATE ON delivery_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS delivery_note_items (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  delivery_note_id  UUID        NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  part_number       TEXT,       -- soft ref to products, nullable — see header
  description       TEXT        NOT NULL,
  quantity          NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit              TEXT        DEFAULT 'pcs',
  notes             TEXT,
  sort_order        INT         DEFAULT 0
);
CREATE INDEX IF NOT EXISTS delivery_note_items_note_idx ON delivery_note_items(delivery_note_id);

ALTER TABLE delivery_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_note_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_notes_select ON delivery_notes;
DROP POLICY IF EXISTS delivery_notes_write  ON delivery_notes;
DROP POLICY IF EXISTS delivery_note_items_select ON delivery_note_items;
DROP POLICY IF EXISTS delivery_note_items_write  ON delivery_note_items;

-- Permissive SELECT within the org (matches customer_invoices/invoices
-- posture — everyone in the org can see billing/logistics records);
-- writes restricted to the same role set BOM/Products use, since
-- dispatch is an operations action, not finance-exclusive.
CREATE POLICY delivery_notes_select ON delivery_notes FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY delivery_notes_write ON delivery_notes FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance')
  )
);

CREATE POLICY delivery_note_items_select ON delivery_note_items FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY delivery_note_items_write ON delivery_note_items FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_notes      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_note_items TO authenticated;

NOTIFY pgrst, 'reload schema';

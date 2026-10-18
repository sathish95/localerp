-- STEP258 — Point of Contact (POC) directory
--
-- One org-wide address book for every person the company deals with:
-- customer contacts, vendor contacts, partners, consultants, government
-- officers, internal-but-external people… any company, any role.
--
--   contacts            one row per person. company_type says what kind of
--                       company they belong to; customer_id / vendor_id are
--                       soft links (plain UUIDs) to the existing masters,
--                       company_name is the free-text name used when the
--                       company isn't in either master (and is filled from
--                       the master when it is, so search always works).
--
-- RLS: every org member can read and add contacts; editing is open to the
-- creator and to managers/admins; deleting is managers/admins only.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS contacts (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  full_name       TEXT        NOT NULL,
  designation     TEXT,                       -- job title at their company
  contact_role    TEXT,                       -- role for us: Decision Maker, Billing, Technical…
  department      TEXT,
  company_type    TEXT        NOT NULL DEFAULT 'OTHER'
                  CHECK (company_type IN ('CUSTOMER','VENDOR','PARTNER','CONSULTANT','GOVERNMENT','INTERNAL','OTHER')),
  company_name    TEXT,
  customer_id     UUID,                       -- soft ref → customers.id
  vendor_id       UUID,                       -- soft ref → vendors.id
  email           TEXT,
  phone           TEXT,
  alt_phone       TEXT,
  whatsapp        TEXT,
  linkedin        TEXT,
  city            TEXT,
  address         TEXT,
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  is_primary      BOOLEAN     NOT NULL DEFAULT false,  -- main POC for that company
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes           TEXT,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_org_idx      ON contacts (organization_id, full_name);
CREATE INDEX IF NOT EXISTS contacts_customer_idx ON contacts (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_vendor_idx   ON contacts (vendor_id)   WHERE vendor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION contacts_before() RETURNS TRIGGER AS $$
BEGIN
  NEW.full_name := trim(NEW.full_name);
  IF NEW.full_name = '' THEN RAISE EXCEPTION 'Contact name is required'; END IF;
  NEW.email := NULLIF(lower(trim(COALESCE(NEW.email, ''))), '');
  -- a linked master wins over the typed company name
  IF NEW.customer_id IS NOT NULL THEN
    NEW.company_type := 'CUSTOMER';
    NEW.company_name := COALESCE((SELECT name FROM customers WHERE id = NEW.customer_id), NEW.company_name);
  ELSIF NEW.vendor_id IS NOT NULL THEN
    NEW.company_type := 'VENDOR';
    NEW.company_name := COALESCE((SELECT name FROM vendors WHERE id = NEW.vendor_id), NEW.company_name);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS contacts_before ON contacts;
CREATE TRIGGER contacts_before BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_before();

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (organization_id = current_org_id());
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (
  organization_id = current_org_id() AND (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','finance','procurement_lead','sales_head'))
  )
) WITH CHECK (organization_id = current_org_id());
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  organization_id = current_org_id()
  AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','finance','procurement_lead','sales_head'))
);

-- register the module so Settings → Roles & Modules can toggle it
INSERT INTO modules (organization_id, key, label)
SELECT o.id, 'contacts', 'Contacts (POC)' FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM modules m WHERE m.organization_id = o.id AND m.key = 'contacts');

NOTIFY pgrst, 'reload schema';

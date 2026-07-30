-- ============================================================
-- STEP25: Procurement & Asset Lifecycle — Master Data (Phase 1)
-- Customers, Products, Device Instances, Deployment History
-- + budgets.committed_amount, vendors.supplier_type, projects.customer_id
-- Run in Supabase SQL editor after STEP24b. Soft FKs throughout (no REFERENCES).
--
-- PREREQUISITE: run STEP25a_add_procurement_roles.sql FIRST, as its own
-- separate query execution. profiles.role is a Postgres ENUM (user_role);
-- the RLS policies below reference 'procurement_lead'/'pm', which must
-- already exist as enum labels before this script runs, or it fails with
-- "invalid input value for enum user_role" and the whole script rolls back.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── 1. CUSTOMERS ─────────────────────────────────────────────
DROP TABLE IF EXISTS customers CASCADE;

CREATE TABLE customers (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  code           TEXT        UNIQUE,
  name           TEXT        NOT NULL,
  industry       TEXT,
  contact_name   TEXT,
  email          TEXT,
  phone          TEXT,
  address        TEXT,
  city           TEXT,
  gst_number     TEXT,
  status         TEXT        DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes          TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX customers_status_idx ON customers(status);
CREATE INDEX customers_name_idx   ON customers(name);
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. PRODUCTS (device catalog) ─────────────────────────────
DROP TABLE IF EXISTS products CASCADE;

CREATE TABLE products (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number     TEXT        UNIQUE NOT NULL,
  name            TEXT        NOT NULL,
  device_type     TEXT,                              -- e.g. IoT Logger, Sensor, Gateway... (10 types, free text)
  spec_sheet      TEXT,                              -- URL or free-text spec description
  warranty_months INT         DEFAULT 12,
  reorder_level   NUMERIC(12,2) DEFAULT 0,
  reorder_qty     NUMERIC(12,2) DEFAULT 0,
  standard_cost   NUMERIC(14,2) DEFAULT 0,
  is_serialized   BOOLEAN     DEFAULT true,          -- true = tracked as device_instances
  status          TEXT        DEFAULT 'active' CHECK (status IN ('active','discontinued')),
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX products_device_type_idx ON products(device_type);
CREATE INDEX products_status_idx      ON products(status);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. DEVICE INSTANCES ──────────────────────────────────────
-- Serialized IoT/hardware units tied to customer deployments.
-- Distinct from the generic `assets` table (capital-asset tracker, e.g. laptops) — do NOT merge.
DROP TABLE IF EXISTS device_instances CASCADE;

CREATE TABLE device_instances (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  device_code      TEXT        UNIQUE,
  part_number      TEXT,                              -- soft ref to products.part_number
  serial_number    TEXT        UNIQUE NOT NULL,
  project_id       UUID,                              -- soft ref to projects
  customer_id      UUID,                              -- soft ref to customers
  installed_date   DATE,
  warranty_start   DATE,
  warranty_end     DATE,
  status           TEXT        DEFAULT 'in_storage'
                   CHECK (status IN ('deployed','in_storage','faulty','replaced','decommissioned')),
  current_location TEXT,
  assigned_to      UUID,                              -- soft ref to profiles
  notes            TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX device_status_idx   ON device_instances(status);
CREATE INDEX device_customer_idx ON device_instances(customer_id);
CREATE INDEX device_project_idx  ON device_instances(project_id);
CREATE INDEX device_part_idx     ON device_instances(part_number);
CREATE INDEX device_warranty_idx ON device_instances(warranty_end);
CREATE TRIGGER device_instances_updated_at BEFORE UPDATE ON device_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. DEPLOYMENT HISTORY ────────────────────────────────────
-- Append-only log of device moves between projects/customers.
DROP TABLE IF EXISTS deployment_history CASCADE;

CREATE TABLE deployment_history (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id        UUID        NOT NULL,              -- soft ref to device_instances
  from_project_id  UUID,
  to_project_id    UUID,
  from_customer_id UUID,
  to_customer_id   UUID,
  from_status      TEXT,
  to_status        TEXT,
  moved_by         UUID,                               -- soft ref to profiles
  reason           TEXT,
  moved_date       TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX deploy_hist_device_idx ON deployment_history(device_id);
CREATE INDEX deploy_hist_moved_idx  ON deployment_history(moved_date DESC);

-- ── 5. ALTER EXISTING TABLES ─────────────────────────────────
ALTER TABLE budgets  ADD COLUMN IF NOT EXISTS committed_amount NUMERIC(14,2) DEFAULT 0;

ALTER TABLE vendors   ADD COLUMN IF NOT EXISTS supplier_type TEXT DEFAULT 'formal_vendor'
  CHECK (supplier_type IN ('formal_vendor','local_shop'));

ALTER TABLE projects  ADD COLUMN IF NOT EXISTS customer_id UUID;
CREATE INDEX IF NOT EXISTS projects_customer_idx ON projects(customer_id);

-- ── 6. ROW LEVEL SECURITY ────────────────────────────────────
-- Permissive-but-sane defaults: all authenticated users read; writes gated to
-- management/procurement-ish roles. Sanity-check against this project's
-- existing per-table RLS conventions after running.
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_instances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_history  ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select ON customers FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY customers_write  ON customers FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

CREATE POLICY products_select ON products FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY products_write  ON products FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

CREATE POLICY device_select ON device_instances FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY device_write  ON device_instances FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('admin','ceo','manager','department_head','procurement_lead','pm'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('admin','ceo','manager','department_head','procurement_lead','pm'))
);

CREATE POLICY deploy_hist_select ON deployment_history FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY deploy_hist_insert ON deployment_history FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
          AND role IN ('admin','ceo','manager','department_head','procurement_lead','pm'))
);

-- ── 7. RELOAD SCHEMA CACHE ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

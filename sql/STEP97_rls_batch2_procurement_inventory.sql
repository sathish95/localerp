-- ============================================================
-- STEP97: Multi-tenant RLS retrofit — Batch 2 (Procurement/Inventory
-- remainder). Previously deferred (see STEP93's header) because
-- component_vendors hard-FKs into `vendors` and create_po_from_pr()/
-- receive_grn() insert directly into `purchase_orders`/`grn`, which
-- were untracked/unknown at the time. Now unblocked — STEP96 just
-- org-scoped vendors/purchase_orders/purchase_requisitions/grn
-- themselves, and STEP92's diagnostic gave exact current policies for
-- every table below.
--
-- create_po_from_pr() (STEP54) and receive_grn() (STEP55) need no
-- changes: they insert into purchase_order_items/grn_items without
-- specifying organization_id, so the DEFAULT current_org_id() added
-- below auto-populates it correctly for whichever real authenticated
-- user is calling the RPC — same reasoning already applied throughout
-- this migration.
-- ============================================================

-- customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE customers SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE customers ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE customers ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS customers_select ON customers;
DROP POLICY IF EXISTS customers_write  ON customers;
CREATE POLICY customers_select ON customers FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY customers_write ON customers FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- products
ALTER TABLE products ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE products SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE products ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS products_select ON products;
DROP POLICY IF EXISTS products_write  ON products;
CREATE POLICY products_select ON products FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY products_write ON products FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- device_instances
ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE device_instances SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE device_instances ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE device_instances ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS device_select ON device_instances;
DROP POLICY IF EXISTS device_write  ON device_instances;
CREATE POLICY device_select ON device_instances FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY device_write ON device_instances FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','procurement_lead','pm'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','procurement_lead','pm'))
);

-- deployment_history
ALTER TABLE deployment_history ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE deployment_history SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE deployment_history ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE deployment_history ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS deploy_hist_select ON deployment_history;
DROP POLICY IF EXISTS deploy_hist_insert ON deployment_history;
CREATE POLICY deploy_hist_select ON deployment_history FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY deploy_hist_insert ON deployment_history FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','procurement_lead','pm'))
);

-- purchase_requisition_items (fully permissive today, no role gate — preserved)
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE purchase_requisition_items SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE purchase_requisition_items ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE purchase_requisition_items ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS pr_items_all    ON purchase_requisition_items;
DROP POLICY IF EXISTS pr_items_select ON purchase_requisition_items;
CREATE POLICY pr_items_select ON purchase_requisition_items FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY pr_items_all ON purchase_requisition_items FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- purchase_order_items
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE purchase_order_items SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE purchase_order_items ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE purchase_order_items ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS po_items_select ON purchase_order_items;
DROP POLICY IF EXISTS po_items_write  ON purchase_order_items;
CREATE POLICY po_items_select ON purchase_order_items FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY po_items_write ON purchase_order_items FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- grn_items
ALTER TABLE grn_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE grn_items SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE grn_items ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE grn_items ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS grn_items_select ON grn_items;
DROP POLICY IF EXISTS grn_items_write  ON grn_items;
CREATE POLICY grn_items_select ON grn_items FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY grn_items_write ON grn_items FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- inventory_transactions
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE inventory_transactions SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE inventory_transactions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE inventory_transactions ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS inventory_txn_select ON inventory_transactions;
DROP POLICY IF EXISTS inventory_txn_write  ON inventory_transactions;
CREATE POLICY inventory_txn_select ON inventory_transactions FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY inventory_txn_write ON inventory_transactions FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- component_vendors
ALTER TABLE component_vendors ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE component_vendors SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE component_vendors ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE component_vendors ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS component_vendors_select ON component_vendors;
DROP POLICY IF EXISTS component_vendors_write  ON component_vendors;
CREATE POLICY component_vendors_select ON component_vendors FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY component_vendors_write ON component_vendors FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- product_bom_versions
ALTER TABLE product_bom_versions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE product_bom_versions SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE product_bom_versions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE product_bom_versions ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS product_bom_versions_select ON product_bom_versions;
DROP POLICY IF EXISTS product_bom_versions_write  ON product_bom_versions;
CREATE POLICY product_bom_versions_select ON product_bom_versions FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY product_bom_versions_write ON product_bom_versions FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- product_bom_version_components
ALTER TABLE product_bom_version_components ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE product_bom_version_components SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE product_bom_version_components ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE product_bom_version_components ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS product_bom_version_components_select ON product_bom_version_components;
DROP POLICY IF EXISTS product_bom_version_components_write  ON product_bom_version_components;
CREATE POLICY product_bom_version_components_select ON product_bom_version_components FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY product_bom_version_components_write ON product_bom_version_components FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

-- approval_chains / approval_chain_steps — org-scoped so each org can
-- define its own approval workflows rather than sharing one global set.
ALTER TABLE approval_chains ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE approval_chains SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE approval_chains ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE approval_chains ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS approval_chains_select ON approval_chains;
DROP POLICY IF EXISTS approval_chains_write  ON approval_chains;
CREATE POLICY approval_chains_select ON approval_chains FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY approval_chains_write ON approval_chains FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

ALTER TABLE approval_chain_steps ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE approval_chain_steps SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE approval_chain_steps ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE approval_chain_steps ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS approval_chain_steps_select ON approval_chain_steps;
DROP POLICY IF EXISTS approval_chain_steps_write  ON approval_chain_steps;
CREATE POLICY approval_chain_steps_select ON approval_chain_steps FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY approval_chain_steps_write ON approval_chain_steps FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

NOTIFY pgrst, 'reload schema';

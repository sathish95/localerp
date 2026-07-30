-- ============================================================
-- STEP62: Proposal Module — core schema (pre-sales cost proposals).
--
-- Design notes, matching this codebase's established conventions:
--
-- * Soft refs throughout (part_number/vendor_id excepted, see below) —
--   part_number-style TEXT columns referencing products.part_number, and
--   UUID columns referencing other tables, are NOT hard FKs unless noted,
--   same convention as products/purchase_requisitions/grn_items etc.
--
-- * Versioning follows product_bom_versions' pattern (STEP52) but applied
--   directly to the proposals table itself rather than a header+version
--   split — a Proposal (unlike a BOM) genuinely IS the whole versioned
--   document, there's no separate long-lived "subject" to keep stable
--   across versions. proposal_group_id is the stable identity; each
--   revision is a new row sharing that group_id with version+1; exactly
--   one row per group has is_current = true, enforced by a partial
--   unique index (same mechanism as product_bom_versions_active_idx).
--   save_proposal_version() below does archive-old + clone-forward +
--   insert-new as one real transaction (SECURITY DEFINER, same reason
--   as save_bom_version() — the Supabase JS client has no multi-statement
--   transaction of its own).
--
-- * Approval is NOT a separate ProposalApproval child table — it follows
--   purchase_requisitions' actual convention instead (approval columns
--   stamped directly on the row: {stage}_approved_by/{stage}_approved_at),
--   read/written by src/lib/proposalApproval.js against the DB-configurable
--   approval_chains/approval_chain_steps (STEP48), exactly like
--   procurementApproval.js does. See STEP63 for the seeded chain.
--
-- * vendor_id on proposal_vendor_costs is a REAL FK to vendors(id) —
--   improving on project_hardware_costs.vendor, which is free text only
--   (flagged as unreliable in STEP36's spend analyzer comments).
--
-- Run after STEP25 (products), STEP31 (role_rates), STEP48 (approval
-- chains), and the pre-existing vendors/projects tables.
-- ============================================================

-- ── 1. PROPOSALS (versioned header) ──────────────────────────
CREATE TABLE IF NOT EXISTS proposals (
  id                       UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_group_id        UUID          NOT NULL,   -- stable identity across versions (= id on v1)
  version                  INT           NOT NULL DEFAULT 1,
  is_current               BOOLEAN       NOT NULL DEFAULT true,
  proposal_number          TEXT          UNIQUE,      -- e.g. PROP-000123, via nextNum('proposal')
  proposal_name            TEXT          NOT NULL,
  customer_name             TEXT          NOT NULL,
  customer_contact         TEXT,
  status                   TEXT          NOT NULL DEFAULT 'Draft'
                            CHECK (status IN ('Draft','In Negotiation','Ready for Approval','Approved','Revision Requested','Won','Lost','Expired')),
  -- Granular chain position while status = 'Ready for Approval' (e.g.
  -- 'sales_lead_review','finance_review','cto_review') — the same role
  -- proposalApproval.js's engine plays elsewhere by having a row's own
  -- `status` BE the chain position (procurementApproval.js's convention).
  -- Kept as its own column here instead of overloading `status` itself,
  -- since this module's top-level status vocabulary above is fixed by
  -- spec and coarser than a chain position. Null outside the approval flow.
  approval_status          TEXT,
  validity_until_date      DATE,
  overall_margin_percent   NUMERIC(6,2)  NOT NULL DEFAULT 20,
  currency                 TEXT          NOT NULL DEFAULT 'INR',
  linked_project_id        UUID,          -- soft ref -> projects, set once Won + converted
  revision_notes           TEXT,          -- what changed vs the prior version
  -- Approval stamps — mirrors purchase_requisitions' pattern exactly
  -- (procurementApproval.js-style engine reads/writes these columns).
  sales_lead_approved_by   UUID          REFERENCES profiles(id),
  sales_lead_approved_at   TIMESTAMPTZ,
  finance_approved_by      UUID          REFERENCES profiles(id),
  finance_approved_at      TIMESTAMPTZ,
  cto_approved_by          UUID          REFERENCES profiles(id),
  cto_approved_at          TIMESTAMPTZ,
  rejection_reason         TEXT,
  created_by               UUID          REFERENCES profiles(id),
  created_at               TIMESTAMPTZ   DEFAULT now(),
  updated_at               TIMESTAMPTZ   DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_current_idx ON proposals(proposal_group_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS proposals_group_idx  ON proposals(proposal_group_id);
CREATE INDEX IF NOT EXISTS proposals_status_idx ON proposals(status);
CREATE INDEX IF NOT EXISTS proposals_approval_status_idx ON proposals(approval_status);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS proposals_updated_at ON proposals;
CREATE TRIGGER proposals_updated_at BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. COST SECTIONS — one row per category, per proposal ────
CREATE TABLE IF NOT EXISTS proposal_cost_sections (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id    UUID          NOT NULL,   -- soft ref -> proposals
  category       TEXT          NOT NULL CHECK (category IN (
                   'Application Development','Firmware Development','Hardware Design & Production',
                   'ERP Integration','Hardware','Software/SaaS/Third-Party','Miscellaneous'
                 )),
  margin_percent NUMERIC(6,2),              -- null = falls back to proposals.overall_margin_percent
  notes          TEXT,
  created_at     TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(proposal_id, category)
);
CREATE INDEX IF NOT EXISTS proposal_cost_sections_proposal_idx ON proposal_cost_sections(proposal_id);

-- ── 3. RESOURCE PLAN — feeds App/Firmware/Hardware-Design categories ──
-- rate_used is a snapshot from role_rates at entry time — never live-referenced,
-- so a proposal sent in January can't silently change if role_rates updates later.
CREATE TABLE IF NOT EXISTS proposal_resource_plans (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_cost_section_id  UUID          NOT NULL,   -- soft ref -> proposal_cost_sections
  designation               TEXT          NOT NULL,   -- matches role_rates.designation
  estimated_count           NUMERIC(8,2)  NOT NULL DEFAULT 1,
  estimated_duration_weeks  NUMERIC(8,2)  NOT NULL DEFAULT 1,
  rate_used                 NUMERIC(12,2) NOT NULL DEFAULT 0,  -- snapshot of role_rates.hourly_rate
  computed_cost             NUMERIC(14,2) NOT NULL DEFAULT 0,  -- count * weeks * 40hrs/wk * rate_used
  notes                     TEXT,
  created_at                TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_resource_plans_section_idx ON proposal_resource_plans(proposal_cost_section_id);

-- ── 4. HARDWARE LINES — feeds the Hardware category ──────────
CREATE TABLE IF NOT EXISTS proposal_hardware_lines (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_cost_section_id  UUID          NOT NULL,
  part_number               TEXT,          -- soft ref -> products.part_number
  description                TEXT          NOT NULL,
  estimated_quantity        NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_cost                 NUMERIC(14,2) NOT NULL DEFAULT 0,  -- snapshot of products.standard_cost
  subtotal_internal_cost    NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes                     TEXT,
  created_at                TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_hardware_lines_section_idx ON proposal_hardware_lines(proposal_cost_section_id);
CREATE INDEX IF NOT EXISTS proposal_hardware_lines_part_idx    ON proposal_hardware_lines(part_number);

-- ── 5. SOFTWARE/SaaS/THIRD-PARTY LINES ───────────────────────
CREATE TABLE IF NOT EXISTS proposal_software_lines (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_cost_section_id  UUID          NOT NULL,
  item_name                 TEXT          NOT NULL,
  cost_type                 TEXT          NOT NULL DEFAULT 'One-time' CHECK (cost_type IN ('One-time','Monthly','Annual')),
  unit_cost                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  duration_months           NUMERIC(8,2)  DEFAULT 1,
  computed_cost             NUMERIC(14,2) NOT NULL DEFAULT 0,  -- One-time: unit_cost. Monthly: unit_cost*months. Annual: unit_cost*ceil(months/12).
  notes                     TEXT,
  created_at                TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_software_lines_section_idx ON proposal_software_lines(proposal_cost_section_id);

-- ── 6. MISCELLANEOUS LINES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_misc_lines (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_cost_section_id  UUID          NOT NULL,
  item_name                 TEXT          NOT NULL,
  cost                      NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes                     TEXT,
  created_at                TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_misc_lines_section_idx ON proposal_misc_lines(proposal_cost_section_id);

-- ── 7. VENDOR COST TRACEABILITY ───────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_vendor_costs (
  id                     UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id            UUID          NOT NULL,   -- soft ref -> proposals
  vendor_id              UUID          REFERENCES vendors(id),  -- real FK (vendors predates this migration folder, safe to reference directly)
  linked_category        TEXT,
  vendor_quote_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  quote_reference        TEXT,          -- file URL or free-text reference
  linked_line_item_id    UUID,          -- soft ref -> whichever *_lines table, per linked_line_item_type
  linked_line_item_type  TEXT          CHECK (linked_line_item_type IN ('resource_plan','hardware_line','software_line','misc_line')),
  created_at             TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_vendor_costs_proposal_idx ON proposal_vendor_costs(proposal_id);
CREATE INDEX IF NOT EXISTS proposal_vendor_costs_vendor_idx   ON proposal_vendor_costs(vendor_id);

-- ── 8. TIMELINE — phases tied to resource plans ──────────────
CREATE TABLE IF NOT EXISTS proposal_timeline (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id               UUID          NOT NULL,
  phase_name                TEXT          NOT NULL,
  start_offset_weeks        NUMERIC(8,2)  NOT NULL DEFAULT 0,
  duration_weeks            NUMERIC(8,2)  NOT NULL DEFAULT 1,
  linked_resource_plan_ids  UUID[]        DEFAULT '{}',
  sort_order                INT           DEFAULT 0,
  created_at                TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_timeline_proposal_idx ON proposal_timeline(proposal_id);

-- ── 9. EXPORT TEMPLATES ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_templates (
  id                         UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name              TEXT          NOT NULL,
  template_type              TEXT          NOT NULL CHECK (template_type IN ('Customer-Facing','Internal Review')),
  header_logo                TEXT,
  company_details            TEXT,
  terms_and_conditions_text  TEXT,
  footer_text                TEXT,
  section_order              TEXT[]        DEFAULT '{}',
  show_line_item_detail      BOOLEAN       NOT NULL DEFAULT false,  -- customer-facing only: itemized vs category-only
  is_default                 BOOLEAN       NOT NULL DEFAULT false,
  created_by                 UUID          REFERENCES profiles(id),
  created_at                 TIMESTAMPTZ   DEFAULT now(),
  updated_at                 TIMESTAMPTZ   DEFAULT now()
);
DROP TRIGGER IF EXISTS proposal_templates_updated_at ON proposal_templates;
CREATE TRIGGER proposal_templates_updated_at BEFORE UPDATE ON proposal_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 10. VALUE SUMMARY — the one computed source of truth for totals ──
-- One row per proposal (i.e. per version, since each version is its own
-- proposals row) — recomputed in place while Draft/In Negotiation,
-- frozen (is_frozen = true) once the status moves past that, per this
-- module's "a customer is looking at a specific number" rule.
CREATE TABLE IF NOT EXISTS proposal_value_summary (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id               UUID          NOT NULL UNIQUE,   -- soft ref -> proposals
  total_internal_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_customer_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  projected_profit          NUMERIC(14,2) NOT NULL DEFAULT 0,
  projected_margin_percent  NUMERIC(6,2)  NOT NULL DEFAULT 0,
  blended_markup_percent    NUMERIC(6,2)  NOT NULL DEFAULT 0,
  cost_by_category          JSONB         NOT NULL DEFAULT '[]',
  cost_by_phase             JSONB         NOT NULL DEFAULT '[]',
  is_frozen                 BOOLEAN       NOT NULL DEFAULT false,
  computed_at               TIMESTAMPTZ   DEFAULT now()
);

-- ── 11. save_proposal_version() — clone-forward RPC ──────────
-- Archives the current version and inserts a full copy (header + cost
-- sections + all line types + timeline) as the new active version, so a
-- revision never mutates what a customer has already been sent. Line
-- edits after this happen against the NEW version's rows.
CREATE OR REPLACE FUNCTION save_proposal_version(
  p_proposal_id  UUID,     -- the CURRENT version's id to branch from
  p_user_id      UUID,
  p_notes        TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_old        proposals%ROWTYPE;
  v_new_id     UUID;
  v_section    RECORD;
  v_new_section_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','sales_lead','finance')) THEN
    RAISE EXCEPTION 'Not authorized to revise a proposal';
  END IF;

  SELECT * INTO v_old FROM proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found'; END IF;

  UPDATE proposals SET is_current = false WHERE id = p_proposal_id;

  INSERT INTO proposals (
    proposal_group_id, version, is_current, proposal_number, proposal_name, customer_name, customer_contact,
    status, validity_until_date, overall_margin_percent, currency, linked_project_id, revision_notes, created_by
  ) VALUES (
    v_old.proposal_group_id, v_old.version + 1, true,
    regexp_replace(v_old.proposal_number, '-v[0-9]+$', '') || '-v' || (v_old.version + 1),
    v_old.proposal_name, v_old.customer_name, v_old.customer_contact,
    'Draft', v_old.validity_until_date, v_old.overall_margin_percent, v_old.currency, v_old.linked_project_id, p_notes, p_user_id
  ) RETURNING id INTO v_new_id;

  FOR v_section IN SELECT * FROM proposal_cost_sections WHERE proposal_id = p_proposal_id LOOP
    INSERT INTO proposal_cost_sections (proposal_id, category, margin_percent, notes)
      VALUES (v_new_id, v_section.category, v_section.margin_percent, v_section.notes)
      RETURNING id INTO v_new_section_id;

    INSERT INTO proposal_resource_plans (proposal_cost_section_id, designation, estimated_count, estimated_duration_weeks, rate_used, computed_cost, notes)
      SELECT v_new_section_id, designation, estimated_count, estimated_duration_weeks, rate_used, computed_cost, notes
      FROM proposal_resource_plans WHERE proposal_cost_section_id = v_section.id;

    INSERT INTO proposal_hardware_lines (proposal_cost_section_id, part_number, description, estimated_quantity, unit_cost, subtotal_internal_cost, notes)
      SELECT v_new_section_id, part_number, description, estimated_quantity, unit_cost, subtotal_internal_cost, notes
      FROM proposal_hardware_lines WHERE proposal_cost_section_id = v_section.id;

    INSERT INTO proposal_software_lines (proposal_cost_section_id, item_name, cost_type, unit_cost, duration_months, computed_cost, notes)
      SELECT v_new_section_id, item_name, cost_type, unit_cost, duration_months, computed_cost, notes
      FROM proposal_software_lines WHERE proposal_cost_section_id = v_section.id;

    INSERT INTO proposal_misc_lines (proposal_cost_section_id, item_name, cost, notes)
      SELECT v_new_section_id, item_name, cost, notes
      FROM proposal_misc_lines WHERE proposal_cost_section_id = v_section.id;
  END LOOP;

  INSERT INTO proposal_timeline (proposal_id, phase_name, start_offset_weeks, duration_weeks, linked_resource_plan_ids, sort_order)
    SELECT v_new_id, phase_name, start_offset_weeks, duration_weeks, '{}', sort_order
    FROM proposal_timeline WHERE proposal_id = p_proposal_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_proposal_version(UUID, UUID, TEXT) TO authenticated;

-- ── 12. ROW LEVEL SECURITY ────────────────────────────────────
-- SELECT permissive (any authenticated user); writes gated to the roles
-- who touch this workflow: admin/ceo (oversight), sales_lead (author),
-- finance (margin override + approval), cto (approval).
ALTER TABLE proposals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_cost_sections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_resource_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_hardware_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_software_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_misc_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_vendor_costs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_timeline       ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_value_summary  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'proposals','proposal_cost_sections','proposal_resource_plans','proposal_hardware_lines',
    'proposal_software_lines','proposal_misc_lines','proposal_vendor_costs','proposal_timeline',
    'proposal_templates','proposal_value_summary'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_lead'',''finance'',''cto''))
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'',''ceo'',''sales_lead'',''finance'',''cto''))
       )', t, t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

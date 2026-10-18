-- ============================================================
-- STEP215: extensible Proposal cost sections — "Add Cost Section" in the
-- platform's own Proposal Builder (not a separate Excel tool), per the
-- org's request to model IoT-project cost categories (IoT Logger,
-- Sensors, SaaS Platform, Dev & Maintenance, QR Device, Installation,
-- etc.) as first-class sections alongside the existing 7 (Application
-- Development, Firmware Development, Hardware Design & Production, ERP
-- Integration, Hardware, Software/SaaS/Third-Party, Miscellaneous).
--
-- Margin is already per-section (proposal_cost_sections.margin_percent,
-- STEP62) — that's exactly what lets each new custom category (e.g. "IoT
-- Logger" at a 140% margin vs "QR Device" at 60%) carry its own margin
-- without any schema change there. This migration only relaxes the
-- category CHECK constraints (proposal_cost_sections and
-- proposal_budget_category_map both had a strict 7-value enum) and adds
-- an is_custom flag so the UI can badge/gate deletion appropriately — the
-- original 7 categories, their line-item tables (hardware/software/misc/
-- resource-plan), and their existing budget-category mappings are
-- completely untouched.
-- ============================================================

ALTER TABLE proposal_cost_sections DROP CONSTRAINT IF EXISTS proposal_cost_sections_category_check;
ALTER TABLE proposal_cost_sections ADD CONSTRAINT proposal_cost_sections_category_notblank CHECK (length(trim(category)) > 0);
ALTER TABLE proposal_cost_sections ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;

-- proposal_budget_category_map.proposal_category was locked to the same 7
-- values — relax it too so a custom section can optionally still roll up
-- into a real planned-budget bucket on "Convert to Project" (previously,
-- proposalConvert.js already skips any unmapped category rather than
-- guessing — see its `if (!budgetCategory) continue` — so this is
-- additive: without a mapping row, a custom section's cost just doesn't
-- flow into Convert to Project, exactly as it wouldn't have before this
-- migration either).
ALTER TABLE proposal_budget_category_map DROP CONSTRAINT IF EXISTS proposal_budget_category_map_proposal_category_check;
ALTER TABLE proposal_budget_category_map ADD CONSTRAINT proposal_budget_category_map_category_notblank CHECK (length(trim(proposal_category)) > 0);

NOTIFY pgrst, 'reload schema';

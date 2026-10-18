-- STEP188: Industry-Adaptive Platform — fix-up for Phases 1 and 9.
--
-- Same root cause as STEP187, different tables — found by exhaustively
-- grepping every new lib file this build added for PostgREST embed
-- syntax (`alias:table!fk_column(...)` / `alias:table(...)`) and
-- cross-checking each one against its column's actual declaration.
-- Five more soft-ref columns turned out to be embedded somewhere,
-- meaning all five will throw the identical PGRST200 the moment that
-- code path is exercised:
--
--   workspace_profiles.industry_profile_id  -> industry_profiles(id)
--   workspace_profiles.business_type_id     -> business_types(id)
--   workspace_operating_models.operating_model_id -> operating_models(id)
--   task_equipment.asset_id                 -> assets(id)
--   task_materials.product_id               -> products(id)
--
-- industry_profiles/business_types/operating_models are foundational
-- lookup tables created in the same migration (STEP180) that declares
-- workspace_profiles/workspace_operating_models. assets/products are
-- long-standing, pre-existing app tables (AssetsPage.jsx/InventoryPage.jsx)
-- that predate this whole build. All five are exactly the
-- "definitely-exists, safe for a real FK" case per this repo's own
-- soft-vs-hard-FK convention.
--
-- No orphan risk: workspace_profiles' industry_profile_id/business_type_id
-- are NULL for every existing org (the legacy-default seed) and NULL
-- passes a foreign key check trivially; task_equipment/task_materials/
-- workspace_operating_models are all brand-new, effectively-empty
-- tables from this same build.
--
-- Idempotent: guarded the same way as STEP187, safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_profiles_industry_profile_id_fkey'
  ) THEN
    ALTER TABLE workspace_profiles ADD CONSTRAINT workspace_profiles_industry_profile_id_fkey
      FOREIGN KEY (industry_profile_id) REFERENCES industry_profiles(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_profiles_business_type_id_fkey'
  ) THEN
    ALTER TABLE workspace_profiles ADD CONSTRAINT workspace_profiles_business_type_id_fkey
      FOREIGN KEY (business_type_id) REFERENCES business_types(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wom_operating_model_id_fkey'
  ) THEN
    ALTER TABLE workspace_operating_models ADD CONSTRAINT wom_operating_model_id_fkey
      FOREIGN KEY (operating_model_id) REFERENCES operating_models(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_equipment_asset_id_fkey'
  ) THEN
    ALTER TABLE task_equipment ADD CONSTRAINT task_equipment_asset_id_fkey
      FOREIGN KEY (asset_id) REFERENCES assets(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_materials_product_id_fkey'
  ) THEN
    ALTER TABLE task_materials ADD CONSTRAINT task_materials_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

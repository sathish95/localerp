-- ============================================================
-- STEP225: seeds 5 starter award categories per organization —
-- award_categories (STEP115) is otherwise empty until HR adds one via
-- Award Management → Categories → "New Category". A deliberately smaller,
-- curated set than STEP122's 9 (which also builds a certificate template
-- per category); this is categories only, covering the 5 broad
-- recognition angles most orgs start with: cadence (monthly), overall
-- performance, innovation, collaboration, and leadership.
--
-- Idempotent: ON CONFLICT (organization_id, name) DO NOTHING, so
-- re-running this is safe and never clobbers a category HR has since
-- renamed or edited. Every field left unset (is_active, created_by,
-- timestamps) uses award_categories' own DB defaults — same shape
-- createCategory() in src/lib/awards.js writes from the UI.
-- ============================================================

DO $$
DECLARE
  org RECORD;
  cats TEXT[][] := ARRAY[
    ARRAY['Employee of the Month', 'Awarded monthly for standout contribution'],
    ARRAY['Best Performer', 'Recognizing consistently excellent performance'],
    ARRAY['Innovation Award', 'Recognizing creative problem-solving and new ideas'],
    ARRAY['Team Player', 'Recognizing outstanding collaboration and teamwork'],
    ARRAY['Leadership Excellence', 'Recognizing exceptional leadership qualities']
  ];
  cat TEXT[];
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    FOREACH cat SLICE 1 IN ARRAY cats LOOP
      INSERT INTO award_categories (organization_id, name, description)
      VALUES (org.id, cat[1], cat[2])
      ON CONFLICT (organization_id, name) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

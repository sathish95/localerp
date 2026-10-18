-- ============================================================
-- OPS (one-off): set Go-live = Yes by Equipment ID (25 equipment).
-- Requires STEP259. Run the two parts in order in the Supabase SQL Editor.
--
-- Matches golive_enrollments.equipment_id on live enrollments (not deleted /
-- unenrolled, engagement not CLOSED / CANCELLED). "Live since" is stamped with
-- today's IST date by the STEP259 trigger for devices not already live.
-- ============================================================

-- ── 1. Match check — NOT FOUND rows are skipped by step 2
WITH src(equipment_id) AS (VALUES
  ('3706000'), ('3100357'), ('3100733'), ('4100201'), ('4700122'),
  ('4700137'), ('4700142'), ('4700143'), ('3300424'), ('3800063'),
  ('3800064'), ('3800065'), ('3800066'), ('3800068'), ('3800069'),
  ('4700136'), ('3100940'), ('3100751'), ('3800061'), ('3800062'),
  ('3800067'), ('3100374'), ('4600036'), ('3800060'), ('4100154')
)
SELECT s.equipment_id,
       CASE WHEN e.id IS NULL THEN 'NOT FOUND' WHEN e.is_golive THEN 'already Yes' ELSE 'will set Yes' END AS result,
       g.code AS engagement, e.equipment_name, d.device_code
FROM src s
LEFT JOIN golive_enrollments e
  ON trim(e.equipment_id) = s.equipment_id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
  AND EXISTS (SELECT 1 FROM golive_engagements x WHERE x.id = e.engagement_id AND x.status NOT IN ('CLOSED','CANCELLED'))
LEFT JOIN golive_engagements g ON g.id = e.engagement_id
LEFT JOIN device_instances d ON d.id = e.device_id
ORDER BY result, s.equipment_id;

-- ── 2. Update
WITH src(equipment_id) AS (VALUES
  ('3706000'), ('3100357'), ('3100733'), ('4100201'), ('4700122'),
  ('4700137'), ('4700142'), ('4700143'), ('3300424'), ('3800063'),
  ('3800064'), ('3800065'), ('3800066'), ('3800068'), ('3800069'),
  ('4700136'), ('3100940'), ('3100751'), ('3800061'), ('3800062'),
  ('3800067'), ('3100374'), ('4600036'), ('3800060'), ('4100154')
)
UPDATE golive_enrollments e
SET is_golive = true
FROM src s
WHERE trim(e.equipment_id) = s.equipment_id
  AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL AND NOT e.is_golive
  AND EXISTS (SELECT 1 FROM golive_engagements x WHERE x.id = e.engagement_id AND x.status NOT IN ('CLOSED','CANCELLED'))
RETURNING e.equipment_id, e.equipment_name, e.is_golive, e.golive_since;

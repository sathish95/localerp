-- STEP173: ThingsAlive Wiki — Phase 6 (full-text search)
--
-- content_text (refreshed on every editor persist, see wikiYjsProvider.js)
-- is the source; title is weighted higher than body so a title match
-- ranks first. Queried directly via supabase-js's .textSearch(), no RPC
-- needed since normal wiki_pages RLS already scopes results correctly.

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_text, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS wiki_pages_search_idx ON wiki_pages USING GIN (search_vector);

NOTIFY pgrst, 'reload schema';

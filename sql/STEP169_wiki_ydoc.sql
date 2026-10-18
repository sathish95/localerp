-- STEP169: ThingsAlive Wiki — Phase 2 (rich text + realtime co-editing state)
--
-- ydoc_state holds the latest merged Yjs CRDT snapshot for a page (see
-- src/lib/wikiYjsProvider.js) so a client opening the page starts from the
-- last persisted state before live updates layer on top. content_text is
-- a plain-text extract refreshed on every persist, kept for a readable
-- fallback now and reused as the source for full-text search in a later
-- phase (STEP: wiki search) rather than storing the tsvector yet.

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS ydoc_state BYTEA;
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS content_text TEXT;

NOTIFY pgrst, 'reload schema';

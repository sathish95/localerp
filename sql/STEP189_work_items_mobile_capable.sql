-- STEP189: Register 'work-items' as a mobile-capable module.
--
-- get_effective_modules() (STEP162) gates mobile visibility on
-- mobile_module_capable_keys() — a hardcoded allowlist, by design (its
-- own header comment: "extend it with a one-line follow-up migration
-- each time a new mobile screen ships", see STEP178's identical
-- precedent for 'wiki'). Without this, the mobile Work Items screen
-- would never appear on Discover even once the 'work-items' module row
-- itself exists (via src/config/modules.js's web-side sync), because
-- get_effective_modules() would always resolve it to
-- reason='not_on_mobile' regardless of the modules table.
--
-- Full existing list carried forward verbatim (STEP178's array plus
-- this one new entry) — dropping any existing key here would silently
-- break that module on mobile for every org.

CREATE OR REPLACE FUNCTION mobile_module_capable_keys() RETURNS TEXT[] AS $$
  SELECT ARRAY[
    'dashboard',
    'org-home',
    'tasks',
    'expenses',
    'travel',
    'approvals',
    'it-helpdesk',
    'leave',
    'timesheet',
    'wiki',
    'work-items'
  ]::text[]
$$ LANGUAGE sql IMMUTABLE;

NOTIFY pgrst, 'reload schema';

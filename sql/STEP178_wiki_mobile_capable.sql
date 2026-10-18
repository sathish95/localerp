-- STEP178: Register 'wiki' as a mobile-capable module.
--
-- get_effective_modules() (STEP162) gates mobile visibility on
-- mobile_module_capable_keys() — a hardcoded allowlist, by design (its own
-- header comment: "extend it with a one-line follow-up migration each time
-- a new mobile screen ships"). Without this, the Wiki module would never
-- appear on mobile Discover even once the 'wiki' module row itself exists,
-- because get_effective_modules() would always resolve it to
-- reason='not_on_mobile' regardless of the modules table.

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
    'wiki'
  ]::text[]
$$ LANGUAGE sql IMMUTABLE;

NOTIFY pgrst, 'reload schema';

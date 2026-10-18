// Industry-Adaptive Platform — verbatim port of src/lib/terminologyDefaults.js.
// Keep these two files in sync by hand; do not add an industry here that
// isn't in the web copy (or vice versa) without updating both — an
// unlisted industry falling through to `fallback` is the deliberate
// "no invented labels" behavior, not a gap to fill in independently.
export const TERMINOLOGY_DEFAULTS: Record<string, Record<string, string>> = {
  construction: {
    location: 'Site',
    person: 'Worker',
    task: 'Activity',
    team: 'Crew',
  },
  manufacturing: {
    location: 'Plant',
    person: 'Operator',
    task: 'Operation',
    equipment: 'Machine',
  },
  retail: {
    location: 'Store',
    person: 'Staff',
    task: 'Store Task',
  },
  security: {
    location: 'Client Site',
    person: 'Guard',
    task: 'Patrol',
  },
  agriculture: {
    location: 'Farm',
    person: 'Farm Worker',
    task: 'Farm Activity',
  },
};

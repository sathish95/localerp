// Industry-Adaptive Platform — Phase 3. Industry-specific default labels
// for the universal terminology keys (master prompt section 11). Keyed
// by industry_profiles.key (STEP180's seed) so WorkspaceContext's term()
// can resolve `industry default -> fallback` without a network round
// trip per lookup.
//
// These are PRESENTATION labels only — never used to rename a database
// table/column (see TARGET_ARCHITECTURE.md's Experience vs. Domain layer
// split). An industry not listed here (or a key an industry doesn't
// define) simply falls through to term()'s `fallback` argument, i.e.
// today's hardcoded English label — exactly the master prompt's
// requirement that unlisted industries get "no overrides" rather than
// invented labels.
//
// Only the industries the master prompt itself gives explicit examples
// for (section 11) are populated; every other seeded industry
// (professional_services, healthcare, hospitality, logistics,
// warehousing, mining, education, other, ...) is intentionally an empty
// object here rather than a guess.
export const TERMINOLOGY_DEFAULTS = {
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
}

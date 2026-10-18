// Closed vocabulary of web UI anchors a tour step can point at. The
// Settings admin UI builds its target_key dropdown from this list (never
// free text) so a step can't reference a key that doesn't exist anywhere
// in the app and silently fail to find its anchor. Each key must have a
// matching `data-tour="<key>"` attribute somewhere in Layout.jsx (or a
// page it renders).
export const WEB_TOUR_TARGETS = [
  { key: 'web-nav-dashboard', label: 'Sidebar — Dashboard link' },
  { key: 'web-nav-tasks', label: 'Sidebar — Task Management link' },
  { key: 'web-nav-projects', label: 'Sidebar — Projects link' },
  { key: 'web-nav-wiki', label: 'Sidebar — ThingsAlive Wiki link' },
  { key: 'web-topbar-search', label: 'Topbar — global search (Ctrl/Cmd+K)' },
  { key: 'web-topbar-notifications', label: 'Topbar — notification bell' },
  { key: 'web-topbar-checkin', label: 'Topbar — check-in widget' },
  { key: 'web-topbar-avatar', label: 'Topbar — profile avatar' },
]

export const WEB_TOUR_TARGET_LABEL = Object.fromEntries(WEB_TOUR_TARGETS.map(t => [t.key, t.label]))

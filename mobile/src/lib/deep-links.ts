// Notification `link` values are stored web-style (e.g. '/it-helpdesk/<id>',
// '/timesheet-approvals'). Translate them to the mobile route tree so a
// push tap lands in the right place.
export function webLinkToMobileRoute(link: string | null | undefined): string {
  if (!link) return '/';
  const path = link.split('?')[0].replace(/\/+$/, '');

  const m = path.match(/^\/it-helpdesk(?:\/([^/]+))?$/);
  if (m) return m[1] ? `/feature/it-helpdesk/${m[1]}` : '/feature/it-helpdesk';

  if (path === '/approvals') return '/feature/approvals';
  if (path === '/timesheet-approvals' || path === '/timesheet') return '/feature/timesheet';
  if (path === '/leave') return '/feature/leave';
  if (path === '/expenses' || path === '/travel') return '/expenses';
  if (path === '/tasks') return '/tasks';

  // Wiki links are query-param based (`/wiki?space=X&page=Y`), not path
  // segments — parse the query string too, not just `path`.
  if (path === '/wiki') {
    const params = new URLSearchParams(link.split('?')[1] ?? '');
    const space = params.get('space');
    const page = params.get('page');
    if (space && page) return `/feature/wiki/${space}/${page}`;
    if (space) return `/feature/wiki/${space}`;
    return '/feature/wiki';
  }

  if (path === '/' || path === '' || path === '/org-home') return '/';

  // Unknown / web-only destination — send them Home rather than nowhere.
  return '/';
}

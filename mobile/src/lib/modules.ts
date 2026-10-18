import { supabase } from '@/lib/supabase';

// Mobile side of STEP161–164's module-access layer. get_effective_modules()
// on the server is the single source of truth — this file is just typed
// wrappers plus the tab → module-key map the nav uses.

export type ModuleReason =
  | 'ok'
  | 'not_purchased'
  | 'org_disabled'
  | 'role_hidden'
  | 'not_allocated'
  | 'not_on_mobile';

export type EffectiveModule = {
  module_key: string;
  label: string;
  allowed: boolean;
  reason: ModuleReason;
  bundle_key: string | null;
  source: string; // bundle name, or "Foundational"
};

// User-facing copy for a locked module (a future "Modules" screen).
export const REASON_LABEL: Record<ModuleReason, string> = {
  ok: 'Available',
  not_purchased: 'Not included in your plan',
  org_disabled: 'Turned off by your administrator',
  role_hidden: 'Not available for your role',
  not_allocated: 'No seat assigned to you — ask your admin',
  not_on_mobile: 'Not available in the mobile app',
};

export async function fetchEffectiveModules(): Promise<EffectiveModule[]> {
  const { data, error } = await supabase.rpc('get_effective_modules', { p_platform: 'mobile' });
  if (error) throw error;
  return (data ?? []) as EffectiveModule[];
}

export type BootstrapPayload = {
  profile: Record<string, unknown> | null;
  organization: Record<string, unknown> | null;
  modules: EffectiveModule[];
  unread_notifications: number;
};

export async function meBootstrap(): Promise<BootstrapPayload | null> {
  const { data, error } = await supabase.rpc('me_bootstrap', { p_platform: 'mobile' });
  if (error) throw error;
  return (data ?? null) as BootstrapPayload | null;
}

// Which module key(s) gate each bottom-tab route. A route not listed here
// is foundational and always shown (Home, Discover, Check-in, Profile).
// "expenses" (the Expense & Travel tab) is shown if EITHER sub-module resolves.
export const TAB_MODULE_GATES: Record<string, string[]> = {
  tasks: ['tasks'],
  expenses: ['expenses', 'travel'],
};

// One-line descriptions for the Discover catalog. Keys not present fall
// back to the module's server-provided label only.
export const MODULE_BLURB: Record<string, string> = {
  dashboard: 'Your key numbers at a glance',
  'org-home': 'Company announcements, new joiners and awards',
  'knowledge-base': 'Guides, policies and how-tos',
  tasks: 'Work assigned to you and its status',
  expenses: 'Claim and track expense reimbursements',
  travel: 'Request and track business travel',
  approvals: 'Review and act on items waiting on you',
  'it-helpdesk': 'Raise IT tickets and follow them to resolution',
  leave: 'Apply for leave and see your balance',
  timesheet: 'Log hours against projects',
  chat: 'Message your team',
  wiki: 'Spaces, pages, and everything your team writes down',
  'work-items': 'Work orders, service requests and the tasks under them',
};

// Where a Discover card navigates when the module is available. Only
// routes that exist today are listed; anything else shows "coming soon".
export const MODULE_ROUTE: Record<string, string> = {
  tasks: '/tasks',
  expenses: '/expenses',
  travel: '/expenses',
  dashboard: '/',
  'org-home': '/',
  'it-helpdesk': '/feature/it-helpdesk',
  approvals: '/feature/approvals',
  leave: '/feature/leave',
  timesheet: '/feature/timesheet',
  wiki: '/feature/wiki',
  'work-items': '/feature/work-items',
};

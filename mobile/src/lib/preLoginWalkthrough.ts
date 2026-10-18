import AsyncStorage from '@react-native-async-storage/async-storage';

// The 3-screen intro carousel shown before login, once per device.
//
// Unlike the org-scoped `onboarding_slides` table (web Settings ->
// Onboarding & Tour, still used by the *web* app's post-login
// walkthrough), this one runs before any authentication — there's no
// way to know which organization a device belongs to yet, so it can't
// be admin-customized per org. Content is hardcoded here instead of
// fetched, matching how most consumer apps ship first-run onboarding.
// "Seen" state is a local device flag (AsyncStorage), not a per-user
// profile column, since it must work with no signed-in user.
export type PreLoginSlide = { id: string; title: string; body: string; icon: string };

export const PRE_LOGIN_SLIDES: PreLoginSlide[] = [
  { id: 'welcome', title: 'Welcome to ThingsAlive NeoX', icon: 'Sparkles', body: "Your team's expenses, projects, tasks and approvals — all in one place." },
  { id: 'track', title: 'Track work as it happens', icon: 'ListChecks', body: 'Check in/out, log hours against projects, and manage tasks from a single board.' },
  { id: 'approve', title: 'Approvals without the chase', icon: 'CheckCircle2', body: 'Expenses, travel and timesheets route themselves to the right approver, automatically.' },
];

const SEEN_KEY = 'prelogin_walkthrough_seen';

export async function hasSeenPreLoginWalkthrough(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SEEN_KEY)) === '1'; } catch { return true; }
}

export async function markPreLoginWalkthroughSeen(): Promise<void> {
  try { await AsyncStorage.setItem(SEEN_KEY, '1'); } catch {}
}

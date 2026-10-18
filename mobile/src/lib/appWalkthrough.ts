import { supabase } from '@/lib/supabase';

// Post-login guided tour content (STEP179, sql/STEP179_app_walkthrough_tour.sql).
// The walkthrough carousel itself moved to lib/preLoginWalkthrough.ts
// (device-local, hardcoded, shown before login) — this file now only
// covers the org-scoped tour_steps table, admin-edited from the web
// app's Settings -> Onboarding & Tour.

export type TourStep = {
  id: string;
  order_index: number;
  target_key: string;
  title: string;
  body: string | null;
};

export async function listTourSteps(orgId: string): Promise<TourStep[]> {
  const { data, error } = await supabase
    .from('tour_steps')
    .select('id, order_index, target_key, title, body')
    .eq('organization_id', orgId)
    .eq('platform', 'mobile')
    .eq('active', true)
    .order('order_index');
  if (error) throw error;
  return (data ?? []) as TourStep[];
}

export async function markTourSeen(userId: string) {
  const { error } = await supabase.from('profiles').update({ tour_seen_at: new Date().toISOString() }).eq('id', userId);
  if (error) throw error;
}

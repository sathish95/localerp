import { supabase } from '@/lib/supabase';

export type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publish_at: string;
  author?: { full_name: string } | null;
};

export type NewJoinee = {
  id: string;
  full_name: string;
  role: string;
  date_joined: string;
  dept?: { name: string } | null;
};

export type AwardWinner = {
  employee_id: string;
  employee_name: string;
  award_id: string;
  award_name: string;
  category_name: string | null;
  award_date: string | null;
  final_score: number | null;
};

export async function listAnnouncements(): Promise<Announcement[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('org_announcements')
    .select('*, author:created_by(full_name)')
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('pinned', { ascending: false })
    .order('publish_at', { ascending: false });
  if (error) throw error;
  return data as unknown as Announcement[];
}

export async function listNewJoinees(days = 60): Promise<NewJoinee[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, date_joined, dept:department_id(name)')
    .gte('date_joined', since)
    .order('date_joined', { ascending: false });
  if (error) throw error;
  return data as unknown as NewJoinee[];
}

export async function listRecentAwardWinners(limit = 8): Promise<AwardWinner[]> {
  const { data, error } = await supabase.rpc('list_recent_award_winners', { p_limit: limit });
  if (error) throw error;
  return data as AwardWinner[];
}

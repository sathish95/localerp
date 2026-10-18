import { supabase } from '@/lib/supabase';

// Mobile port of src/lib/wikiRestrictions.js.

export type WikiPageRestriction = {
  id: string;
  page_id: string;
  subject_type: 'user' | 'role';
  subject_id: string;
  permission: 'view' | 'edit';
  created_by: string | null;
  created_at: string;
};

export async function listRestrictions(pageId: string): Promise<WikiPageRestriction[]> {
  const { data, error } = await supabase.from('wiki_page_restrictions').select('*').eq('page_id', pageId).order('created_at');
  if (error) throw error;
  return (data ?? []) as WikiPageRestriction[];
}

export async function addRestriction(pageId: string, subjectType: 'user' | 'role', subjectId: string, permission: 'view' | 'edit', createdBy: string) {
  const { error } = await supabase.from('wiki_page_restrictions')
    .insert({ page_id: pageId, subject_type: subjectType, subject_id: subjectId, permission, created_by: createdBy });
  if (error) throw error;
}

export async function removeRestriction(id: string) {
  const { error } = await supabase.from('wiki_page_restrictions').delete().eq('id', id);
  if (error) throw error;
}

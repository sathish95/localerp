import { supabase } from '@/lib/supabase';

// Mobile port of src/lib/wikiLabels.js.

export type WikiLabel = { id: string; name: string; color: string };

export async function listLabels(): Promise<WikiLabel[]> {
  const { data, error } = await supabase.from('wiki_labels').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as WikiLabel[];
}

export async function createLabel(name: string, color?: string): Promise<WikiLabel> {
  const { data, error } = await supabase.from('wiki_labels').insert({ name: name.trim(), color: color || '#6366f1' }).select().single();
  if (error) throw error;
  return data as WikiLabel;
}

export async function listPageLabels(pageId: string): Promise<WikiLabel[]> {
  const { data, error } = await supabase.from('wiki_page_labels').select('label_id, label:wiki_labels(id,name,color)').eq('page_id', pageId);
  if (error) throw error;
  return ((data ?? []) as unknown as { label: WikiLabel | null }[]).map(r => r.label).filter((l): l is WikiLabel => !!l);
}

export async function setPageLabels(pageId: string, labelIds: string[]) {
  const { data: existing, error: readErr } = await supabase.from('wiki_page_labels').select('label_id').eq('page_id', pageId);
  if (readErr) throw readErr;
  const before = new Set((existing ?? []).map(r => r.label_id as string));
  const after = new Set(labelIds);
  const toAdd = [...after].filter(id => !before.has(id));
  const toRemove = [...before].filter(id => !after.has(id));
  if (toAdd.length) await supabase.from('wiki_page_labels').insert(toAdd.map(label_id => ({ page_id: pageId, label_id })));
  if (toRemove.length) await supabase.from('wiki_page_labels').delete().eq('page_id', pageId).in('label_id', toRemove);
}

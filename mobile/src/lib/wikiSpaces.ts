import { supabase } from '@/lib/supabase';

// Mobile port of src/lib/wikiSpaces.js — same table, same shape.

export type WikiSpace = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  visibility: 'org' | 'restricted';
  project_id: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
};

export async function listSpaces(): Promise<WikiSpace[]> {
  const { data, error } = await supabase.from('wiki_spaces').select('*').is('archived_at', null).order('name');
  if (error) throw error;
  return (data ?? []) as WikiSpace[];
}

export async function getSpace(id: string): Promise<WikiSpace | null> {
  const { data, error } = await supabase.from('wiki_spaces').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as WikiSpace | null;
}

export async function createSpace(input: { key: string; name: string; description?: string }, userId: string): Promise<WikiSpace> {
  const { data, error } = await supabase.from('wiki_spaces')
    .insert({ key: input.key, name: input.name, description: input.description || null, created_by: userId })
    .select().single();
  if (error) throw error;
  return data as WikiSpace;
}

export async function archiveSpace(id: string) {
  const { error } = await supabase.from('wiki_spaces').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

function keyFrom(text: string | null | undefined, fallback: string) {
  const key = (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return key || fallback;
}

// One space per project, created the first time anyone opens that
// project's wiki space on any platform (web or mobile) — see
// src/lib/wikiSpaces.js's ensureProjectSpace for the identical shape.
export async function ensureProjectSpace(project: { id: string; name: string; code?: string | null }, userId: string): Promise<WikiSpace> {
  const { data: existing, error: findErr } = await supabase.from('wiki_spaces').select('*').eq('project_id', project.id).maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing as WikiSpace;

  const key = keyFrom(project.code, keyFrom(project.id, 'PRJ'));
  const { data, error } = await supabase.from('wiki_spaces')
    .insert({ key, name: project.name, description: `Auto-created space for project "${project.name}"`, project_id: project.id, created_by: userId })
    .select().single();
  if (!error) return data as WikiSpace;

  // Unique violation — a concurrent call (web or another device) already
  // created it. Fetch and use that one instead of erroring out.
  if (error.code === '23505') {
    const { data: retry, error: retryErr } = await supabase.from('wiki_spaces').select('*').eq('project_id', project.id).maybeSingle();
    if (retryErr) throw retryErr;
    if (retry) return retry as WikiSpace;
  }
  throw error;
}

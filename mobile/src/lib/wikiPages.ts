import { supabase } from '@/lib/supabase';

// Mobile port of src/lib/wikiPages.js. content/ydoc-editing itself never
// happens on mobile (see WikiEditorWebView) so the bytea<->Uint8Array
// helpers only need to exist for version restore (wikiPageVersions.ts),
// not here.

export type WikiPage = {
  id: string;
  space_id: string;
  parent_page_id: string | null;
  project_id: string | null;
  title: string;
  content_text: string | null;
  sort_order: number;
  status: 'draft' | 'published';
  current_version_no: number;
  mentions: string[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WikiPageTreeNode = WikiPage & { children: WikiPageTreeNode[]; cycleDetected?: boolean };

const PAGE_LIST_SELECT = 'id,space_id,parent_page_id,project_id,title,sort_order,status,current_version_no,created_by,updated_by,created_at,updated_at';

export async function listPages(spaceId: string): Promise<WikiPage[]> {
  const { data, error } = await supabase.from('wiki_pages').select(PAGE_LIST_SELECT).eq('space_id', spaceId).order('sort_order').order('created_at');
  if (error) throw error;
  return (data ?? []) as WikiPage[];
}

export async function getPage(id: string): Promise<WikiPage | null> {
  const { data, error } = await supabase.from('wiki_pages').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as WikiPage | null;
}

export async function createPage(input: { spaceId: string; parentPageId?: string | null; title: string; projectId?: string | null }, userId: string): Promise<WikiPage> {
  const { data, error } = await supabase.from('wiki_pages')
    .insert({
      space_id: input.spaceId, parent_page_id: input.parentPageId || null, title: input.title || 'Untitled page',
      project_id: input.projectId || null, created_by: userId, updated_by: userId,
    })
    .select().single();
  if (error) throw error;
  return data as WikiPage;
}

export async function renamePage(id: string, title: string, userId: string) {
  const { error } = await supabase.from('wiki_pages').update({ title, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function setPageProject(id: string, projectId: string | null) {
  const { error } = await supabase.from('wiki_pages').update({ project_id: projectId }).eq('id', id);
  if (error) throw error;
}

// parent_page_id is a soft ref (no FK/CASCADE) — always delete the whole
// subtree, or descendants would point at a now-nonexistent parent and
// become permanently invisible (buildPageTree can never reach them
// again). Same fix as src/lib/wikiPages.js's deletePage.
export async function deletePage(id: string, allPages: WikiPage[]) {
  const byParent: Record<string, string[]> = {};
  allPages.forEach(p => {
    const key = p.parent_page_id ?? '';
    (byParent[key] ??= []).push(p.id);
  });
  const ids = [id];
  for (let i = 0; i < ids.length; i++) ids.push(...(byParent[ids[i]] ?? []));
  const { error } = await supabase.from('wiki_pages').delete().in('id', ids);
  if (error) throw error;
}

export function wouldCreateCycle(pageId: string, newParentId: string | null, allPages: WikiPage[]): boolean {
  if (!newParentId) return false;
  if (pageId === newParentId) return true;
  const byId = Object.fromEntries(allPages.map(p => [p.id, p]));
  let cur: WikiPage | undefined = byId[newParentId];
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === pageId) return true;
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    cur = cur.parent_page_id ? byId[cur.parent_page_id] : undefined;
  }
  return false;
}

export async function movePage(id: string, newParentId: string | null, allPages: WikiPage[]) {
  if (wouldCreateCycle(id, newParentId, allPages)) throw new Error("Cannot move a page under its own descendant.");
  const { error } = await supabase.from('wiki_pages').update({ parent_page_id: newParentId }).eq('id', id);
  if (error) throw error;
}

export function buildPageTree(pages: WikiPage[]): WikiPageTreeNode[] {
  const byParent: Record<string, WikiPage[]> = {};
  pages.forEach(p => { (byParent[p.parent_page_id ?? '__root__'] ??= []).push(p); });
  function build(parentKey: string, visited: Set<string>): WikiPageTreeNode[] {
    return (byParent[parentKey] ?? []).map(p => {
      if (visited.has(p.id)) return { ...p, children: [], cycleDetected: true };
      const nextVisited = new Set(visited); nextVisited.add(p.id);
      return { ...p, children: build(p.id, nextVisited) };
    });
  }
  return build('__root__', new Set());
}

export async function searchPages(query: string): Promise<{ id: string; space_id: string; title: string; content_text: string | null }[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.from('wiki_pages')
    .select('id,space_id,title,content_text')
    .textSearch('search_vector', q, { type: 'websearch' })
    .limit(15);
  if (error) throw error;
  return data ?? [];
}

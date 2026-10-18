import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { haptic } from '@/lib/haptics';
import { listProjects } from '@/lib/requests';
import {
  archiveSpace, createSpace, ensureProjectSpace, getSpace, listSpaces, type WikiSpace,
} from '@/lib/wikiSpaces';
import {
  buildPageTree, createPage, deletePage, getPage, listPages, movePage, renamePage, searchPages, setPageProject,
  type WikiPage,
} from '@/lib/wikiPages';
import { addComment, deleteComment, listComments } from '@/lib/wikiComments';
import { createLabel, listLabels, listPageLabels, setPageLabels } from '@/lib/wikiLabels';
import { addRestriction, listRestrictions, removeRestriction } from '@/lib/wikiRestrictions';
import { listPageVersions, restorePageVersion } from '@/lib/wikiPageVersions';
import { deleteAttachment, listAttachments, uploadAttachment } from '@/lib/wikiAttachments';

export const wikihk = {
  spaces: () => ['wiki', 'spaces'] as const,
  space: (id: string) => ['wiki', 'space', id] as const,
  projects: () => ['wiki', 'projects'] as const,
  pages: (spaceId: string) => ['wiki', 'pages', spaceId] as const,
  page: (id: string) => ['wiki', 'page', id] as const,
  search: (q: string) => ['wiki', 'search', q] as const,
  comments: (pageId: string) => ['wiki', 'comments', pageId] as const,
  labels: () => ['wiki', 'labels'] as const,
  pageLabels: (pageId: string) => ['wiki', 'page-labels', pageId] as const,
  restrictions: (pageId: string) => ['wiki', 'restrictions', pageId] as const,
  versions: (pageId: string) => ['wiki', 'versions', pageId] as const,
  attachments: (pageId: string) => ['wiki', 'attachments', pageId] as const,
};

/* ── Spaces ── */

export function useWikiSpaces() {
  return useQuery({ queryKey: wikihk.spaces(), queryFn: listSpaces });
}

export function useWikiSpace(id: string | undefined) {
  return useQuery({ queryKey: wikihk.space(id ?? ''), queryFn: () => getSpace(id!), enabled: !!id });
}

export function useWikiProjects() {
  return useQuery({ queryKey: wikihk.projects(), queryFn: () => listProjects(), staleTime: 5 * 60_000 });
}

export function useCreateWikiSpace() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (input: { key: string; name: string; description?: string }) => createSpace(input, profile!.id),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: wikihk.spaces() }); },
    onError: () => haptic.error(),
  });
}

export function useOpenProjectSpace() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (project: { id: string; name: string; code?: string | null }) => ensureProjectSpace(project, profile!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.spaces() }),
  });
}

export function useArchiveWikiSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveSpace(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.spaces() }),
  });
}

/* ── Pages ── */

export function useWikiPages(spaceId: string | undefined) {
  const q = useQuery({ queryKey: wikihk.pages(spaceId ?? ''), queryFn: () => listPages(spaceId!), enabled: !!spaceId });
  return { ...q, tree: buildPageTree(q.data ?? []) };
}

export function useWikiPage(id: string | undefined) {
  return useQuery({ queryKey: wikihk.page(id ?? ''), queryFn: () => getPage(id!), enabled: !!id });
}

export function useWikiSearch(query: string) {
  return useQuery({ queryKey: wikihk.search(query), queryFn: () => searchPages(query), enabled: query.trim().length > 0 });
}

export function useCreateWikiPage(spaceId: string) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (input: { title: string; parentPageId?: string | null; projectId?: string | null }) =>
      createPage({ spaceId, ...input }, profile!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.pages(spaceId) }),
  });
}

export function useWikiPageActions(spaceId: string, allPages: WikiPage[]) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const invalidate = () => qc.invalidateQueries({ queryKey: wikihk.pages(spaceId) });

  const rename = useMutation({
    mutationFn: (args: { id: string; title: string }) => renamePage(args.id, args.title, profile!.id),
    onSuccess: invalidate,
  });
  const move = useMutation({
    mutationFn: (args: { id: string; newParentId: string | null }) => movePage(args.id, args.newParentId, allPages),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deletePage(id, allPages),
    onSuccess: invalidate,
  });
  const setProject = useMutation({
    mutationFn: (args: { id: string; projectId: string | null }) => setPageProject(args.id, args.projectId),
    onSuccess: (_r, args) => { invalidate(); qc.invalidateQueries({ queryKey: wikihk.page(args.id) }); },
  });

  return { rename, move, remove, setProject };
}

/* ── Comments ── */

export function useWikiComments(pageId: string) {
  return useQuery({ queryKey: wikihk.comments(pageId), queryFn: () => listComments(pageId) });
}

export function useAddWikiComment(pageId: string, ctx: { pageTitle: string; spaceId: string; pageOwnerId: string | null }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (args: { comment: string; mentionIds: string[] }) => addComment(pageId, profile!.id, args.comment, args.mentionIds, ctx),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.comments(pageId) }),
  });
}

export function useDeleteWikiComment(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.comments(pageId) }),
  });
}

/* ── Labels ── */

export function useWikiLabels() {
  return useQuery({ queryKey: wikihk.labels(), queryFn: listLabels, staleTime: 5 * 60_000 });
}

export function useWikiPageLabels(pageId: string) {
  return useQuery({ queryKey: wikihk.pageLabels(pageId), queryFn: () => listPageLabels(pageId) });
}

export function useSetWikiPageLabels(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelIds: string[]) => setPageLabels(pageId, labelIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.pageLabels(pageId) }),
  });
}

export function useCreateWikiLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; color?: string }) => createLabel(args.name, args.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.labels() }),
  });
}

/* ── Restrictions ── */

export function useWikiRestrictions(pageId: string) {
  return useQuery({ queryKey: wikihk.restrictions(pageId), queryFn: () => listRestrictions(pageId) });
}

export function useWikiRestrictionActions(pageId: string) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const invalidate = () => qc.invalidateQueries({ queryKey: wikihk.restrictions(pageId) });
  const add = useMutation({
    mutationFn: (args: { subjectType: 'user' | 'role'; subjectId: string; permission: 'view' | 'edit' }) =>
      addRestriction(pageId, args.subjectType, args.subjectId, args.permission, profile!.id),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => removeRestriction(id), onSuccess: invalidate });
  return { add, remove };
}

/* ── Versions ── */

export function useWikiVersions(pageId: string) {
  return useQuery({ queryKey: wikihk.versions(pageId), queryFn: () => listPageVersions(pageId) });
}

export function useRestoreWikiVersion(pageId: string) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (versionId: string) => restorePageVersion(pageId, versionId, profile!.id),
    onSuccess: () => {
      haptic.success();
      qc.invalidateQueries({ queryKey: wikihk.versions(pageId) });
      qc.invalidateQueries({ queryKey: wikihk.page(pageId) });
    },
    onError: () => haptic.error(),
  });
}

/* ── Attachments ── */

export function useWikiAttachments(pageId: string) {
  return useQuery({ queryKey: wikihk.attachments(pageId), queryFn: () => listAttachments(pageId) });
}

export function useUploadWikiAttachment(pageId: string) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (args: { uri: string; fileName: string; mimeType?: string }) =>
      uploadAttachment(pageId, args.uri, args.fileName, profile!.id, profile!.org?.id ?? '', args.mimeType),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: wikihk.attachments(pageId) }); },
    onError: () => haptic.error(),
  });
}

export function useDeleteWikiAttachment(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; storagePath: string }) => deleteAttachment(args.id, args.storagePath),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikihk.attachments(pageId) }),
  });
}

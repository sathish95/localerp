import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Edit2, FileText, MoreVertical, Plus, Trash2, X } from 'lucide-react-native';

import { Button, Card, EmptyState, PageHeader, Screen, TextField } from '@/components/ui';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useCreateWikiPage, useWikiPageActions, useWikiPages, useWikiSpace } from '@/hooks/wiki';
import type { WikiPageTreeNode } from '@/lib/wikiPages';

export default function WikiSpaceScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { blocked } = useFeatureGuard('wiki');
  const t = useTheme();
  const router = useRouter();

  const spaceQ = useWikiSpace(spaceId);
  const pagesQ = useWikiPages(spaceId);
  const createPage = useCreateWikiPage(spaceId);
  const actions = useWikiPageActions(spaceId, pagesQ.data ?? []);

  const [showNewPage, setShowNewPage] = useState(false);
  const [parentPageId, setParentPageId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [renameTarget, setRenameTarget] = useState<WikiPageTreeNode | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [actionsFor, setActionsFor] = useState<WikiPageTreeNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WikiPageTreeNode | null>(null);

  if (blocked) return <Redirect href={'/discover' as Href} />;

  function openNewPage(parent: string | null) {
    setParentPageId(parent);
    setTitle('');
    setShowNewPage(true);
  }

  async function handleCreate() {
    if (!title.trim()) return;
    const projectId = spaceQ.data?.project_id ?? null;
    const page = await createPage.mutateAsync({ title: title.trim(), parentPageId, projectId });
    setShowNewPage(false);
    router.push(`/feature/wiki/${spaceId}/${page.id}` as Href);
  }

  async function handleRename() {
    if (!renameTarget || !renameTitle.trim()) return;
    await actions.rename.mutateAsync({ id: renameTarget.id, title: renameTitle.trim() });
    setRenameTarget(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await actions.remove.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  }

  return (
    <Screen onRefresh={pagesQ.refetch} refreshing={pagesQ.isRefetching}>
      <PageHeader
        title={spaceQ.data?.name ?? 'Space'}
        subtitle={spaceQ.data?.key}
        right={
          <Pressable onPress={() => openNewPage(null)} style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={20} color="#fff" />
          </Pressable>
        }
      />

      {pagesQ.isLoading ? (
        <View style={{ gap: Spacing.md }}>
          {[56, 56, 56].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
        </View>
      ) : pagesQ.tree.length === 0 ? (
        <Card><EmptyState icon={<FileText color={t.accent} size={22} />} title="No pages yet" desc="Create the first page in this space." /></Card>
      ) : (
        <View style={{ gap: 6 }}>
          {pagesQ.tree.map(node => (
            <PageTreeRow key={node.id} node={node} depth={0} spaceId={spaceId}
              onAddChild={openNewPage} onOpenActions={setActionsFor} />
          ))}
        </View>
      )}

      {/* New page */}
      <Modal visible={showNewPage} transparent animationType="fade" onRequestClose={() => setShowNewPage(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setShowNewPage(false)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>{parentPageId ? 'New Sub-page' : 'New Page'}</Text>
              <Pressable onPress={() => setShowNewPage(false)}><X size={20} color={t.textMuted} /></Pressable>
            </View>
            <TextField label="Title" placeholder="Page title" value={title} onChangeText={setTitle} autoFocus />
            <Button title="Create" onPress={handleCreate} loading={createPage.isPending} disabled={!title.trim()} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Page actions bottom sheet */}
      <Modal visible={!!actionsFor} transparent animationType="fade" onRequestClose={() => setActionsFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setActionsFor(null)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 4 }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15, marginBottom: 8 }} numberOfLines={1}>{actionsFor?.title}</Text>
            <ActionRow icon={<Plus size={16} color={t.text} />} label="Add sub-page" onPress={() => { if (actionsFor) openNewPage(actionsFor.id); setActionsFor(null); }} />
            <ActionRow icon={<Edit2 size={16} color={t.text} />} label="Rename" onPress={() => { if (actionsFor) { setRenameTarget(actionsFor); setRenameTitle(actionsFor.title); } setActionsFor(null); }} />
            <ActionRow icon={<Trash2 size={16} color={t.danger} />} label="Delete" danger onPress={() => { setDeleteTarget(actionsFor); setActionsFor(null); }} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rename */}
      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setRenameTarget(null)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 12 }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>Rename Page</Text>
            <TextField label="Title" value={renameTitle} onChangeText={setRenameTitle} autoFocus />
            <Button title="Save" onPress={handleRename} loading={actions.rename.isPending} disabled={!renameTitle.trim()} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete confirm */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl }} onPress={() => setDeleteTarget(null)}>
          <Pressable style={{ backgroundColor: t.surface, borderRadius: Radius.lg, padding: Spacing.xl, gap: 14, width: '100%' }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>Delete this page?</Text>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>This deletes "{deleteTarget?.title}" and all its sub-pages permanently.</Text>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Button title="Cancel" variant="ghost" onPress={() => setDeleteTarget(null)} />
              <Button title="Delete" variant="danger" onPress={handleDelete} loading={actions.remove.isPending} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function PageTreeRow({ node, depth, spaceId, onAddChild, onOpenActions }: {
  node: WikiPageTreeNode; depth: number; spaceId: string;
  onAddChild: (parentId: string) => void; onOpenActions: (node: WikiPageTreeNode) => void;
}) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View>
      <Pressable
        onPress={() => router.push(`/feature/wiki/${spaceId}/${node.id}` as Href)}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingRight: 8,
          paddingLeft: 12 + depth * 18, borderRadius: Radius.md, backgroundColor: pressed ? t.surfaceSoft : 'transparent',
        })}
      >
        <FileText size={14} color={t.textMuted} />
        <Text style={{ flex: 1, color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13.5 }} numberOfLines={1}>{node.title}</Text>
        <Pressable hitSlop={8} onPress={() => onOpenActions(node)}>
          <MoreVertical size={16} color={t.textMuted} />
        </Pressable>
      </Pressable>
      {node.children.map(child => (
        <PageTreeRow key={child.id} node={child} depth={depth + 1} spaceId={spaceId} onAddChild={onAddChild} onOpenActions={onOpenActions} />
      ))}
    </View>
  );
}

function ActionRow({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 }}>
      {icon}
      <Text style={{ color: danger ? t.danger : t.text, fontFamily: Fonts.bodyMedium, fontSize: 14.5 }}>{label}</Text>
    </Pressable>
  );
}

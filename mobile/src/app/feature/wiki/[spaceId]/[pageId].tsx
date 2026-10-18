import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Briefcase, Edit2, ExternalLink, FileText, X } from 'lucide-react-native';

import { Card, EmptyState, PageHeader, Screen, TextField } from '@/components/ui';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { dateFmt } from '@/lib/supabase';
import { useWikiPage, useWikiPageActions, useWikiPages, useWikiProjects } from '@/hooks/wiki';
import { PageLabelsSection } from '@/components/wiki/PageLabelsSection';
import { PageCommentsSection } from '@/components/wiki/PageCommentsSection';
import { PageVersionsSection } from '@/components/wiki/PageVersionsSection';
import { PageRestrictionsSection } from '@/components/wiki/PageRestrictionsSection';
import { PageAttachmentsSection } from '@/components/wiki/PageAttachmentsSection';

export default function WikiPageDetailScreen() {
  const { spaceId, pageId } = useLocalSearchParams<{ spaceId: string; pageId: string }>();
  const { blocked } = useFeatureGuard('wiki');
  const t = useTheme();
  const router = useRouter();

  const pageQ = useWikiPage(pageId);
  const pagesQ = useWikiPages(spaceId);
  const projectsQ = useWikiProjects();
  const actions = useWikiPageActions(spaceId, pagesQ.data ?? []);

  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  if (blocked) return <Redirect href={'/discover' as Href} />;

  const page = pageQ.data;
  if (pageQ.isLoading) return <Screen scroll={false}><View /></Screen>;
  if (!page) {
    return (
      <Screen scroll={false}>
        <PageHeader title="Page" />
        <EmptyState icon={<FileText color={t.textMuted} size={22} />} title="Page not found" desc="It may have been removed, or you don't have access." />
      </Screen>
    );
  }

  const project = projectsQ.data?.find(p => p.id === page.project_id);

  async function handleRename() {
    if (!renameTitle.trim()) return;
    await actions.rename.mutateAsync({ id: page!.id, title: renameTitle.trim() });
    setRenaming(false);
  }

  function pickProject(projectId: string | null) {
    actions.setProject.mutate({ id: page!.id, projectId });
    setShowProjectPicker(false);
  }

  return (
    <Screen onRefresh={pageQ.refetch} refreshing={pageQ.isRefetching}>
      <PageHeader
        title={page.title}
        subtitle={`Updated ${dateFmt(page.updated_at)}`}
        right={
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable onPress={() => { setRenameTitle(page.title); setRenaming(true); }}><Edit2 size={16} color={t.textMuted} /></Pressable>
            <PageRestrictionsSection pageId={page.id} />
          </View>
        }
      />

      <Pressable onPress={() => setShowProjectPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Briefcase size={12} color={t.textMuted} />
        <Text style={{ color: project ? t.accent : t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>
          {project ? project.name : 'No project — tap to link one'}
        </Text>
      </Pressable>

      <PageLabelsSection pageId={page.id} />

      <Card>
        <Pressable onPress={() => router.push(`/feature/wiki/${spaceId}/${pageId}/editor` as Href)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>Open Editor</Text>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }}>Live co-editing with anyone else viewing this page</Text>
          </View>
          <ExternalLink size={18} color={t.accent} />
        </Pressable>
        {page.content_text ? (
          <Text style={{ color: t.textSoft, fontFamily: Fonts.body, fontSize: 12.5, marginTop: 10, lineHeight: 18 }} numberOfLines={4}>{page.content_text}</Text>
        ) : null}
      </Card>

      <PageVersionsSection pageId={page.id} onRestored={() => pageQ.refetch()} />

      <PageAttachmentsSection pageId={page.id} />

      <PageCommentsSection pageId={page.id} pageTitle={page.title} spaceId={spaceId} pageOwnerId={page.created_by} />

      {/* Rename */}
      <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setRenaming(false)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 12 }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>Rename Page</Text>
            <TextField label="Title" value={renameTitle} onChangeText={setRenameTitle} autoFocus onSubmitEditing={handleRename} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Project picker */}
      <Modal visible={showProjectPicker} transparent animationType="fade" onRequestClose={() => setShowProjectPicker(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setShowProjectPicker(false)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 4, maxHeight: '70%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>Link Project</Text>
              <Pressable onPress={() => setShowProjectPicker(false)}><X size={20} color={t.textMuted} /></Pressable>
            </View>
            <Pressable onPress={() => pickProject(null)} style={{ paddingVertical: 12 }}>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyMedium, fontSize: 14.5 }}>No project</Text>
            </Pressable>
            {(projectsQ.data ?? []).map(p => (
              <Pressable key={p.id} onPress={() => pickProject(p.id)} style={{ paddingVertical: 12 }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 14.5 }}>{p.name}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

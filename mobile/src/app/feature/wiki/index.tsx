import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { Briefcase, FileText, Library, Plus, Search, X } from 'lucide-react-native';

import { Button, Card, EmptyState, PageHeader, Screen, TextField } from '@/components/ui';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing, alpha } from '@/constants/theme';
import {
  useWikiSpaces, useWikiProjects, useOpenProjectSpace, useCreateWikiSpace, useWikiSearch,
} from '@/hooks/wiki';
import type { WikiSpace } from '@/lib/wikiSpaces';

export default function WikiSpacesScreen() {
  const { blocked } = useFeatureGuard('wiki');
  const t = useTheme();
  const router = useRouter();

  const spacesQ = useWikiSpaces();
  const projectsQ = useWikiProjects();
  const openProjectSpace = useOpenProjectSpace();
  const createSpace = useCreateWikiSpace();

  const [query, setQuery] = useState('');
  const searchQ = useWikiSearch(query);

  const [showNewSpace, setShowNewSpace] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', description: '' });

  if (blocked) return <Redirect href={'/discover' as Href} />;

  const spaces = spacesQ.data ?? [];
  const projects = projectsQ.data ?? [];

  async function openProject(project: { id: string; name: string; code?: string | null }) {
    const space = await openProjectSpace.mutateAsync(project);
    router.push(`/feature/wiki/${space.id}` as Href);
  }

  async function handleCreateSpace() {
    if (!form.key.trim() || !form.name.trim()) return;
    const space = await createSpace.mutateAsync(form);
    setShowNewSpace(false);
    setForm({ key: '', name: '', description: '' });
    router.push(`/feature/wiki/${space.id}` as Href);
  }

  return (
    <Screen onRefresh={spacesQ.refetch} refreshing={spacesQ.isRefetching}>
      <PageHeader
        title="ThingsAlive Wiki"
        subtitle="Spaces, pages, and everything your team writes down"
        right={
          <Pressable
            onPress={() => setShowNewSpace(true)}
            style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Plus size={20} color="#fff" />
          </Pressable>
        }
      />

      <TextField
        placeholder="Search all wiki pages…"
        value={query}
        onChangeText={setQuery}
        left={<Search size={16} color={t.textMuted} />}
        autoCapitalize="none"
      />

      {query.trim() ? (
        <Card>
          {searchQ.isLoading ? (
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>Searching…</Text>
          ) : (searchQ.data ?? []).length === 0 ? (
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>No pages match "{query}"</Text>
          ) : (
            <View style={{ gap: 2 }}>
              {(searchQ.data ?? []).map(r => (
                <Pressable key={r.id} onPress={() => router.push(`/feature/wiki/${r.space_id}/${r.id}` as Href)} style={{ paddingVertical: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <FileText size={12} color={t.accent} />
                    <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13 }} numberOfLines={1}>{r.title}</Text>
                  </View>
                  {r.content_text ? (
                    <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>{r.content_text}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </Card>
      ) : (
        <>
          {projects.length > 0 ? (
            <View style={{ gap: Spacing.sm }}>
              <SectionLabel icon={<Briefcase size={12} color={t.textMuted} />} label="Projects" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
                {projects.map(p => {
                  const linked = spaces.find(s => s.project_id === p.id);
                  return (
                    <Pressable key={p.id} onPress={() => openProject(p)} style={{ width: '48%' }}>
                      <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: alpha('#d97706', 0.14), alignItems: 'center', justifyContent: 'center' }}>
                            <Briefcase size={14} color="#d97706" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13 }} numberOfLines={1}>{p.name}</Text>
                            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5 }} numberOfLines={1}>
                              {linked ? 'Open wiki space' : 'Create wiki space'}
                            </Text>
                          </View>
                        </View>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={{ gap: Spacing.sm }}>
            <SectionLabel icon={<Library size={12} color={t.textMuted} />} label="Spaces" />
            {spacesQ.isLoading ? (
              <View style={{ gap: Spacing.md }}>
                {[64, 64].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
              </View>
            ) : spaces.length === 0 ? (
              <Card><EmptyState icon={<Library color={t.accent} size={22} />} title="No spaces yet" desc="Create your first space to start writing pages." /></Card>
            ) : (
              <View style={{ gap: Spacing.sm }}>
                {spaces.map(s => <SpaceCard key={s.id} space={s} onPress={() => router.push(`/feature/wiki/${s.id}` as Href)} />)}
              </View>
            )}
          </View>
        </>
      )}

      <Modal visible={showNewSpace} transparent animationType="fade" onRequestClose={() => setShowNewSpace(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setShowNewSpace(false)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>New Space</Text>
              <Pressable onPress={() => setShowNewSpace(false)}><X size={20} color={t.textMuted} /></Pressable>
            </View>
            <TextField label="Space Key" placeholder="e.g. ENG" autoCapitalize="characters" maxLength={10}
              value={form.key} onChangeText={v => setForm(f => ({ ...f, key: v.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} />
            <TextField label="Name" placeholder="e.g. Engineering" value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
            <TextField label="Description" placeholder="What lives in this space?" multiline style={{ minHeight: 60 }}
              value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} />
            <Button title="Create" onPress={handleCreateSpace} loading={createSpace.isPending} disabled={!form.key.trim() || !form.name.trim()} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {icon}
      <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>
    </View>
  );
}

function SpaceCard({ space, onPress }: { space: WikiSpace; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: alpha(t.accent, 0.14), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.accent, fontFamily: Fonts.bodyExtraBold, fontSize: 15 }}>{(space.name || '?')[0]?.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }} numberOfLines={1}>{space.name}</Text>
              {space.project_id ? <Briefcase size={11} color="#d97706" /> : null}
            </View>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5 }}>{space.key}</Text>
          </View>
        </View>
        {space.description ? (
          <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12, marginTop: 8 }} numberOfLines={2}>{space.description}</Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

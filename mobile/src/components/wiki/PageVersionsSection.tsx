import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { History, RotateCcw, X } from 'lucide-react-native';

import { Button } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { dateFmt, supabase } from '@/lib/supabase';
import { useRestoreWikiVersion, useWikiVersions } from '@/hooks/wiki';
import type { WikiPageVersion } from '@/lib/wikiPageVersions';

export function PageVersionsSection({ pageId, onRestored }: { pageId: string; onRestored: () => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const versionsQ = useWikiVersions(pageId);
  const restore = useRestoreWikiVersion(pageId);
  const [selected, setSelected] = useState<WikiPageVersion | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<WikiPageVersion | null>(null);
  const [authors, setAuthors] = useState<{ id: string; full_name: string }[]>([]);

  useEffect(() => {
    if (open) supabase.from('profiles').select('id,full_name').then(({ data }) => setAuthors(data ?? []));
  }, [open]);

  const versions = versionsQ.data ?? [];

  async function handleRestore() {
    if (!confirmTarget) return;
    await restore.mutateAsync(confirmTarget.id);
    setConfirmTarget(null);
    setOpen(false);
    onRestored();
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <History size={13} color={t.textMuted} />
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>Version history</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 60 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, marginBottom: Spacing.md }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 20 }}>Version History</Text>
            <Pressable onPress={() => setOpen(false)}><X size={22} color={t.textMuted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.xl, gap: 6 }}>
            {versions.length === 0 ? (
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 13 }}>No saved versions yet.</Text>
            ) : versions.map(v => {
              const author = authors.find(a => a.id === v.edited_by);
              const isSel = selected?.id === v.id;
              return (
                <Pressable key={v.id} onPress={() => setSelected(isSel ? null : v)}
                  style={{ borderWidth: 1, borderColor: t.border, borderRadius: Radius.md, padding: 12, backgroundColor: isSel ? t.surfaceSoft : t.surface }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13 }}>
                      Version {v.version_no}{v.status === 'active' ? ' (current)' : ''}
                    </Text>
                    {v.status !== 'active' ? (
                      <Pressable onPress={() => setConfirmTarget(v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <RotateCcw size={13} color={t.accent} />
                        <Text style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 11.5 }}>Restore</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11, marginTop: 2 }}>
                    {author?.full_name ?? 'Unknown'} · {dateFmt(v.created_at)}
                  </Text>
                  {isSel ? (
                    <Text style={{ color: t.textSoft, fontFamily: Fonts.body, fontSize: 12.5, marginTop: 8, lineHeight: 18 }} numberOfLines={8}>
                      {v.content_text || 'This version is empty.'}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <Modal visible={!!confirmTarget} transparent animationType="fade" onRequestClose={() => setConfirmTarget(null)}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl }} onPress={() => setConfirmTarget(null)}>
              <Pressable style={{ backgroundColor: t.surface, borderRadius: Radius.lg, padding: Spacing.xl, gap: 14, width: '100%' }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>Restore Version {confirmTarget?.version_no}?</Text>
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>
                  This becomes the page's new current content. Nothing is deleted from history. If someone has this page open live right now, they won't see the change until they reopen it.
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                  <Button title="Cancel" variant="ghost" onPress={() => setConfirmTarget(null)} />
                  <Button title="Restore" onPress={handleRestore} loading={restore.isPending} />
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      </Modal>
    </>
  );
}

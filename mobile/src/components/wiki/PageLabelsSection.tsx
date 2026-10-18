import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Plus, Tag, X } from 'lucide-react-native';

import { Button, TextField } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Radius, Spacing, alpha } from '@/constants/theme';
import { useCreateWikiLabel, useSetWikiPageLabels, useWikiLabels, useWikiPageLabels } from '@/hooks/wiki';

const PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#e11d48', '#0ea5e9', '#8b5cf6', '#14b8a6'];

export function PageLabelsSection({ pageId }: { pageId: string }) {
  const t = useTheme();
  const allLabelsQ = useWikiLabels();
  const pageLabelsQ = useWikiPageLabels(pageId);
  const setLabels = useSetWikiPageLabels(pageId);
  const createLabel = useCreateWikiLabel();

  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const pageLabels = pageLabelsQ.data ?? [];
  const allLabels = allLabelsQ.data ?? [];

  function toggle(id: string) {
    const has = pageLabels.some(l => l.id === id);
    const next = has ? pageLabels.filter(l => l.id !== id).map(l => l.id) : [...pageLabels.map(l => l.id), id];
    setLabels.mutate(next);
  }

  async function handleCreate() {
    if (!newLabel.trim()) return;
    const label = await createLabel.mutateAsync({ name: newLabel.trim(), color: PALETTE[allLabels.length % PALETTE.length] });
    setNewLabel('');
    setLabels.mutate([...pageLabels.map(l => l.id), label.id]);
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {pageLabels.map(l => (
        <View key={l.id} style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.pill, backgroundColor: alpha(l.color, 0.15) }}>
          <Text style={{ color: l.color, fontFamily: Fonts.bodyBold, fontSize: 11 }}>{l.name}</Text>
        </View>
      ))}
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }}>
        <Tag size={12} color={t.textMuted} />
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 11 }}>{pageLabels.length ? 'Edit labels' : 'Add labels'}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setOpen(false)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>Labels</Text>
              <Pressable onPress={() => setOpen(false)}><X size={20} color={t.textMuted} /></Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {allLabels.map(l => {
                const active = pageLabels.some(pl => pl.id === l.id);
                return (
                  <Pressable key={l.id} onPress={() => toggle(l.id)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.pill, borderWidth: 1.5, borderColor: active ? l.color : t.border, backgroundColor: active ? alpha(l.color, 0.15) : t.surfaceSoft }}>
                    <Text style={{ color: active ? l.color : t.textSoft, fontFamily: Fonts.bodyBold, fontSize: 12 }}>{l.name}</Text>
                  </Pressable>
                );
              })}
              {allLabels.length === 0 ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>No labels yet — create one below.</Text> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <TextField placeholder="New label name" value={newLabel} onChangeText={setNewLabel} />
              </View>
              <Button title="Add" icon={<Plus size={14} color="#fff" />} onPress={handleCreate} loading={createLabel.isPending} disabled={!newLabel.trim()} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

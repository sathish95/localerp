import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { Briefcase, ChevronRight, Plus, X } from 'lucide-react-native';

import { Button, Card, EmptyState, GradientIconBadge, PageHeader, Screen, TextField } from '@/components/ui';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { Domains, Fonts, Radius, Spacing, alpha } from '@/constants/theme';
import { useCreateWorkItem, useWorkItems, useWorkTypeConfigs } from '@/hooks/workItems';
import type { WorkItem } from '@/lib/workItems';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', color: '#0ea5e9' },
  { value: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { value: 'completed', label: 'Completed', color: '#15803d' },
  { value: 'cancelled', label: 'Cancelled', color: '#64748b' },
];
const statusColor = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.color ?? '#64748b';
const statusLabel = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;

export default function WorkItemsScreen() {
  const { blocked } = useFeatureGuard('work-items');
  const t = useTheme();
  const router = useRouter();
  const [workType, setWorkType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [showCreate, setShowCreate] = useState(false);

  const typesQ = useWorkTypeConfigs();
  const itemsQ = useWorkItems({ workType, status });

  if (blocked) return <Redirect href={'/discover' as Href} />;

  const items = itemsQ.data ?? [];
  const types = typesQ.data ?? [];

  return (
    <Screen onRefresh={itemsQ.refetch} refreshing={itemsQ.isRefetching}>
      <PageHeader
        title="Work Items"
        subtitle="Work orders, service requests and more"
        right={
          <Pressable onPress={() => setShowCreate(true)}>
            <GradientIconBadge icon={<Plus size={20} color="#fff" />} colors={Domains.tasks.grad} radius={Radius.pill} />
          </Pressable>
        }
      />

      {types.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
          <FilterChip label="All types" active={!workType} onPress={() => setWorkType(undefined)} />
          {types.map((wt) => (
            <FilterChip key={wt.key} label={wt.name} active={workType === wt.key} onPress={() => setWorkType(wt.key)} />
          ))}
        </ScrollView>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
        <FilterChip label="All statuses" active={!status} onPress={() => setStatus(undefined)} />
        {STATUS_OPTIONS.map((s) => (
          <FilterChip key={s.value} label={s.label} active={status === s.value} onPress={() => setStatus(s.value)} />
        ))}
      </ScrollView>

      {itemsQ.isLoading ? (
        <View style={{ gap: Spacing.md }}>
          {[84, 84, 84].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
        </View>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<Briefcase color={t.accent} size={22} />} title="No work items yet" desc="Create a work order or service request to get started." /></Card>
      ) : (
        <View style={{ gap: Spacing.md }}>
          {items.map((w) => (
            <WorkItemCard key={w.id} item={w} typeName={types.find((x) => x.key === w.work_type_key)?.name} onPress={() => router.push(`/feature/work-items/${w.id}` as Href)} />
          ))}
        </View>
      )}

      <CreateWorkItemModal visible={showCreate} onClose={() => setShowCreate(false)} types={types} />
    </Screen>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: Radius.pill, backgroundColor: active ? Domains.tasks.solid : t.surfaceSoft, borderWidth: 1, borderColor: active ? Domains.tasks.solid : t.border }}>
      <Text style={{ color: active ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function WorkItemCard({ item, typeName, onPress }: { item: WorkItem; typeName?: string; onPress: () => void }) {
  const t = useTheme();
  const sc = statusColor(item.status);
  return (
    <Pressable onPress={onPress}>
      <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <GradientIconBadge icon={<Briefcase size={18} color="#fff" />} colors={Domains.tasks.grad} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14.5 }} numberOfLines={1}>{item.title}</Text>
          <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
            {typeName ?? item.work_type_key}{item.client?.name ? ` · ${item.client.name}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <View style={{ backgroundColor: alpha(sc, 0.14), borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: sc, fontFamily: Fonts.bodyBold, fontSize: 10.5 }}>{statusLabel(item.status)}</Text>
            </View>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyMedium, fontSize: 11 }}>{item.taskCount ?? 0} task{item.taskCount === 1 ? '' : 's'}</Text>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyMedium, fontSize: 11 }}>{(item.totalHours ?? 0).toFixed(1)}h logged</Text>
          </View>
        </View>
        <ChevronRight size={16} color={t.textMuted} />
      </Card>
    </Pressable>
  );
}

function CreateWorkItemModal({ visible, onClose, types }: { visible: boolean; onClose: () => void; types: { key: string; name: string }[] }) {
  const t = useTheme();
  const createItem = useCreateWorkItem();
  const [title, setTitle] = useState('');
  const [workTypeKey, setWorkTypeKey] = useState<string | undefined>(types[0]?.key);
  const [error, setError] = useState<string | null>(null);

  function reset() { setTitle(''); setWorkTypeKey(types[0]?.key); setError(null); }

  async function submit() {
    if (!title.trim() || !workTypeKey) { setError('Title and type are required.'); return; }
    setError(null);
    try {
      await createItem.mutateAsync({ title: title.trim(), workTypeKey });
      reset(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, marginBottom: Spacing.md }}>
          <Text style={{ color: t.text, fontFamily: Fonts.display, fontSize: 22 }}>New Work Item</Text>
          <Pressable onPress={onClose}><X size={22} color={t.textMuted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.lg }}>
          <TextField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. AC repair at Site 4" />
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Type</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {types.length === 0 ? (
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>No work types configured for your org yet.</Text>
              ) : types.map((wt) => {
                const isSel = workTypeKey === wt.key;
                return (
                  <Pressable key={wt.key} onPress={() => setWorkTypeKey(wt.key)}
                    style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: Radius.pill, backgroundColor: isSel ? Domains.tasks.solid : t.surfaceSoft, borderWidth: 1, borderColor: isSel ? Domains.tasks.solid : t.border }}>
                    <Text style={{ color: isSel ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{wt.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {error ? <Text style={{ color: '#dc2626', fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
        </ScrollView>
        <View style={{ padding: Spacing.lg, borderTopWidth: 1, borderTopColor: t.border }}>
          <Button title="Create Work Item" onPress={submit} loading={createItem.isPending} disabled={createItem.isPending} />
        </View>
      </View>
    </Modal>
  );
}

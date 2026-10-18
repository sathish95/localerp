import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Check, ListChecks, Package, Plus, Wrench, X } from 'lucide-react-native';

import { Badge, Card, EmptyState, GradientIconBadge, Screen, ScreenHeader } from '@/components/ui';
import { alpha, Domains, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyTasks, useSetTaskStatus } from '@/hooks/queries';
import {
  useAssetsPicker, useLinkTaskEquipment, useLinkTaskMaterial, useProductsPicker,
  useTaskEquipment, useTaskMaterials, useUnlinkTaskEquipment, useUnlinkTaskMaterial,
  useUpdateTaskMaterialUsage,
} from '@/hooks/resourceLinks';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';
import { STATUS_COLOR, STATUS_LABEL, TASK_STATUSES, type MyTask } from '@/lib/tasks';

export default function TasksScreen() {
  const t = useTheme();
  const { data: tasks = [], isLoading, isRefetching, refetch } = useMyTasks();
  const setStatus = useSetTaskStatus();
  const [editing, setEditing] = useState<MyTask | null>(null);

  function updateStatus(status: (typeof TASK_STATUSES)[number]) {
    if (!editing) return;
    setStatus.mutate({ id: editing.id, status });
    setEditing(null);
  }

  if (isLoading) return <Screen scroll={false}><View /></Screen>;

  const isOverdue = (task: MyTask) => task.planned_end_date && new Date(task.planned_end_date) < new Date();

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <ScreenHeader title="My Tasks" subtitle={`${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'}`} right={<GradientIconBadge icon={<ListChecks color="#fff" size={20} />} colors={Domains.tasks.grad} />} />

      {tasks.length === 0 ? (
        <Card><EmptyState icon={<ListChecks color={t.accent} size={22} />} title="All caught up" desc="No open tasks assigned to you right now." /></Card>
      ) : (
        <View style={{ gap: Spacing.md }}>
          {tasks.map((task) => {
            const sc = STATUS_COLOR[task.status];
            return (
            <Pressable key={task.id} onPress={() => setEditing(task)}>
              <Card style={{ flexDirection: 'row', gap: 12, overflow: 'hidden' }}>
                <View style={{ width: 4, marginVertical: -16, marginLeft: -16, backgroundColor: sc }} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14.5 }}>{task.task_name}</Text>
                      {task.project?.name ? (
                        <View style={{ alignSelf: 'flex-start', backgroundColor: alpha(Domains.tasks.solid, 0.12), borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 }}>
                          <Text style={{ color: Domains.tasks.solid, fontFamily: Fonts.bodySemiBold, fontSize: 11 }}>{task.project.name}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Badge label={STATUS_LABEL[task.status]} color={sc} />
                  </View>
                  {task.planned_end_date ? (
                    <Text style={{ marginTop: 10, color: isOverdue(task) ? t.danger : t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 11.5 }}>
                      {isOverdue(task) ? 'Overdue · ' : 'Due '}{dateFmt(task.planned_end_date)}
                    </Text>
                  ) : null}
                </View>
              </Card>
            </Pressable>
            );
          })}
        </View>
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setEditing(null)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }}>
            <ScrollView contentContainerStyle={{ padding: Spacing.xl, gap: Spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16, flex: 1 }} numberOfLines={1}>{editing?.task_name}</Text>
                <Pressable onPress={() => setEditing(null)}><X size={20} color={t.textMuted} /></Pressable>
              </View>
              {TASK_STATUSES.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => updateStatus(s)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 14, borderRadius: Radius.md, backgroundColor: editing?.status === s ? t.surfaceTint : 'transparent' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: STATUS_COLOR[s] }} />
                    <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 14.5 }}>{STATUS_LABEL[s]}</Text>
                  </View>
                  {editing?.status === s ? <Check size={16} color={t.accent} /> : null}
                </Pressable>
              ))}

              {editing ? (
                <View style={{ gap: Spacing.md, marginTop: Spacing.sm, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: t.border }}>
                  <EquipmentSection taskId={editing.id} />
                  <MaterialsSection taskId={editing.id} />
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

// ── Equipment/Materials — Industry-Adaptive Platform Phase 9 (mobile port) ──
// Additive sections appended below the existing status list. Neither
// section reads or writes task.status or anything else the status flow
// above touches — pure separate tables (task_equipment/task_materials),
// scoped by task_id, RLS-gated via the parent task's org.

function SectionHeader({ icon, label, onAdd }: { icon: React.ReactNode; label: string; onAdd: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {icon}
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</Text>
      </View>
      <Pressable onPress={onAdd} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Plus size={13} color={t.accent} />
        <Text style={{ color: t.accent, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>Link</Text>
      </Pressable>
    </View>
  );
}

function EquipmentSection({ taskId }: { taskId: string }) {
  const t = useTheme();
  const { data: links = [] } = useTaskEquipment(taskId);
  const { data: assets = [] } = useAssetsPicker();
  const linkMut = useLinkTaskEquipment(taskId);
  const unlinkMut = useUnlinkTaskEquipment(taskId);
  const [picking, setPicking] = useState(false);
  const linkedAssetIds = new Set(links.map((l) => l.asset_id));

  return (
    <View style={{ gap: 8 }}>
      <SectionHeader icon={<Wrench size={13} color={t.textMuted} />} label="Equipment" onAdd={() => setPicking((p) => !p)} />
      {links.length === 0 ? (
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>No equipment linked.</Text>
      ) : (
        links.map((l) => (
          <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surfaceSoft, borderRadius: Radius.sm, paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 13, flex: 1 }} numberOfLines={1}>
              {l.asset?.name ?? 'Unknown asset'}{l.asset?.asset_code ? ` · ${l.asset.asset_code}` : ''}
            </Text>
            <Pressable onPress={() => unlinkMut.mutate(l.id)} hitSlop={8}><X size={15} color={t.textMuted} /></Pressable>
          </View>
        ))
      )}
      {picking ? (
        <View style={{ gap: 4, maxHeight: 160 }}>
          <ScrollView nestedScrollEnabled>
            {assets.filter((a) => !linkedAssetIds.has(a.id)).map((a) => (
              <Pressable
                key={a.id}
                onPress={() => { linkMut.mutate(a.id); setPicking(false); }}
                style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: Radius.sm }}
              >
                <Text style={{ color: t.text, fontFamily: Fonts.body, fontSize: 13 }}>{a.name} · {a.asset_code}</Text>
              </Pressable>
            ))}
            {assets.length === 0 ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12, padding: 8 }}>No assets found.</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function MaterialsSection({ taskId }: { taskId: string }) {
  const t = useTheme();
  const { data: links = [] } = useTaskMaterials(taskId);
  const { data: products = [] } = useProductsPicker();
  const linkMut = useLinkTaskMaterial(taskId);
  const unlinkMut = useUnlinkTaskMaterial(taskId);
  const usageMut = useUpdateTaskMaterialUsage(taskId);
  const [picking, setPicking] = useState(false);
  const [usageDrafts, setUsageDrafts] = useState<Record<string, string>>({});

  function commitUsage(id: string) {
    const raw = usageDrafts[id];
    if (raw === undefined) return;
    const n = Number(raw);
    if (!Number.isNaN(n)) usageMut.mutate({ id, quantityUsed: n });
  }

  return (
    <View style={{ gap: 8 }}>
      <SectionHeader icon={<Package size={13} color={t.textMuted} />} label="Materials" onAdd={() => setPicking((p) => !p)} />
      {links.length === 0 ? (
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>No materials linked.</Text>
      ) : (
        links.map((l) => (
          <View key={l.id} style={{ backgroundColor: t.surfaceSoft, borderRadius: Radius.sm, padding: 10, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 13, flex: 1 }} numberOfLines={1}>
                {l.product?.name ?? 'Unknown item'}{l.product?.part_number ? ` · ${l.product.part_number}` : ''}
              </Text>
              <Pressable onPress={() => unlinkMut.mutate(l.id)} hitSlop={8}><X size={15} color={t.textMuted} /></Pressable>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>
                Required: {l.quantity_required ?? '—'}
              </Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>·</Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>Used:</Text>
              <TextInput
                value={usageDrafts[l.id] ?? (l.quantity_used != null ? String(l.quantity_used) : '')}
                onChangeText={(v) => setUsageDrafts((d) => ({ ...d, [l.id]: v }))}
                onEndEditing={() => commitUsage(l.id)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={t.textMuted}
                style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 12.5, borderBottomWidth: 1, borderBottomColor: t.border, minWidth: 40, paddingVertical: 2 }}
              />
            </View>
          </View>
        ))
      )}
      {picking ? (
        <View style={{ gap: 4, maxHeight: 160 }}>
          <ScrollView nestedScrollEnabled>
            {products.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => { linkMut.mutate({ productId: p.id, quantityRequired: null }); setPicking(false); }}
                style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: Radius.sm }}
              >
                <Text style={{ color: t.text, fontFamily: Fonts.body, fontSize: 13 }}>{p.name} · {p.part_number}</Text>
              </Pressable>
            ))}
            {products.length === 0 ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12, padding: 8 }}>No items found.</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

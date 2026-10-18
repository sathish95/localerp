import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Briefcase, Clock, Plus, User, Users, X } from 'lucide-react-native';

import { Badge, Button, Card, EmptyState, GradientIconBadge, PageHeader, Screen, TextField } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { Domains, Fonts, Radius, Spacing, alpha } from '@/constants/theme';
import { useCreateTaskForWorkItem, useTasksForWorkItem, useWorkItem, useWorkItemHours } from '@/hooks/workItems';
import { STATUS_COLOR, STATUS_LABEL, type TaskStatus } from '@/lib/tasks';
import { dateFmt } from '@/lib/supabase';

export default function WorkItemDetailScreen() {
  const { workItemId } = useLocalSearchParams<{ workItemId: string }>();
  const t = useTheme();
  const [showNewTask, setShowNewTask] = useState(false);

  const itemQ = useWorkItem(workItemId);
  const tasksQ = useTasksForWorkItem(workItemId);
  const hoursQ = useWorkItemHours(workItemId);

  const item = itemQ.data;
  const tasks = tasksQ.data ?? [];
  const people = [...new Map(tasks.filter((tk) => tk.assignee).map((tk) => [tk.assignee!.id, tk.assignee!])).values()];

  return (
    <Screen onRefresh={tasksQ.refetch} refreshing={tasksQ.isRefetching}>
      <PageHeader
        title={item?.title ?? 'Work Item'}
        subtitle={item?.client?.name ?? undefined}
        right={<GradientIconBadge icon={<Briefcase size={20} color="#fff" />} colors={Domains.tasks.grad} />}
      />

      {item ? (
        <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <View style={{ backgroundColor: alpha(Domains.tasks.solid, 0.12), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: Domains.tasks.solid, fontFamily: Fonts.bodyBold, fontSize: 11 }}>{item.work_type_key}</Text>
          </View>
          <View style={{ backgroundColor: t.surfaceSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: t.textSoft, fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'capitalize' }}>{item.status.replace(/_/g, ' ')}</Text>
          </View>
          {item.location?.name ? (
            <View style={{ backgroundColor: t.surfaceSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: t.textSoft, fontFamily: Fonts.bodyMedium, fontSize: 11 }}>{item.location.name}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Hours summary */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <GradientIconBadge icon={<Clock size={16} color="#fff" />} colors={Domains.timesheet.grad} size={36} radius={10} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 18 }}>{(hoursQ.data?.totalHours ?? 0).toFixed(1)}h logged</Text>
          <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11 }}>Already reflected in the team&apos;s timesheets</Text>
        </View>
      </Card>

      {/* Tasks */}
      <View style={{ gap: Spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>Tasks</Text>
          <Pressable onPress={() => setShowNewTask(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Plus size={13} color={Domains.tasks.solid} />
            <Text style={{ color: Domains.tasks.solid, fontFamily: Fonts.bodyBold, fontSize: 12 }}>New Task</Text>
          </Pressable>
        </View>

        {tasksQ.isLoading ? (
          <View style={{ height: 60, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />
        ) : tasks.length === 0 ? (
          <Card><EmptyState icon={<Briefcase color={t.accent} size={20} />} title="No tasks yet" desc="Add the first task under this work item." /></Card>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {tasks.map((tk) => {
              const sc = STATUS_COLOR[tk.status as TaskStatus] ?? t.textMuted;
              return (
                <Card key={tk.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sc }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13.5 }} numberOfLines={1}>{tk.task_name}</Text>
                    <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                      {tk.assignee?.full_name ?? 'Unassigned'}{tk.planned_end_date ? ` · Due ${dateFmt(tk.planned_end_date)}` : ''}
                    </Text>
                  </View>
                  <Badge label={STATUS_LABEL[tk.status as TaskStatus] ?? tk.status} color={sc} />
                </Card>
              );
            })}
          </View>
        )}
      </View>

      {/* People */}
      {people.length > 0 ? (
        <View style={{ gap: Spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Users size={13} color={t.textMuted} />
            <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>People</Text>
          </View>
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {people.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surfaceSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                <User size={12} color={t.textMuted} />
                <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>{p.full_name}</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <NewTaskModal visible={showNewTask} onClose={() => setShowNewTask(false)} workItemId={workItemId} />
    </Screen>
  );
}

function NewTaskModal({ visible, onClose, workItemId }: { visible: boolean; onClose: () => void; workItemId: string }) {
  const t = useTheme();
  const createTask = useCreateTaskForWorkItem(workItemId);
  const [taskName, setTaskName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!taskName.trim()) { setError('Task name is required.'); return; }
    setError(null);
    try {
      await createTask.mutateAsync({ taskName: taskName.trim() });
      setTaskName(''); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>New Task</Text>
            <Pressable onPress={onClose}><X size={20} color={t.textMuted} /></Pressable>
          </View>
          <TextField label="Task name" placeholder="What needs to be done?" value={taskName} onChangeText={setTaskName} autoFocus />
          {error ? <Text style={{ color: '#dc2626', fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
          <Button title="Create" onPress={submit} loading={createTask.isPending} disabled={!taskName.trim()} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

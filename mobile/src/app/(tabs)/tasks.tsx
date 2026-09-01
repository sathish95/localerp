import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Check, ListChecks, X } from 'lucide-react-native';

import { Badge, Card, EmptyState, Screen, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';
import { listMyTasks, setTaskStatus, STATUS_COLOR, STATUS_LABEL, TASK_STATUSES, type MyTask } from '@/lib/tasks';

export default function TasksScreen() {
  const { profile } = useAuth();
  const t = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [editing, setEditing] = useState<MyTask | null>(null);

  async function load() {
    try {
      if (profile?.id) setTasks(await listMyTasks(profile.id));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is intentionally not memoized; re-run only when the user changes
  useEffect(() => { load(); }, [profile?.id]);

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function updateStatus(status: (typeof TASK_STATUSES)[number]) {
    if (!editing) return;
    const prev = tasks;
    setTasks((ts) => ts.map((x) => (x.id === editing.id ? { ...x, status } : x)));
    setEditing(null);
    try { await setTaskStatus(editing.id, status); } catch (e) { console.error(e); setTasks(prev); }
  }

  if (loading) return <Screen scroll={false}><View /></Screen>;

  const isOverdue = (task: MyTask) => task.planned_end_date && new Date(task.planned_end_date) < new Date();

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ScreenHeader title="My Tasks" subtitle={`${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'}`} right={<ListChecks color={t.accent} size={22} />} />

      {tasks.length === 0 ? (
        <Card><EmptyState icon={<ListChecks color={t.accent} size={22} />} title="All caught up" desc="No open tasks assigned to you right now." /></Card>
      ) : (
        <View style={{ gap: Spacing.md }}>
          {tasks.map((task) => (
            <Pressable key={task.id} onPress={() => setEditing(task)}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14.5 }}>{task.task_name}</Text>
                    {task.project?.name ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12 }}>{task.project.name}</Text> : null}
                  </View>
                  <Badge label={STATUS_LABEL[task.status]} color={STATUS_COLOR[task.status]} />
                </View>
                {task.planned_end_date ? (
                  <Text style={{ marginTop: 10, color: isOverdue(task) ? t.danger : t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 11.5 }}>
                    {isOverdue(task) ? 'Overdue · ' : 'Due '}{dateFmt(task.planned_end_date)}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setEditing(null)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: Spacing.sm }}>
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
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

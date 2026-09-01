import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Clock, ListChecks, Play, Square } from 'lucide-react-native';

import { Badge, Button, Card, Screen, ScreenHeader, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  checkIn, checkOut, getActiveLog, getLinkedTasks, listProjectTasks, myActiveProjects,
  type ActiveLog, type LinkedTask, type ProjectTask,
} from '@/lib/checkin';
import { STATUS_COLOR, STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '@/lib/tasks';

function formatElapsed(startIso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function CheckinScreen() {
  const { profile } = useAuth();
  const t = useTheme();
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ActiveLog | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selProject, setSelProject] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [selTasks, setSelTasks] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [elapsed, setElapsed] = useState('00:00:00');
  const [busy, setBusy] = useState(false);
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([]);
  const [checkingOut, setCheckingOut] = useState(false);
  const [statusChoices, setStatusChoices] = useState<Record<string, TaskStatus>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      if (profile?.id) {
        const [log, projs] = await Promise.all([getActiveLog(profile.id), myActiveProjects()]);
        setActive(log); setProjects(projs);
        if (log) {
          const linked = await getLinkedTasks(log.id);
          setLinkedTasks(linked);
        } else {
          setLinkedTasks([]);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is intentionally not memoized; re-run only when the user changes
  useEffect(() => { load(); }, [profile?.id]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (active?.check_in) {
      setElapsed(formatElapsed(active.check_in));
      timer.current = setInterval(() => setElapsed(formatElapsed(active.check_in)), 1000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [active]);

  useEffect(() => {
    setSelTasks([]);
    if (!selProject) { setProjectTasks([]); return; }
    listProjectTasks(selProject).then(setProjectTasks).catch(console.error);
  }, [selProject]);

  function toggleTask(id: string) {
    setSelTasks((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));
  }

  async function handleCheckIn() {
    if (!profile) return;
    setBusy(true);
    try {
      await checkIn(profile.id, profile.full_name, selProject, selTasks, comment);
      setComment(''); setSelProject(null); setSelTasks([]);
      await load();
    } catch (e) { console.error(e); } finally { setBusy(false); }
  }

  function openCheckoutReview() {
    const defaults: Record<string, TaskStatus> = {};
    for (const l of linkedTasks) {
      if (l.task) defaults[l.id] = l.task.status === 'closed' ? 'closed' : 'delayed';
    }
    setStatusChoices(defaults);
    setCheckingOut(true);
  }

  async function handleConfirmCheckOut() {
    if (!profile || !active) return;
    setBusy(true);
    try {
      const updates = linkedTasks
        .filter((l) => l.task)
        .map((l) => ({ checkinTaskId: l.id, taskId: l.task!.id, currentStatus: l.task!.status, newStatus: statusChoices[l.id] ?? l.task!.status }));
      await checkOut(active, profile.id, profile.full_name, updates);
      setCheckingOut(false);
      await load();
    } catch (e) { console.error(e); } finally { setBusy(false); }
  }

  if (loading) return <Screen scroll={false}><View /></Screen>;

  return (
    <Screen>
      <ScreenHeader title="Check-in" subtitle="Track your work session" right={<Clock color={t.accent} size={22} />} />

      <Card style={{ alignItems: 'center', paddingVertical: Spacing.xxl }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: active ? t.success : t.textMuted, marginBottom: 14 }} />
        <Text style={{ color: t.text, fontFamily: Fonts.displayExtraBold, fontSize: 40, letterSpacing: 1 }}>{active ? elapsed : '00:00:00'}</Text>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyMedium, fontSize: 13, marginTop: 4 }}>
          {active ? `Checked in${active.project?.name ? ` · ${active.project.name}` : ''}` : 'Not checked in'}
        </Text>

        {active ? (
          !checkingOut && <Button title="Check Out" variant="danger" icon={<Square size={16} color="#fff" />} onPress={openCheckoutReview} style={{ marginTop: 24, minWidth: 180 }} />
        ) : (
          <Button title="Check In" icon={<Play size={16} color="#fff" />} onPress={handleCheckIn} loading={busy} disabled={busy} style={{ marginTop: 24, minWidth: 180 }} />
        )}
      </Card>

      {/* Checked in: show what you're working on */}
      {active && !checkingOut && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <ListChecks size={16} color={t.accent} />
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>Working on</Text>
          </View>
          {active.comment ? <Text style={{ color: t.textSoft, fontFamily: Fonts.body, fontSize: 13, marginBottom: linkedTasks.length ? 12 : 0 }}>{active.comment}</Text> : null}
          {linkedTasks.length === 0 ? (
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>No specific tasks linked to this session.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {linkedTasks.map((l) => l.task && (
                <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 13, flex: 1 }} numberOfLines={1}>{l.task.task_name}</Text>
                  <Badge label={STATUS_LABEL[l.task.status]} color={STATUS_COLOR[l.task.status]} />
                </View>
              ))}
            </View>
          )}
        </Card>
      )}

      {/* Checkout review: confirm a status for each linked task before closing the session */}
      {active && checkingOut && (
        <Card>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14, marginBottom: 4 }}>Before you go — update task status</Text>
          <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12, marginBottom: 14 }}>Set where each task stands, then confirm check-out.</Text>

          {linkedTasks.length === 0 ? (
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, marginBottom: 14 }}>No tasks were linked to this session.</Text>
          ) : (
            <View style={{ gap: 16, marginBottom: 16 }}>
              {linkedTasks.map((l) => l.task && (
                <View key={l.id}>
                  <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13, marginBottom: 8 }} numberOfLines={1}>{l.task.task_name}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {TASK_STATUSES.map((s) => {
                      const isSel = statusChoices[l.id] === s;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => setStatusChoices((c) => ({ ...c, [l.id]: s }))}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.pill,
                            backgroundColor: isSel ? STATUS_COLOR[s] : t.surfaceSoft, borderWidth: 1, borderColor: isSel ? STATUS_COLOR[s] : t.border,
                          }}
                        >
                          {isSel && <Check size={11} color="#fff" />}
                          <Text style={{ color: isSel ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 11.5 }}>{STATUS_LABEL[s]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Back" variant="outline" onPress={() => setCheckingOut(false)} style={{ flex: 1 }} />
            <Button title="Confirm Check Out" variant="danger" onPress={handleConfirmCheckOut} loading={busy} disabled={busy} style={{ flex: 1 }} />
          </View>
        </Card>
      )}

      {/* Not checked in: pick a project, pick tasks, add a note */}
      {!active && (
        <Card>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14, marginBottom: 12 }}>Session details (optional)</Text>
          {projects.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {projects.map((p) => {
                const isSel = selProject === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setSelProject(isSel ? null : p.id)}
                    style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: isSel ? t.accent : t.surfaceSoft, borderWidth: 1, borderColor: isSel ? t.accent : t.border }}
                  >
                    <Text style={{ color: isSel ? '#fff' : t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>{p.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {selProject && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5, marginBottom: 8 }}>What are you working on?</Text>
              {projectTasks.length === 0 ? (
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>No open tasks on this project.</Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {projectTasks.map((task) => {
                    const isSel = selTasks.includes(task.id);
                    return (
                      <Pressable
                        key={task.id}
                        onPress={() => toggleTask(task.id)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: Radius.md,
                          backgroundColor: isSel ? t.accentSoft : t.surfaceSoft, borderWidth: 1, borderColor: isSel ? t.accent : t.border,
                        }}
                      >
                        <View style={{
                          width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: isSel ? t.accent : t.border,
                          backgroundColor: isSel ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isSel && <Check size={12} color="#fff" />}
                        </View>
                        <Text style={{ color: t.text, fontFamily: Fonts.bodyMedium, fontSize: 13, flex: 1 }} numberOfLines={1}>{task.task_name}</Text>
                        <Badge label={STATUS_LABEL[task.status]} color={STATUS_COLOR[task.status]} />
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <TextField placeholder="Add a note (optional)" value={comment} onChangeText={setComment} multiline style={{ minHeight: 48 }} />
        </Card>
      )}
    </Screen>
  );
}

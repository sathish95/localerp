import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  Briefcase, Check, Clock, History, ListChecks, Play, Send, Square,
} from 'lucide-react-native';

import { Badge, Button, Card, Chip, EmptyState, GradientCard, MetricTile, PageHeader, Screen, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Domains, Fonts, Radius, Spacing, alpha } from '@/constants/theme';
import { useActiveLog, useInvalidateCheckin, useRecentCheckinLogs, useWeekCheckinLogs } from '@/hooks/queries';
import { useMyTimesheetMonth } from '@/hooks/timesheet';
import { useTheme } from '@/hooks/use-theme';
import {
  checkIn, checkOut, countWorkingDaysElapsed, DAILY_MIN_HOURS, getLinkedTasks, getWeekRange,
  listProjectTasks, myActiveProjects, type ActiveLog, type LinkedTask, type ProjectTask,
} from '@/lib/checkin';
import { dateFmt } from '@/lib/supabase';
import { SUBMITTABLE_STATUSES } from '@/lib/timesheet';
import { STATUS_COLOR, STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '@/lib/tasks';

function formatElapsed(startIso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

function sessionTimeRange(inIso: string, outIso: string | null) {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return outIso ? `${fmt(inIso)} – ${fmt(outIso)}` : `Since ${fmt(inIso)}`;
}

export default function CheckinScreen() {
  const { profile } = useAuth();
  const t = useTheme();
  const router = useRouter();
  const now = new Date();
  const { data: active, isLoading: activeLoading } = useActiveLog();
  const invalidateCheckin = useInvalidateCheckin();

  const { start: weekStart, end: weekEnd } = getWeekRange(now);
  const weekQ = useWeekCheckinLogs(weekStart, weekEnd);
  const recentQ = useRecentCheckinLogs(10);
  const monthQ = useMyTimesheetMonth(now.getMonth() + 1, now.getFullYear());

  const hoursThisWeek = (weekQ.data ?? []).reduce((s, l) => s + (l.hours_worked ?? 0), 0);
  const monthStatus = monthQ.data?.approval?.status ?? '';
  const monthHours = (monthQ.data?.logs ?? []).reduce((s, l) => s + (l.hours_worked ?? 0), 0);
  const isMonthPending = SUBMITTABLE_STATUSES.includes(monthStatus);
  const isSaturday = now.getDay() === 6;

  // "Pending hours" = shortfall against an 8h/day minimum for every
  // working day (Mon–Sat) that's already come and gone this week.
  const workingDaysElapsed = countWorkingDaysElapsed(weekStart, now);
  const requiredHoursSoFar = workingDaysElapsed * DAILY_MIN_HOURS;
  const pendingHours = Math.max(0, requiredHoursSoFar - hoursThisWeek);

  const [loading, setLoading] = useState(true);
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

  // Projects + the tasks linked to the current session. `active` itself
  // is owned by the shared useActiveLog() query (also read on Home), so
  // this effect re-runs whenever a check-in/out flips it.
  async function load() {
    try {
      if (profile?.id) {
        setProjects(await myActiveProjects());
        setLinkedTasks(active ? await getLinkedTasks(active.id) : []);
      }
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when the user or the active session changes
  useEffect(() => { load(); }, [profile?.id, active?.id]);

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
      await invalidateCheckin();
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
      await invalidateCheckin();
    } catch (e) { console.error(e); } finally { setBusy(false); }
  }

  if (activeLoading || loading) return <Screen scroll={false}><View /></Screen>;

  return (
    <Screen>
      <PageHeader title="Check-in" subtitle="Track your work session" right={<Clock color={t.accent} size={22} />} />

      <GradientCard colors={active ? Domains.checkin.grad : Domains.neutral.grad} style={{ marginBottom: Spacing.xs }}>
        <View style={{ alignItems: 'center', paddingVertical: Spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? '#4ade80' : 'rgba(255,255,255,0.6)' }} />
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {active ? 'Checked in' : 'Not checked in'}
            </Text>
          </View>
          <Text style={{ color: '#fff', fontFamily: Fonts.displayExtraBold, fontSize: 44, letterSpacing: 1 }}>{active ? elapsed : '00:00:00'}</Text>
          {active?.project?.name ? (
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: Fonts.bodyMedium, fontSize: 13, marginTop: 4 }}>{active.project.name}</Text>
          ) : null}

          {active ? (
            !checkingOut && <Button title="Check Out" variant="danger" icon={<Square size={16} color="#fff" />} onPress={openCheckoutReview} style={{ marginTop: 22, minWidth: 180 }} />
          ) : (
            <Button title="Check In" icon={<Play size={16} color="#fff" />} onPress={handleCheckIn} loading={busy} disabled={busy} style={{ marginTop: 22, minWidth: 180 }} />
          )}
        </View>
      </GradientCard>

      {/* This week at a glance */}
      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        <MetricTile
          colors={Domains.checkin.grad}
          value={`${hoursThisWeek.toFixed(1)}h`}
          label="Hours this week"
          sub={`Mon–Sun · ${dateFmt(weekStart)}`}
          icon={<Clock size={16} color="#fff" />}
        />
        <MetricTile
          colors={pendingHours > 0 ? Domains.expenses.grad : Domains.approvals.grad}
          value={pendingHours > 0 ? `${pendingHours.toFixed(1)}h` : 'On track'}
          label="Pending hours"
          sub={pendingHours > 0 ? `Short of ${DAILY_MIN_HOURS}h/day minimum` : `Meeting ${DAILY_MIN_HOURS}h/day so far`}
          icon={<Send size={16} color="#fff" />}
          onPress={() => router.push('/feature/timesheet' as Href)}
        />
      </View>

      {/* Saturday nudge — the work week's natural "close it out" moment */}
      {isSaturday && pendingHours > 0 ? (
        <Pressable onPress={() => router.push('/feature/timesheet' as Href)}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: alpha(t.accent, 0.08), borderColor: alpha(t.accent, 0.3) }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: alpha(t.accent, 0.16), alignItems: 'center', justifyContent: 'center' }}>
              <Send size={17} color={t.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13.5 }}>It's Saturday — wrap up your timesheet</Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 1 }}>{monthHours.toFixed(1)}h logged this month, not yet submitted</Text>
            </View>
          </Card>
        </Pressable>
      ) : null}

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

      {/* Recent activity — past completed sessions */}
      <View style={{ gap: Spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <History size={13} color={t.textMuted} />
          <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>Recent Activity</Text>
        </View>
        {recentQ.isLoading ? (
          <View style={{ gap: Spacing.sm }}>
            {[62, 62].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
          </View>
        ) : (recentQ.data ?? []).length === 0 ? (
          <Card><EmptyState icon={<History color={t.accent} size={22} />} title="No past sessions yet" desc="Your completed check-ins will show up here." /></Card>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {(recentQ.data ?? []).map((log: ActiveLog) => (
              <Card key={log.id} style={{ paddingVertical: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13 }}>{dateFmt(log.check_in)}</Text>
                    <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }}>{sessionTimeRange(log.check_in, log.check_out)}</Text>
                    <View style={{ marginTop: 6 }}>
                      <Chip
                        label={log.project?.name ?? 'No project'}
                        color={log.project?.name ? t.accent : t.textMuted}
                        icon={<Briefcase size={10} color={log.project?.name ? t.accent : t.textMuted} />}
                      />
                    </View>
                    {log.comment ? (
                      <Text style={{ color: t.textSoft, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 5 }} numberOfLines={1}>
                        {log.comment}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ color: t.accent, fontFamily: Fonts.bodyExtraBold, fontSize: 15 }}>{(log.hours_worked ?? 0).toFixed(1)}h</Text>
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, CalendarDays, CheckCircle2, ChevronRight, Clock, ListChecks, Megaphone, Pin,
  Receipt, Trophy, UserPlus2,
} from 'lucide-react-native';

import { Appear, Avatar, Card, Chip, EmptyState, GradientCard, MetricTile, NotificationBell, PressableScale, Screen, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Domains, Fonts, Radius, Spacing, alpha } from '@/constants/theme';
import {
  useActiveLog, useAnnouncements, useAwardWinners, useMyExpenses, useMyTasks, useMyTravel, useNewJoinees,
} from '@/hooks/queries';
import { useLeaveData } from '@/hooks/leave';
import { useMyTimesheetMonth } from '@/hooks/timesheet';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt, rupee } from '@/lib/supabase';
import type { RequestStatus } from '@/lib/requests';

const PENDING: RequestStatus[] = ['draft', 'submitted', 'manager_review', 'ceo_review', 'finance_review'];
const PRIORITY_COLOR: Record<string, string> = { low: '#64748b', medium: '#0ea5e9', high: '#f59e0b', critical: '#dc2626' };

function elapsed(fromIso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function HomeScreen() {
  const { profile } = useAuth();
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const now = new Date();

  const tasksQ = useMyTasks();
  const activeQ = useActiveLog();
  const expensesQ = useMyExpenses();
  const travelQ = useMyTravel();
  const annQ = useAnnouncements();
  const joineesQ = useNewJoinees(60);
  const awardsQ = useAwardWinners(8);
  const leaveQ = useLeaveData();
  const tsQ = useMyTimesheetMonth(now.getMonth() + 1, now.getFullYear());

  const busy = useIsFetching() > 0;
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';
  const today = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const active = activeQ.data;
  const [tick, setTick] = useState('00:00:00');
  useEffect(() => {
    if (!active?.check_in) return;
    setTick(elapsed(active.check_in));
    const id = setInterval(() => setTick(elapsed(active.check_in)), 1000);
    return () => clearInterval(id);
  }, [active?.check_in]);

  const openTasks = tasksQ.data ?? [];
  const overdueTasks = openTasks.filter((x) => x.planned_end_date && new Date(x.planned_end_date) < now).length;

  const { pendCount, pendAmount } = useMemo(() => {
    const e = (expensesQ.data ?? []).filter((x) => PENDING.includes(x.status));
    const tr = (travelQ.data ?? []).filter((x) => PENDING.includes(x.status));
    return {
      pendCount: e.length + tr.length,
      pendAmount: e.reduce((s, x) => s + (x.total_amount ?? 0), 0) + tr.reduce((s, x) => s + (x.estimated_cost ?? 0), 0),
    };
  }, [expensesQ.data, travelQ.data]);

  const leaveLeft = useMemo(() => {
    const b = leaveQ.data?.balances;
    const p = leaveQ.data?.policy;
    if (!leaveQ.data) return null;
    const pair = (used: number | null | undefined, total: number | null | undefined, def: number) =>
      Math.max(0, (total ?? def) - (used ?? 0));
    return pair(b?.sick_used, p?.sick_days, 12) + pair(b?.casual_used, p?.casual_days, 12) + pair(b?.personal_used, p?.personal_days, 6);
  }, [leaveQ.data]);

  const hoursThisMonth = (tsQ.data?.logs ?? []).reduce((s, l) => s + (l.hours_worked ?? 0), 0);

  const bootLoading = (tasksQ.isLoading || annQ.isLoading) && !tasksQ.data && !annQ.data;
  if (bootLoading) {
    return (
      <Screen scroll={false}>
        <ScreenHeader title={`Hey, ${firstName}`} subtitle={today} />
        <View style={{ gap: Spacing.md }}>
          {[104, 100, 130, 120].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
        </View>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => qc.invalidateQueries()} refreshing={busy}>
      <ScreenHeader
        title={`Hey, ${firstName}`}
        subtitle={today}
        right={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <NotificationBell />
            <Avatar name={profile?.full_name} size={38} />
          </View>
        )}
      />

      {/* Gradient hero — check-in */}
      <PressableScale onPress={() => router.push('/feature/checkin' as Href)}>
        <GradientCard colors={Domains.checkin.grad}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? '#4ade80' : 'rgba(255,255,255,0.6)' }} />
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {active ? 'Checked in' : 'Not checked in'}
              </Text>
            </View>
            <ArrowRight size={18} color="#fff" />
          </View>
          <Text style={{ color: '#fff', fontFamily: Fonts.displayExtraBold, fontSize: active ? 40 : 22, letterSpacing: active ? 1 : 0, marginTop: 10 }}>
            {active ? tick : 'Start your day'}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: Fonts.bodyMedium, fontSize: 12.5, marginTop: 4 }}>
            {active
              ? `${active.project?.name ? active.project.name + ' · ' : ''}since ${new Date(active.check_in).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
              : 'Tap to check in and start tracking'}
          </Text>
        </GradientCard>
      </PressableScale>

      {/* KPI tiles */}
      <View style={{ gap: Spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <MetricTile colors={Domains.tasks.grad} value={openTasks.length} label="Open tasks"
            sub={overdueTasks ? `${overdueTasks} overdue` : 'on track'} icon={<ListChecks size={16} color="#fff" />}
            onPress={() => router.push('/tasks')} />
          <MetricTile colors={Domains.expenses.grad} value={pendCount ? rupee(pendAmount) : '₹0'} label="Awaiting approval"
            sub={`${pendCount} request${pendCount === 1 ? '' : 's'}`} icon={<Receipt size={16} color="#fff" />}
            onPress={() => router.push('/expenses' as Href)} />
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <MetricTile colors={Domains.leave.grad} value={leaveLeft ?? '—'} label="Leave days left"
            sub="sick + casual + personal" icon={<CalendarDays size={16} color="#fff" />}
            onPress={() => router.push('/feature/leave' as Href)} />
          <MetricTile colors={Domains.timesheet.grad} value={`${hoursThisMonth.toFixed(1)}h`} label="Logged this month"
            sub={now.toLocaleDateString('en-IN', { month: 'long' })} icon={<Clock size={16} color="#fff" />}
            onPress={() => router.push('/feature/timesheet' as Href)} />
        </View>
      </View>

      {/* Your tasks */}
      <Appear index={1}>
        <SectionCard color={Domains.tasks.solid} icon={<ListChecks size={16} color={Domains.tasks.solid} />} title="Your open tasks"
          action={openTasks.length > 3 ? { label: `All ${openTasks.length}`, onPress: () => router.push('/tasks') } : undefined}>
          {openTasks.length === 0 ? (
            <EmptyState icon={<CheckCircle2 color={t.success} size={22} />} title="All caught up" desc="Nothing assigned to you." />
          ) : (
            <View style={{ gap: 8 }}>
              {openTasks.slice(0, 4).map((task) => {
                const pc = PRIORITY_COLOR[task.priority] ?? '#64748b';
                const overdue = task.planned_end_date && new Date(task.planned_end_date) < now;
                return (
                  <Pressable key={task.id} onPress={() => router.push('/tasks')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 3, borderLeftColor: pc, paddingLeft: 10, paddingVertical: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13.5 }} numberOfLines={1}>{task.task_name}</Text>
                      {task.project?.name ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11 }} numberOfLines={1}>{task.project.name}</Text> : null}
                    </View>
                    {task.planned_end_date ? <Chip label={dateFmt(task.planned_end_date)} color={overdue ? t.danger : t.textMuted} /> : null}
                    <ChevronRight size={15} color={t.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </SectionCard>
      </Appear>

      {/* Announcements */}
      <Appear index={2}>
        <SectionCard color={Domains.home.solid} icon={<Megaphone size={16} color={Domains.home.solid} />} title="Announcements">
          {(annQ.data ?? []).length === 0 ? (
            <EmptyState icon={<Megaphone color={t.accent} size={22} />} title="Nothing new" desc="Company updates show up here." />
          ) : (
            <View style={{ gap: Spacing.sm }}>
              {(annQ.data ?? []).slice(0, 3).map((a) => (
                <View key={a.id} style={{ borderRadius: 12, padding: 13, gap: 4, backgroundColor: a.pinned ? alpha(t.accent, 0.1) : t.surfaceSoft, borderLeftWidth: 3, borderLeftColor: a.pinned ? t.accent : 'transparent' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {a.pinned ? <Pin size={12} color={t.accent} /> : null}
                    <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13.5, flex: 1 }}>{a.title}</Text>
                  </View>
                  <Text style={{ color: t.textSoft, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18 }} numberOfLines={3}>{a.body}</Text>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5, marginTop: 2 }}>{a.author?.full_name ?? 'Team'} · {dateFmt(a.publish_at)}</Text>
                </View>
              ))}
            </View>
          )}
        </SectionCard>
      </Appear>

      {/* Around the company */}
      <Appear index={3}>
        <SectionCard color={Domains.approvals.solid} icon={<Trophy size={16} color={Domains.approvals.solid} />} title="Around the company">
          <PeopleRow label="New joiners" tint={Domains.travel.solid} icon={<UserPlus2 size={13} color={Domains.travel.solid} />} names={(joineesQ.data ?? []).map((j) => j.full_name)} />
          <View style={{ height: 14 }} />
          <PeopleRow label="Recent awards" tint={Domains.expenses.solid} icon={<Trophy size={13} color={Domains.expenses.solid} />} names={(awardsQ.data ?? []).map((w) => w.employee_name)} />
        </SectionCard>
      </Appear>
    </Screen>
  );
}

function SectionCard({ icon, title, color, action, children }: {
  icon: React.ReactNode; title: string; color: string;
  action?: { label: string; onPress: () => void }; children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      <View style={{ height: 3, backgroundColor: color }} />
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {icon}
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15, flex: 1 }}>{title}</Text>
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={{ color, fontFamily: Fonts.bodyBold, fontSize: 12 }}>{action.label}</Text>
              <ChevronRight size={14} color={color} />
            </Pressable>
          ) : null}
        </View>
        {children}
      </View>
    </Card>
  );
}

function PeopleRow({ label, icon, tint, names }: { label: string; icon: React.ReactNode; tint: string; names: string[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {icon}
        <Text style={{ color: t.textSoft, fontFamily: Fonts.bodyBold, fontSize: 11.5 }}>{label}</Text>
        <View style={{ backgroundColor: alpha(tint, 0.16), borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
          <Text style={{ color: tint, fontFamily: Fonts.bodyBold, fontSize: 10 }}>{names.length}</Text>
        </View>
      </View>
      {names.length === 0 ? (
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12 }}>None yet</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {names.slice(0, 7).map((n, i) => (
            <View key={`${n}-${i}`} style={{ marginLeft: i === 0 ? 0 : -8, borderWidth: 2, borderColor: t.surface, borderRadius: 999 }}>
              <Avatar name={n} size={30} />
            </View>
          ))}
          {names.length > 7 ? <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11.5, marginLeft: 6 }}>+{names.length - 7}</Text> : null}
        </View>
      )}
    </View>
  );
}

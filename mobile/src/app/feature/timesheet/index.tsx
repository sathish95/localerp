import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Redirect, type Href } from 'expo-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react-native';

import { Button, Card, EmptyState, PageHeader, Screen, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useActOnTimesheet, useMyTimesheetMonth, usePendingTimesheets, useSubmitTimesheet } from '@/hooks/timesheet';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';
import { statusLabel, SUBMITTABLE_STATUSES, type PendingTimesheet } from '@/lib/timesheet';
import { isManager } from '@/lib/roles';
import { Fonts, Radius, Spacing } from '@/constants/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_COLOR: Record<string, string> = {
  draft: '#475569', pending_manager: '#1d4ed8', pending_hr: '#6d28d9', pending_finance: '#065f46',
  approved: '#15803d', rejected: '#dc2626',
};
export default function TimesheetHub() {
  const { blocked } = useFeatureGuard('timesheet');
  const { profile } = useAuth();
  const t = useTheme();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [note, setNote] = useState('');

  const monthQ = useMyTimesheetMonth(month, year);
  const pendingQ = usePendingTimesheets();
  const submit = useSubmitTimesheet(month, year);

  const manager = isManager(profile?.role);

  if (blocked) return <Redirect href={'/discover' as Href} />;

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  }

  const d = monthQ.data;
  const status = d?.approval?.status ?? '';
  const canSubmit = SUBMITTABLE_STATUSES.includes(status) && (d?.logs.length ?? 0) > 0;
  const totalHours = (d?.logs ?? []).reduce((s, l) => s + (l.hours_worked ?? 0), 0);
  const totalDays = new Set((d?.logs ?? []).map((l) => l.work_date)).size;

  async function doSubmit() {
    if (!d) return;
    try {
      await submit.mutateAsync({ note: note.trim(), logs: d.logs, existingId: d.approval?.id });
      setSubmitOpen(false); setNote('');
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <Screen onRefresh={() => { monthQ.refetch(); if (manager) pendingQ.refetch(); }} refreshing={monthQ.isRefetching}>
      <PageHeader title="Timesheet" subtitle="Logged from your check-ins" right={<Clock color={t.accent} size={22} />} />

      {manager ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['mine', 'team'] as const).map((x) => {
            const on = tab === x;
            return (
              <Pressable
                key={x}
                onPress={() => setTab(x)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Radius.md, backgroundColor: on ? t.accent : t.surfaceSoft, borderWidth: 1, borderColor: on ? t.accent : t.border }}
              >
                <Text style={{ color: on ? '#fff' : t.textSoft, fontFamily: Fonts.bodyBold, fontSize: 12 }}>
                  {x === 'mine' ? 'My timesheet' : 'Team'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {tab === 'mine' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => shift(-1)} hitSlop={10}><ChevronLeft size={20} color={t.textMuted} /></Pressable>
            <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 15 }}>{MONTHS[month - 1]} {year}</Text>
            <Pressable onPress={() => shift(1)} hitSlop={10}><ChevronRight size={20} color={t.textMuted} /></Pressable>
          </View>

          {monthQ.isLoading || !d ? (
            <View style={{ height: 120, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />
          ) : (
            <>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View>
                    <Text style={{ color: t.text, fontFamily: Fonts.displayExtraBold, fontSize: 28 }}>{totalHours.toFixed(1)}h</Text>
                    <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12, marginTop: 2 }}>{totalDays} day{totalDays === 1 ? '' : 's'} logged</Text>
                  </View>
                  <View style={{ backgroundColor: `${STATUS_COLOR[status] ?? '#475569'}22`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: STATUS_COLOR[status] ?? '#475569', fontFamily: Fonts.bodyBold, fontSize: 11 }}>
                      {status ? statusLabel(status) : 'Not submitted'}
                    </Text>
                  </View>
                </View>
                {d.approval?.rejection_reason ? (
                  <Text style={{ color: t.danger, fontFamily: Fonts.bodyMedium, fontSize: 12, marginTop: 10 }}>Rejected: {d.approval.rejection_reason}</Text>
                ) : null}
                {canSubmit ? (
                  <Button title={status === 'rejected' ? 'Re-submit for approval' : 'Submit for approval'} onPress={() => setSubmitOpen(true)} style={{ marginTop: 14 }} />
                ) : null}
              </Card>

              {d.logs.length === 0 ? (
                <Card><EmptyState icon={<Clock color={t.accent} size={22} />} title="No hours this month" desc="Check in from the Check-in tab to log time." /></Card>
              ) : (
                <View style={{ gap: Spacing.sm }}>
                  {d.logs.map((l) => (
                    <Card key={l.id} style={{ paddingVertical: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13 }}>{dateFmt(l.work_date)}</Text>
                          {l.project?.name || l.comment ? (
                            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>
                              {[l.project?.name, l.comment].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 14 }}>{(l.hours_worked ?? 0).toFixed(1)}h</Text>
                      </View>
                    </Card>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      ) : (
        <TeamTimesheets q={pendingQ} />
      )}

      {/* Submit note */}
      <Modal visible={submitOpen} transparent animationType="slide" onRequestClose={() => setSubmitOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setSubmitOpen(false)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: Spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>Submit {MONTHS[month - 1]} {year}</Text>
              <Pressable onPress={() => setSubmitOpen(false)}><X size={20} color={t.textMuted} /></Pressable>
            </View>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>
              {totalHours.toFixed(1)}h across {totalDays} day{totalDays === 1 ? '' : 's'} goes to your manager.
            </Text>
            <TextField label="Note (optional)" value={note} onChangeText={setNote} multiline style={{ minHeight: 56 }} />
            <Button title="Submit" onPress={doSubmit} loading={submit.isPending} disabled={submit.isPending} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function TeamTimesheets({ q }: { q: ReturnType<typeof usePendingTimesheets> }) {
  const t = useTheme();
  const act = useActOnTimesheet();
  const [target, setTarget] = useState<PendingTimesheet | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const items = (q.data ?? []).filter((x) => x.status !== 'approved' && x.status !== 'rejected');

  async function decide(action: 'approve' | 'reject') {
    if (!target) return;
    if (action === 'reject' && !comment.trim()) { setError('Add a reason before rejecting.'); return; }
    setError(null);
    try {
      await act.mutateAsync({ approvalId: target.id, status: target.status, action, comment: comment.trim() });
      setTarget(null); setComment('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  if (q.isLoading) return <View style={{ height: 80, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />;
  if (items.length === 0) {
    return <Card><EmptyState icon={<CheckCircle2 color={t.success} size={22} />} title="Nothing pending" desc="No timesheets waiting for review." /></Card>;
  }

  return (
    <View style={{ gap: Spacing.md }}>
      {items.map((it) => (
        <Pressable key={it.id} onPress={() => it.canAct && setTarget(it)} style={({ pressed }) => ({ opacity: pressed && it.canAct ? 0.85 : 1 })}>
          <Card style={{ opacity: it.canAct ? 1 : 0.6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>{it.employeeName}</Text>
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }}>
                  {MONTHS[it.period_month - 1]} {it.period_year} · {(it.total_hours ?? 0).toFixed(1)}h · {it.total_days ?? 0}d
                </Text>
              </View>
              <View style={{ backgroundColor: `${STATUS_COLOR[it.status] ?? '#475569'}22`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: STATUS_COLOR[it.status] ?? '#475569', fontFamily: Fonts.bodyBold, fontSize: 10.5 }}>{it.statusLabel}</Text>
              </View>
            </View>
            {!it.canAct ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11, marginTop: 6 }}>Waiting on another approver</Text> : null}
          </Card>
        </Pressable>
      ))}

      <Modal visible={!!target} transparent animationType="slide" onRequestClose={() => setTarget(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setTarget(null)}>
          <Pressable style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, gap: Spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>{target?.employeeName}</Text>
              <Pressable onPress={() => setTarget(null)}><X size={20} color={t.textMuted} /></Pressable>
            </View>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5 }}>
              {target ? `${MONTHS[target.period_month - 1]} ${target.period_year} · ${(target.total_hours ?? 0).toFixed(1)}h · ${target.total_days ?? 0} days` : ''}
            </Text>
            <TextField label="Comment" value={comment} onChangeText={setComment} multiline style={{ minHeight: 56 }} placeholder="Optional for approve, required for reject" />
            {error ? <Text style={{ color: t.danger, fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Reject" variant="danger" onPress={() => decide('reject')} loading={act.isPending} disabled={act.isPending} style={{ flex: 1 }} />
              <Button title="Approve" onPress={() => decide('approve')} loading={act.isPending} disabled={act.isPending} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

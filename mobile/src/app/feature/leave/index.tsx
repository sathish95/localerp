import { Pressable, Text, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { CalendarDays, Plus } from 'lucide-react-native';

import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { useLeaveData } from '@/hooks/leave';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';
import { leaveRequestDays, leaveStatusColor, type LeaveData } from '@/lib/leave';
import { Fonts, Radius, Spacing } from '@/constants/theme';

export default function LeaveHub() {
  const { blocked } = useFeatureGuard('leave');
  const t = useTheme();
  const router = useRouter();
  const dataQ = useLeaveData();

  if (blocked) return <Redirect href={'/discover' as Href} />;

  const d = dataQ.data;

  return (
    <Screen onRefresh={dataQ.refetch} refreshing={dataQ.isRefetching}>
      <PageHeader
        title="Leave"
        subtitle="Balances and your requests"
        right={
          <Pressable
            onPress={() => router.push('/feature/leave/new' as Href)}
            style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Plus size={20} color="#fff" />
          </Pressable>
        }
      />

      {dataQ.isLoading || !d ? (
        <View style={{ gap: Spacing.md }}>
          {[110, 90, 90].map((h, i) => <View key={i} style={{ height: h, borderRadius: Radius.lg, backgroundColor: t.surfaceSoft }} />)}
        </View>
      ) : (
        <>
          <Balances d={d} />

          <View style={{ gap: Spacing.md }}>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 2 }}>
              My requests
            </Text>
            {d.requests.length === 0 ? (
              <Card><EmptyState icon={<CalendarDays color={t.accent} size={22} />} title="No requests yet" desc="Tap + to request time off." /></Card>
            ) : (
              d.requests.map((r) => {
                const type = d.types.find((x) => x.code === r.leave_type);
                const days = leaveRequestDays(r, d.holidays);
                const isPerm = r.leave_type === 'permission';
                const sc = leaveStatusColor(r.status);
                return (
                  <Card key={r.id}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: type?.color ?? t.textMuted }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>
                          {type?.name ?? r.leave_type}
                          {isPerm
                            ? ` · ${r.permission_hours?.toFixed(1) ?? '—'} hrs`
                            : days != null ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}
                        </Text>
                        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
                          {isPerm
                            ? dateFmt(r.permission_date)
                            : `${dateFmt(r.from_date)}${r.to_date && r.to_date !== r.from_date ? ` – ${dateFmt(r.to_date)}` : ''}`}
                          {r.reason ? ` · ${r.reason}` : ''}
                        </Text>
                      </View>
                      <View style={{ backgroundColor: `${sc}22`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ color: sc, fontFamily: Fonts.bodyBold, fontSize: 10.5, textTransform: 'capitalize' }}>{r.status}</Text>
                      </View>
                    </View>
                  </Card>
                );
              })
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

function Balances({ d }: { d: LeaveData }) {
  const t = useTheme();
  const rows = [
    { key: 'sick', label: 'Sick', used: d.balances?.sick_used ?? 0, total: d.policy?.sick_days ?? 12, color: '#dc2626', unit: 'days' },
    { key: 'casual', label: 'Casual', used: d.balances?.casual_used ?? 0, total: d.policy?.casual_days ?? 12, color: '#1d4ed8', unit: 'days' },
    { key: 'personal', label: 'Personal', used: d.balances?.personal_used ?? 0, total: d.policy?.personal_days ?? 6, color: '#6d28d9', unit: 'days' },
    { key: 'permission', label: 'Permission', used: d.balances?.permission_hours_used ?? 0, total: d.policy?.permission_hours ?? 24, color: '#0f766e', unit: 'hrs' },
  ];
  return (
    <Card style={{ gap: 14 }}>
      {rows.map((r) => {
        const pct = r.total ? Math.min(100, Math.round(((r.total - r.used) / r.total) * 100)) : 0;
        return (
          <View key={r.key} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13 }}>{r.label}</Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>
                {Math.max(0, r.total - r.used)} / {r.total} {r.unit} left
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surfaceSoft, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${pct}%`, backgroundColor: r.color, borderRadius: 3 }} />
            </View>
          </View>
        );
      })}
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Clock, ListChecks, Megaphone, Pin, Sparkles, Trophy, UserPlus2 } from 'lucide-react-native';

import { Avatar, Card, EmptyState, Screen, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateFmt } from '@/lib/supabase';
import { getActiveLog, type ActiveLog } from '@/lib/checkin';
import { listMyTasks } from '@/lib/tasks';
import { listAnnouncements, listNewJoinees, listRecentAwardWinners, type Announcement, type AwardWinner, type NewJoinee } from '@/lib/orgHome';

function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export default function HomeScreen() {
  const { profile } = useAuth();
  const t = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [joinees, setJoinees] = useState<NewJoinee[]>([]);
  const [winners, setWinners] = useState<AwardWinner[]>([]);
  const [activeLog, setActiveLog] = useState<ActiveLog | null>(null);
  const [openTaskCount, setOpenTaskCount] = useState(0);

  async function load() {
    try {
      const [a, j, w, log, tasks] = await Promise.all([
        listAnnouncements(), listNewJoinees(60), listRecentAwardWinners(8),
        profile?.id ? getActiveLog(profile.id) : Promise.resolve(null),
        profile?.id ? listMyTasks(profile.id) : Promise.resolve([]),
      ]);
      setAnnouncements(a); setJoinees(j); setWinners(w); setActiveLog(log); setOpenTaskCount(tasks.length);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the user changes
  useEffect(() => { load(); }, [profile?.id]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) return <Screen scroll={false}><View /></Screen>;

  const firstName = profile?.full_name?.split(' ')[0];

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ScreenHeader title={`Hey, ${firstName ?? 'there'}`} subtitle="What's happening at your organization" right={<Sparkles color={t.accent} size={22} />} />

      <View style={{ flexDirection: 'row', gap: Spacing.md }}>
        <QuickStat
          icon={<Clock size={16} color="#fff" />}
          accent={activeLog ? t.success : t.textMuted}
          label={activeLog ? `Since ${timeOfDay(activeLog.check_in)}` : 'Not checked in'}
          value={activeLog ? 'Checked in' : 'Check in'}
          onPress={() => router.push('/checkin')}
        />
        <QuickStat
          icon={<ListChecks size={16} color="#fff" />}
          accent={t.accent}
          label={openTaskCount === 1 ? 'open task' : 'open tasks'}
          value={String(openTaskCount)}
          onPress={() => router.push('/tasks')}
        />
      </View>

      <Section icon={<Megaphone size={16} color={t.accent} />} title="Announcements">
        {announcements.length === 0 ? (
          <EmptyState icon={<Megaphone color={t.accent} size={22} />} title="No announcements yet" desc="Company updates will show up here." />
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {announcements.map((a) => (
              <View key={a.id} style={{ backgroundColor: a.pinned ? t.surfaceTint : t.surfaceSoft, borderRadius: 12, padding: 14, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {a.pinned ? <Pin size={12} color={t.accent} /> : null}
                  <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14, flex: 1 }}>{a.title}</Text>
                </View>
                <Text style={{ color: t.textSoft, fontFamily: Fonts.body, fontSize: 13, lineHeight: 19 }}>{a.body}</Text>
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11, marginTop: 2 }}>
                  {a.author?.full_name ?? 'Team'} · {dateFmt(a.publish_at)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section icon={<UserPlus2 size={16} color={t.accent} />} title="New Joinees">
        {joinees.length === 0 ? (
          <EmptyState icon={<UserPlus2 color={t.accent} size={22} />} title="No new joinees" desc="Welcome new teammates here once they join." />
        ) : (
          <View style={{ gap: Spacing.md }}>
            {joinees.map((j) => (
              <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={j.full_name} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13.5 }}>{j.full_name}</Text>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>{j.dept?.name ?? j.role}</Text>
                </View>
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11 }}>{dateFmt(j.date_joined)}</Text>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section icon={<Trophy size={16} color={t.accent} />} title="Recent Awards & Recognition">
        {winners.length === 0 ? (
          <EmptyState icon={<Trophy color={t.accent} size={22} />} title="No awards yet" desc="Granted awards will be celebrated here." />
        ) : (
          <View style={{ gap: Spacing.md }}>
            {winners.map((w) => (
              <View key={`${w.award_id}-${w.employee_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={w.employee_name} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13.5 }}>{w.employee_name}</Text>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>
                    {w.award_name}{w.category_name ? ` · ${w.category_name}` : ''}
                  </Text>
                </View>
                {w.award_date ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11 }}>{dateFmt(w.award_date)}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </Section>
    </Screen>
  );
}

function QuickStat({ icon, accent, label, value, onPress }: { icon: React.ReactNode; accent: string; label: string; value: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <Card style={{ borderLeftWidth: 4, borderLeftColor: accent, flex: 1 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: accent, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
          {icon}
        </View>
        <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 16 }} numberOfLines={1}>{value}</Text>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }} numberOfLines={1}>{label}</Text>
      </Card>
    </Pressable>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon}
        <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}

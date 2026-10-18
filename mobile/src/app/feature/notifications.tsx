import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell, Calendar, CheckSquare, Clock, Library, ListChecks, MessageSquare, Plane, Receipt, Trophy,
  type LucideIcon,
} from 'lucide-react-native';

import { Appear, Card, EmptyState, GradientIconBadge, PageHeader, PressableScale, Screen } from '@/components/ui';
import { Domains, Fonts, Spacing, alpha, type DomainKey } from '@/constants/theme';
import { useNotifications } from '@/context/NotificationsContext';
import { useTheme } from '@/hooks/use-theme';
import { webLinkToMobileRoute } from '@/lib/deep-links';
import { dateFmt } from '@/lib/supabase';
import type { AppNotification } from '@/lib/notifications';

// type prefix → icon + domain color. Falls back to a plain neutral bell
// for anything unmapped (new notification types added on the web side
// need no mobile change).
const TYPE_ICON: [string, LucideIcon, DomainKey][] = [
  ['task', ListChecks, 'tasks'],
  ['allocation', CheckSquare, 'approvals'],
  ['approval', CheckSquare, 'approvals'],
  ['timesheet', Clock, 'timesheet'],
  ['leave', Calendar, 'leave'],
  ['travel', Plane, 'travel'],
  ['expense', Receipt, 'expenses'],
  ['chat', MessageSquare, 'home'],
  ['award', Trophy, 'leave'],
  ['wiki', Library, 'dashboard'],
];

function iconFor(type: string): LucideIcon {
  const hit = TYPE_ICON.find(([prefix]) => type.startsWith(prefix));
  return hit ? hit[1] : Bell;
}

function domainFor(type: string): DomainKey {
  const hit = TYPE_ICON.find(([prefix]) => type.startsWith(prefix));
  return hit ? hit[2] : 'neutral';
}

export default function NotificationsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { notifications, unreadCount, loading, markRead, markAllRead, reload } = useNotifications();

  function openNotification(n: AppNotification) {
    if (!n.read_at) markRead(n.id);
    if (n.link) router.push(webLinkToMobileRoute(n.link) as never);
  }

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        right={unreadCount > 0 ? (
          <PressableScale onPress={markAllRead}>
            <Text style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 12.5 }}>Mark all read</Text>
          </PressableScale>
        ) : undefined}
      />

      {notifications.length === 0 ? (
        <Card>
          <EmptyState icon={<Bell color={t.accent} size={22} />} title="No notifications yet" desc="Updates about your tasks, requests and approvals show up here." />
        </Card>
      ) : (
        <View style={{ gap: Spacing.sm }}>
          {notifications.map((n, i) => {
            const Icon = iconFor(n.type);
            const dc = Domains[domainFor(n.type)];
            const unread = !n.read_at;
            return (
              <Appear key={n.id} index={Math.min(i, 8)}>
                <PressableScale onPress={() => openNotification(n)}>
                  <Card padded={false} style={{ overflow: 'hidden' }}>
                    <View style={{ flexDirection: 'row' }}>
                      {unread ? <View style={{ width: 4, backgroundColor: dc.solid }} /> : null}
                      <View style={{ flex: 1, flexDirection: 'row', gap: Spacing.md, padding: 14, backgroundColor: unread ? alpha(dc.solid, 0.06) : 'transparent' }}>
                        <GradientIconBadge icon={<Icon size={18} color="#fff" />} colors={dc.grad} radius={20} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ flex: 1, color: t.text, fontFamily: unread ? Fonts.bodyBold : Fonts.bodySemiBold, fontSize: 13.5 }} numberOfLines={1}>
                              {n.title}
                            </Text>
                            {unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dc.solid }} /> : null}
                          </View>
                          {n.body ? (
                            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>
                              {n.body}
                            </Text>
                          ) : null}
                          <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 10.5, marginTop: 2 }}>
                            {dateFmt(n.created_at)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Card>
                </PressableScale>
              </Appear>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';

import { Fonts, alpha } from '@/constants/theme';
import { useNotifications } from '@/context/NotificationsContext';
import { useTheme } from '@/hooks/use-theme';

import { PressableScale } from './PressableScale';

// Bell + unread badge, tap to open the full list. Sits in a ScreenHeader's
// `right` slot (see (tabs)/index.tsx).
export function NotificationBell() {
  const t = useTheme();
  const router = useRouter();
  const { unreadCount } = useNotifications();

  return (
    <PressableScale onPress={() => router.push('/feature/notifications')}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(t.accent, 0.14), alignItems: 'center', justifyContent: 'center' }}>
        <Bell color={t.accent} size={19} />
        {unreadCount > 0 ? (
          <View style={{
            position: 'absolute', top: -2, right: -2, minWidth: 17, height: 17, borderRadius: 9,
            paddingHorizontal: 3, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: t.bg,
          }}>
            <Text style={{ color: '#fff', fontFamily: Fonts.bodyExtraBold, fontSize: 9.5 }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

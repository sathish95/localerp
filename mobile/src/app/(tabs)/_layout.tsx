import { Tabs } from 'expo-router';
import { Clock, ListChecks, Receipt, Sparkles, User } from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border, height: 62, paddingBottom: 10, paddingTop: 8 },
        tabBarLabelStyle: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} /> }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks', tabBarIcon: ({ color, size }) => <ListChecks color={color} size={size} /> }} />
      <Tabs.Screen name="checkin" options={{ title: 'Check-in', tabBarIcon: ({ color, size }) => <Clock color={color} size={size} /> }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests', tabBarIcon: ({ color, size }) => <Receipt color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  );
}

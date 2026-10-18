import { Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Compass, ListChecks, Receipt, Sparkles, User } from 'lucide-react-native';

import { TabBar, type TabBarProps } from '@/components/TabBar';
import { useEffectiveModules } from '@/context/ModulesContext';
import { usePush } from '@/hooks/use-push';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const t = useTheme();
  const { ready, isTabAllowed } = useEffectiveModules();
  usePush(); // register this device + route notification taps

  // Hold the tab bar until modules have resolved once, so guarded tabs
  // don't flash in and then disappear.
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }

  return (
    <Tabs
      tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Sparkles color={color} size={21} /> }} />

      {/* Always shown — the feature catalog. It renders each module's own
          allowed / locked state from get_effective_modules('mobile'). */}
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: ({ color }) => <Compass color={color} size={21} /> }} />

      {/* Gated by the `tasks` module — purchased ∩ enabled ∩ role-visible ∩ allocated ∩ mobile-eligible (STEP162). */}
      <Tabs.Protected guard={isTabAllowed('tasks')}>
        <Tabs.Screen name="tasks" options={{ title: 'Tasks', tabBarIcon: ({ color }) => <ListChecks color={color} size={21} /> }} />
      </Tabs.Protected>

      {/* "Expense & Travel" — shown if EITHER `expenses` or `travel` resolves as allowed. */}
      <Tabs.Protected guard={isTabAllowed('expenses')}>
        <Tabs.Screen name="expenses" options={{ title: 'Expenses', tabBarIcon: ({ color }) => <Receipt color={color} size={21} /> }} />
      </Tabs.Protected>

      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <User color={color} size={21} /> }} />
    </Tabs>
  );
}

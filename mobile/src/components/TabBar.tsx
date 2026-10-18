import { useEffect, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Domains, Fonts, Radius, type DomainKey } from '@/constants/theme';
import { useTourTarget } from '@/context/TourTargetContext';
import { useTheme } from '@/hooks/use-theme';
import { haptic } from '@/lib/haptics';

type IconFn = ((props: { focused: boolean; color: string; size: number }) => ReactNode) | undefined;

// Structural subset of React Navigation's BottomTabBarProps (not exported
// from expo-router; the vendored bottom-tabs passes this shape).
export type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string; tabBarIcon?: IconFn } }>;
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

const DOMAIN_FOR_ROUTE: Record<string, DomainKey> = {
  index: 'home',
  discover: 'dashboard',
  tasks: 'tasks',
  expenses: 'expenses',
  profile: 'neutral',
};

const SPRING = { damping: 16, stiffness: 220, mass: 0.7 };

// Floating pill tab bar. The focused tab expands into a coloured capsule
// with its label; the rest stay icon-only, so 6 tabs fit comfortably.
export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 2,
          backgroundColor: t.surface, borderRadius: Radius.pill,
          paddingHorizontal: 7, paddingVertical: 7,
          borderWidth: 1, borderColor: t.border,
        }}
      >
        {state.routes.map((route, i) => {
          const { options } = descriptors[route.key];
          const focused = state.index === i;
          const dom = Domains[DOMAIN_FOR_ROUTE[route.name] ?? 'neutral'];

          const onPress = () => {
            haptic.tap();
            const ev = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !ev.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <TabItem
              key={route.key}
              focused={focused}
              grad={dom.grad}
              inactive={t.textMuted}
              label={typeof options.title === 'string' ? options.title : route.name}
              icon={options.tabBarIcon}
              onPress={onPress}
              tourKey={`mobile-tab-${route.name}`}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({ focused, grad, inactive, label, icon, onPress, tourKey }: {
  focused: boolean;
  grad: readonly [string, string, ...string[]];
  inactive: string;
  label: string;
  icon: IconFn;
  onPress: () => void;
  tourKey: string;
}) {
  const p = useSharedValue(focused ? 1 : 0);
  useEffect(() => { p.set(withSpring(focused ? 1 : 0, SPRING)); }, [focused, p]);
  const registerTarget = useTourTarget(tourKey);

  const labelBox = useAnimatedStyle(() => ({
    width: p.get() * 66,
    opacity: p.get(),
    marginLeft: p.get() * 6,
  }));

  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 10 }}>
      {icon?.({ focused, color: focused ? '#fff' : inactive, size: 21 })}
      <Animated.View style={[{ overflow: 'hidden' }, labelBox]}>
        <Text numberOfLines={1} style={{ color: '#fff', fontFamily: Fonts.bodyExtraBold, fontSize: 12 }}>{label}</Text>
      </Animated.View>
    </View>
  );

  return (
    <View ref={registerTarget} collapsable={false}>
      <Pressable onPress={onPress} hitSlop={6}>
        {focused ? (
          <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: Radius.pill, overflow: 'hidden' }}>
            {inner}
          </LinearGradient>
        ) : (
          inner
        )}
      </Pressable>
    </View>
  );
}

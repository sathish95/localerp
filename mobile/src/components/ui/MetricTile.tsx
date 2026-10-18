import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Fonts, Radius } from '@/constants/theme';
import { haptic } from '@/lib/haptics';

// A filled, gradient KPI tile: big value, label, optional sub-line and
// icon. Meant to sit in a horizontal row (flex: 1 each).
export function MetricTile({
  colors, value, label, sub, icon, onPress,
}: {
  colors: readonly [string, string, ...string[]];
  value: string | number;
  label: string;
  sub?: string;
  icon?: ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14, minHeight: 96, justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ color: '#fff', fontFamily: Fonts.bodyExtraBold, fontSize: 23, letterSpacing: -0.3 }} numberOfLines={1}>{value}</Text>
        {icon ? <View style={{ opacity: 0.9 }}>{icon}</View> : null}
      </View>
      <View>
        <Text style={{ color: '#fff', fontFamily: Fonts.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={{ color: 'rgba(255,255,255,0.82)', fontFamily: Fonts.bodyMedium, fontSize: 10.5, marginTop: 2 }} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </LinearGradient>
  );

  return (
    <Pressable
      onPress={onPress ? () => { haptic.tap(); onPress(); } : undefined}
      style={({ pressed }) => ({ flex: 1, borderRadius: Radius.lg, overflow: 'hidden', opacity: pressed ? 0.9 : 1 })}
    >
      {body}
    </Pressable>
  );
}

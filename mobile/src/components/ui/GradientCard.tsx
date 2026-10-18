import { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Radius } from '@/constants/theme';

// A rounded card with a diagonal 2-stop gradient fill. Content is
// expected to be white / near-white.
export function GradientCard({
  colors, children, style, padded = true,
}: {
  colors: readonly [string, string, ...string[]];
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return (
    <View style={[{ borderRadius: Radius.lg, overflow: 'hidden' }, style]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: padded ? 18 : 0 }}>
        {children}
      </LinearGradient>
    </View>
  );
}

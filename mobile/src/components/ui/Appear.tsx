import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

// Staggered fade-in-up for list items and cards. `index` drives the
// stagger; keep it small (~40ms) so a long list doesn't crawl in.
export function Appear({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(260)} style={style}>
      {children}
    </Animated.View>
  );
}

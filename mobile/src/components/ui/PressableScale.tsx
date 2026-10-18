import { type ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SPRING = { damping: 18, stiffness: 320 };

// Pressable with a spring scale-down on press + an optional light haptic.
// Replaces the ad-hoc `opacity: pressed ? 0.85 : 1` pattern.
export function PressableScale({
  children, onPress, style, disabled, haptics = true, scaleTo = 0.97,
}: {
  children: ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  haptics?: boolean;
  scaleTo?: number;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={() => scale.set(withSpring(scaleTo, SPRING))}
      onPressOut={() => scale.set(withSpring(1, SPRING))}
      onPress={(e) => { if (haptics) haptic.tap(); onPress?.(e); }}
      style={[animatedStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

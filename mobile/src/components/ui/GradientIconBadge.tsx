import { type ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';

import { Radius } from '@/constants/theme';

// Vivid, gradient-filled icon chip — the standard "colorful" header/list
// accent used across the app (replaces flat tinted-background circles).
// Pass a Domains[...].grad tuple as `colors`.
export function GradientIconBadge({
  icon, colors, size = 40, radius = Radius.md,
}: { icon: ReactNode; colors: readonly [string, string, ...string[]]; size?: number; radius?: number }) {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size, height: size, borderRadius: radius,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {icon}
    </LinearGradient>
  );
}

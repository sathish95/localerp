import { Platform } from 'react-native';

// Mirrors the web app's design tokens (src/index.css) so the mobile app
// reads as the same product, not a reskin — same accent, same radius,
// same light-mode surface/border values. Dark mode has no web
// equivalent to mirror, so it's a fresh, coherent palette built around
// the same accent.
export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceSoft: string;
  surfaceTint: string;
  border: string;
  text: string;
  textSoft: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  statusBar: 'dark' | 'light';
};

export const Colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    bg: '#f8fafc',
    surface: '#ffffff',
    surfaceSoft: '#f1f5f9',
    surfaceTint: '#eef2ff',
    border: '#e2e8f0',
    text: '#0f172a',
    textSoft: '#334155',
    textMuted: '#64748b',
    accent: '#6366f1',
    accentSoft: '#eef2ff',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    statusBar: 'dark' as const,
  },
  dark: {
    bg: '#0a0a0f',
    surface: '#15151d',
    surfaceSoft: '#1c1c26',
    surfaceTint: '#1e1b3a',
    border: '#2a2a36',
    text: '#f5f5f7',
    textSoft: '#cbd0dc',
    textMuted: '#8b8fa3',
    accent: '#818cf8',
    accentSoft: '#211f3d',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    statusBar: 'light' as const,
  },
} as const;

export const Radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;

export const Fonts = {
  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  bodySemiBold: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
  bodyExtraBold: 'PlusJakartaSans_800ExtraBold',
  display: 'PlayfairDisplay_700Bold',
  displayExtraBold: 'PlayfairDisplay_800ExtraBold',
} as const;

export const Shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  default: { elevation: 2 },
}) as object;

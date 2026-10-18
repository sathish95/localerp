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

// ── Vivid domain palette ──
// Each functional area gets a hue + a 2-stop gradient. Used for filled
// tiles, gradient hero cards and coloured icon chips. Works on both
// themes (bold colour + white text); pair with alpha() for soft tints.
export const Domains = {
  home:      { solid: '#6366f1', grad: ['#4f46e5', '#7c3aed'] as const },
  checkin:   { solid: '#6366f1', grad: ['#6366f1', '#8b5cf6'] as const },
  dashboard: { solid: '#6366f1', grad: ['#6366f1', '#8b5cf6'] as const },
  tasks:     { solid: '#6366f1', grad: ['#6366f1', '#4338ca'] as const },
  expenses:  { solid: '#f59e0b', grad: ['#f59e0b', '#ea7c0c'] as const },
  travel:    { solid: '#0ea5e9', grad: ['#0ea5e9', '#2563eb'] as const },
  approvals: { solid: '#10b981', grad: ['#10b981', '#0d9488'] as const },
  helpdesk:  { solid: '#06b6d4', grad: ['#06b6d4', '#0284c7'] as const },
  leave:     { solid: '#a855f7', grad: ['#a855f7', '#ec4899'] as const },
  timesheet: { solid: '#3b82f6', grad: ['#3b82f6', '#1d4ed8'] as const },
  neutral:   { solid: '#64748b', grad: ['#64748b', '#475569'] as const },
} as const;

export type DomainKey = keyof typeof Domains;

// hex + 2-digit alpha (e.g. alpha('#6366f1', 0.14))
export function alpha(hex: string, a: number): string {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  return `${hex}${v}`;
}

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

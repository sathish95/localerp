import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Fonts, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

export function Button({
  title, onPress, variant = 'primary', loading = false, disabled = false, icon, style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: object;
}) {
  const t = useTheme();
  const isDisabled = disabled || loading;

  const bg = { primary: t.accent, outline: 'transparent', ghost: 'transparent', danger: t.danger }[variant];
  const border = { primary: t.accent, outline: t.border, ghost: 'transparent', danger: t.danger }[variant];
  const fg = { primary: '#fff', outline: t.text, ghost: t.textSoft, danger: '#fff' }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg, borderWidth: 1.5, borderColor: border, borderRadius: Radius.md,
          paddingVertical: 13, paddingHorizontal: 18,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : (
        <>
          {icon}
          <Text style={{ color: fg, fontFamily: Fonts.bodyBold, fontSize: 15 }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ children, onPress, style }: { children: ReactNode; onPress: () => void; style?: object }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: t.surfaceSoft, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <View>{children}</View>
    </Pressable>
  );
}

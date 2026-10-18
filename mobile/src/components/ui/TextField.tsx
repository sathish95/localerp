import { type ReactNode } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TextField({ label, left, right, style, ...rest }: TextInputProps & { label?: string; left?: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ color: t.textSoft, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: t.surfaceSoft, borderWidth: 1.5, borderColor: t.border, borderRadius: Radius.md,
          paddingHorizontal: Spacing.md,
        }}
      >
        {left}
        <TextInput
          placeholderTextColor={t.textMuted}
          style={[{ flex: 1, paddingVertical: 13, fontSize: 15, color: t.text, fontFamily: Fonts.body }, style]}
          {...rest}
        />
        {right}
      </View>
    </View>
  );
}

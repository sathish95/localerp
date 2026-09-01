import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: Spacing.lg, gap: Spacing.md }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontFamily: Fonts.display, fontSize: 26 }}>{title}</Text>
        {subtitle ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 13.5, marginTop: 3 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

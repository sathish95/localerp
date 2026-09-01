import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function EmptyState({ icon, title, desc }: { icon: ReactNode; title: string; desc?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.lg, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>{title}</Text>
      {desc ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 13, textAlign: 'center' }}>{desc}</Text> : null}
    </View>
  );
}

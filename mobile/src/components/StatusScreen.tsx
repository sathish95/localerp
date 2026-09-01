import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Button, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function StatusScreen({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  const t = useTheme();
  const { signOut } = useAuth();
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.lg }}>
        {icon}
        <Text style={{ color: t.text, fontFamily: Fonts.display, fontSize: 22, textAlign: 'center' }}>{title}</Text>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 14.5, textAlign: 'center', lineHeight: 21 }}>{desc}</Text>
        <Button title="Sign Out" variant="outline" onPress={() => signOut()} />
      </View>
    </Screen>
  );
}

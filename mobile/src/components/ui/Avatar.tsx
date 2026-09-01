import { Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { initials } from '@/lib/supabase';

export function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontFamily: Fonts.bodyBold, fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

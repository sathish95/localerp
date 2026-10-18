import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ScreenHeader } from './ScreenHeader';

// ScreenHeader with a back affordance, for pushed /feature/* screens.
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
        hitSlop={10}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 1, alignSelf: 'flex-start' }}
      >
        <ChevronLeft size={16} color={t.textMuted} />
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 13 }}>Back</Text>
      </Pressable>
      <ScreenHeader title={title} subtitle={subtitle} right={right} />
    </View>
  );
}

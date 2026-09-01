import { Text, View } from 'react-native';

import { Fonts, Radius } from '@/constants/theme';

export function Badge({ label, color = '#6366f1' }: { label: string; color?: string }) {
  return (
    <View style={{ backgroundColor: `${color}1f`, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontFamily: Fonts.bodyBold, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Fonts, alpha } from '@/constants/theme';

// Small pill. `filled` = solid colour + white text; otherwise a soft
// tinted background with coloured text.
export function Chip({ label, color = '#6366f1', filled = false, icon }: {
  label: string;
  color?: string;
  filled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: filled ? color : alpha(color, 0.14),
        borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3,
      }}
    >
      {icon}
      <Text style={{ color: filled ? '#fff' : color, fontFamily: Fonts.bodyBold, fontSize: 10.5, textTransform: 'capitalize' }}>
        {label}
      </Text>
    </View>
  );
}

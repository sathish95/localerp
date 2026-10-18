import { View, type ViewProps } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Card({ style, padded = true, ...rest }: ViewProps & { padded?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: Radius.lg,
          borderWidth: 1,
          borderColor: t.border,
          padding: padded ? 16 : 0,
        },
        style,
      ]}
      {...rest}
    />
  );
}

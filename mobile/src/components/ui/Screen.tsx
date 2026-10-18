import { type ReactNode } from 'react';
import { RefreshControl, ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Screen({
  children, scroll = true, onRefresh, refreshing = false, padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
}) {
  const t = useTheme();
  const content = (
    // extra bottom room so the floating pill tab bar never covers content
    <View style={{ padding: padded ? Spacing.lg : 0, paddingBottom: 110, gap: Spacing.lg }}>{children}</View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={t.statusBar === 'dark' ? 'dark-content' : 'light-content'} />
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} /> : undefined}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{content}</View>
      )}
    </SafeAreaView>
  );
}

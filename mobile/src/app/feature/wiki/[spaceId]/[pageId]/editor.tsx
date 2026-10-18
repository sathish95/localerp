import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

import { PageHeader } from '@/components/ui';
import { useFeatureGuard } from '@/hooks/use-feature-guard';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { useWikiPage } from '@/hooks/wiki';
import { WikiEditorWebView } from '@/components/WikiEditorWebView';

// Deliberately not using the shared <Screen> wrapper — its content View
// has no flex:1 (it sizes to children, expecting a ScrollView), which
// would collapse the WebView (flex:1) to zero height. This screen needs
// the WebView to fill all remaining space below the header.
export default function WikiPageEditorScreen() {
  const { pageId } = useLocalSearchParams<{ spaceId: string; pageId: string }>();
  const { blocked } = useFeatureGuard('wiki');
  const pageQ = useWikiPage(pageId);
  const t = useTheme();

  if (blocked) return <Redirect href={'/discover' as Href} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md }}>
        <PageHeader title={pageQ.data?.title ?? 'Page'} subtitle="Live editing" />
      </View>
      {pageQ.data ? (
        <WikiEditorWebView pageId={pageQ.data.id} pageTitle={pageQ.data.title} />
      ) : null}
    </SafeAreaView>
  );
}

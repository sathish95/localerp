import { Stack } from 'expo-router';

// Feature hubs pushed from Discover / Home. Screens render their own
// header (PageHeader) so the native header stays hidden.
export default function FeatureLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

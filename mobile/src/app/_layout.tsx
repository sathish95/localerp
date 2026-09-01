import { PlayfairDisplay_700Bold, PlayfairDisplay_800ExtraBold } from '@expo-google-fonts/playfair-display';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ShieldAlert, UserX } from 'lucide-react-native';

import { StatusScreen } from '@/components/StatusScreen';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
    PlayfairDisplay_700Bold, PlayfairDisplay_800ExtraBold,
  });

  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function Gate() {
  const { user, profile, loading } = useAuth();
  const t = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }

  // Same lockout rules as the web app (src/App.jsx) — the admin/super-admin
  // exemptions there don't apply since this build only targets the
  // employee role.
  if (user && profile?.org && (profile.org.deleted_at || profile.org.is_active === false)) {
    return <StatusScreen icon={<ShieldAlert color={t.danger} size={40} />} title="Organization Suspended" desc="Your organization's access has been suspended. Contact your administrator for help." />;
  }
  if (user && profile && profile.is_active === false) {
    return <StatusScreen icon={<UserX color={t.danger} size={40} />} title="Account Deactivated" desc="Your account has been deactivated by an administrator. Contact HR or your manager for help." />;
  }

  const signedIn = !!user;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

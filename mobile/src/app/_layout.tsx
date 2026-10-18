import { PlayfairDisplay_700Bold, PlayfairDisplay_800ExtraBold } from '@expo-google-fonts/playfair-display';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import { ShieldAlert, UserX } from 'lucide-react-native';

import { AppTourOverlay } from '@/components/AppTourOverlay';
import { ChatBotBubble } from '@/components/ChatBotBubble';
import { LockScreen } from '@/components/LockScreen';
import { StatusScreen } from '@/components/StatusScreen';
import { WalkthroughScreen } from '@/components/WalkthroughScreen';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { LockProvider, useLock } from '@/context/LockContext';
import { ModulesProvider } from '@/context/ModulesContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { TourTargetProvider } from '@/context/TourTargetContext';
import { TourUIProvider, useTourUI } from '@/context/TourUIContext';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import { useMarkTourSeen, useTourSteps } from '@/hooks/onboarding';
import { useTheme } from '@/hooks/use-theme';
import { hasSeenPreLoginWalkthrough, markPreLoginWalkthroughSeen, PRE_LOGIN_SLIDES } from '@/lib/preLoginWalkthrough';
import { asyncStoragePersister, queryClient } from '@/lib/query-client';

SplashScreen.preventAutoHideAsync();

// Catches render errors anywhere in the tree. Bulletproof, hardcoded
// colours — this must not itself depend on anything that could throw.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0f', padding: 24, gap: 12 }}>
      <Text style={{ color: '#f5f5f7', fontSize: 18, fontWeight: '800' }}>Something went wrong</Text>
      <Text style={{ color: '#8b8fa3', fontSize: 13, textAlign: 'center' }} numberOfLines={4}>{error.message}</Text>
      <Pressable onPress={retry} style={{ marginTop: 8, backgroundColor: '#6366f1', paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

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
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: asyncStoragePersister }}>
        <AuthProvider>
          <ModulesProvider>
            <WorkspaceProvider>
              <NotificationsProvider>
                <LockProvider>
                  <TourTargetProvider>
                    <TourUIProvider>
                      <Gate />
                    </TourUIProvider>
                  </TourTargetProvider>
                </LockProvider>
              </NotificationsProvider>
            </WorkspaceProvider>
          </ModulesProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function Gate() {
  const { user, profile, loading } = useAuth();
  const { locked } = useLock();
  const t = useTheme();
  const { data: tourSteps = [] } = useTourSteps();
  const markTourSeen = useMarkTourSeen();
  const { showTour, openTour, closeTour } = useTourUI();

  // Pre-login walkthrough (Splash -> Walkthrough -> Login): a local,
  // device-level "seen" flag rather than a profile column, since there's
  // no signed-in user yet to gate it on. null while the AsyncStorage
  // read is in flight, to avoid flashing the login screen first.
  const [preLoginSeen, setPreLoginSeen] = useState<boolean | null>(null);
  useEffect(() => { hasSeenPreLoginWalkthrough().then(setPreLoginSeen); }, []);

  // The post-login guided tour (spotlighting real nav/tab elements) is
  // unrelated to the walkthrough above and still per-user/org-scoped.
  const autoTourPending = !!profile && tourSteps.length > 0 && !profile.tour_seen_at;
  useEffect(() => { if (autoTourPending) openTour(); }, [autoTourPending, openTour]);

  if (loading || preLoginSeen === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }

  // Biometric app-lock — sits above everything else once a session exists.
  if (user && locked) return <LockScreen />;

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

  // First-run walkthrough, shown once per device before the login
  // screen — replaces the whole stack, blocking, until dismissed (same
  // "can't be swiped away or skipped via back button" guarantee the
  // LockScreen branch above gets). Only relevant pre-auth: a device
  // that's already signed in skips straight past it regardless of the
  // local flag.
  if (!signedIn && !preLoginSeen) {
    return <WalkthroughScreen slides={PRE_LOGIN_SLIDES} onDone={async () => { await markPreLoginWalkthroughSeen(); setPreLoginSeen(true); }} />;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="feature" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      {signedIn && <ChatBotBubble />}
      {signedIn && showTour && tourSteps.length > 0 && (
        <AppTourOverlay steps={tourSteps} onDone={() => { closeTour(); markTourSeen.mutate(); }} />
      )}
    </>
  );
}

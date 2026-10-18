import { useEffect, useRef } from 'react';
import { useRouter, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { useAuth } from '@/context/AuthContext';
import { webLinkToMobileRoute } from '@/lib/deep-links';
import { registerForPush } from '@/lib/push';

// Registers this device for push once signed in, and routes notification
// taps to the right screen (translating the stored web-style `link`).
export function usePush() {
  const { user } = useAuth();
  const router = useRouter();
  const registered = useRef(false);

  useEffect(() => {
    if (!user || registered.current) return;
    registered.current = true;
    registerForPush().catch((e) => console.warn('[push] register failed', e));
  }, [user]);

  useEffect(() => {
    function open(resp: Notifications.NotificationResponse | null) {
      const link = resp?.notification.request.content.data?.link as string | undefined;
      if (link !== undefined) router.navigate(webLinkToMobileRoute(link) as Href);
    }

    // Cold start from a tapped notification.
    Notifications.getLastNotificationResponseAsync().then(open);

    // Taps while the app is running / backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);
}

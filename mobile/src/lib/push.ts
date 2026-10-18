import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Foreground behaviour: show the banner + list entry, play a sound, and
// let the OS manage the badge from the push payload.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function easProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    // easConfig is populated in EAS builds; not in the type but present at runtime
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

async function getExpoToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators/emulators can't receive push
  const pid = easProjectId();
  try {
    const res = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined);
    return res.data;
  } catch (e) {
    // Most common cause: no EAS projectId configured yet (run `eas init`).
    console.warn('[push] getExpoPushTokenAsync failed', e);
    return null;
  }
}

/** Ask for permission, get a token, and register it server-side (STEP164). */
export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;

  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const token = await getExpoToken();
  if (!token) return;

  await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    p_device_name: Device.deviceName ?? null,
    p_app_version: Constants.expoConfig?.version ?? null,
  });
}

/** Revoke this device's token — call on sign-out. Best effort. */
export async function unregisterPush(): Promise<void> {
  const token = await getExpoToken();
  if (!token) return;
  try {
    await supabase.rpc('revoke_push_token', { p_token: token });
  } catch {
    // ignore — the token is orphaned server-side at worst, and the
    // delivery worker prunes DeviceNotRegistered tokens anyway.
  }
}

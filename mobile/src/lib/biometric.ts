import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const KEY = 'neox.biometric.enabled';

/** Device has biometric hardware AND the user has enrolled a face/finger. */
export async function biometricAvailable(): Promise<boolean> {
  try {
    const [hasHw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHw && enrolled;
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  try {
    if (on) await SecureStore.setItemAsync(KEY, '1');
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // secure store unavailable — nothing we can do; treat as disabled
  }
}

/** Prompt for Face ID / fingerprint. Returns true on success. */
export async function authenticate(): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock ThingsAlive NeoX',
      fallbackLabel: 'Use device passcode',
    });
    return res.success;
  } catch {
    return false;
  }
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { authenticate, isBiometricEnabled } from '@/lib/biometric';

// Re-lock if the app was backgrounded for longer than this.
const GRACE_MS = 30_000;

type LockCtx = {
  /** true when the app should be hidden behind the lock screen right now. */
  locked: boolean;
  /** biometric lock is switched on for this device. */
  armed: boolean;
  /** prompt Face ID / fingerprint; returns true on success. */
  unlock: () => Promise<boolean>;
  /** re-read the preference after the Profile toggle changes it. */
  refreshArmed: () => Promise<void>;
};

const Ctx = createContext<LockCtx | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const [locked, setLocked] = useState(false);
  const bgSince = useRef<number | null>(null);

  useEffect(() => {
    isBiometricEnabled().then((on) => {
      setArmed(on);
      setLocked(on); // start locked when the feature is on
    });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') {
        if (bgSince.current == null) bgSince.current = Date.now();
      } else if (s === 'active') {
        if (armed && bgSince.current != null && Date.now() - bgSince.current > GRACE_MS) {
          setLocked(true);
        }
        bgSince.current = null;
      }
    });
    return () => sub.remove();
  }, [armed]);

  const unlock = useCallback(async () => {
    const ok = await authenticate();
    if (ok) setLocked(false);
    return ok;
  }, []);

  const refreshArmed = useCallback(async () => {
    const on = await isBiometricEnabled();
    setArmed(on);
    if (!on) setLocked(false);
  }, []);

  return (
    <Ctx.Provider value={{ locked: armed && locked, armed, unlock, refreshArmed }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLock() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLock outside LockProvider');
  return c;
}

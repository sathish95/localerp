import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';

import { Button } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useLock } from '@/context/LockContext';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function LockScreen() {
  const t = useTheme();
  const { unlock } = useLock();
  const { signOut } = useAuth();
  const auto = useRef(false);

  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    unlock();
  }, [unlock]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, gap: Spacing.lg, paddingHorizontal: Spacing.xl }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Lock size={28} color={t.accent} />
      </View>
      <Text style={{ color: t.text, fontFamily: Fonts.display, fontSize: 22 }}>ThingsAlive NeoX</Text>
      <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 14 }}>Locked for your security</Text>
      <Button title="Unlock" onPress={() => unlock()} style={{ minWidth: 180 }} />
      <Pressable onPress={() => signOut()} hitSlop={10}>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 13 }}>Sign out instead</Text>
      </Pressable>
    </View>
  );
}

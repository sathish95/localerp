import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Briefcase, Building2, Compass, Fingerprint, LogOut, Mail } from 'lucide-react-native';

import { Avatar, Button, Card, GradientCard, GradientIconBadge, Screen, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useLock } from '@/context/LockContext';
import { useTourUI } from '@/context/TourUIContext';
import { useTourSteps } from '@/hooks/onboarding';
import { Domains, Fonts, Spacing, alpha, type DomainKey } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { authenticate, biometricAvailable, isBiometricEnabled, setBiometricEnabled } from '@/lib/biometric';

function Row({ icon, label, value, domain }: { icon: React.ReactNode; label: string; value: string; domain: DomainKey }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <GradientIconBadge icon={icon} colors={Domains[domain].grad} size={36} radius={10} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>{label}</Text>
        <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 14, marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const { refreshArmed } = useLock();
  const { openTour } = useTourUI();
  const { data: tourSteps = [] } = useTourSteps();
  const t = useTheme();

  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBioAvailable);
    isBiometricEnabled().then(setBioOn);
  }, []);

  async function toggleBio(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const ok = await authenticate();
        if (!ok) return;
      }
      await setBiometricEnabled(next);
      setBioOn(next);
      await refreshArmed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Profile" subtitle="Your account details" />

      <GradientCard colors={Domains.home.grad} padded={false}>
        <View style={{ alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg, gap: 10 }}>
          <View style={{ borderRadius: 999, padding: 3, backgroundColor: 'rgba(255,255,255,0.25)' }}>
            <Avatar name={profile?.full_name} size={72} />
          </View>
          <Text style={{ color: '#fff', fontFamily: Fonts.bodyExtraBold, fontSize: 18 }}>{profile?.full_name}</Text>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 }}>
            <Text style={{ color: '#fff', fontFamily: Fonts.bodyBold, fontSize: 12, textTransform: 'capitalize' }}>{profile?.role?.replace(/_/g, ' ')}</Text>
          </View>
        </View>
      </GradientCard>

      <Card padded={false}>
        <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
          <Row icon={<Mail size={16} color="#fff" />} label="Email" value={profile?.email ?? '—'} domain="home" />
          <Row icon={<Briefcase size={16} color="#fff" />} label="Department" value={profile?.dept?.name ?? '—'} domain="tasks" />
          <Row icon={<Building2 size={16} color="#fff" />} label="Organization" value={profile?.org?.name ?? '—'} domain="travel" />
        </View>
      </Card>

      {bioAvailable ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <GradientIconBadge icon={<Fingerprint size={18} color="#fff" />} colors={Domains.approvals.grad} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 14 }}>Biometric unlock</Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 1 }}>
                Require Face ID / fingerprint to open the app
              </Text>
            </View>
            <Switch
              value={bioOn}
              disabled={busy}
              onValueChange={toggleBio}
              trackColor={{ true: Domains.approvals.solid, false: t.border }}
              thumbColor="#fff"
            />
          </View>
        </Card>
      ) : null}

      {tourSteps.length > 0 ? (
        <Pressable onPress={openTour}>
          <Card style={{ backgroundColor: alpha(Domains.leave.solid, 0.06), borderColor: alpha(Domains.leave.solid, 0.2) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <GradientIconBadge icon={<Compass size={18} color="#fff" />} colors={Domains.leave.grad} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 14 }}>Take a tour</Text>
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, marginTop: 1 }}>
                  Replay the guided walkthrough of the app
                </Text>
              </View>
            </View>
          </Card>
        </Pressable>
      ) : null}

      <Button title="Sign Out" variant="outline" icon={<LogOut size={16} color={t.text} />} onPress={() => signOut()} />
    </Screen>
  );
}

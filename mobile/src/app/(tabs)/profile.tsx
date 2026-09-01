import { Text, View } from 'react-native';
import { Briefcase, Building2, LogOut, Mail } from 'lucide-react-native';

import { Avatar, Button, Card, Screen, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border }}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5 }}>{label}</Text>
        <Text style={{ color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 14, marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const t = useTheme();

  return (
    <Screen>
      <ScreenHeader title="Profile" subtitle="Your account details" />

      <Card style={{ alignItems: 'center', paddingVertical: Spacing.xl, gap: 10 }}>
        <Avatar name={profile?.full_name} size={72} />
        <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 18 }}>{profile?.full_name}</Text>
        <View style={{ backgroundColor: t.accentSoft, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 }}>
          <Text style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 12, textTransform: 'capitalize' }}>{profile?.role?.replace(/_/g, ' ')}</Text>
        </View>
      </Card>

      <Card padded={false}>
        <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
          <Row icon={<Mail size={16} color={t.textMuted} />} label="Email" value={profile?.email ?? '—'} />
          <Row icon={<Briefcase size={16} color={t.textMuted} />} label="Department" value={profile?.dept?.name ?? '—'} />
          <Row icon={<Building2 size={16} color={t.textMuted} />} label="Organization" value={profile?.org?.name ?? '—'} />
        </View>
      </Card>

      <Button title="Sign Out" variant="outline" icon={<LogOut size={16} color={t.text} />} onPress={() => signOut()} />
    </Screen>
  );
}

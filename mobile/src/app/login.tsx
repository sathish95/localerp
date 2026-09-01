import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock, Mail, Sparkles } from 'lucide-react-native';

import { Button, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function LoginScreen() {
  const t = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={['#0a0a0f', '#15152b', '#1e1b3a']} style={{ paddingTop: 90, paddingBottom: 56, paddingHorizontal: Spacing.xl, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(129,140,248,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <Sparkles color="#a5b4fc" size={26} />
        </View>
        <Text style={{ color: '#f5f5f7', fontFamily: Fonts.display, fontSize: 30 }}>ThingsAlive NeoX</Text>
        <Text style={{ color: 'rgba(245,245,247,0.6)', fontFamily: Fonts.body, fontSize: 14, marginTop: 6 }}>Manage everything. From one place.</Text>
      </LinearGradient>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
          <View style={{ flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, gap: Spacing.lg, marginTop: -28 }}>
            <View style={{ backgroundColor: t.surface, borderRadius: 20, padding: Spacing.lg, borderWidth: 1, borderColor: t.border, gap: Spacing.md, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 18 }}>Welcome back</Text>
              <TextField
                label="Work email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                left={<Mail size={16} color={t.textMuted} />}
              />
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                left={<Lock size={16} color={t.textMuted} />}
              />
              {error ? <Text style={{ color: t.danger, fontFamily: Fonts.bodyMedium, fontSize: 13 }}>{error}</Text> : null}
              <Button title="Sign In" onPress={handleSignIn} loading={loading} style={{ marginTop: 4 }} />
            </View>
            <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12, textAlign: 'center' }}>
              Use the same account you sign in with on the web app.
            </Text>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

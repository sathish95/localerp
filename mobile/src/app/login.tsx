import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertCircle, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react-native';

import { Appear, Button, TextField } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function LoginScreen() {
  const t = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      <LinearGradient colors={['#4338ca', '#6366f1', '#8b5cf6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: 90, paddingBottom: 56, paddingHorizontal: Spacing.xl, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <Appear>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <Sparkles color="#fff" size={26} />
          </View>
          <Text style={{ color: '#fff', fontFamily: Fonts.display, fontSize: 30 }}>ThingsAlive NeoX</Text>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: Fonts.body, fontSize: 14, marginTop: 6 }}>Manage everything. From one place.</Text>
        </Appear>
      </LinearGradient>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
          <View style={{ flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, gap: Spacing.lg, marginTop: -28 }}>
            <Appear index={1}>
              <View style={{ backgroundColor: t.surface, borderRadius: 20, padding: Spacing.lg, borderWidth: 1, borderColor: t.border, gap: Spacing.md, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}>
                <Text style={{ color: t.text, fontFamily: Fonts.bodyExtraBold, fontSize: 18 }}>Welcome back</Text>
                <TextField
                  label="Work email"
                  value={email}
                  onChangeText={(v) => { setEmail(v); if (error) setError(null); }}
                  placeholder="you@company.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  returnKeyType="next"
                  left={<Mail size={16} color={t.textMuted} />}
                />
                <TextField
                  label="Password"
                  value={password}
                  onChangeText={(v) => { setPassword(v); if (error) setError(null); }}
                  placeholder="••••••••"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="go"
                  onSubmitEditing={handleSignIn}
                  left={<Lock size={16} color={t.textMuted} />}
                  right={
                    <Pressable hitSlop={10} onPress={() => setShowPassword((s) => !s)}>
                      {showPassword ? <EyeOff size={16} color={t.textMuted} /> : <Eye size={16} color={t.textMuted} />}
                    </Pressable>
                  }
                />

                {error ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: `${t.danger}14`, borderWidth: 1, borderColor: `${t.danger}33`, borderRadius: Radius.sm, paddingVertical: 9, paddingHorizontal: 11 }}>
                    <AlertCircle size={15} color={t.danger} />
                    <Text style={{ color: t.danger, fontFamily: Fonts.bodyMedium, fontSize: 13, flex: 1 }}>{error}</Text>
                  </View>
                ) : null}

                <Button title="Sign In" onPress={handleSignIn} loading={loading} style={{ marginTop: 4 }} />

                <Pressable
                  hitSlop={8}
                  style={{ alignSelf: 'center' }}
                  onPress={() => Alert.alert('Forgot password', 'Ask your workspace admin to reset it for you from Settings → Team.')}
                >
                  <Text style={{ color: t.accent, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Forgot password?</Text>
                </Pressable>
              </View>
            </Appear>

            <Appear index={2}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <ShieldCheck size={13} color={t.textMuted} />
                <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12, textAlign: 'center' }}>
                  Use the same account you sign in with on the web app.
                </Text>
              </View>
            </Appear>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

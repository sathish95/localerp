import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bot, Send, Sparkles, X } from 'lucide-react-native';

import { useAuth } from '@/context/AuthContext';
import { Domains, Fonts, Radius, Spacing, alpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { questionsForRole, type QuickQuestion } from '@/lib/quickAnswers';

type Message = { id: number; from: 'user' | 'bot'; text: string };

// Floating "NeoX AI" quick-answers bubble — native counterpart to the web
// app's AskBubble.jsx. Everyone gets the icon; the question set behind it
// is role-gated (questionsForRole) rather than the icon's visibility
// itself, per the chosen design: personal questions (my tasks, my hours,
// my pending requests) for every role, plus org-wide financial/ops
// questions for managers/finance/HR. No freeform typed question here —
// unlike the web bubble, mobile has no LLM API key configured
// (EXPO_PUBLIC_DEEPSEEK/GEMINI_API_KEY), so this only answers the
// canned, instant, non-AI questions; adding freeform chat later just
// means wiring those keys + a port of src/lib/assistant.js.
export function ChatBotBubble() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  const questions = questionsForRole(profile?.role);

  function reset() {
    setMessages([]);
  }

  async function ask(q: QuickQuestion) {
    if (busy || !profile) return;
    const userMsgId = ++idRef.current;
    setMessages((m) => [...m, { id: userMsgId, from: 'user', text: q.label }]);
    setBusy(true);
    scrollRef.current?.scrollToEnd({ animated: true });
    const answer = await q.run(profile);
    const botMsgId = ++idRef.current;
    setMessages((m) => [...m, { id: botMsgId, from: 'bot', text: answer }]);
    setBusy(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ position: 'absolute', right: 18, bottom: 96 + insets.bottom * 0.3, zIndex: 50 }}
      >
        <LinearGradient
          colors={Domains.home.grad}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}
        >
          <Sparkles size={22} color="#fff" />
        </LinearGradient>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={() => setOpen(false)}>
          <Pressable
            style={{
              backgroundColor: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
              maxHeight: '80%', paddingBottom: insets.bottom + Spacing.md,
            }}
          >
            <LinearGradient colors={Domains.home.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Bot size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontFamily: Fonts.bodyExtraBold, fontSize: 15 }}>NeoX AI</Text>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: Fonts.body, fontSize: 11.5 }}>Ask me about your work</Text>
              </View>
              {messages.length > 0 && (
                <Pressable onPress={reset} hitSlop={8} style={{ padding: 4 }}>
                  <Text style={{ color: '#fff', fontFamily: Fonts.bodySemiBold, fontSize: 12 }}>Reset</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setOpen(false)} hitSlop={8} style={{ padding: 4 }}>
                <X size={18} color="#fff" />
              </Pressable>
            </LinearGradient>

            <ScrollView ref={scrollRef} style={{ padding: Spacing.lg }} contentContainerStyle={{ gap: 10 }}>
              {messages.length === 0 ? (
                <>
                  <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, marginBottom: 4 }}>
                    Hi{profile?.full_name ? ` ${profile.full_name.split(' ')[0]}` : ''}! Pick a question for an instant answer:
                  </Text>
                  {questions.map((q) => (
                    <Pressable key={q.id} disabled={busy} onPress={() => ask(q)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
                        borderRadius: Radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface,
                      }}>
                      <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: alpha(Domains.home.solid, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                        <Sparkles size={14} color={Domains.home.solid} />
                      </View>
                      <Text style={{ flex: 1, color: t.text, fontFamily: Fonts.bodySemiBold, fontSize: 13 }}>{q.label}</Text>
                    </Pressable>
                  ))}
                </>
              ) : (
                messages.map((m) => (
                  <View key={m.id} style={{ alignItems: m.from === 'user' ? 'flex-end' : 'flex-start' }}>
                    <View style={{
                      maxWidth: '85%', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 13,
                      backgroundColor: m.from === 'user' ? Domains.home.solid : t.surface,
                      borderWidth: m.from === 'user' ? 0 : 1, borderColor: t.border,
                    }}>
                      <Text style={{ color: m.from === 'user' ? '#fff' : t.text, fontFamily: Fonts.body, fontSize: 13, lineHeight: 19 }}>{m.text}</Text>
                    </View>
                  </View>
                ))
              )}
              {busy && (
                <View style={{ alignItems: 'flex-start' }}>
                  <View style={{ borderRadius: 14, paddingVertical: 9, paddingHorizontal: 13, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
                    <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 13 }}>Thinking…</Text>
                  </View>
                </View>
              )}
              {messages.length > 0 && !busy && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {questions.map((q) => (
                    <Pressable key={q.id} onPress={() => ask(q)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: t.border, backgroundColor: t.surfaceSoft }}>
                      <Send size={11} color={t.textMuted} />
                      <Text style={{ color: t.textSoft, fontFamily: Fonts.bodyMedium, fontSize: 11 }} numberOfLines={1}>{q.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

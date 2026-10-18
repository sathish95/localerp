import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Slide = { id: string; title: string; body?: string | null; icon?: string | null };

// Blocking, full-screen first-run carousel — mirrors the web app's
// WalkthroughModal (same button-driven paging + dot progress, no swipe
// gesture, so the interaction model matches exactly across platforms).
// Shown before login, once per device (see app/_layout.tsx's Gate +
// lib/preLoginWalkthrough.ts) — content is hardcoded, not org-fetched,
// since there's no signed-in user yet to resolve an organization from.
export function WalkthroughScreen({ slides, onDone }: { slides: Slide[]; onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const slide = slides[i];
  const isLast = i === slides.length - 1;
  const IconComp = (slide.icon && (Icons as unknown as Record<string, typeof Sparkles>)[slide.icon]) || Sparkles;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24, paddingHorizontal: 28, justifyContent: 'space-between' }}>
      <View style={{ alignItems: 'center', marginTop: 40 }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 28 }}>
          <IconComp size={38} color="#fff" />
        </View>
        <Text style={{ color: t.text, fontFamily: Fonts.display, fontSize: 22, textAlign: 'center', marginBottom: 12 }}>{slide.title}</Text>
        {slide.body ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>{slide.body}</Text> : null}
      </View>

      <View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
          {slides.map((s, idx) => (
            <View key={s.id} style={{ width: idx === i ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: idx === i ? t.accent : t.border }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} style={{ opacity: i === 0 ? 0 : 1, flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8 }}>
            <ArrowLeft size={15} color={t.textMuted} />
            <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 13.5 }}>Back</Text>
          </Pressable>
          <Pressable onPress={() => (isLast ? onDone() : setI((x) => x + 1))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accent, borderRadius: Radius.pill, paddingHorizontal: 22, paddingVertical: 13 }}>
            <Text style={{ color: '#fff', fontFamily: Fonts.bodyExtraBold, fontSize: 14 }}>{isLast ? 'Get Started' : 'Next'}</Text>
            {!isLast && <ArrowRight size={15} color="#fff" />}
          </Pressable>
        </View>
        <Pressable onPress={onDone} style={{ alignSelf: 'center', marginTop: 16, padding: 6 }}>
          <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

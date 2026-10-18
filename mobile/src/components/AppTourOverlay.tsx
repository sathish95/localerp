import { useEffect, useState } from 'react';
import { Dimensions, Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

import { Fonts, Radius } from '@/constants/theme';
import { useTourMeasure } from '@/context/TourTargetContext';
import { useTheme } from '@/hooks/use-theme';
import type { TourStep } from '@/lib/appWalkthrough';

const PAD = 8;

// Sequential spotlight overlay, native counterpart to the web app's
// AppTour.jsx (same four-rectangle mask technique, measured via
// TourTargetContext's registry instead of `data-tour` + getBoundingClientRect).
// Rendered as the last sibling in app/_layout.tsx's Gate, absolutely
// positioned over the whole screen so it sits above the tab bar.
export function AppTourOverlay({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const measure = useTourMeasure();
  const t = useTheme();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const step = steps[i];

  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    measure(step.target_key).then((r) => { if (!cancelled) setRect(r); });
    return () => { cancelled = true; };
  }, [step, measure]);

  if (!step) return null;

  const { width: vw, height: vh } = Dimensions.get('window');
  const r = rect ?? { x: -9999, y: -9999, width: 0, height: 0 };
  const hole = { top: r.y - PAD, left: r.x - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
  const spaceBelow = vh - (hole.top + hole.height);
  const placeBelow = !rect || spaceBelow > 200 || hole.top < 200;
  const tooltipWidth = Math.min(320, vw - 32);
  const overlayColor = 'rgba(10,10,15,0.62)';

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <View pointerEvents="auto" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: Math.max(0, hole.top), backgroundColor: overlayColor }} />
      <View pointerEvents="auto" style={{ position: 'absolute', top: Math.max(0, hole.top), left: 0, width: Math.max(0, hole.left), height: hole.height, backgroundColor: overlayColor }} />
      <View pointerEvents="auto" style={{ position: 'absolute', top: Math.max(0, hole.top), left: hole.left + hole.width, right: 0, height: hole.height, backgroundColor: overlayColor }} />
      <View pointerEvents="auto" style={{ position: 'absolute', top: hole.top + hole.height, left: 0, right: 0, bottom: 0, backgroundColor: overlayColor }} />

      {rect && (
        <View pointerEvents="none" style={{ position: 'absolute', top: hole.top, left: hole.left, width: hole.width, height: hole.height, borderRadius: 16, borderWidth: 2.5, borderColor: t.accent }} />
      )}

      <View style={{
        position: 'absolute', width: tooltipWidth,
        left: Math.min(Math.max(hole.left, 16), vw - tooltipWidth - 16),
        top: placeBelow ? Math.min(hole.top + hole.height + 14, vh - 220) : undefined,
        bottom: !placeBelow ? vh - hole.top + 14 : undefined,
        backgroundColor: t.surface, borderRadius: Radius.lg, padding: 16,
        shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12,
      }}>
        <Pressable onPress={onDone} hitSlop={8} style={{ position: 'absolute', top: 10, right: 10, padding: 4 }}>
          <X size={14} color={t.textMuted} />
        </Pressable>
        <Text style={{ color: t.accent, fontFamily: Fonts.bodyExtraBold, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          Step {i + 1} of {steps.length}
        </Text>
        <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14.5, marginBottom: 6 }}>{step.title}</Text>
        {step.body ? <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18, marginBottom: 14 }}>{step.body}</Text> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, opacity: i === 0 ? 0 : 1 }}>
            <ChevronLeft size={16} color={t.textMuted} />
            <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 12.5 }}>Back</Text>
          </Pressable>
          <Pressable onPress={() => (i === steps.length - 1 ? onDone() : setI((x) => x + 1))}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.accent, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8, gap: 4 }}>
            <Text style={{ color: '#fff', fontFamily: Fonts.bodyExtraBold, fontSize: 12.5 }}>{i === steps.length - 1 ? 'Finish' : 'Next'}</Text>
            {i !== steps.length - 1 && <ChevronRight size={14} color="#fff" />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import type { View } from 'react-native';

type Rect = { x: number; y: number; width: number; height: number };

type Ctx = {
  register: (key: string) => (node: View | null) => void;
  measure: (key: string) => Promise<Rect | null>;
};

const TourTargetCtx = createContext<Ctx | null>(null);

// Registry of measurable UI anchors for the mobile app tour — a native
// counterpart to the web app's `data-tour="<key>"` attribute. A component
// registers itself with `useTourTarget('mobile-tab-discover')` on a
// `ref`; AppTourOverlay looks the node up by the same key and measures
// it on demand via `measureInWindow` (not a static layout snapshot,
// since the tab bar can reflow between mount and tour start).
export function TourTargetProvider({ children }: { children: ReactNode }) {
  const registry = useRef<Map<string, View>>(new Map());

  const register = useCallback((key: string) => (node: View | null) => {
    if (node) registry.current.set(key, node);
    else registry.current.delete(key);
  }, []);

  const measure = useCallback((key: string): Promise<Rect | null> => {
    const node = registry.current.get(key);
    if (!node) return Promise.resolve(null);
    return new Promise((resolve) => {
      node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
    });
  }, []);

  return <TourTargetCtx.Provider value={{ register, measure }}>{children}</TourTargetCtx.Provider>;
}

export function useTourTarget(key: string) {
  const ctx = useContext(TourTargetCtx);
  return ctx?.register(key) ?? (() => {});
}

export function useTourMeasure() {
  const ctx = useContext(TourTargetCtx);
  return ctx?.measure ?? (async () => null);
}

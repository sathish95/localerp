import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Ctx = { showTour: boolean; openTour: () => void; closeTour: () => void };
const Ctx = createContext<Ctx | null>(null);

// Lets any screen (e.g. Profile's "Take a tour" row) re-open the guided
// tour on demand, not just the automatic first-run trigger in
// app/_layout.tsx's Gate — same idea as the web app's topbar compass icon.
export function TourUIProvider({ children }: { children: ReactNode }) {
  const [showTour, setShowTour] = useState(false);
  const openTour = useCallback(() => setShowTour(true), []);
  const closeTour = useCallback(() => setShowTour(false), []);
  const value = useMemo(() => ({ showTour, openTour, closeTour }), [showTour, openTour, closeTour]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTourUI() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTourUI must be used within TourUIProvider');
  return ctx;
}

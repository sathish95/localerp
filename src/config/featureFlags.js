// Industry-Adaptive Platform — Phase 3 kill switches (master prompt
// section 45). Flat constants for now; a real per-org override table is
// Phase 8 "Enterprise Configuration" territory, not this phase. Flip
// either to `false` here (and redeploy) to instantly revert Layout.jsx
// to its pre-Phase-3 behavior if something's wrong post-launch, without
// touching the workspace_profiles data itself.
export const FEATURE_FLAGS = {
  adaptiveNavigation: true,
  adaptiveTerminology: true,
}

# ThingsAlive NeoX — Mobile (Employee)

A lightweight companion app to the [ThingsAlive NeoX](../README.md) ERP web app, scoped to the `employee` role's daily actions — not a full port of the web app. Bundle id: `com.thingsaliveneo`.

Connects to the **same Supabase project** as the web app — same accounts, same data, same tables (`org_announcements`, `project_tasks`, `time_logs`, etc.).

## Screens

- **Home** — company announcements, new joinees, recent award winners (reads the same `org_announcements` / `list_recent_award_winners` backend built for the web app's Company Home page).
- **Tasks** — the signed-in user's open `project_tasks`, with a status-change sheet.
- **Check-in** — start/stop a work session against a project (writes `time_logs`, same table `CheckInWidget` uses on web). Simplified vs. the web widget: no per-task check-in/status-update linking (`checkin_tasks`) in this v1.
- **Profile** — account details + sign out.

Not built yet (deliberately out of scope for this pass): Expenses/Travel request submission, Approvals inbox, push notifications, chat.

## Setup

```bash
npm install
```

Copy Supabase credentials into `.env` (already present in this checkout, gitignored — same values as the web app's `.env`):

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Run

```bash
npx expo start        # then press `a` (Android), `i` (iOS), or `w` (web) — or scan the QR with Expo Go
npm run android
npm run ios            # macOS only
```

## Stack

Expo SDK 57, Expo Router (file-based routing under `src/app`), TypeScript, `@supabase/supabase-js`. Design tokens in `src/constants/theme.ts` mirror the web app's `src/index.css` (`--c1: #6366f1` accent, same light-mode surface/border values) plus a matching dark theme. Fonts: Plus Jakarta Sans (body) + Playfair Display (headings), same pairing as the web app.

## Checks

```bash
npx tsc --noEmit       # typecheck
npx expo lint          # lint
npx expo export        # bundle smoke test (no device needed)
```

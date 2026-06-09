# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**ThingsAlive NeoX** — a React 18 + Vite + Supabase ERP application (package name: `procurepro`, v3.0.0). Manages expenses, procurement, HR, projects, tasks, timesheets, chat, and AI-powered requirement analysis for a single organisation.

## Commands

```bash
npm run dev       # start Vite dev server
npm run build     # production build → dist/
npm run preview   # preview the production build
```

There are no lint or test scripts. The build (`npm run build`) is the primary correctness check — run it after significant changes to verify no JSX/import errors.

## Environment Variables

Vite only loads `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`. The file `prod.env` is **not** loaded automatically and is kept only as a reference for the production Supabase project.

Required keys in `.env`:
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_DEEPSEEK_API_KEY      # DeepSeek V3 for Neo Task AI
VITE_GEMINI_API_KEY        # Gemini 2.5 Pro for Neo Task AI
```

## Database

All schema changes are SQL files in `sql/` numbered by step (STEP20–STEP24b). Run them in the Supabase SQL Editor in order. After creating new tables always end the script with `NOTIFY pgrst, 'reload schema';` to clear the PostgREST schema cache (avoids PGRST205 errors).

**Important:** Use soft FK references (plain `UUID` columns) when referencing tables that may not exist yet (`user_stories`, `project_tasks`). Hard `REFERENCES` constraints silently abort the entire script if the target table has an unexpected structure.

When dropping and recreating tables with RLS policies, use `DROP TABLE IF EXISTS ... CASCADE` — do **not** use standalone `DROP POLICY IF EXISTS` statements before the table exists, as the `IF EXISTS` guard on `DROP POLICY` only covers the policy name, not the table.

## Architecture

### Routing & Auth (`src/App.jsx`)

All routes inside `<Layout>` are protected. Auth state comes from `useAuth()`. Route-level access is checked with role helpers:

```js
const isAdmin    = ['admin','ceo'].includes(role)
const isManager  = ['admin','ceo','manager','department_head'].includes(role)
const isFinance  = ['admin','ceo','finance'].includes(role)
const isHR       = ['admin','ceo','hr'].includes(role)
```

Unauthenticated users are redirected to `/auth`.

### Auth Context (`src/context/AuthContext.jsx`)

`useAuth()` returns `{ user, profile, loading, signIn, signUp, signOut, refreshProfile }`. Profile loading retries up to 7 times with exponential backoff (700ms × attempt) to handle Supabase eventual-consistency delays. The `profile` object includes a joined `dept` (department name/code).

### Tab Visibility (`src/context/TabVisibilityContext.jsx`)

Controls which sidebar tabs each role can see. `isTabVisible(tab)` is the gating function. Defaults live in `DEFAULT_TABS` keyed by role; overrides are persisted to localStorage. Every new page route must be registered here for the correct roles.

### Layout & Navigation (`src/components/layout/Layout.jsx`)

Single shell with collapsible sidebar (`ALL_NAV` array) and topbar. Records a `page_view` event to `app_events` on every route change using a module-level `SESSION_ID`. Navigation items support a `roles` filter array for role-gating individual links.

### Data Fetching Pattern

No React Query is used in practice. All data fetching is direct Supabase client calls inside `useEffect`:

```js
const { data, error } = await supabase.from('table').select('*').eq('field', value)
```

Real-time subscriptions use `supabase.channel(...).on('postgres_changes', ...).subscribe()`. Always unsubscribe in the `useEffect` cleanup. Store the channel in a `useRef` to avoid stale-closure issues in subscription callbacks.

### Utility Functions (`src/lib/supabase.js`)

Centralised helpers used across all pages:
- `rupee(n)` / `rupeeFull(n)` — INR formatting (en-IN locale)
- `dateFmt(d)` / `timeFmt(d)` — "DD MMM YYYY" / "DD MMM HH:mm"
- `nextNum(type)` — sequence numbers (EXP, TRV, PR, PO, INV, AST) via RPC with fallback

### Approval Flow (`src/lib/approvalFlow.js`)

Multi-step approval chains defined per submitter role. Status progression: `submitted → manager_review → ceo_review → finance_review → approved`. Chain definitions live in `CHAINS` keyed by role.

### Notification System

- `src/lib/notifications.js` — `sendNotif(recipientId, opts)`, `sendNotifToMany()`, `notifyManagers(opts)`
- `src/context/NotificationContext.jsx` — subscribes to realtime INSERT/UPDATE on `notifications` table; exposes `unreadCount`, `markRead`, `markAllRead`
- Bell icon turns yellow with glow when `unreadCount > 0`

### Neo Task AI (`src/pages/NeoTaskAIPage.jsx` + `src/lib/llm.js`)

AI-powered requirement analysis. Upload a document → AI generates stories, backlog, tasks, test cases, APIs, sprint plan.

`src/lib/llm.js` is the unified LLM service:
- `LLM_MODELS` registry — DeepSeek V3 (`deepseek-chat`) and Gemini 2.5 Pro (`gemini-2.5-pro`)
- `analyzeRequirements(sessionId, modelId)` — routes to `callDeepSeek()` or `callGemini()`
- Gemini uses the OpenAI-compatible endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` with model `gemini-2.5-pro` (not the dated preview slug)
- `parseJSON()` — 3-strategy robust parser (direct → code block → brace extraction)
- Results persisted to 6 tables: `ai_analysis_sessions`, `ai_generated_stories`, `ai_generated_backlog`, `ai_generated_tasks`, `ai_generated_test_cases`, `ai_generated_apis`

### UI Components (`src/components/ui/index.jsx`)

Shared primitives: `Loader`, `Modal`, `Badge`, `StatusBadge`, `StatCard`, `Alert`, `Confirm`, `SearchBox`, `Empty`, `ApprovalChain`. Import from `'../components/ui'`.

### Styling

Mixed inline styles (object notation) and Tailwind utility classes. Theming via CSS variables defined in `src/index.css`:
- Primary: `--c1: #6366f1`
- Layout: `--sidebar-w: 240px`, `--topbar-h: 60px`, `--radius: 14px`
- Typography: Playfair Display (headings) + Plus Jakarta Sans (body)

Icons come exclusively from `lucide-react`, imported by name.

### Roles

`admin`, `ceo`, `manager`, `department_head`, `finance`, `hr`, `employee`. Role is stored on the `profiles` table and loaded into `profile.role` via `useAuth()`.

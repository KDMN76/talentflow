# TalentFlow Web — Build Status

## Status: Complete

All files built, `npx tsc --noEmit` passes with zero errors.

---

## What was built

### Config files
- `package.json` — all dependencies incl. @dnd-kit, @tanstack/react-query v5, shadcn/ui primitives
- `tsconfig.json` — strict TypeScript
- `tailwind.config.ts` — Indigo primary, shadcn CSS variables, tailwindcss-animate
- `next.config.ts` — Next.js 14 App Router
- `postcss.config.js`
- `components.json` — shadcn/ui config
- `.env.local` — `NEXT_PUBLIC_USE_MOCK_DATA=true` (enabled for dev without API)
- `.env.local.example`

### App screens
| Route | Description |
|---|---|
| `/login` | Centered card, gradient bg, form validation |
| `/register` | Company + user registration form |
| `/dashboard` | Stats cards (4) + activity feed + open jobs |
| `/candidates` | Grid/list toggle, debounced search, source filter chips |
| `/candidates/[id]` | Two-column profile: details + applications timeline |
| `/jobs` | Status tab filter, job cards with hover actions |
| `/jobs/new` | Job creation form |
| `/jobs/[id]` | Job detail + stats |
| `/jobs/[id]/pipeline` | **Kanban drag-and-drop** with optimistic updates |
| `/settings` | Tabs: Algemeen / Gebruikers / Beveiliging |

### Component library (shadcn/ui, written manually)
`components/ui/`: button, input, label, card, badge, avatar, separator, dialog, select, tabs, dropdown-menu, toast, toaster, use-toast, form, skeleton, tooltip

### Layout components
- `Sidebar.tsx` — active state, user avatar, logout
- `Header.tsx` — search bar, notification bell
- `PageHeader.tsx` — title + description + actions slot

### Feature components
- `CandidateCard.tsx`, `CandidateForm.tsx`, `ResumeUpload.tsx`
- `JobCard.tsx`, `JobForm.tsx`
- `KanbanBoard.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx` (dnd-kit)
- `StatsCard.tsx`

### Hooks
- `useCandidates.ts` — list, single, create, update
- `useJobs.ts` — list, single, create, update
- `usePipeline.ts` — stages, applications, move (with optimistic update)

### Lib
- `api.ts` — axios instance, request interceptor (Bearer token), 401 refresh flow
- `auth.ts` — token in memory + sessionStorage
- `queryClient.ts` — React Query client
- `utils.ts` — cn(), formatDate, formatRelativeDate, getInitials, getScoreColor
- `mockData.ts` — 5 candidates, 3 jobs, pipeline stages/applications, dashboard stats

---

## Mock data included

- **5 kandidaten**: Sophie van den Berg (score 92), Thomas Janssen (74), Aisha El Hamdouchi (88), Lars Visser (61), Maya Okonkwo (85)
- **3 vacatures**: Senior Frontend Developer (open), Product Manager (open), Backend Engineer Python (draft)
- **Pipeline stages** voor job-1 (5 fasen) en job-2 (4 fasen)
- **6 sollicitaties** verdeeld over beide jobs
- **Dashboard stats** + activity feed (5 items)

---

## How to start

```bash
cd apps/web

# Mock mode (no API needed):
npm run dev
# → open http://localhost:3000
# → login met elk e-mail/wachtwoord

# With real API:
# Edit .env.local → NEXT_PUBLIC_USE_MOCK_DATA=false
npm run dev
```

The login page accepts any credentials in mock mode.

---

## Design highlights
- Indigo/purple gradient primary color throughout
- Clean white cards, subtle shadows, rounded-xl
- Sidebar with active state indicators
- Kanban board with drag-and-drop (optimistic updates)
- Grid/list toggle on candidates page
- Fully responsive (sidebar collapses to mobile overlay)
- Dark mode ready (CSS variables set for both themes)

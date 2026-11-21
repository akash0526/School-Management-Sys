# School Portal — Frontend

React 19 + Vite + TypeScript + Tailwind CSS 4. One app for everyone: office/admin, teachers, accountants, parents and students.
**The menu and pages adapt to each user's permissions** (from `GET /auth/me`). The API enforces the same rules, so the UI only hides what you can't use anyway.

## Run

```bash
cd ~/school_backend && npm start                         # API on :4000
cd ~/school_frontend && npm install && npm run dev       # UI on :5173
```

The dev server proxies `/api/*` to `http://localhost:4000` (override with `API_TARGET=...`).
The browser only ever calls relative `/api/v1/...` URLs.

**The UI's origin must be in the API's `CORS_ORIGINS`.** `POST /auth/refresh` and `/auth/logout` reject other origins (CSRF guard).

Want something to click through? Load the demo school in the backend (`npm run db:demo -- --yes`, see the backend README).
The sign-in page then shows one-click buttons for every demo role. A real school's DB never shows them.

## First-time setup for a new school

After `npm run db:reset` in the backend, sign in as the super admin. The dashboard shows a **Set up your school** checklist that ticks itself off:

1. **School settings** → name (English + Nepali), address, phone, PAN, logo. These appear on the sign-in page, the sidebar, the browser tab, fee receipts and report cards.
2. **Academic setup** → sections for each class (and streams for Grade 11–12).
3. **Academic setup** → subjects for each class (mark electives as optional, with a group such as "Elective").
4. **Staff** → add teachers and give them a login with roles.
5. **Students** → admit and enroll. Pick optional subjects on the student's **Enrollment** tab.
6. **Fees** → fee structure, then generate invoices per BS month.

The checklist disappears once all six are done.

## Production

`npm run build` writes static files to `dist/`. Serve them from the same domain as the API, for example with nginx:

```nginx
location /api/ { proxy_pass http://127.0.0.1:4000; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; client_max_body_size 1m; }
location /assets/ { root /var/www/school/dist; expires 1y; add_header Cache-Control "public, immutable"; }
location /     { root /var/www/school/dist; try_files $uri /index.html; add_header Cache-Control "no-cache"; }
```

Same-origin is what makes the refresh cookie work: it is httpOnly, `SameSite=Strict`, and scoped to `path=/api/v1/auth`.
`index.html` must not be cached. If it is, then after a deploy the old page requests JS files that no longer exist. The app catches that case and shows "A new version is available — Reload" instead of a blank screen.

## How auth works

| | |
|---|---|
| Access token | kept **in memory only**, never in localStorage |
| Refresh token | httpOnly cookie set by the API; `src/lib/api.ts` calls `/auth/refresh` on a 401 and retries once |
| Several tabs | refreshes are serialised across tabs with the **Web Locks API**. Without that, two tabs refreshing at once would trip the API's token-theft detection and log everyone out. Sign-in, sign-out and password changes are broadcast to other tabs (`BroadcastChannel('sms-auth')`) |
| Page reload | the session is restored from the cookie. `localStorage['sms.hadSession']` is only a hint that skips the refresh call for first-time visitors; it holds no secret |
| Temporary password | `mustChangePassword` → full-screen "Set a new password" gate |

## What's in it

| Area | Who sees it (any of these permissions) | Pages |
|---|---|---|
| Dashboard | everyone | greeting, setup checklist (admins), students/staff, **outstanding dues and today's collection** (`/fees/summary`), quick actions, "My classes" for teachers, calendar |
| Portal | parents and students (`/students/mine`) | per child: overview, attendance, results with report cards, fees and statement |
| Students | `students.view` | search and filter, admission form, profile, guardians (add, **edit**, parent login — hidden when one exists), enrollment with **optional-subject choice**, status change, student login |
| Parents & guardians | `students.view` | directory searchable by name or phone, children linked to their profiles, tap-to-call, edit contact details, create parent logins (`students.manage`) |
| Staff | `staff.view` | list, add/edit, departments, create login with roles |
| Academic setup | `academic.manage` | years and terms, sections, class subjects, teacher assignments, subjects, calendar |
| Enrollment | `enrollment.manage` | per-section roster, enroll, roll numbers, bulk promote/repeat |
| Attendance | `attendance.mark` / `mark_any` / `view` | P/A/L/Lv/H roster (teachers see only their sections), staff attendance |
| Exams | `exams.manage`, `marks.*`, `results.view` | create and **edit** exams, papers with NEB components, keyboard-friendly marks entry, verify, process (with a force prompt), publish, ranked results, printable report card with the school letterhead |
| Fees | `fees.view` / `manage` | invoices, bulk generation per BS month, fee structure, discounts |
| Collect payment | `fees.collect` | student search → open invoices → FIFO or manual allocation → printable receipt with letterhead and PAN (amount in words, lakh/crore) |
| Users & roles | `users.manage` | users, roles (only grantable roles are selectable), temporary-password reset, permission matrix, security log |
| School settings | `settings.manage` | profile form and logo upload (PNG/JPEG/WebP ≤ 300 KB, checked in the browser before upload) |
| My account | everyone | sign-in details and roles, own staff record (staff), change password |

**Branding** comes from the database (`school_profile`), never from the build. `useBranding()` reads the public `GET /school/branding` (sign-in page, sidebar, tab title, favicon). `useSchoolProfile()` adds address, phone and PAN for printouts. Until a profile is saved, the app calls itself "School Portal".

**Errors.** Every page sits inside an error boundary keyed by URL. A crash shows a "Something went wrong on this page" card ("your data is safe") with Reload and a way back to the dashboard. Moving to another page clears it. A second, full-page boundary wraps the whole app.

**Phone.** All screens work at 390 px: the sidebar becomes a drawer, wide tables scroll inside their card, and tabs scroll sideways.

## Checks

```bash
npm run typecheck     # tsc -b (also checks tests/)
npm test              # 42 unit tests: date/money formatting + the API wrapper
npm run lint          # oxlint (0 errors; 10 warnings: "copy server rows into an editable grid" effects — intentional)
npm run build
npm run test:e2e      # needs API + dev server + DEMO database
```

`tests/unit/` covers the two places where a quiet mistake reaches a parent: `format.ts`
(a date rendered with `toISOString()` is the UTC date, which is yesterday in Nepal until
05:45) and `api.ts` (the 401 → refresh → retry path, which must not log a user out when
they were fine, and must not retry in a loop when they are not).

`tests/e2e/ui.mjs` (Playwright) signs in as admin, teacher, accountant, parent and student, then at phone size as admin and parent. It opens every screen each role can use, including the edit-guardian and edit-exam modals and the optional-subjects card. It **fails** on any JavaScript error, any failed API call or a visible error boundary. It also checks that forbidden pages stay forbidden and that no page is wider than a phone. Screenshots land in `screenshots/`. Use `BASE=https://… npm run test:e2e` to point it at another server.

## Structure

```
src/
  lib/        api.ts (fetch, refresh, Web Locks), auth.ts + AuthProvider.tsx (session, can(), cross-tab sync),
              school.ts (branding/profile), hooks.ts (lookups, useYearPicker, useMyStaff), types.ts, format.ts
  components/ ui.tsx (buttons, forms, modal, tabs, toasts…), ui-utils.ts, Layout.tsx (permission-driven sidebar),
              ErrorBoundary.tsx, SchoolLogo.tsx, SchoolLetterhead.tsx, AccountModal.tsx, StudentPicker.tsx
  pages/      one folder per area; each page is lazy-loaded (initial JS ≈ 100 KB gzip)
tests/unit/   format.test.ts, api.test.ts — pure logic, no browser (npm test)
tests/e2e/    ui.mjs — browser smoke test for every role
```

## Known limits / next steps

- Dates are entered and shown in **AD** (as the API stores them). Fee periods already use BS month names ("2083-Mangsir"). A BS date picker is the obvious next step.
- English only. All strings are inline and ready to extract for a Nepali translation.
- The API has no edit/delete yet for subjects, fee types, fee structures, exam papers or rooms, and no report-card remarks.
- No pages yet for the modules the backend doesn't expose (library, transport, payroll, timetable, homework, online eSewa/Khalti checkout).

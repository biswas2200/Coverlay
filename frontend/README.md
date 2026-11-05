# Frontend

Static web client for resume upload and the results dashboard: parsed profile, ATS score and
checks, role matches with skill gaps, JD match and feedback. It is built from **HTML, one
hand-written stylesheet and vanilla JavaScript** (native ES modules), with no framework, no
bundler and no build step. The files in `src/` are exactly what the browser runs, so DevTools
shows your own code, line for line.

The look is a calm dashboard: a soft grey canvas, white cards, a sidebar with the account, the
navigation and the resume versions, a monospace face for field labels and numbers, and small
tinted badges. It follows the system light or dark theme. The fonts are Plus Jakarta Sans and
JetBrains Mono from Google Fonts; the icons are drawn for the project (`components/icons.js`).
The layout was inspired by the public Dribbble shot "MyCV – CV Analyzer AI Dashboard" by Sina
Pasha; no assets were copied from it.

Every screen calls the real backend (`backend/`) directly.

## Running it

The pages need to be served over HTTP, because browsers refuse to load ES modules from
`file://`. Any static server works; Python is already part of this repo's toolchain:

```bash
cd frontend
python3 -m http.server 4200 --directory src     # or: npm start (same command)
```

Open `http://localhost:4200/`. The app expects the backend at `http://localhost:8080`, which is
set in `src/js/config.js`. The backend only accepts browser calls from the origins in
`app.cors.allowed-origins` (default `http://localhost:4200`). If you serve the pages from a
different port (VS Code Live Server, for example, uses 5500), add that origin to
`CORS_ALLOWED_ORIGINS`.

In Docker Compose, the `frontend` service is plain nginx serving `src/` on port 4200
(`Dockerfile`, `nginx.conf`).

### The clickable preview (no backend)

To review every screen before anything is built, run the preview server. It serves `src/`,
answers the API with sample data (`preview/mock-answers.js`) and opens on a hub page that signs
in a preview admin and links every screen:

```bash
cd frontend
npm run preview          # http://localhost:4300 ; PORT=4400 npm run preview for another port
```

Pages marked **Preview** in the sidebar are prototypes with sample data: they keep their state
in the browser only and call neither the backend nor an AI. "Reset all preview data" on the hub
clears it.

**Hosted copy.** `npm run preview:hosted` writes `preview/dist/`, a static copy that needs no
server: `js/config.js` there answers the API in the page from `preview/mock-answers.js` (the same
answers the Node preview sends), the hub is the main page, the landing page becomes `home.html`,
and every page gets an "All screens" link back to the hub. It is published as a private
claude.ai artifact so the preview opens any time, on a phone too. Download PDF works only in the
local preview, because the artifact can't open the print dialog.

## Pages

| Page | What it shows |
|---|---|
| `index.html` | Public landing page: what the app does, features, and what every account gets (one plan, no tiers). |
| `login.html`, `register.html` | Sign in and create an account. A new account goes straight to the analyzer. |
| `upload.html` | **Resume analyzer.** Left: the resume as we read it (or the original PDF, for a file chosen in this browser) and the file card for uploading a new version. Right: the parsing result (name, email, phone, skills, experience, education) for the version picked in the version menu. `?resume=<id>` opens a given version. |
| `dashboard.html` | **Dashboard**, in three tabs driven by the hash. `#overview`: ATS score and band, detected field, best match, every ATS check with its points and how to fix it, the suggestions (written by AI) and up to three next steps. `#matches`: ranked roles with the skills you have and the ones to add, a "New" badge for roles not shown before, and helpful/not-helpful feedback; a locked card takes their place when the AI engine could not run for this analysis. `#jd`: the job-description match. |
| `resume-builder.html` | **Resume Builder (preview, sample data).** Start questions, then three templates suggested from the answers (Classic is the LaTeX look in CMU Serif, PDF only; the font is in `src/fonts/cmu-serif/`, OFL), then the editor: the resume on the left, edited by clicking and typing (every committed change becomes a version). A toolbar sets the font, size, bold, italic, underline, links, bullets, spacing, header alignment and the writing style Lay AI uses; formatting is kept as a tiny HTML subset that is never assigned as HTML. The Lay AI cursor follows your typing ("watching", with one tip) and moves to what Lay AI changes. "Make it fit a DevOps role" (or "create me a resume for devops") answers with suggestions to Add or Skip one by one, with each skill's share of that role's postings (sample data), never a rewritten resume. What you type in the chat passes the personal-data guard (`pages/privacy-guard-rules.js`): a lock chip says what stays private, and "What we store" shows the placeholder text and what it becomes after deletion. The floating **Lay AI** button opens a right-side panel with **Chat** (canned sample replies, no AI call yet: add or remove skills, shorten or rewrite the summary; what changed turns green) and **Versions** (View, Restore; a restore is added as a new version). A "Lay AI" pointer follows the caret as animation only. Done shows the finished resume with Download PDF (the browser's print to PDF). State is kept in this browser only. Design: `../design/resume-builder/`; rules in `pages/resume-builder-rules.js`. On a phone the panel is a bottom sheet. "Start from my LinkedIn profile" (also `resume-builder.html#linkedin`, linked from the sign-up preview) explains LinkedIn's Save to PDF, takes the file (the preview shows its name and uses a sample profile), lists "What we found" with checkboxes, and imports it as a version ("Imported from LinkedIn"). We never scrape LinkedIn; its profile API is for approved partners only. Rules in `pages/linkedin-import-rules.js`. |
| `lay-assistant.html` | **Lay AI on the phone (preview).** A phone-sized chat: "What's the status for AI engineer intern?" reads the Applications board ("Boss, your application is still pending…"); "Find new ones" shows sample roles from job boards Coverlay may read, plus LinkedIn and Naukri links to look yourself; Prepare shows the price first (43 credits), then spends it from the Wallet and adds the application to Preparing; the user presses Apply on the company's own page; "I applied" tracks the portal's application id. "3 days later" shows the one reminder for a prepared application that wasn't sent. Rules in `pages/lay-assistant-rules.js`. |
| `search.html` | **Search companies (preview).** Suggestions as you type, in three groups: popular searches (only those 20 or more people made in 30 days; the smaller ones are counted as hidden), topics from community posts, and your own last 50 searches (Clear). Search lists sample companies with a Watch toggle; close spellings ("swigy") still match, the way PostgreSQL's `pg_trgm` does. "What we store" shows the analytics record (no emails, phone numbers or links; nothing without consent). Rules in `pages/search-rules.js`. |
| `letters.html` | **Letters & emails (preview).** Cover letters (standard, career change, fresher) and cold emails (referral ask, hiring manager, follow-up) drafted from the Builder resume and a chosen job. The draft is built with placeholders such as `{user.name}` and `{other.person_1}` (what Gemini would get) and filled in on screen; "What Gemini sees" shows it. Paragraphs are editable, and an edit goes back through the personal-data guard. Lay AI suggestions add one sentence each, only from facts in the resume. Rules in `pages/letters-rules.js`. |
| `applications.html` | **Applications (preview).** A board: Preparing, Applied, Interview, Offer, Rejected. Each status brings one reminder (apply within 3 days, follow up after a week, prepare for the interview); "Did you hear back?" appears a week after applying, and the outcome record it feeds is shown (no names). Rules in `pages/applications-rules.js`. |
| `community.html` | **Community (preview).** Anonymous posts under this month's mask (a random handle), filtered by topic. Before a post goes up, the guard checks it for the writer's name, college, company and contacts and offers a safe version ("my college"). Points (5 a post) move to the wallet. Rules in `pages/community-rules.js`. |
| `wallet.html` | **Wallet (preview).** Credits (1 credit = ₹0.10), recharge from ₹60 to ₹2,000, the price of every AI action, what one full journey costs (282 credits), a low-balance warning, and the history. Rules in `pages/wallet-rules.js`. |
| `settings.html` | **Settings & privacy (preview).** Phone change with a code, consents (opt-in in the EU and UK, on elsewhere), export, and Delete my account: in 14 days (undo) or now, optionally with community posts. The deletion runs as steps that are retried until done (one fails once on purpose), says "Deleted" only at the end, and shows the tombstone that remains. Rules in `pages/settings-rules.js`. |
| `admin-insights.html` | **Team insights (admin, preview).** KPI tiles, the sign-up-to-interview funnel, what people ask Lay AI, templates by role, interview rate by experience and role (cells under 20 people hidden), where ₹100 of credits goes, AI cost by feature, spend by experience, and health. Every chart has a table view and a hover/focus tooltip. Rules in `pages/team-insights-rules.js`. |
| `signup-preview.html` | **Sign-up (preview).** The planned sign-up: email and password, phone with a code (one account per number), 18+, terms and the analytics choice by region; `deleting@example.com` shows the "being deleted: restore or start fresh" case. `register.html` is unchanged. Rules in `pages/signup-rules.js`. |
| `jobs.html` | **Jobs for you.** Open jobs in Bengaluru from each company's own careers feed, ranked for the latest resume: match percent and band, why it ranks there, the skills you have and the ones to add, and Apply / View posting links to the company's site. Search (title or company) and a workplace filter. Without a resume the jobs show newest first with an upload prompt. Save keeps a job for tracking. Credits the Bangalore Startup Map for part of the company list. |
| `saved.html` | **Saved jobs**, grouped by where each application stands: Saved, Applied, Interviewing, Offer, Not selected. A status menu moves a job between groups; Remove drops it; a job the company closed stays, marked as closed. |
| `admin-bugs.html` | **Bug reports (admin).** The review queue by status (waiting, on GitHub, linked, rejected). Each report shows its three sections, page and browser; Approve opens a GitHub issue with an editable suggested title, Link points it at an existing issue, Reject keeps it private. The sidebar shows this page to admins only; the backend enforces it. |
| *(every signed-in page)* | **Report a bug** in the sidebar opens a dialog (`components/bug-report.js`): an AI-tools disclaimer, three short sections with counters (1,500 characters each), and a required "I wrote this myself" tick. Below it, "Your reports" lists earlier reports and where each stands. Rules in `pages/bug-report-rules.js`. |

## Layout

```
src/
  index.html  login.html  register.html  upload.html  dashboard.html  jobs.html  saved.html
  favicon.svg                  the logo mark
  css/app.css                  every style: colour tokens (light and dark), site, auth, app shell, cards
  js/
    config.js                  API_BASE_URL
    core/
      http.js                  every backend call goes through request(): JSON/FormData,
                               Bearer token, 204 → null, errors → ApiError, 401 → back to login
      session.js               JWT + user in localStorage; requireAuth() page guard
      api-error.js             ApiError, extractApiErrorMessage() for user-facing messages
      validation.js            form and file rules (mirror the backend's own checks)
      dom.js                   byId, el, show/hide, setText, cloneTemplate, setBusy, renderChips
      local-store.js           try/catch JSON localStorage for the small per-browser memories
    api/                       one module per backend controller
      auth-api.js  resume-api.js  recommendation-api.js  feedback-api.js  jobs-api.js
    components/
      shell.js                 the sidebar: account, navigation, resume versions, mobile drawer
      icons.js                 the SVG icon sprite and icon()
      signed-in.js             "already signed in" panel on the sign-in pages
    pages/
      landing.js  login.js  register.js  upload.js  dashboard.js  jobs.js  saved.js
      resume-builder.js        one script per HTML page
      dashboard-rules.js       lock and JD decisions (pure, unit-tested)
      jobs-rules.js            jobs request, match band, location, workplace, job-type and
                               posted labels, safe links for feed URLs, saved-job grouping
                               (pure, unit-tested)
      insights.js              ATS check wording, fixes and points, score band, next steps,
                               new matches, score change (pure, unit-tested)
      resume-builder-rules.js  Resume Builder preview: sample resume, edits by path, version
                               history and restore, template suggestions, sample Lay AI
                               replies (pure, unit-tested)
tests/                         node --test suites for the pure modules
```

### How a page works

Each HTML file contains all of its markup up front, with the optional sections marked `hidden`.
The page's script (`<script type="module" src="js/pages/<page>.js">`) then:

1. calls `requireAuth()` on protected pages, which sends a signed-out visitor to `login.html`;
2. calls `renderShell(active)` on the app pages to build the sidebar;
3. fetches data through the `api/` modules;
4. fills the markup in and shows or hides sections.

Repeated items, such as role cards and ATS checks, are cloned from `<template>` elements in the
HTML.

**Security rule:** anything that comes from the backend (resume text, skills, the AI
suggestions) is written with `textContent`, never `innerHTML`. A resume that contains
`<script>` is shown as text, not run.

### ATS checks

`insights.js` holds a readable name, the points and a "how to fix" line for each check the ML
service runs (`ml-service/app/services/ats_score.py`). Keep its weights in step with
`BASE_CHECK_WEIGHTS` and `KEYWORD_WEIGHT` there. A check the frontend doesn't know is still
shown, with its name tidied up and no points.

## Debugging

- **Network tab.** Every API call is a `fetch` issued from `core/http.js`. Filter by
  `localhost:8080` to see the request, its `Authorization` header and the backend's JSON
  error body (`{ message, fieldErrors }`).
- **Sources tab.** Open `js/pages/<page>.js` and set a breakpoint. There is no transpilation,
  so you don't need source maps.
- **Session.** Go to Application → Local Storage → `http://localhost:4200`. The keys are
  `resumeAnalyser.auth.token` and `resumeAnalyser.auth.user`. Delete them to sign out. After
  an admin changes an account's role, reload any app page: the sidebar re-reads `GET /auth/me`.
- **Per-browser memories.** `resumeAnalyser.seenRoles.<userId>` (roles already shown, so new
  ones get a "New" badge) and `resumeAnalyser.lastAts.<userId>` (the "Up 7 points since your
  previous version" line). Losing them only loses that polish.
- **Wrong element?** `byId()` throws `No element with id "…"` when the HTML and the script
  disagree on an id, so a typo shows up in the Console straight away.
- **Stale page after an edit?** Hard-reload (Ctrl+Shift+R). `python3 -m http.server` lets the
  browser cache files.

## Tests

The pure logic has unit tests: validation, error messages, the `http.js` request/401 handling,
the dashboard's lock and unlock rules, and the insights (check fixes and points, score band,
next steps, new matches, score change). They run on Node's built-in test runner (Node 21 or
later), with no `npm install` needed:

```bash
cd frontend
npm test            # = node --test "tests/*.test.js"
```

`package.json` only exists to mark the `.js` files as ES modules for Node and to name these two
scripts. It has no dependencies.

DOM rendering is checked by hand in the browser. The flows to walk through are register/login,
upload, the dashboard unlocked and locked, JD match and feedback, each in light and
dark mode and at phone width.

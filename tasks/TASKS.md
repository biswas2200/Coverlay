# Task list

Last updated 2026-10-22. Project tracker: the Google Sheet "Smart Resume Analyzer - Project Tracker". Work is on branch `job-recommendations` (from master 5f2d737; PR #6 merged `frontend-vanilla-and-ner-v1`),
not pushed yet.

## Done

### App

- [x] Frontend rewritten in HTML, Bootstrap 5 and vanilla JS: multi-page, no build step, 24 `node --test` tests
- [x] Backend: tier allowances, domain-aware analysis, JD match
- [x] ML service: domain routing; NER v1 (`yashpwr/resume-ner-bert`) and MiniLM pinned to exact revisions; engine 0.4.0
- [x] Parser fixes: name line, education institutions, chunking that keeps newlines, confidence threshold measured (0.0)
- [x] General skill taxonomy cleaned: 1,185 skills down to 1,155, all 260 roles kept
- [x] Docs: new frontend, cloud tiers, NER v1 baseline; v2 history removed; Gemini-only design compared and rejected

### Data and labelling

- [x] Baselines: NER v1 scores 60 % macro F1 on DataTurks held-out, 64 % on 20 unseen LiveCareer resumes
- [x] Data prep (`ml-service/training/data_prep`): DataTurks repair, LiveCareer HTML to text, BIO, validation
- [x] Gemini labeller with a spending cap, placeholder filter, graduation-year rules, retry on 429 and 5xx
- [x] Labelling model chosen: `gemini-3.5-flash-lite` with prompt v3 (97 % on the tuning set, at least 93 % recall on the independent set)
- [x] 10-resume sample on the pool: $0.0345 actual against $0.0559 assumed
- [x] Docs name `gemini-3.5-flash-lite` as the labeller
- [x] Pre-flight checklist and check script: `ml-service/training/PREFLIGHT.md`, `training/gcp/preflight.sh`

## Now: data work on GCP (nothing heavy on the laptop)

- [x] Budget alert (₹2,200 a month, about $25: the billing account is in INR), APIs, private bucket (pre-flight `setup`)
- [x] Upload `datasets/` to the bucket: 7.06 GB in 67 s, 849 Mbit/s measured (pre-flight `data`)
- [x] Service account `data-prep` (Vertex AI user + this bucket only) and VM `data-prep-vm` (pre-flight `vm`)
- [x] Clean and prepare the resume data on the VM: all 6 output files byte-identical to the laptop build (pre-flight `label`)
- [x] VM sample of 5: $0.0031 per resume, 0 of 273 answers not found in the text
- [x] Label the pool on the VM: all 2,461 done 16:07 IST, $7.18 (estimate $13.67), 0.21 % answers not in text, no restarts
- [x] Report by email with the laptop off: Cloud Monitoring alert to Gmail (channel verified, test email received 14:33), `report_on_finish.sh` waiting on the VM, plus a backstop email when the VM stops
- [x] After-run checks passed; spot-checked; results in LABELLING.md; report email and VM-stopped email both arrived; VM is off
- [x] VM `data-prep-vm` and its disk deleted 2026-10-09 (results all in the bucket; recreate with gcp-setup.md §3 when needed, no creation fee)

## Next: training

- [x] Skills decision: one span per skill everywhere; DataTurks train/dev keep human labels except skills, which Gemini re-labels (~$0.30)
- [x] Step 2 code: `training/data_prep/training_set.py` (merge, filter non-year graduation years, 5 % pool dev, test untouched), 7 tests
- [x] Step 3 code: `training/train_ner.py` (plain PyTorch loop: finetune, distill, k-fold), `evaluate_model.py` (app-parser field scoring, same harness as the baselines); smoke-tested on tiny data
- [x] Label-quality classifier: `training/label_quality.py` (confident learning; ≤ 3 rounds, ≤ 5 %/round, ≤ 15 % total, stop when dev F1 stops improving; review.md for a person), 8 tests
- [x] Conversation history: `supporting-docs/conversation-history.md`, rebuilt by a Stop hook after every reply (`.claude/hooks/export_history.py`, git-ignored)
- [x] GPU quota raised to 1; T4/L4 out of stock in Mumbai, L4 VM `train-gpu-vm` in asia-southeast1-b (now STOPPED, disk kept)
- [x] Track A run: gate 0 reproduced 60 %; teacher, 1 kept label-quality round (round 2 stopped by the rule), student distilled. Results in ml-service/training/RESULTS.md: unseen LiveCareer 63 % -> 85 %, DataTurks 60 % -> 57 % (precision drop, recall similar). Gate NOT passed; app keeps its model
- [x] Parser fix: entity text taken from the resume at the model's offsets (engine 0.4.1); DataTurks baseline 60 % -> 64 %, trained models +5 points
- [x] By-eye check of DataTurks extra values -> corrected test key (308 values added, 21 removed; out of git). Corrected key: baseline 76 %, teacher 84 %, student 81 %; unseen LiveCareer 64 % -> 90 %. Gate passed, with the caveats in RESULTS.md run 2
- [x] Placeholder replacement for companies/locations (`teacher2`, `student2`): no clear gain (DataTurks 82 % / 81 %, LiveCareer 91 % / 91 %); run 1's models stay the candidates. VM stopped 2026-10-10, ~48 min, ~$0.72
- [ ] Optional: oversample DataTurks train, after hand-labelling a fresh test set (the current ones have now scored three rounds)
- [x] Fix `training/config.py` tokenizer mismatch: student is now `distilbert/distilbert-base-cased` (vocabulary byte-identical to the cased teacher), both pinned; tests guard it (8f4e0a2)
- [x] Record each training dataset's licence in `ml-service/training/DATASETS.md` (docs/datasets.md §6)
- [x] **Your decision:** licences. 2026-10-10: non-commercial project (engineering domain is free), so the trained models may ship; residual risks recorded in DATASETS.md
- [ ] GPU: upgrade the billing account if it is still a free trial; request T4 quota in asia-south1 (approval can take a day)
- [x] Fine-tune the NER model on GCP; compare it with the baselines on the same splits (runs 1 and 2, RESULTS.md)
- [x] Published the NER models on Hugging Face (2026-10-22, public, account biswas2200): `biswas2200/resume-ner-bert-careeros` (teacher) and `biswas2200/resume-ner-distilbert-careeros` (student), weights byte-identical to `models/ner/`. The app still loads the local folder
- [x] The ML service downloads the NER model from the GCS bucket at start-up when `models/ner/teacher-run1` is missing (`NER_MODEL_GCS_URI`, ADC, pinned SHA-256 checked before use), 2026-10-22, commit 2338550, merged to master in PR #6. 310 tests pass; a real download matched the local model
- [x] Run 1's teacher in the app (2026-10-20): loaded from `ml-service/models/ner/teacher-run1`, pinned by the SHA-256 of its weights, engine 0.5.0; the student is kept as the small option in `models/ner/student-run1`. `scripts/fetch_ner_models.sh` downloads both

## Frontend: dashboard redesign

- [x] Comic redesign (Kite, prototype, frontend/src), 10 to 14 Oct: dropped on 20 Oct, too confusing for users and the teacher. Removed, with the prototype (still in git history)
- [x] New dashboard design based on the Dribbble shot "MyCV - CV Analyzer AI Dashboard" (Sina Pasha): sidebar with versions, resume analyzer (preview + parsing result), dashboard tabs (overview with ATS fixes and next steps, role matches, Premium JD match), light/dark, phone layout. 39 tests. Commit 3c51f78, pushed 2026-10-20. Checked against a mock API only
- [x] Docs outside `frontend/` still say Bootstrap: root README, docs/tech-stack.md, architecture.md, hld.md, index.md, srs.md updated 2026-10-21, commit cf53229 pushed (SRS revision 2.10, FR-8.1 now names the JD match tab). backend/README.md needed no change: its only "bootstrap" is the first-admin setting

## Logging (2026-10-20)

- [x] Backend: request id per request (`X-Request-Id`, echoed, in every log line, passed to the ML service), access line per request, ML-service call lines, analysis outcome line, 500 trace id = request id; `LOG_LEVEL`, `LOG_FILE`
- [x] ML service: same request id on every line, access line, analysis outcome line, file-extraction line, model-load line; `LOG_LEVEL`, `LOG_FILE`; no resume content or file names logged

## Later

- [x] Clean the LinkedIn postings in BigQuery (gcp-setup.md §7): 1.35M → 1.08M postings, Parquet in `cleaned/linkedin/` (2026-10-10)
- [ ] Point `scripts/build_general_catalogue.py` at the cleaned postings and rebuild the catalogue (changes app data → engine version bump)
  - [x] Rebuilt on `catalogue-vm`, run `20261010T092747Z`; fetched 2026-10-14 to `ml-service/build/catalogue/20261010T092747Z/`, VM deleted. Raw-input check reproduced the current catalogue (only 2 skills differ in capitalisation). Cleaned input: 259 roles (21 in, 22 out), 1,111 skills
  - [ ] Review `cleaned/compare.md`, then copy into `app/data` and bump `engine_version`
- [x] `ml-service/.env`: add `GOOGLE_CLOUD_PROJECT`; drop the empty `GEMINI_API_KEY` line, since access is ADC only (checked 2026-10-14); `LLM_PROVIDER` set to `gemini` 2026-10-20 (the Groq key was empty)
- [x] Try the new frontend end to end against the running backend: register, upload, dashboard, feedback, JD match. Done 2026-10-21 on the real local stack (frontend on :4300, since :4200 was taken): every flow worked, no frontend bugs, no console errors
- [x] Fix what the end-to-end test found in the ML service (engine 0.5.1, commit 9cd4bc9 pushed 2026-10-21, 301 tests pass, checked in the app):
  - [x] `local_ner_parser._PHONE_RE` misses Indian "+91 98765 43210" (5+5 digits), so the profile says no phone while the ATS check passes
  - [x] Free template suggestions (`explainer.py`) show the raw check name "sufficient_length" and "match score 0.95"
  - [x] JD skill extraction counts "Hiring" and "Design" as skills and misses Kafka, Redis, GraphQL, FastAPI (JD-only boilerplate list; 17 tools added to `skill_taxonomy.json`; "Go" left out because it would match the word "go")
- [x] Commit the teacher swap and logging: 67a0f35 (2026-10-21, pushed)
- [x] Open a PR to `master`: PR #4 already merged; PR #5 opened 2026-10-21 for 9cd4bc9, 2260696, cf53229 (https://github.com/biswas2200/Smart-Resume-Analyzer-and-Job-Recommendation-System/pull/5), waiting for review

## 0.6: preview mode and job recommendations (planned 2026-10-21)

Plan: Canva deck "Coverlay Product Plan". All work so far is 0.x; beta must be production-ready.

- [x] Preview mode: `PREVIEW_MODE` (default true) gives every account Premium; `GET /tiers` (public) reports it; banner on app pages and landing; JD match guard moved into `ResumeService` (2026-10-21)
- [x] Decide sources (2026-10-22): Bangalore first; companies' public job feeds (Lever, Greenhouse, Ashby), Adzuna later, LinkedIn 2024 offline only; no scraping of job sites
- [x] Company finder: 322 Bengaluru companies from Wikidata, hiring-tool detection (guessed boards need a job in India), stored in `companies` (2026-10-22, not committed)
- [x] Job feed readers (Lever, Greenhouse, Ashby) behind one `JobFeed` interface; Bengaluru filter; daily refresh at 06:30 IST; admin endpoints; `GET /jobs`. First run: 6 companies, 150 jobs. 98 backend tests pass
- [ ] On GCP: Cloud Scheduler call to `POST /{admin-path}/jobs/refresh` (Cloud Run may stop an idle instance)
- [ ] Coverage: only 6 of 322 companies matched; startup map list, watchlist adds, Adzuna
- [x] Startup map import (public pages only, 1 page/s): 1,085 pages, 33 companies with a feed in total, 489 open Bengaluru jobs (2026-10-22). Permission asked; credited in the app
- [x] Matching engine: ML `/extract-job-skills` (stored once per posting) + `/rank-jobs` (0.45 coverage + 0.30 similarity + 0.25 role fit), backend `GET /jobs/recommended`; saved jobs with status (`/jobs/{id}/saved`). 109 backend + 328 ML tests pass. Not committed
- [x] Jobs and Saved jobs pages: built by the "Front end completion status" session (frontend/ only), end-to-end check on the local stack in progress
- [x] Job-market demand into the EMA weights (SRS FR-7.6): daily, jobs grouped by catalogue role, skill shares as EMA signals, weights pushed to the ML service, `GET /jobs/in-demand`. First run: 489 jobs, 43 roles, 392 weights. Commit 1d60318 on `job-market-demand`, PR #9 open (2026-10-22)
- [ ] In-demand skills in the UI (frontend session)
- [ ] Coverage: read Keka (46 map companies), Freshteam (13), Workday (12) feeds
- [ ] Tune job skill extraction: generic words ("Production", "Communication", "Monitoring") show up as missing skills
- [ ] Basic watchlist (LA scope): watch a company, add a missing one (auto-detect its job tool), New badge on fresh jobs
- [ ] Mini project: email alerts, shared lists
- [ ] Ask the startup map creator for permission to use their company list
- [ ] Jobs page, job cards with match and missing skills, Apply links, Saved jobs (0.7)

## Guardrails (2026-10-22)

- [x] Hidden-text prompt-injection test: white 1-pt text added fake skills on both engines; it could not change scores, the name, or reach other users' data
- [x] PDF extractor leaves out white, tiny (< 3 pt) and off-page text (white on a dark filled shape stays); new 10-point ATS check `no_hidden_text`, base max now 90
- [x] Gemini extraction prompt wraps the resume in `<resume>` tags and declares it data; extracted skills not in the text are dropped
- [x] Profile field lengths capped under the DB column sizes (an overlong phone would have failed the backend's save)
- [x] Engine 0.5.2, SRS NFR-2.5 + revision 2.11, LLD table; 321 Python + 40 frontend tests pass. Commit 37091df, pushed 2026-10-22 (joins PR #5)
- [x] Preview banner text shortened to "Preview" (commit 19af65b, pushed)
- [ ] DOCX hidden text (white or "vanished" runs) is not detected yet
- [ ] Guardrails for the planned resume chat: user-scoped data enforced by the backend, no cross-user tools, resume as data, off-topic refusals, per-user rate limits

## Repository housekeeping (2026-10-22)

- [x] GitHub master has everything: PRs #1 to #6 all merged, none open
- [x] Local master fast-forwarded to GitHub (a493efd -> 5f2d737)
- [x] Deleted the 4 merged branches locally and on GitHub: backend-hardening-and-frontend-scaffold, backend/entities-auth-rbac-docs, backend/skillvector-and-rbac, full-stack-integration
- [ ] Local frontend-vanilla-and-ner-v1 (deleted on GitHub after PR #6) still holds another session's uncommitted jobs work (V5 migration, job/ package, application.yml): move it to a new branch from master when it is committed, then delete this branch

## Job recommendations (2026-10-22, with the "Project rename to Coverlay" session)

- [x] Split agreed: that session owns backend/ + ml-service/ (feeds, ranking, saved jobs API, V5/V6 migrations); this one owns frontend/
- [x] Frontend test-first: jobs-rules (match band, workplace/job-type/posted labels, safe feed links, saved grouping, empty states), jobs-api, HTTP put/del; 57 tests pass
- [x] jobs.html (Jobs for you) and saved.html (Saved jobs by application status), sidebar entries, Bangalore Startup Map credit
- [x] End to end on the real stack passed (489 jobs, 33 companies); commits 1aa28bd (backend/ML) and 744b0fc (frontend) on job-recommendations, not pushed
- [x] Push job-recommendations and open a PR to master: PR #7 (https://github.com/biswas2200/Smart-Resume-Analyzer-and-Job-Recommendation-System/pull/7), opened 2026-10-22, waiting for review
- [x] Job-skill extraction drops job-ad words (other session, d2ff580, in PR #7)
- [x] Search matches whole words (other session, d2ff580, in PR #7); PR description updated to mark both fixed
- [x] Job cards show one location (first with a city and region, else the first), full list as a tooltip: commit 17ca9df, pushed to PR #7
- [x] PR #7 merged 2026-10-22 10:07 IST with 1aa28bd + 744b0fc only; d2ff580 and 17ca9df were pushed after it merged
- [x] PR #8 opened for d2ff580 + 17ca9df (https://github.com/biswas2200/Smart-Resume-Analyzer-and-Job-Recommendation-System/pull/8)
- [ ] After PR #8 merges: delete job-recommendations locally and on GitHub (check it is fully in master first)
- [x] PR #8 merged 2026-10-22; all 4 jobs commits in master; job-recommendations deleted locally and on GitHub; local master fast-forwarded
- [x] Deleted the local frontend-vanilla-and-ner-v1 branch (fully in master)

## Job-market demand (other session)

- [x] PR #9 opened 2026-10-22 for job-market-demand (1d60318): job demand feeds the EMA skill weights; GET /jobs/in-demand (https://github.com/biswas2200/Smart-Resume-Analyzer-and-Job-Recommendation-System/pull/9)
- [ ] In-demand skills UI (Role matches cards / Jobs page): offered to this session, not started; waiting on the user
- [x] Report a bug (2026-10-24, branch `bug-reports`): dialog with AI disclaimer and 3 sections; reports held privately (V9 `bug_reports`); admin review page approves (GitHub issue), links or rejects. Needs `GITHUB_ISSUES_TOKEN` (fine-grained, Issues read/write) to approve

## Resume Builder prototype (F1), 6 to 7 Nov 2026

- [x] Real document editor: Tiptap core (MIT) with a resume-shaped document; Lay AI, versions and the tests kept (`frontend/src/vendor/tiptap.js`, tooling in `frontend/vendor-build/`)
- [x] Page setup: true A4/Letter page, zoom (fit width to 150%), four margins with rulers and a dialog (cm/in), text size in points, one or two columns, Sidebar and Executive templates
- [x] Custom sections with tables (borders none/rows/light/all), hide built-in sections, "How an ATS reads this", Fit to page (also by asking Lay AI; never deletes text; min 9.5 pt)
- [x] Sidebar: Report a bug and Sign out pinned at the bottom; resume versions out of the sidebar, a version menu in the top bar of the pages that use the resume
- [x] Resume Builder toolbar aligned (two rows, one control height); the page scrolls to what Lay AI edits
- [x] `docs/prototype-spec.md`: the mandatory contract for frontend, backend and ML service; the prototype is the source of truth (linked from README, docs index, CONTRIBUTING, mkdocs nav)
- [x] Commit all of it: branch `resume-builder-editor-and-prototype-spec`, commit cca2394 (57 files, 7 Nov 2026); `.claude/`, `tasks/` and the root logo images left out of git
- [x] Push the branch and open a PR to master: PR #21 (https://github.com/biswas2200/Coverlay/pull/21), ready for review, 7 Nov 2026
- [x] Later fixes committed on the same branch as 02e90a8 (text colour, tables with line width and style, toolbar, Sign out, resume font) and pushed, so PR #21 now includes them
- [x] Letters: cover letters a page long (250 to 400 words), PDF and DOCX; the cold email is no longer a PDF but is saved or sent from Gmail with the resume and cover letter attached (sample); real Word files for the resume and the letter; Resume Builder renamed Builder (7 Nov 2026; committed as 6fd67dd, not pushed yet)
- [x] Letters: the cover letter and the cold email are edited in place (toolbar, Subject box, start from the template again); edits kept per type, template and job after the guard; spec RB-LET-09 (7 Nov 2026; committed in 6fd67dd, not pushed yet)
- [x] 8 Nov 2026 (committed and pushed to PR #22 as 957214b): Team insights is a mock-up that is not part of the product (F11 Dropped, spec RB-PRE-01); Settings has a Connected apps card with the connector (MCP) rules in RB-CON; the wallet history folds repeats (RB-WAL-01)
- [ ] Owner: choose the Gmail scope (gmail.compose for drafts is restricted, needs Google verification and a security assessment; gmail.send is lighter but cannot save drafts)
- [x] PR #21 was merged into master (9f9f591) with cca2394 and 02e90a8; its branch was deleted, so the push of 6fd67dd re-created it
- [x] Opened PR #22 for 6fd67dd (Letters work), ready for review, 7 Nov 2026: https://github.com/biswas2200/Coverlay/pull/22
- [x] PR #22 title and description updated to cover both commits (8 Nov 2026); GitHub shows all 3 CI checks passed and "Ready to merge"
- [ ] Review and merge PR #22 (https://github.com/biswas2200/Coverlay/pull/22)
- [ ] Backend and ML service: build to the contract in section 9 of the spec, with contract tests from the prototype's fixtures

## Applications board (7 Nov 2026)

- [x] Drag a card onto another column to move it (same move as the menu and the button, which stay for keyboard and touch)
- [x] Lay AI on the Applications page: floating button and a docked chat (`components/lay-chat.js`, reusable); answers from the board; proposes moves, the person presses Move it; the card is brought into view
- [x] Spec section 6.3 (RB-APP) and 8 new tests (191 frontend tests)

## Community: every post anonymous (7 Nov 2026)

- [x] Owner's suggestion: no username under posts. Every post says "Anonymous"; the monthly mask is gone (no way to map a post to an account, or one post to another)
- [x] This device keeps a private tally of its own posts and points; "You" shows only on the writer's own screen; old saved previews convert
- [x] Spec section 6.4 (RB-COM), data model page step 10 and Features rows F3 and F5 updated
- [x] Republish the data model page (hosted claude.ai copy, version 3, 7 Nov 2026: step 10 now says every post is plain Anonymous)

## Lay AI everywhere, notes on cards (8 Nov 2026)

- [x] Lay AI on every signed-in page (`components/lay-chat.js` mounted by the shell; the Builder keeps its panel): a box for a pasted job description (Enter sends), the conversation kept on the device across pages, "New chat"
- [x] Lay AI's own work (`pages/lay-agent-rules.js`): reads "I learned X, add it to my resume" plus a job description; proposes the change and waits for a yes; adds only skills the person named; tailors Skills order and the Summary; match; cold email
- [x] Redirect: the first yes leaves a handoff and opens the Builder, which makes one new version (green, undoable) and offers the match; the email opens in Letters, ready to send; "Save as a Gmail draft" when Gmail is connected; no Lay AI button sends mail
- [x] A send refuses while the email has a blank (`[Company]`, `{user.link}`); a draft may keep one
- [x] Applications: small "+ Notes" on every card (private, 2,000 characters, kept as you type, not in the insights); "Where are my rejections?" answered from the board
- [x] Spec: RB-LAY-01 to 08, RB-APP-11 to 13, backend rows; 42 new tests (295 frontend tests)
- [ ] Owner to decide: a trust setting (suggest only / prepare drafts without asking) is not built; every action asks once

## Frontend moves to React + TypeScript (8 Nov 2026)

- [x] Installed the Vercel React best-practices skill (`npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices`) into `.agents/skills/`, linked for Claude Code
- [x] Stack decided: React 19, React Router 7, SWR, TypeScript, Vite 7; Tiptap for the editors; the stylesheet and the DOM-free rules modules are reused as they are (295 tests still pass)
- [x] New app in `frontend/app/`: shell and route guard, session store, typed API layer, storage hooks, Lay AI chat (own chunk), `npm run dev` with the sample API as a Vite plugin, `/preview` hub
- [x] Ported and checked in the browser: Landing, Login, Register, Dashboard (3 tabs), Upload, Jobs, Saved, Watchlist, Wallet, Settings, Community, Applications (drag and drop, + Notes), Letters (editor, Gmail panel, Lay AI handoff), Builder (Tiptap editor, rulers, fit to page, Lay AI panel and cursor, versions, page setup, ATS reading order, finished step), Admin bug reports; Team insights and Sign-up preview are preview-only (not in a production build)
- [x] Production build splits every screen into its own chunk (main bundle 99 kB gzipped; Builder 29 kB); nginx serves the single-page app and writes `/config.js`; Dockerfile builds in a Node stage; CI runs tests, typecheck and build; spec FE-04 to FE-07 and the README updated
- [ ] Owner reviews the React app, then: delete the older static pages (`frontend/src/*.html`, `src/js/pages/<page>.js`, `preview/`), move the shared rules and the stylesheet into `app/`, and drop `frontend/vendor-build`
- [ ] Component tests for the React screens (Vitest + Testing Library); today the rules are tested and the screens were checked by hand in the browser
- [ ] Hosted copy of the preview on claude.ai needs rebuilding from the React app (`npm run preview:hosted` was for the old pages)


## Admin console off /admin, admin security (11 Nov 2026)

- [x] Admin API moved off `/admin` to a secret path (`APP_ADMIN_PATH`, checked at start-up, random when unset); skill-vector recompute and snapshot moved under it too; nothing is mapped at `/admin`
- [x] Only an administrator is told the path (`adminPath` in sign-in and `GET /auth/me`); the React console takes its address from it (no `/admin` route, not in the bundle)
- [x] A signed-in non-admin gets the same 404 as an unknown address (`AdminGateFilter`); unknown addresses now answer 404 (were 500); admin endpoints hidden from Swagger
- [x] `admin.audit` log of every admin call and refusal; an administrator cannot change their own role
- [x] Spec RB-ADM-01 to 04 and FE-05; backend README "Admin API"; deploy `.env.example`, `setup.sh`, both compose files; 12 new backend tests, 4 new frontend tests (305)
- [ ] The existing beta VM's `deploy/.env` has no `APP_ADMIN_PATH`: add one (`openssl rand -hex 24`) before the next `setup.sh up`, or compose stops with "set in deploy/.env"
- [ ] Owner to decide: second sign-in step for administrators, shorter admin sessions, network limit on the admin path (RB-ADM-03)
- [ ] The older static admin page (`frontend/src/admin-bugs.html`) still exists at its file name until the static pages are deleted; its API calls use the secret path

## My activity: each person's own analytics (11 Nov 2026)
- [x] New `/activity` page (sidebar, Account): skills (total, chips, skills role matches ask for) and education from the latest resume or the Builder; applications sent, job postings opened, saved jobs (and how many applied), interviews and offers, board bars, last postings opened
- [x] Community: separate upvote (agree) and downvote (disagree) counts on posts and comments, one vote per device that can be taken back or switched, all counters increment-only (given and withdrawn); anonymous comments in branches (6 levels, collapsible) with the identity check, posts-viewed counting; all kept on the device only (RB-COM-04), shown as "This device only" on My activity
- [x] `activity-rules.js` + `activity-rules.test.js`, community tests extended (313 frontend tests, typecheck clean, clicked through in the browser)
- [x] Spec RB-COM-09 to 11, RB-ACT-01 to 04, RB-ADM-04, FE-05
- [ ] Real build: owner-only server table for job postings opened (RB-ACT-03); votes and comments through one-time passes (RB-COM-03) when the community backend is built

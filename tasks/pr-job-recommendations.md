Title: Add job recommendations: Bengaluru job feeds, ranking, Jobs and Saved jobs pages

## Summary

Job recommendations, built by two sessions working in parallel: one did the backend and ML service, the other did the frontend. The work was done test-first and checked end to end on the real local stack.

### Backend (1aa28bd)
- **Company list:** a new `job` module keeps a list of Bengaluru companies, from Wikidata and the Bangalore Startup Map's public pages.
- **Jobs:** it reads each company's open jobs from the company's own public Lever, Greenhouse or Ashby job feed, refreshed daily. Nothing is scraped from job boards.
- **Matching feeds to companies:** a feed guessed from a company's website or name must have at least one job in India. That keeps other companies' boards with the same name out.
- **Endpoints:** `GET /jobs/recommended` ranks open jobs for the user's latest resume. `PUT`/`DELETE /jobs/{id}/saved` save a job and track its application status. `GET /jobs/saved` lists saved jobs. There are also admin endpoints to run discovery, detection and the daily refresh.
- **Database:** migrations V5 and V6 add the `companies`, `job_postings` and `saved_jobs` tables.

### ML service (1aa28bd)
- `POST /extract-job-skills` extracts each posting's skills once, so they're reused for every user.
- `POST /rank-jobs` scores each job as 0.45 skill coverage + 0.30 similarity + 0.25 role fit. It's deterministic, uses no LLM, and returns the matched skills, missing skills and a reason.

### Frontend (744b0fc)
- **Jobs for you** (`jobs.html`): open jobs ranked for the latest resume. Each one shows a match percentage, why it ranks there, the skills you have and the ones to add, and Apply / View posting. The page has search, a workplace filter and a Save button. Without a resume, it shows the newest jobs with an upload prompt.
- **Saved jobs** (`saved.html`): saved jobs grouped by application status (Saved, Applied, Interviewing, Offer, Not selected). You can change a job's status or remove it, and a job the company has closed is marked as closed.
- **Shared parts:** the sidebar has new entries for both pages, and the HTTP client now supports PUT and DELETE.
- **Safety:** job-feed links are used only if they are plain `http(s)`, and all feed text is shown as text.
- **Credit:** the Jobs page credits the Bangalore Startup Map for part of the company list.

## Testing
- **Frontend tests:** 57 pass, 17 of them new. They were written before the code.
- **Backend and ML tests:** added with the job module.
- **End to end on the real stack** (33 companies, 489 open jobs), as a new user:
  - a signed-out visitor is sent to sign in
  - after registering, the unranked list and upload prompt show
  - after uploading a resume, the ranked list shows (top match: HackerRank DevOps Engineer II at 67%)
  - the remote filter and search work
  - saving works, and on the Saved page a status change and a removal both persist after a reload
  - there were no console errors and no unsafe links

## Known follow-ups
- [x] ~~Job-skill extraction still lists some everyday words as skills (Production, Leadership, Empathy, Instagram).~~ Fixed in d2ff580: job-ad words (soft skills, perks, footer links, equal-opportunity text) are no longer counted as job skills.
- [x] ~~Search matches words inside company names ("data" in "Acceldata").~~ Fixed in d2ff580: each search word must start a word of the title or company name.
- [x] ~~Some feeds repeat the location on a job card.~~ Fixed in 17ca9df: cards show one location, with the full list as a tooltip.

d2ff580 also scales down the match for jobs that name fewer than 5 skills, so a job that lists only 2 or 3 skills can't reach the top just by matching most of them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

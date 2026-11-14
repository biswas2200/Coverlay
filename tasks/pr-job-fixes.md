Title: Job recommendations follow-ups: clean job skills, whole-word search, one location per card

## Summary

This finishes #7. #7 was merged before these two commits were pushed to `job-recommendations`, so they never reached `master`. #7's description already lists them as fixed; this PR is what brings them in.

### d2ff580: job skills, search and ranking (backend and ML service)
- **Job skills:** words from job-ad copy are no longer counted as skills. That covers soft skills, verbs like "shipping", perks, footer links (Instagram) and equal-opportunity text. "Communication" alone had been counted in 175 of 489 jobs. The average number of skills per job drops from 14 to 11.
- **Re-reading jobs:** `POST /admin/jobs/reextract-skills` extracts every job's skills again after the extractor changes.
- **Small postings:** a job that names fewer than 5 skills has its match scaled down, so matching 2 of 3 skills no longer puts it first.
- **Search:** each search word must start a word in the job title or company name, so "data engineer" no longer matches every Acceldata job.

### 17ca9df: one location per job card (frontend)
- 162 of 489 open jobs list several locations, usually the same city more than once ("Bangalore · Bangalore, Karnataka, India").
- Job cards and saved-job cards now show one location: the first that gives a city and region, else the first. The full list shows as a tooltip.

## Testing
- **Backend and ML service:** new tests for the ranking changes, in `JobRecommendationServiceTest` and `test_job_rank.py`.
- **Frontend:** 58 tests pass, including a new test for the location rule, written before the code.
- **Real data:** the location change was checked on the local stack's 489 jobs. No card repeats a location, and the full list shows on hover.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

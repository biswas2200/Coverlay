Title: Fix issues from the end-to-end test, rename to Coverlay, update the docs

## Summary

Follow-up to #4. The new dashboard frontend was tested end to end against the real backend (Postgres, MinIO, backend and ML service running locally). Every flow worked: register, sign in and out, upload of several versions, the resume analyzer, the overview, role matches, feedback, the Free JD-match lock and the Premium JD match. There were no frontend bugs and no console errors. The test found three problems in the ML service, which this PR fixes, along with the docs and the project's display name.

### ML service (engine 0.5.0 → 0.5.1)
- **Indian phone numbers:** the parser now reads mobile numbers written as two groups of five ("+91 98765 43210"). Before, the profile showed no phone number even though the ATS check found one.
- **Free-tier suggestions:** they now say what to fix in plain words and show the top match as a percentage. Before, they showed the raw check name ("sufficient_length") and a raw score ("match score 0.95").
- **JD match:** everyday job-ad words (hiring, design, equity, inclusion, compensation, recognition, trust) are no longer counted as required skills. This applies to job descriptions only.
- **Skills list:** 17 common tools added to the engineering skills list: Kafka, Redis, GraphQL, FastAPI, Django, Flask, MongoDB, Elasticsearch, RabbitMQ, gRPC, Jenkins, GitHub Actions, Ansible, Angular, Vue.js, Hadoop and Golang. "Go" is left out because it would match the word "go".

### Display name
- The project is now called **Coverlay** in the README, docs, mkdocs, frontend pages, API and ML-service titles, the Maven project name and the GCP alert subjects. Code identifiers, the database name, storage keys and the GCP project ID are unchanged.

### Docs
- The root README, tech-stack, architecture, hld, index and srs now describe the frontend as HTML, one hand-written stylesheet and vanilla JS, instead of Bootstrap.
- In the SRS, FR-8.1 now names the JD match tab, and revisions 2.9 and 2.10 record these changes.

## Testing
- ML service: 301 tests pass, 5 of them new.
- All three fixes were checked again in the running app with the same resume and job description used in the end-to-end test.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

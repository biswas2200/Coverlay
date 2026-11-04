# Design principles and patterns

Start here when something breaks. Each pattern lists the problem it solves, where it lives,
how it works, and what to check first when it misbehaves. "In use" means the code exists today;
"Planned" means it is designed and will be used by the feature named. Every new feature adds or
updates its entry here (see `CONTRIBUTING.md`).

## Principles

| Principle | What it means here |
|---|---|
| Single responsibility | A class or module does one job: a controller turns HTTP into calls, a service holds the rules, a repository talks to the database. |
| Depend on interfaces | Code that uses an AI provider, a job feed or a file extractor depends on its interface, so a new one is a new class, not an edit everywhere. |
| Privacy by design | Personal data lives in one place (the account) and everything else holds ids or placeholders. Deleting the account must leave nothing that points back to a person. |
| Fail safe, never fail silent | When the AI or an outside service fails, the user still gets a useful result, and the failure is logged as an event an alert can match. |
| Small reversible steps | Schema changes are migrations; features ship behind a preview first; a model is a config value, not code. |
| Logic you can test without a browser | Frontend rules live in DOM-free `*-rules.js` modules with `node --test` tests; the page scripts only wire events and draw. |

## Contents

- In use: [Layered architecture](#layered-architecture) · [DTOs and mappers](#dtos-and-mappers) · [Repository](#repository) · [Strategy](#strategy) · [Factory and registry](#factory-and-registry) · [Template method](#template-method) · [Adapter](#adapter) · [Chain of responsibility](#chain-of-responsibility) · [Aspect (cross-cutting logging)](#aspect-cross-cutting-logging) · [Cache-aside](#cache-aside) · [Graceful degradation](#graceful-degradation) · [Centralised error handling](#centralised-error-handling) · [Injected clock](#injected-clock) · [Evolutionary schema](#evolutionary-schema) · [Functional core, imperative shell](#functional-core-imperative-shell) · [Append-only history](#append-only-history)
- Planned: [Tokenization with a personal-data vault](#tokenization-with-a-personal-data-vault) · [Durable job and saga](#durable-job-and-saga) · [Queue and workers with idempotency keys](#queue-and-workers-with-idempotency-keys) · [Stateless services](#stateless-services) · [Append-only ledger](#append-only-ledger) · [Pseudonymization and k-anonymity](#pseudonymization-and-k-anonymity) · [Blind signatures](#blind-signatures)

---

## In use

### Layered architecture

- **Why.** Changing how a page talks to the API shouldn't touch the rules, and changing the
  database shouldn't touch the controllers.
- **Where.** Every backend module: `resume/ResumeController.java` → `ResumeService.java` →
  `ResumeRepository.java`; the same for `job/`, `auth/`, `bugreport/`, `feedback/`.
- **How.** Controllers validate input and map HTTP; services hold the business rules and
  transactions; repositories are Spring Data interfaces. A layer only calls the one below it.
- **When it breaks.** A controller doing database work, or a service building HTTP responses,
  is the smell. Look for the rule in the service first.

### DTOs and mappers

- **Why.** Entities change with the schema; the API must not. DTOs are the API's own shapes.
- **Where.** `*/dto/` packages; `resume/mapper/`.
- **How.** Services return DTOs (Java records); a mapper turns an entity into its DTO.
  Entities never leave the service layer.
- **When it breaks.** A JSON field appearing or vanishing after a schema change means an
  entity leaked into a response.

### Repository

- **Why.** One place per table for queries, so SQL isn't scattered.
- **Where.** `*Repository.java` (Spring Data JPA), for example `job/JobPostingRepository.java`.
- **How.** Interfaces with derived or `@Query` methods; Hibernate only *validates* the
  entities against the schema (`ddl-auto: validate`).
- **When it breaks.** A startup error naming a column means an entity and a migration
  disagree: fix the migration, never switch Hibernate to generate the schema.

### Strategy

- **Why.** The same job done different ways, chosen at run time: different AI providers,
  different job-board feeds, a template or an AI explanation, and since engine 0.7.0 a
  different Gemini model per kind of task.
- **Where.**
  - ML: `app/services/llm_client.py`: the `LLMClient` protocol with `GeminiLLMClient` and
    `GroqLLMClient`; the task tiers (`TIER_BY_PURPOSE`, `Settings.gemini_model_for`);
    `explainer.py` (template or LLM).
  - Backend: `job/feed/JobFeed.java` with `LeverFeed`, `GreenhouseFeed`, `AshbyFeed`.
- **How.** Callers depend on the interface; the setting (`LLM_PROVIDER`,
  `GEMINI_MODEL_EXTRACT/CHAT/WRITE`) or the company's ATS picks the implementation.
- **When it breaks.** Check which strategy was picked: the ML service logs `provider=` and
  `model=` on every call, and `GET /llm-usage` lists each tier's model and price.

### Factory and registry

- **Why.** Code that needs "the right one" shouldn't know every class.
- **Where.** `llm_client.get_llm_client()` (builds and caches the provider);
  `document_extraction/registry.py` (`get_extractor_for_filename`: PDF or DOCX).
- **How.** One function maps a setting or a file name to an instance. A new format or
  provider is one new class plus one line in the factory.
- **When it breaks.** "Unknown provider" or "unsupported file type" errors come from here.

### Template method

- **Why.** Every AI call needs the same cache, usage ledger and logging, whatever the SDK.
- **Where.** `llm_client._ProviderClient.complete()`, with each provider's `_generate()`.
- **How.** The base class runs the fixed steps (cache lookup → call → price → record → log);
  subclasses fill in only the SDK call.
- **When it breaks.** Wrong cost figures: check `model_catalog.py` (prices per model) and
  `LLM_PRICES`. Wrong answers repeated: the cache key includes model and prompts.

### Adapter

- **Why.** The rest of the backend shouldn't know HTTP details of the ML service or GitHub.
- **Where.** `client/MlServiceClient.java`; `bugreport/GitHubIssueClient.java`.
- **How.** A Java class with plain methods (`analyzeFile(bytes, filename, topN)`) hides the
  HTTP, headers, timeouts and error mapping.
- **When it breaks.** `MlServiceException` / `ExternalServiceException` in the logs; the
  request id in the log line finds the same request in the ML service's logs.

### Chain of responsibility

- **Why.** Each request passes the same checks in order: tag it, authenticate it, authorise it.
- **Where.** `common/logging/RequestIdFilter.java` → `auth/JwtAuthenticationFilter.java` →
  Spring Security (`auth/SecurityConfig.java`).
- **How.** Each filter does its one job and passes the request on. The request id filter runs
  first, so even rejected requests are logged with an id.
- **When it breaks.** A 401 or 403 you don't expect: check the filter order and
  `SecurityConfig`'s public paths.

### Aspect (cross-cutting logging)

- **Why.** Timing and failure logs for every controller and service without writing them in
  every method.
- **Where.** `common/aspect/LoggingAspect.java`.
- **How.** An `@Around` advice on classes named `*Controller` and `*Service`. Arguments and
  return values are never logged (they can hold passwords, tokens, resume text).
- **When it breaks.** A slow request shows up as "completed in Nms" lines; find the slowest
  service under the same request id.

### Cache-aside

- **Why.** Re-analysing an unchanged resume shouldn't pay Gemini twice.
- **Where.** `llm_client._ProviderClient` (`LLM_CACHE_SIZE`, in-process LRU).
- **How.** Look in the cache first; on a miss, call, then store. Cache hits are recorded as
  zero-cost calls in the ledger.
- **When it breaks.** It's per process today (see [Stateless services](#stateless-services)):
  two copies of the ML service don't share it.

### Graceful degradation

- **Why.** The AI being off, over budget, retired or down must never cost the user their
  score (NFR-3.1).
- **Where.** `ml-service/app/services/pipeline.py` (`_lock_reason`, the locked result on an
  extraction failure); `explainer.py` (falls back to the template).
- **How.** The result comes back locked with `lock_reason` `ai_unavailable` or
  `ai_budget_exhausted`: ATS score and a rules-only profile card. The service logs
  `event=ai_unavailable` or `event=ai_budget_exhausted` with the error class and status only.
- **When it breaks.** Search the logs for `event=ai_`. A `code=404` means the model name is
  wrong or retired: change `GEMINI_MODEL_*`, not code.

### Centralised error handling

- **Why.** Every error reaches the client in one shape, with no stack traces.
- **Where.** `common/GlobalExceptionHandler.java`; scoped handlers such as
  `resume/ResumeExceptionHandler.java` and `auth/AuthExceptionHandler.java`; `common/ApiError.java`.
- **How.** `@RestControllerAdvice` maps exceptions to status codes and `ApiError` bodies; the
  scoped ones win for their package.
- **When it breaks.** A 500 that should be a 4xx: the exception has no mapping yet.

### Injected clock

- **Why.** Code that depends on "now" (reminders, rate limits, retention) must be testable.
- **Where.** `common/ClockConfig.java`; services take a `Clock`.
- **How.** Tests pass a fixed clock instead of the system time.
- **When it breaks.** Flaky time-dependent tests: something called `Instant.now()` directly.

### Evolutionary schema

- **Why.** The database changes in small, reviewed, repeatable steps.
- **Where.** `backend/src/main/resources/db/migration/V*.sql` (Flyway); CI checks that
  version numbers are unique.
- **How.** Never edit an applied migration; add the next one. Hibernate validates, never creates.
- **When it breaks.** "Validate failed" at startup: compare the entity with the latest migration.

### Functional core, imperative shell

- **Why.** Page logic you can test in milliseconds without a browser, and pages that stay thin.
- **Where.** `frontend/src/js/pages/*-rules.js` (pure functions, tested in
  `frontend/tests/`), with each page's script (`*.js`) only wiring events and drawing.
- **How.** Rules return new values instead of changing old ones (for example
  `applyEdit(resume, path, value)` returns a new resume). The page keeps state, calls a rule,
  saves, re-draws. Backend strings always go in with `textContent`, never `innerHTML`; the
  Builder's rich text is a tiny HTML subset that `parseInline()` turns into text nodes.
- **When it breaks.** Reproduce it as a failing test against the rules module first; the bug
  is usually there, not in the page.

### Append-only history

- **Why.** Undo must never lose work.
- **Where.** The Resume Builder's versions (`resume-builder-rules.js`: `addVersion`,
  `restoreVersion`); later `resume_document_versions`.
- **How.** Every change, including a restore, adds a new version; nothing is overwritten or
  deleted. Lay AI suggestions add one version each, only when the user presses Add.
- **When it breaks.** A "missing" change is usually in an older version: the Versions tab
  shows every one.

---

## Planned

### Tokenization with a personal-data vault

- **Why.** Prompts, chats, logs, analytics and every Gemini call must work without anyone's
  name, college, email, phone or links in them; deleting an account must leave nothing that
  points back.
- **Where.** Previewed in `frontend/src/js/pages/privacy-guard-rules.js`; built in the ML
  service and backend (detection with the account's own values, patterns, and Microsoft
  Presidio).
- **How.** Personal details become placeholders (`{user.college}`, `{other.person_1}`). Only
  the account (the vault) holds the real values, and only the user's own screen fills them
  in. After deletion every placeholder resolves to null; the rest of the record stays useful.
- **When it breaks.** A real name in a log or a prompt record means a path skipped the guard.

### Durable job and saga

- **Why.** Deleting an account touches several stores. A failure halfway must not leave data
  behind or tell the user "Deleted" too early.
- **Where.** Previewed in `settings-rules.js` (`startDeletion`, `advanceDeletion`); built as
  a `deletion_jobs` table and a worker.
- **How.** Each step is recorded with its state and is safe to repeat. The worker retries a
  failed step with growing waits and alerts after 24 hours. "Deleted" shows only when every
  step is done, and a nightly sweep removes leftovers. Restores replay the purge list first.
- **When it breaks.** Look for jobs whose step is `retrying`; the step's log lines carry the
  job id, step and attempt, never an email.

### Queue and workers with idempotency keys

- **Why.** A spike of users must slow things down, not break them. AI work waits in a queue
  instead of blocking a request.
- **Where.** Spike readiness step 2: a Postgres queue (`SKIP LOCKED`) first, Pub/Sub or Cloud
  Tasks later.
- **How.** A request stores a job and returns at once ("Working on it…"); workers take jobs
  and scale out. Each job has an idempotency key, so a retry never does the work twice.
- **When it breaks.** Queue depth (a Team insights health tile) climbing means workers can't
  keep up, or the Gemini quota is the limit.

### Stateless services

- **Why.** Running two copies today would split the rate limiter, the AI cache and the daily
  budget, and run the scheduled jobs twice.
- **Where.** `job/WatchlistRateLimiter.java` and `job/JobsRunner.java` (`@Scheduled`); the ML
  service's cache and `UsageLedger`.
- **How.** Move shared state to PostgreSQL or Redis; run scheduled jobs once (ShedLock, or
  Cloud Scheduler calling an endpoint).
- **When it breaks.** Doubled emails or doubled job refreshes mean two copies each ran a job.

### Append-only ledger

- **Why.** A wallet balance must always be explainable, line by line.
- **Where.** Previewed in `wallet-rules.js`; built as a ledger table.
- **How.** Recharges, spends, refunds and community points are rows that are never edited;
  the balance is their sum. Prices are shown before an action runs.
- **When it breaks.** A balance that doesn't match its history is a bug by definition: the
  ledger wins.

### Pseudonymization and k-anonymity

- **Why.** Insights (what gets interviews, what people ask) must never point at one person.
- **Where.** The analytics store, keyed by `subject_id`; previewed in
  `team-insights-rules.js` (`suppress`, `K_MIN = 20`).
- **How.** Analytics rows carry a random id, never the account id. Rare values (a small
  college) are generalised, and a figure is shown only for 20 or more people. Deleting an
  account removes only the link row, so months of data are never rebuilt.
- **When it breaks.** A chart cell with fewer than 20 people behind it is a bug.

### Blind signatures

- **Why.** Anonymous community posts that nobody can link to an account: not us, not Google,
  not someone with our code and database.
- **Where.** The Community feature (planned); open-source parts: Cloudflare's privacypass-ts
  in the browser, an RFC 9474 Java library checked against the RFC's test vectors.
- **How.** The device makes a key pair; Coverlay signs it blinded (without seeing it), once
  per account per month; posts carry the signature, not the account.
- **When it breaks.** Signatures failing to verify after a key rotation: the server must keep
  last month's public key until every pass from it has expired.

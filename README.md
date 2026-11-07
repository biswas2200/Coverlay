# Coverlay

A **Career OS for every job domain**: an AI-assisted resume analyser and career
recommendation system, built with a deterministic core (domain detection, ATS
scoring, embedding-based skill-to-role matching) and a narrow, well-scoped use of
an LLM (reading the resume into a profile, and a coaching narrative — never
scoring, never resume rewriting). It is delivered as a hosted cloud platform on **Google Cloud Platform (GCP)**, one plan for every account, with a single deterministic core engine (domain detection, ATS scoring, embedding-based skill-to-role matching) and Google Vertex AI (Gemini) reading every resume. (The standalone offline self-hosted distribution has been archived for reference in [`docs/archive/community-edition.md`](docs/archive/community-edition.md)). Full design docs live in [`docs/`](docs/) — see the **Documentation** section below.

## Domains and the AI engine

Every upload is classified into one of 23 job domains (`ml-service/app/data/domains.json`,
deterministic, no API call): Engineering & Technology (software, data, ML/AI, DevOps,
cloud, security, hardware, product/QA) · Core Engineering (mechanical, electrical,
civil, chemical) · Healthcare · Science & Research · Finance & Accounting · Banking &
Insurance · Sales · Retail & E-commerce · Marketing · HR · Operations & Supply Chain ·
Manufacturing & Production · Quality, Safety & EHS · Consulting & Project Management ·
Education · Legal · Social Services · Design & Creative · Customer Service &
Hospitality · Construction & Trades · Real Estate & Property · Veterinary, Agriculture
& Environment · Administration.

Every domain is served the same way: **Gemini on Vertex AI (ADC)** reads the resume
into a profile, with the domain's skill dictionary merged in and every extracted skill
checked against the resume text; matching stays the deterministic embedding matcher
against that domain's catalogue (engineering: curated by hand; the other 22: 260 roles
built from 1.35M LinkedIn postings by `scripts/build_general_catalogue.py`); and
Gemini writes the coaching narrative. The local NER model that used to read
engineering resumes is archived ([`docs/archive/ner-model.md`](docs/archive/ner-model.md)).

**No tiers.** Every account gets the whole product: all 23 domains, analysed as often
as they like, five role matches with skill gaps, the AI-written suggestions, the
JD-targeted match (paste a job description → covered / missing requirements;
deterministic, no LLM) and every resume version kept.

When the AI engine cannot run — `LLM_PROVIDER=none`, or the operator's
`LLM_DAILY_BUDGET_USD` brake — an upload still returns its ATS score, detected domain
and a rules-only profile card, with `recommendationsLocked = true` and `lockReason`
`"ai_unavailable"` or `"ai_budget_exhausted"`; `POST /resumes/{id}/reanalyze` fills
in the matches once the engine is back.

**Credentials:** the only Google credential is Application Default Credentials —
`gcloud auth application-default login` on a dev machine, an attached service
account on GCP — plus `GOOGLE_CLOUD_PROJECT`. There is no API key anywhere.

## Repo layout

| Path | Status | Description |
|---|---|---|
| [`ml-service/`](ml-service/README.md) | Integrated | Python/FastAPI ML pipeline: parsing, skill normalization, embedding-based role matching, ATS scoring, gap analysis, explanations. |
| [`backend/`](backend/README.md) | Integrated | Spring Boot API: auth + RBAC roles, resume upload/versioning (MinIO), ML-service orchestration, recommendation/feedback persistence, and the temporal (EMA) skill-vector update job (FR-7). |
| [`frontend/`](frontend/README.md) | Integrated | Static web client (HTML, one hand-written stylesheet, vanilla JavaScript, no build step), laid out as a clean dashboard: auth, resume analyzer with versions, ATS checks with fixes, role matches, feedback and JD match, all wired to the real backend and checked end to end against it. |

## Running the full stack locally

The three services talk to each other over HTTP; start them in this order (each in its own
terminal):

1. **ML service** (`ml-service/`, port 8000) — see [its README](ml-service/README.md) for setup.
   ```bash
   gcloud auth application-default login   # once; Gemini reads every resume
   export GOOGLE_CLOUD_PROJECT=<your-project>
   uvicorn app.main:app --reload
   ```
2. **Backend** (`backend/`, port 8080) — needs a PostgreSQL 15+ database (Flyway creates the
   schema on startup, `db/migration/`) and an S3-compatible object store (MinIO) for resume
   files.
   ```bash
   docker compose up -d       # starts Postgres + MinIO
   APP_ADMIN_EMAILS=you@example.com mvn spring-boot:run   # your account becomes ADMIN; ML_SERVICE_BASE_URL defaults to http://localhost:8000
   ```
   An ADMIN can make another account ADMIN with `PATCH /admin/users/{id}/role` (find the
   id with `GET /admin/users?email=`). There are no tiers or payments.
3. **Frontend** (`frontend/`, port 4200) — plain HTML/CSS/JS, nothing to install or build.
   It expects the backend at `http://localhost:8080` (`frontend/src/js/config.js`). Serve the
   `src/` folder over HTTP (ES modules don't load from `file://`):
   ```bash
   python3 -m http.server 4200 --directory frontend/src
   ```
   Then open `http://localhost:4200/`. Frontend unit tests: `cd frontend && npm test`
   (Node's built-in test runner, no dependencies).

The backend's `app.cors.allowed-origins` (default `http://localhost:4200`) must include
whatever origin the frontend is actually served from.

## Build order

1. **ML pipeline** — deterministic scoring/matching + narrow LLM tasks, validated standalone.
2. **Backend** — wraps the ML service, adds persistence and orchestration.
3. **Frontend** — consumes the backend API.

The temporal EMA-weighted skill-vector update loop (FR-7) is implemented in the backend
(`skillvector.SkillVectorService`): once a role collects enough helpful/not-helpful votes,
weights are recomputed with `new = α·signal + (1−α)·old` and stored as a new version.
Next up is exporting those weights as versioned release snapshots — see
[Result Determinism & Parity](docs/editions-and-parity.md).

## Documentation

**Read first: [`docs/prototype-spec.md`](docs/prototype-spec.md).** The clickable prototype in
`frontend/` is the source of truth for what Coverlay does, and that document is the mandatory
contract the frontend, the backend and the ML service implement when the full application is
built. Where it disagrees with an older design document, it wins.

Full docs live in [`docs/`](docs/) in this repository, as a MkDocs + Material
site (`mkdocs.yml` at the repo root). To preview or check it:

```bash
pip install mkdocs-material
mkdocs serve          # local preview, from the repo root
mkdocs build --strict # broken links fail the build
```

## Design docs (quick lookup)

| Doc | What it covers |
|---|---|
| [SRS v2.0](docs/srs.md) | Requirements, incl. editions, result parity, tier gating (tiers since removed — see the archive), model training |
| [Editions & Parity](docs/editions-and-parity.md) | How Community and Web Free stay identical; restaged pipeline; PC spec; costs; fine-tuning; research |
| [Architecture](docs/architecture.md) | System diagram, deterministic-vs-LLM split, editions, deployment |
| [HLD](docs/hld.md) | Layer responsibilities, key design decisions |
| [LLD](docs/lld.md) | Module design grounded in the real code, API contracts, sequence diagram, backend modules |
| [DFD](docs/dfd.md) | Level 0 context diagram, Level 1 process breakdown |
| [Database Schema & ERD](docs/database-schema.md) | Flyway schema, the versioned EMA skill-vector table, snapshot export |
| [Use Case Diagram](docs/use-case-diagram.md) | Actors, use cases, implemented vs. planned |
| [Tech Stack](docs/tech-stack.md) | Per-layer breakdown, built vs. planned |
| [Datasets](docs/datasets.md) | Open datasets for development, golden tests and training |
| [Archive: local NER model](docs/archive/ner-model.md) | The offline NER parser for engineering resumes, why it was replaced by Gemini, how to bring it back |

## Tech stack (at a glance)

| Layer | Stack | Status |
|---|---|---|
| Frontend | HTML5, one hand-written CSS file (light and dark themes, no CSS framework), vanilla JavaScript (ES modules, no build step); tests via `node --test` | Integrated — `frontend/` |
| Backend | Java 21, Spring Boot 3.x, Spring Security (JWT), PostgreSQL, Flyway | Integrated — `backend/` |
| ML service | Python 3.12, FastAPI, `sentence-transformers` (`all-MiniLM-L6-v2`), Gemini on Vertex AI via ADC (reads every resume, writes the coaching narrative; Groq optional) | Integrated — `ml-service/` |
| Docs | MkDocs + Material, `docs/` + root `mkdocs.yml`, `mkdocs build --strict` | Done |

## License

All rights reserved — see [`LICENSE`](LICENSE).

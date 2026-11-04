# ML service

FastAPI service implementing the resume analysis pipeline: parsing,
skill normalization, embedding-based role matching, ATS scoring, gap
analysis, and explanation generation. Design notes and setup instructions
also live in the separate `docs/` project (see the repo root README).

The backend (`../backend/`) calls this service's `POST /analyze-file?top_n=5`
once per resume upload -- a multipart file (PDF or DOCX) in, the full
`AnalyzeResponse` (profile, detected domain, ATS score, role matches, gaps,
explanation, lock state) out. `POST /parse-file` is the same file-upload
pattern for parsing alone; `/parse`, `/detect-domain`, `/match`, `/match-jd`,
`/ats-score`, and `/analyze` (routers/analyze.py) take raw text directly, for
callers that already have it. `/match-jd` (services/jd_match.py) scores an
already-extracted skill set against one pasted job description --
deterministic, no LLM: JD skills are dictionary hits against both taxonomies,
`score = 0.6 * coverage + 0.4 * embedding similarity`, with matched/missing
lists and the closest catalogue role. The backend exposes it to every
account as `POST /resumes/{id}/jd-match`.

Job recommendations (routers/jobs.py, services/job_rank.py), also
deterministic and LLM-free: `POST /extract-job-skills` returns each job
posting's skills with the same extractor `/match-jd` uses (the backend stores
them once per posting), and `POST /rank-jobs` ranks jobs for a resume:
`score = 0.45 * coverage * evidence + 0.30 * embedding similarity + 0.25 * role fit`
(role fit: the job title against the resume's top catalogue roles; evidence
= `min(1, job skills / 5)`, so a job naming few skills can't win on coverage;
`0.5 * role fit` when a job's skills couldn't be read), each job with matched/missing skills
and a one-line reason. Embeddings of skills and titles are cached in memory.

Job-market demand (services/market_demand.py, SRS FR-7.6): `POST /market-demand`
groups open jobs by the catalogue role their title is closest to and returns,
per role with at least 3 jobs, the skills they ask for and an EMA signal per
catalogue skill. The backend feeds those into its skill weights and pushes the
result back with `PUT /weights-snapshot`, which writes
`app/data/weights_snapshot.json` (git-ignored) and clears the matcher's caches.

## Domains and the AI engine

`app/data/domains.json` lists every job domain the service knows (23 of them).
`services/domain_classifier.py` assigns one to every resume deterministically
(dictionary hits + MiniLM similarity to the domain descriptions -- never an
LLM). There are no tiers: every resume, in every domain, takes the same path
in `services/pipeline.py`:

| AI engine available? | What happens |
|---|---|
| yes | Gemini extraction (the domain's name is in the prompt), the domain's skill dictionary merged in, deterministic match against that domain's catalogue, Gemini coaching narrative |
| no -- `LLM_PROVIDER=none` | ATS + domain + rules-only profile card (name, email, phone, dictionary skills); `recommendations_locked=true`, `lock_reason=ai_unavailable`, no client is ever built |
| no -- daily budget spent | the same, with `lock_reason=ai_budget_exhausted` until the next UTC day |

Every skill Gemini returns is checked against the resume text
(`parser.skills_found_in_text`), so a skill the model made up never reaches
matching, and the contact rules fill any contact field it left empty.
`LLM_DAILY_BUDGET_USD` is an operator brake on the whole service (0 = off).

Role catalogues: `app/data/role_skills.json` (engineering, curated) and
`app/data/role_skills_general.json` (the 22 other domains, 12 roles each, built
by `scripts/build_general_catalogue.py` from the LinkedIn postings dataset in
`../datasets/` -- re-run it and review the diff to change the catalogue; the
build is byte-reproducible). Non-IT engineers (mechanical, civil, electrical,
chemical, ...) have their own `core_engineering` domain: the builder's
`PRE_EXCLUSION_RULES` keep those titles before the software/IT exclusion, and
the classifier's engineering fast path only counts *software* taxonomy skills,
so a SolidWorks/ETAP/HYSYS resume never lands on the software catalogue.

Resume parsing is done by Gemini on Vertex AI, for every domain
(`services/parser.py`), authenticated with **Google Application Default
Credentials**. There is no API key anywhere in this service: run
`gcloud auth application-default login` once on a dev machine (or attach a
service account on GCP) and set `GOOGLE_CLOUD_PROJECT`. The local NER model
that used to read engineering resumes offline is archived, with how to bring
it back, in `archive/ner_model/README.md` (the idea and its numbers:
`../docs/archive/ner-model.md`). The only local model left is MiniLM, for
embeddings.

Quick start:

```bash
python -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu  # CPU-only, much smaller than the CUDA default
pip install -r requirements.txt
cp .env.example .env   # set GOOGLE_CLOUD_PROJECT (Gemini reads every resume)
gcloud auth application-default login   # once; ADC is the only Google credential this service uses
pytest tests/          # no credentials needed, LLM calls are mocked (the matcher tests download MiniLM once)
uvicorn app.main:app --reload
```

## Models per task

Each kind of task runs on its own Gemini model, so a model retirement or an
upgrade is a config change (`app/config.py`, `Settings.gemini_model_for`):

| Tier | Used for | Default model | Set with |
|---|---|---|---|
| `extract` | Reading a resume into JSON (`parser.py`) | `gemini-3.5-flash-lite` | `GEMINI_MODEL_EXTRACT` |
| `chat` | Lay AI messages and the analysis narrative (`explainer.py`) | `gemini-3.5-flash-lite` | `GEMINI_MODEL_CHAT` |
| `write` | What a recruiter reads: tailored resumes, cover letters, cold emails (no caller yet) | `gemini-3.8-flash` | `GEMINI_MODEL_WRITE` |

An empty tier runs on `GEMINI_MODEL`. A call's `purpose` picks its tier
(`llm_client.TIER_BY_PURPOSE`); a purpose not listed runs on `chat`, the
cheaper one. Every model's list price and thinking setting is one line in
`app/services/model_catalog.py`:

| Model | USD per 1M tokens (in / out) | Thinking |
|---|---|---|
| `gemini-3.5-flash-lite` | 0.30 / 2.50 | level `MINIMAL` |
| `gemini-3.8-flash` | 1.50 / 7.50 from 1 Jan 2027 (0.75 / 3.75 until 31 Dec 2026) | level `LOW` |
| `gemini-2.5-flash-lite` | 0.10 / 0.40 | budget 0 (retired on Vertex AI, October 2026) |

`LLM_PRICES` overrides a price without a code change, e.g.
`LLM_PRICES={"gemini-3.8-flash": [0.75, 3.75]}`.

When Gemini fails while reading a resume (a retired model, a quota, an
outage), the analysis comes back locked with `lock_reason=ai_unavailable` --
the user keeps their ATS score and a rules-only profile card (NFR-3.1) -- and
the service logs `event=ai_unavailable stage=extract ...` with the error's
class and status code only. Alert on that line: it is how a retired model
shows up on day one.

## LLM cost: what is assumed, and how to check it

Every analysis makes two LLM calls (extract, narrate), and every call goes through
`services/llm_client.py`, which applies the same cost controls whatever the
provider:

| Control | Where | Default |
|---|---|---|
| Thinking turned down: the lowest level for Gemini 3.x (`model_catalog.py`), budget 0 for 2.5 -- thinking tokens are billed as output, the expensive side | `GeminiLLMClient._thinking_config` | `MINIMAL` / `LOW`; `GEMINI_THINKING_BUDGET=0` |
| Whitespace-compacted, length-capped resume text in the extraction prompt | `parser.compact_resume_text` | `LLM_MAX_INPUT_CHARS=16000` |
| JSON mode + `temperature=0` for extraction (no fences/prose to pay for; same JSON for the same resume) | `_generate` | always |
| Bounded output: prompt asks for compact fields / <=180 words, plus hard `max_output_tokens` | `parser.py`, `explainer.py` | `3072` / `600` tokens |
| Gaps block dropped from the narrative prompt (it duplicated each match's `missing` list) | `explainer._build_user_prompt` | always |
| In-process completion cache keyed by (provider, model, options, prompts) | `_ProviderClient.complete` | `LLM_CACHE_SIZE=256` |
| Usage ledger: token counts from each response, priced at each call's model's list price | `UsageLedger`, `model_catalog.prices_for` | per model |

**Cost per analysis -- assumed, then measured on the 2.5 models** (thinking
off, the two-page samples in `scripts/samples/`, list prices, 2026-09-14). The
2.5 models are retired; on `gemini-3.5-flash-lite` the same token counts come
to about $0.0013 per analysis before thinking, and minimal thinking adds a
few hundred output tokens -- run `scripts/llm_cost_check.py` on real
credentials for the measured figure:

| Call | Prompt tokens | Output tokens | `gemini-2.5-flash` ($0.30 / $2.50 per 1M) | `gemini-2.5-flash-lite` ($0.10 / $0.40 per 1M) |
|---|---|---|---|---|
| `extract` (every analysis) | 826-891 | 453-511 | $0.0014-0.0015 | $0.00027-0.00028 |
| `narrate` (every analysis) | 279-282 | 118-151 | $0.00045 | $0.00008 |
| **One analysis, any domain** | | | **~$0.0019** | **~$0.00035** |
| A locked result, or a cache hit | 0 | 0 | 0 | 0 |

The pre-measurement assumption was ~$0.0024 on `gemini-2.5-flash`; the first
run came in at 0.91x of it, and dropping the never-rendered
`experience[].description` field from the extraction prompt took another
18-23% off the answer. Both models returned the same contact details,
experience and education and 22 skills for the nursing sample, so
`gemini-2.5-flash-lite` was the default until its retirement. Not adopted after measuring:
asking for minified JSON (JSON mode ignores the formatting instruction, and
the one wording that worked dropped 4 skills). With thinking left on (the
SDK default) the same two calls add 1,000-4,000 reasoning tokens billed as
output, i.e. 2-4x the cost. A repeat of an unchanged resume is served from
the cache at $0.

**Checking the assumption against reality:** every `AnalyzeResponse` made
with an LLM call carries `llm_usage` (per-call prompt/output/thinking tokens
and the priced estimate), and `GET /llm-usage` gives the process totals
(`POST /llm-usage/reset` zeroes them). `scripts/llm_cost_check.py` runs the
pipeline over the bundled sample resumes (or files you pass) and
prints assumed vs. actual side by side:

```bash
python scripts/llm_cost_check.py --dry-run          # estimates only, no API call
python scripts/llm_cost_check.py                     # real calls, needs ADC + GOOGLE_CLOUD_PROJECT
python scripts/llm_cost_check.py path/to/resume.pdf  # your own files
```

The estimates are list-price arithmetic, not billing -- confirm against the
Cloud Billing report, and update `LLM_INPUT_USD_PER_1M`/`LLM_OUTPUT_USD_PER_1M`
when the model changes.

## Logging

Every log line carries the request id the backend sends as `X-Request-Id`
(a new one when it is missing), so one upload can be followed through the
backend's and this service's logs: `grep <id>` in both. Each request writes an
access line (method, path, status, duration) and each analysis one outcome
line (domain, ATS score, number of matches, lock reason,
explanation source, LLM calls, duration). Resume text, names, contact details
and file names are never logged.

`LOG_LEVEL` (default `INFO`; `DEBUG` adds per-step timings) and `LOG_FILE`
(e.g. `logs/ml-service.log`, rotated at 10 MB) are set in `.env`. Run uvicorn
with `--no-access-log` to drop its own access lines, which lack the id.

## API docs

FastAPI generates these automatically, no setup needed: Swagger UI at
`http://localhost:8000/docs`, ReDoc at `http://localhost:8000/redoc`, raw OpenAPI document at
`http://localhost:8000/openapi.json`.

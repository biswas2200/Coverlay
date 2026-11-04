from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parent
SERVICE_DIR = APP_DIR.parent
DATA_DIR = APP_DIR / "data"


class Settings(BaseSettings):
    """Application configuration, loaded from environment variables / a
    local .env file. Every field has a safe default so the service can
    start (and its tests can run) with no .env file present at all.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Which LLM provider llm_client.get_llm_client() should build: "gemini"
    # (default -- Gemini on Vertex AI, authenticated with Google Application
    # Default Credentials, no API key), "groq" (optional, needs
    # GROQ_API_KEY), or "none": no provider is ever built, and every
    # analysis comes back locked with lock_reason "ai_unavailable" (ATS score
    # and a rules-only profile card, no role matches) instead of failing. Kept as a
    # plain string rather than an enum so a new provider only needs a new
    # branch in get_llm_client(), not a schema change here.
    llm_provider: str = "gemini"

    # Level for the app's own loggers (app.*): DEBUG, INFO, WARNING, ERROR.
    log_level: str = "INFO"
    # Also write logs to this file (rotated at 10 MB, 5 kept), e.g.
    # logs/ml-service.log. Empty: console only.
    log_file: str = ""

    # Resume parsing is always the LLM (parser.py). The local NER model and
    # its NER_MODEL_* settings are archived: archive/ner_model/README.md.

    # Gemini runs on Vertex AI and authenticates with Application Default
    # Credentials (ADC): `gcloud auth application-default login` on a dev
    # machine, the attached service account on GCP. There is deliberately
    # no API-key field for Google -- credentials never live in config. The
    # env var names match what gcloud and the google-genai SDK already use,
    # so one `export GOOGLE_CLOUD_PROJECT=...` configures both.
    google_cloud_project: str = ""
    # "global" is Vertex AI's multi-region Gemini endpoint; a regional id
    # (e.g. "asia-south1") pins traffic to one region.
    google_cloud_location: str = "global"
    # Which Gemini model runs each kind of task (gemini_model_for below):
    #   extract -- reading a resume into JSON (parser.py)
    #   chat    -- Lay AI messages and the analysis narrative (explainer.py)
    #   write   -- what a recruiter reads: tailored resumes, cover letters,
    #              cold emails (no caller yet; the Builder and Letters
    #              backends will use it)
    # An empty tier runs on gemini_model, so a deployment that sets only
    # GEMINI_MODEL runs every task on that one model. Retiring or upgrading
    # a model is a config change: model_catalog.py has the prices and
    # thinking settings. gemini-2.5-flash-lite (the old default) was retired
    # on Vertex AI in October 2026; gemini-3.5-flash-lite is Google's named
    # replacement, and measured 97% macro F1 labelling resumes (docs/srs.md
    # v2.6). gemini-3.8-flash writes the documents (owner's decision,
    # 2026-11-04): about 3x the cost per journey of Flash-Lite, spent where
    # quality shows.
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_model_extract: str = ""
    gemini_model_chat: str = ""
    gemini_model_write: str = "gemini-3.8-flash"
    # Thinking budget for models that take one (Gemini 2.5). 0 (default)
    # switches thinking off: copying fields out of a resume into JSON, and
    # turning pre-computed scores into three short paragraphs, are shallow,
    # and thinking tokens are billed at the output rate, typically 2-4x the
    # visible answer. -1 sends no thinking config and leaves the model's
    # dynamic default in place. Gemini 3.x models take a thinking *level*
    # instead, set per model in model_catalog.py (MINIMAL, or LOW for
    # gemini-3.8-flash); this budget doesn't apply to them.
    gemini_thinking_budget: int = 0

    # Groq -- optional alternative provider (LLM_PROVIDER=groq). Hosts
    # several open-weight model families (Llama, Gemma, ...) behind one API,
    # so switching between them is just changing groq_model -- it never
    # requires a code change in GroqLLMClient. The key is read from the
    # environment only.
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    embedding_model: str = "all-MiniLM-L6-v2"

    # --- LLM cost controls (provider-agnostic; see ml-service/README.md) ---
    # Resume text is whitespace-compacted and cut to this many characters
    # before the extraction prompt (~4 chars per token, so ~4k tokens). A
    # two-page resume is 3-6k chars; this only trims pathological uploads.
    llm_max_input_chars: int = 16000
    # Output ceilings per task. Ceilings, not budgets -- you pay for what is
    # generated -- but they stop a runaway answer from costing 10x.
    llm_extract_max_output_tokens: int = 3072
    llm_narrate_max_output_tokens: int = 600
    # In-process cache of completions keyed by (provider, model, prompts):
    # re-analysing an unchanged resume costs nothing.
    # 0 disables it.
    llm_cache_size: int = 256
    # Prices the usage ledger (llm_client.UsageLedger) uses to turn token
    # counts into an estimated spend -- estimates, not billing. Each Gemini
    # model's list price is in model_catalog.py. LLM_PRICES overrides a
    # model's price from the environment, as JSON, e.g.
    #   LLM_PRICES='{"gemini-3.8-flash": [0.75, 3.75]}'
    # LLM_INPUT_USD_PER_1M / LLM_OUTPUT_USD_PER_1M price any model the
    # catalog doesn't list (a Groq model, a new Gemini): set them when you
    # run one. Thinking is billed as output.
    llm_prices: dict[str, tuple[float, float]] = {}
    llm_input_usd_per_1m: float = 0.30
    llm_output_usd_per_1m: float = 2.50
    # Soft guard on what the service may spend on the AI engine per UTC day,
    # in the same estimated dollars the ledger reports. Once the day's
    # estimated spend passes it, analyses come back locked
    # ("ai_budget_exhausted") until the next UTC day. In-process only
    # (resets with the process), so it is a brake against a runaway, not
    # billing enforcement. 0 disables it.
    llm_daily_budget_usd: float = 0.0

    # Which explainer.py backend explain_results() uses when the caller does
    # not say: "template" (deterministic, no network call, FR-5.4) or "llm"
    # (coaching narrative, routes through llm_provider). The analysis
    # pipeline always asks for "llm" and falls back to the template if it
    # fails.
    explainer_backend: str = "template"

    # Engine version stamped into every engine_fingerprint (FR-11.2, see
    # fingerprint.py) -- bumped on any release that changes scoring behavior,
    # so two deployments can prove they're running the same core engine.
    # 0.7.0: resumes are read by gemini-3.5-flash-lite (was 2.5-flash-lite).
    engine_version: str = "0.7.0"

    # The all-MiniLM-L6-v2 commit the role vectors and domain scores were
    # measured with, hashed into engine_fingerprint.embed_model_sha.
    embedding_model_revision: str = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"

    def gemini_model_for(self, tier: str) -> str:
        """The Gemini model for a task tier ("extract", "chat", "write"). An
        empty or unknown tier runs on gemini_model."""
        chosen = {
            "extract": self.gemini_model_extract,
            "chat": self.gemini_model_chat,
            "write": self.gemini_model_write,
        }.get(tier, "")
        return chosen.strip() or self.gemini_model


@lru_cache
def get_settings() -> Settings:
    return Settings()

"""LLM spend since the process started: GET /llm-usage reads the ledger
llm_client.py keeps of every provider call (token counts straight from the
responses, priced at each model's list price, model_catalog.py), POST /llm-usage/reset
zeroes it. This is how an analysis's real cost is checked against the
assumptions in ml-service/README.md -- the per-request figures are on
AnalyzeResponse.llm_usage, this is the running total.
"""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import LLMPricing, LLMTier, LLMUsageReport
from app.services.llm_client import ledger, usage_summary
from app.services.model_catalog import prices_for

router = APIRouter()

TIERS = ("extract", "chat", "write")


def _pricing(model: str) -> LLMPricing:
    input_usd_per_1m, output_usd_per_1m = prices_for(model)
    return LLMPricing(input_usd_per_1m=input_usd_per_1m, output_usd_per_1m=output_usd_per_1m)


def _report() -> LLMUsageReport:
    settings = get_settings()

    def model_of(tier: str) -> str:
        # Gemini picks a model per tier; Groq runs one model for everything.
        if settings.llm_provider == "gemini":
            return settings.gemini_model_for(tier)
        return settings.groq_model

    tiers = [LLMTier(tier=t, model=model_of(t), pricing=_pricing(model_of(t))) for t in TIERS]
    extract = tiers[0]
    totals = usage_summary(ledger.recent())
    # The recent list is capped; the counters are not -- prefer them.
    totals.calls = ledger.calls
    totals.cache_hits = ledger.cache_hits
    totals.prompt_tokens = ledger.prompt_tokens
    totals.output_tokens = ledger.output_tokens
    totals.thinking_tokens = ledger.thinking_tokens
    totals.cached_tokens = ledger.cached_tokens
    totals.estimated_cost_usd = ledger.estimated_cost_usd
    return LLMUsageReport(
        since=datetime.fromtimestamp(ledger.started_at, tz=timezone.utc).isoformat(timespec="seconds"),
        provider=settings.llm_provider,
        model=extract.model,
        pricing=extract.pricing,
        tiers=tiers,
        totals=totals,
    )


@router.get("/llm-usage")
def llm_usage() -> LLMUsageReport:
    """Token counts and estimated spend for every LLM call this process
    has made (the last 200 individually, all of them in the totals)."""
    return _report()


@router.post("/llm-usage/reset")
def reset_llm_usage() -> LLMUsageReport:
    """Zero the ledger -- e.g. right before a measured sample run."""
    ledger.reset()
    return _report()

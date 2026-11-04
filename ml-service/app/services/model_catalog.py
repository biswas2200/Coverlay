"""What this service knows about each Gemini model it may run: the list
price, and how the model's thinking is turned down. One table, so adopting
a model (or a price change) is one line here; Settings.llm_prices can
override a price from the environment without a code change.

Which model runs which kind of task is a separate question, answered by
Settings.gemini_model_for(tier) in config.py.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import get_settings


@dataclass(frozen=True)
class ModelInfo:
    """List prices in USD per 1M tokens (thinking is billed as output), and
    the thinking level a Gemini 3.x model is sent. None means the model
    takes a thinking *budget* instead (Gemini 2.5), set by
    Settings.gemini_thinking_budget."""

    input_usd_per_1m: float
    output_usd_per_1m: float
    thinking_level: str | None = None


# Vertex AI list prices, global endpoint, standard tier. Check the pricing
# page before adding a model:
# https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
CATALOG: dict[str, ModelInfo] = {
    # Retired on Vertex AI in October 2026; kept so old ledgers still price.
    "gemini-2.5-flash-lite": ModelInfo(0.10, 0.40),
    "gemini-2.5-flash": ModelInfo(0.30, 2.50),
    # Pricing page, 2026-10-08. Gemini 3.x sets thinking by level; MINIMAL
    # is the cheapest the Flash-Lite and 3.5 Flash models accept.
    "gemini-3.5-flash-lite": ModelInfo(0.30, 2.50, "MINIMAL"),
    "gemini-3.5-flash": ModelInfo(1.50, 9.00, "MINIMAL"),
    # Standard price from 1 Jan 2027. Until 31 Dec 2026 Google charges an
    # introductory $0.75 / $3.75, so estimates run high (on the safe side)
    # until then; set LLM_PRICES to the introductory price for exact figures.
    # 3.8 Flash's thinking levels are LOW, MEDIUM and HIGH.
    "gemini-3.8-flash": ModelInfo(1.50, 7.50, "LOW"),
}


def model_info(model: str) -> ModelInfo | None:
    """The catalog entry for a model, or None for a model it doesn't list."""
    return CATALOG.get(model)


def prices_for(model: str | None) -> tuple[float, float]:
    """(input, output) USD per 1M tokens for a model. An LLM_PRICES entry
    wins, then the catalog; any other model (a Groq model, a Gemini not yet
    listed) uses LLM_INPUT_USD_PER_1M / LLM_OUTPUT_USD_PER_1M."""
    settings = get_settings()
    if model:
        override = settings.llm_prices.get(model)
        if override is not None:
            return float(override[0]), float(override[1])
        info = model_info(model)
        if info is not None:
            return info.input_usd_per_1m, info.output_usd_per_1m
    return settings.llm_input_usd_per_1m, settings.llm_output_usd_per_1m

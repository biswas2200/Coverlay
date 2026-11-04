"""The one analysis pipeline both routers run (POST /analyze with text,
POST /analyze-file with a file): detect the domain, score ATS, then have
Gemini read the resume, match roles, find gaps and write the coaching
narrative -- the same for every domain and every account.

  AI engine available? | what happens
  ---------------------+---------------------------------------------------
  yes                  | Gemini extraction -> match -> gaps -> Gemini narrative
  no                   | rules-only profile card, ATS, locked (lock_reason says why)

The AI engine is unavailable for a request in three cases: LLM_PROVIDER=none
("ai_unavailable"), the daily budget brake LLM_DAILY_BUDGET_USD
("ai_budget_exhausted"), and Gemini failing while it reads the resume -- a
retired model, a quota, an outage ("ai_unavailable" again, NFR-3.1: the user
still gets their score). The last two log an `event=` line the monitoring
alerts match. ATS scoring and domain detection are deterministic and always
run. The narrative falls back to the template on its own if Gemini fails
(explainer.py).
"""

import logging
import time

from app.config import get_settings
from app.models.schemas import AnalyzeResponse, DomainDetection, LockReason, ResumeProfile
from app.services import ats_score, gap_analysis, matcher
from app.services.basic_profile import basic_profile, extract_email, extract_name, extract_phone
from app.services.dictionary_skills import GENERAL_TAXONOMY_PATH, find_skills
from app.services.domain_classifier import ENGINEERING_DOMAIN, detect_domain
from app.services.explainer import explain_results
from app.services.fingerprint import engine_fingerprint
from app.services.llm_client import ledger, llm_available, usage_summary
from app.services.normalizer import normalize_skills
from app.services.parser import parse_resume

LOCK_REASON_AI_UNAVAILABLE: LockReason = "ai_unavailable"
LOCK_REASON_AI_BUDGET_EXHAUSTED: LockReason = "ai_budget_exhausted"

log = logging.getLogger(__name__)


def _extract_profile(resume_text: str, domain: DomainDetection) -> ResumeProfile:
    """Gemini reads the resume; the skill dictionary for the domain is merged
    in for recall (a skill the model skipped still reaches matching), and the
    contact rules fill any contact field the model left empty.
    """
    profile = parse_resume(resume_text, domain_name=domain.name)
    if domain.domain == ENGINEERING_DOMAIN:
        profile.skills = normalize_skills([*find_skills(resume_text), *profile.skills])
    else:
        profile.skills = normalize_skills(
            [*find_skills(resume_text, GENERAL_TAXONOMY_PATH), *profile.skills], include_general=True
        )
    profile.name = profile.name or extract_name(resume_text)
    profile.email = profile.email or extract_email(resume_text)
    profile.phone = profile.phone or extract_phone(resume_text)
    return profile


def _lock_reason() -> LockReason | None:
    """Why this request cannot use the AI engine, or None if it can."""
    if not llm_available():
        return LOCK_REASON_AI_UNAVAILABLE
    if ledger.over_daily_budget():
        return LOCK_REASON_AI_BUDGET_EXHAUSTED
    return None


def analyze_text(resume_text: str, top_n: int = 5, hidden_word_count: int = 0) -> AnalyzeResponse:
    """Run the pipeline and, when it made any LLM calls, attach what they
    cost (AnalyzeResponse.llm_usage). `hidden_word_count` comes from the
    file extractor and only feeds the ATS "no_hidden_text" check."""
    start = time.perf_counter()
    with ledger.request_scope() as llm_calls:
        response = _analyze(resume_text, top_n, hidden_word_count)
    if llm_calls:
        response.llm_usage = usage_summary(llm_calls)
    # Outcome only -- never the resume text or anything parsed out of it.
    log.info(
        "analysis domain=%s confidence=%.2f ats=%.0f matches=%d locked=%s "
        "explanation=%s llm_calls=%d chars=%d hidden_words=%d in %.0fms",
        response.domain.domain, response.domain.confidence,
        response.ats_score.score, len(response.matches), response.lock_reason or False,
        response.explanation_source, len(llm_calls),
        len(resume_text), hidden_word_count, (time.perf_counter() - start) * 1000,
    )
    return response


def _locked(resume_text: str, domain: DomainDetection, ats, lock_reason: LockReason) -> AnalyzeResponse:
    """The result when the AI engine can't be used: the profile card comes
    from the rules (never the LLM), recommendations stay empty by design."""
    profile = basic_profile(resume_text)
    explanation = explain_results(
        profile, ats, [], [], backend="template", domain=domain, locked=True, lock_reason=lock_reason
    )
    return AnalyzeResponse(
        profile=profile,
        domain=domain,
        ats_score=ats,
        matches=[],
        gaps=[],
        recommendations_locked=True,
        lock_reason=lock_reason,
        explanation=explanation.text,
        explanation_source=explanation.source,
        engine_fingerprint=engine_fingerprint(),
    )


def _error_summary(exc: Exception) -> str:
    """Class and status code only: an error's message can quote what the
    model returned, i.e. parts of the resume, which never go in a log."""
    code = getattr(exc, "code", None)
    status = getattr(exc, "status", None)
    parts = [type(exc).__name__]
    if code is not None:
        parts.append(f"code={code}")
    if status:
        parts.append(f"status={status}")
    return " ".join(parts)


def _analyze(resume_text: str, top_n: int, hidden_word_count: int = 0) -> AnalyzeResponse:
    domain = detect_domain(resume_text)
    ats = ats_score.score_resume(resume_text, hidden_word_count=hidden_word_count)
    lock_reason = _lock_reason()

    if lock_reason == LOCK_REASON_AI_BUDGET_EXHAUSTED:
        log.warning("event=ai_budget_exhausted")
    if lock_reason is not None:
        return _locked(resume_text, domain, ats, lock_reason)

    t = time.perf_counter()
    try:
        profile = _extract_profile(resume_text, domain)
    except Exception as exc:
        # NFR-3.1: Gemini failing (a retired model, a quota, an outage) must
        # not cost the user their score. The event name is what the
        # monitoring alert matches, so the first failure pages someone.
        settings = get_settings()
        model = settings.gemini_model_for("extract") if settings.llm_provider == "gemini" else settings.groq_model
        log.warning("event=ai_unavailable stage=extract provider=%s model=%s error=%s",
                    settings.llm_provider, model, _error_summary(exc))
        return _locked(resume_text, domain, ats, LOCK_REASON_AI_UNAVAILABLE)
    parsed_ms = (time.perf_counter() - t) * 1000
    t = time.perf_counter()
    matches = matcher.match_roles(profile.skills, top_n=top_n, domain=domain.domain)
    gaps = gap_analysis.analyze_gaps(matches)
    log.debug(
        "parse %.0fms (skills=%d experience=%d education=%d), match+gaps %.0fms",
        parsed_ms, len(profile.skills), len(profile.experience), len(profile.education),
        (time.perf_counter() - t) * 1000,
    )
    explanation = explain_results(profile, ats, matches, gaps, backend="llm", domain=domain)
    return AnalyzeResponse(
        profile=profile,
        domain=domain,
        ats_score=ats,
        matches=matches,
        gaps=gaps,
        explanation=explanation.text,
        explanation_source=explanation.source,
        engine_fingerprint=engine_fingerprint(),
    )

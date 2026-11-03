"""services/pipeline.py -- which seams run for each domain, and when the
result locks. Every model and the LLM are faked: the point here is the
routing (the extraction prompt's domain, the dictionary merge, the catalogue
matched against, whether and why recommendations lock), not the models'
output.
"""

import pytest

from app.models.schemas import (
    AtsCheck,
    AtsScoreResponse,
    DomainDetection,
    GapAnalysis,
    ResumeProfile,
    RoleMatch,
)
from app.services import pipeline
from app.services.explainer import Explanation

ENGINEERING = DomainDetection(domain="engineering", name="Engineering & Technology", confidence=0.8)
HEALTHCARE = DomainDetection(domain="healthcare", name="Healthcare & Life Sciences", confidence=0.8)
ATS = AtsScoreResponse(score=60, max_score=80, checks=[AtsCheck(name="contact_email", passed=True, detail="ok")])


class Calls:
    """Records which seams the pipeline exercised."""

    def __init__(self) -> None:
        self.parse: list[dict] = []
        self.match: list[dict] = []
        self.explain: list[dict] = []
        self.dictionary: list[object] = []


@pytest.fixture
def calls(monkeypatch) -> Calls:
    recorded = Calls()

    def fake_parse(resume_text, client=None, domain_name=None):
        recorded.parse.append({"domain_name": domain_name})
        return ResumeProfile(name="Sam", email="sam@example.com", skills=["Python", "SQL"])

    def fake_match(skills, top_n=5, domain="engineering"):
        recorded.match.append({"skills": skills, "top_n": top_n, "domain": domain})
        return [RoleMatch(role=f"{domain} role", domain=domain, score=0.7,
                          matched_skills=skills[:1], missing_skills=["Other"])]

    def fake_explain(profile, ats, matches, gaps, client=None, backend=None, domain=None, locked=False,
                     lock_reason=None):
        recorded.explain.append({"backend": backend, "locked": locked, "lock_reason": lock_reason,
                                 "n_matches": len(matches)})
        return Explanation(text=f"{backend}:{'locked' if locked else 'open'}",
                           source="llm" if backend == "llm" and not locked else "template")

    def fake_find_skills(text, path=None):
        recorded.dictionary.append(path)
        return []

    monkeypatch.setattr(pipeline, "parse_resume", fake_parse)
    monkeypatch.setattr(pipeline.matcher, "match_roles", fake_match)
    monkeypatch.setattr(pipeline, "explain_results", fake_explain)
    monkeypatch.setattr(pipeline.ats_score, "score_resume", lambda text, hidden_word_count=0: ATS)
    monkeypatch.setattr(pipeline, "find_skills", fake_find_skills)
    monkeypatch.setattr(pipeline.gap_analysis, "analyze_gaps",
                        lambda matches: [GapAnalysis(role=m.role, missing_skills=m.missing_skills) for m in matches])
    return recorded


def _forbid_llm(monkeypatch):
    from app.services import llm_client

    def boom():
        raise AssertionError("a locked analysis must never build an LLM client")

    monkeypatch.setattr(llm_client, "get_llm_client", boom)


@pytest.fixture
def no_provider(monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("LLM_PROVIDER", "none")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_engineering_is_extracted_by_the_llm_and_narrated(monkeypatch, calls):
    monkeypatch.setattr(pipeline, "detect_domain", lambda text: ENGINEERING)

    result = pipeline.analyze_text("resume")

    assert result.domain == ENGINEERING
    assert result.recommendations_locked is False and result.lock_reason is None
    assert calls.parse == [{"domain_name": "Engineering & Technology"}]
    assert calls.dictionary == [None]  # the engineering taxonomy only
    assert calls.match == [{"skills": ["Python", "SQL"], "top_n": 5, "domain": "engineering"}]
    assert calls.explain == [{"backend": "llm", "locked": False, "lock_reason": None, "n_matches": 1}]
    assert result.matches[0].role == "engineering role"
    assert result.explanation_source == "llm"


def test_other_domains_take_the_same_path_with_their_own_catalogue(monkeypatch, calls):
    monkeypatch.setattr(pipeline, "detect_domain", lambda text: HEALTHCARE)

    result = pipeline.analyze_text("resume", top_n=2)

    assert result.recommendations_locked is False
    assert calls.parse == [{"domain_name": "Healthcare & Life Sciences"}]
    assert calls.dictionary == [pipeline.GENERAL_TAXONOMY_PATH]
    assert calls.match[0]["top_n"] == 2 and calls.match[0]["domain"] == "healthcare"
    assert result.matches[0].domain == "healthcare"
    assert result.explanation_source == "llm"


def test_dictionary_hits_are_merged_into_the_extracted_skills(monkeypatch, calls):
    monkeypatch.setattr(pipeline, "detect_domain", lambda text: HEALTHCARE)
    monkeypatch.setattr(pipeline, "find_skills", lambda text, path=None: ["ACLS", "BLS"])

    result = pipeline.analyze_text("resume")

    assert result.profile.skills[:2] == ["ACLS", "BLS"]
    assert "Python" in result.profile.skills


def test_contact_rules_fill_what_the_llm_left_empty(monkeypatch, calls):
    monkeypatch.setattr(pipeline, "detect_domain", lambda text: ENGINEERING)
    monkeypatch.setattr(pipeline, "parse_resume",
                        lambda text, client=None, domain_name=None: ResumeProfile(name="", skills=["Python"]))

    result = pipeline.analyze_text("Jane Doe\njane@example.com | +91 98765 43210\nSkills: Python")

    assert result.profile.name == "Jane Doe"
    assert result.profile.email == "jane@example.com"
    assert result.profile.phone == "+91 98765 43210"


def test_no_provider_locks_every_domain_with_a_rules_only_profile_card(monkeypatch, calls, no_provider):
    _forbid_llm(monkeypatch)
    text = "Jane Doe\njane@example.com\nSkills: Python, SQL"
    for domain in (ENGINEERING, HEALTHCARE):
        monkeypatch.setattr(pipeline, "detect_domain", lambda t, d=domain: d)

        result = pipeline.analyze_text(text)

        assert result.recommendations_locked is True
        assert result.lock_reason == pipeline.LOCK_REASON_AI_UNAVAILABLE
        assert result.matches == [] and result.gaps == []
        assert result.ats_score == ATS  # ATS is always computed
        assert result.profile.name == "Jane Doe" and result.profile.email == "jane@example.com"
        assert {"Python", "SQL"} <= set(result.profile.skills)
        assert result.llm_usage is None
    assert calls.parse == [] and calls.match == []
    assert calls.explain[-1] == {"backend": "template", "locked": True,
                                 "lock_reason": "ai_unavailable", "n_matches": 0}


def test_daily_budget_brake_locks_the_analysis(monkeypatch, calls):
    from app.services import llm_client

    monkeypatch.setattr(llm_client.ledger, "over_daily_budget", lambda: True)
    monkeypatch.setattr(pipeline, "detect_domain", lambda text: ENGINEERING)

    result = pipeline.analyze_text("resume")

    assert result.recommendations_locked is True
    assert result.lock_reason == pipeline.LOCK_REASON_AI_BUDGET_EXHAUSTED
    assert calls.parse == []


def test_llm_usage_is_attached_when_the_analysis_called_an_llm(monkeypatch, calls):
    import time
    from app.services import llm_client

    monkeypatch.setattr(pipeline, "detect_domain", lambda text: ENGINEERING)
    assert pipeline.analyze_text("text").llm_usage is None  # every seam is faked here

    plain_explain = pipeline.explain_results

    def explain_and_record_usage(*args, **kwargs):
        llm_client.ledger.record(llm_client.LLMUsage(
            "gemini", "gemini-2.5-flash", "narrate", 450, 300, 0, 0, 0.000885, False, time.time()))
        return plain_explain(*args, **kwargs)

    monkeypatch.setattr(pipeline, "explain_results", explain_and_record_usage)

    result = pipeline.analyze_text("text")
    assert result.llm_usage is not None
    assert result.llm_usage.calls == 1
    assert result.llm_usage.details[0].purpose == "narrate"
    assert result.llm_usage.estimated_cost_usd == pytest.approx(0.000885)


def test_analysis_logs_its_outcome_but_not_the_resume(monkeypatch, calls, caplog):
    monkeypatch.setattr(pipeline, "detect_domain", lambda text: ENGINEERING)

    with caplog.at_level("INFO", logger="app.services.pipeline"):
        pipeline.analyze_text("Jane Doe jane@example.com")

    line = caplog.records[-1].getMessage()
    assert "domain=engineering" in line and "matches=1" in line
    assert "Jane" not in line and "jane@example.com" not in line

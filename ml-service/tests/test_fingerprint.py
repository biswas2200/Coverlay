"""Tests fingerprint.py's engine_fingerprint (FR-11.2). No model download
involved -- extraction_model_sha/embed_model_sha hash the configured identifier
string, and taxonomy_sha hashes the real, already-present skill_taxonomy.json.
"""

from app.services.fingerprint import engine_fingerprint


def test_engine_fingerprint_has_every_required_field_populated():
    fp = engine_fingerprint()

    assert fp.engine_version
    assert fp.extraction_model_sha
    assert fp.embed_model_sha
    assert fp.taxonomy_sha
    assert fp.weights_snapshot_id


def test_engine_fingerprint_hashes_are_64_character_hex_strings():
    fp = engine_fingerprint()

    for value in (fp.extraction_model_sha, fp.embed_model_sha, fp.taxonomy_sha):
        assert len(value) == 64
        int(value, 16)  # raises ValueError if not valid hex


def test_engine_fingerprint_is_stable_across_calls():
    assert engine_fingerprint() == engine_fingerprint()


def test_engine_fingerprint_reports_uniform_weights_snapshot_by_default():
    # No weights_snapshot.json ships by default -- see test_weights.py.
    assert engine_fingerprint().weights_snapshot_id == "uniform"


def test_extraction_model_sha_follows_the_configured_llm(monkeypatch):
    from app.config import get_settings

    def fingerprint_with(**env):
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
        engine_fingerprint.cache_clear()
        try:
            return engine_fingerprint().extraction_model_sha
        finally:
            get_settings.cache_clear()
            engine_fingerprint.cache_clear()

    monkeypatch.setenv("GEMINI_MODEL_EXTRACT", "")
    lite = fingerprint_with(LLM_PROVIDER="gemini", GEMINI_MODEL="gemini-2.5-flash-lite")
    flash = fingerprint_with(LLM_PROVIDER="gemini", GEMINI_MODEL="gemini-2.5-flash")
    off = fingerprint_with(LLM_PROVIDER="none")

    assert len({lite, flash, off}) == 3

    # The extract tier is the model that reads resumes, so it alone moves
    # the hash; the chat and write tiers only word text, never a score.
    base = fingerprint_with(LLM_PROVIDER="gemini", GEMINI_MODEL="gemini-3.5-flash-lite",
                            GEMINI_MODEL_EXTRACT="", GEMINI_MODEL_WRITE="gemini-3.8-flash")
    other_extract = fingerprint_with(GEMINI_MODEL_EXTRACT="gemini-3.5-flash")
    other_write = fingerprint_with(GEMINI_MODEL_EXTRACT="", GEMINI_MODEL_WRITE="gemini-3.5-flash")
    assert other_extract != base
    assert other_write == base

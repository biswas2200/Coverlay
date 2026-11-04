"""Computes the engine_fingerprint every analysis response and GET /health
include (SRS FR-11.2): {engine_version, extraction_model_sha,
embed_model_sha, taxonomy_sha, weights_snapshot_id} -- the tuple that says
exactly which engine produced a result, so two deployments (or a result and
its re-analysis) can be compared without trusting anyone's word for it (see
docs/editions-and-parity.md).

taxonomy_sha is a real content hash of every bundled data file that shapes a
result -- both skill taxonomies, both role catalogues and domains.json -- so
it changes automatically whenever any of them is edited.
extraction_model_sha hashes the LLM provider and the model that reads the
resume, the "extract" tier (e.g. "gemini:gemini-3.5-flash-lite"). The chat
and write tiers only word text (the narrative, letters), never a score, so
they are deliberately not part of it. embed_model_sha hashes the embedding
model's name and pinned revision. Both are hashes of the *configured
identifier*, not of weights, so they change whenever the configured model
changes -- which is what matters for detecting a mismatch.
"""

import hashlib
from functools import lru_cache

from app.config import DATA_DIR, get_settings
from app.models.schemas import EngineFingerprint
from app.services.weights import snapshot_id

# Order is fixed so the combined hash is stable; a file that is absent (a
# stripped-down build) hashes as empty rather than failing.
DATA_FILES = (
    DATA_DIR / "skill_taxonomy.json",
    DATA_DIR / "skill_taxonomy_general.json",
    DATA_DIR / "role_skills.json",
    DATA_DIR / "role_skills_general.json",
    DATA_DIR / "domains.json",
)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_files(paths) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes() if path.exists() else b"")
    return digest.hexdigest()


def _extraction_model(settings) -> str:
    """"provider:model" for the LLM that extracts profiles ("none" when off)."""
    provider = settings.llm_provider.strip().lower()
    model = {"gemini": settings.gemini_model_for("extract"), "groq": settings.groq_model}.get(provider, "")
    return f"{provider}:{model}" if model else provider


@lru_cache
def engine_fingerprint() -> EngineFingerprint:
    settings = get_settings()
    return EngineFingerprint(
        engine_version=settings.engine_version,
        extraction_model_sha=_sha256_text(_extraction_model(settings)),
        embed_model_sha=_sha256_text(f"{settings.embedding_model}@{settings.embedding_model_revision}"),
        taxonomy_sha=_sha256_files(DATA_FILES),
        weights_snapshot_id=snapshot_id(),
    )

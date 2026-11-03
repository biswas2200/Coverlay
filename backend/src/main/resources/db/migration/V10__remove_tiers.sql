-- One product for everyone (November 2026): there are no Free / Premium
-- tiers any more, and every domain is read by the same AI engine (the local
-- NER model is archived, docs/archive/ner-model.md).

-- Premium accounts become ordinary users; ADMIN stays.
UPDATE users SET role = 'USER' WHERE role = 'PREMIUM_USER';

-- The free tier's monthly AI-analysis allowance (V4) is gone.
ALTER TABLE users
    DROP COLUMN ai_period,
    DROP COLUMN ai_analyses_used;

-- A domain no longer has an engine or a tier (V3): every domain is served
-- the same way.
ALTER TABLE parsed_profiles
    DROP COLUMN domain_engine,
    DROP COLUMN domain_tier;

-- A result can now only be locked because the AI engine could not run
-- ("ai_unavailable") or the operator's daily budget was spent
-- ("ai_budget_exhausted"). Older reasons -- the spent allowance and the
-- Community Edition -- read as "ai_unavailable"; re-analysing unlocks them.
UPDATE parsed_profiles
SET lock_reason = 'ai_unavailable'
WHERE lock_reason IN ('ai_engine_required', 'community_edition', 'premium_domain');

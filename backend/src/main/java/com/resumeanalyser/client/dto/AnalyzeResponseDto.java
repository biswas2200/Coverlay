package com.resumeanalyser.client.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * Mirrors the ML service's {@code AnalyzeResponse} Pydantic model -- the full
 * result of {@code POST /analyze-file} (ml-service/app/routers/upload.py):
 * parsed profile, detected domain, ATS score, ranked role matches, skill gaps,
 * a coaching explanation, and whether recommendations were locked because
 * the AI engine could not run.
 */
public record AnalyzeResponseDto(
        ResumeProfileDto profile,

        /** Which job domain the resume was classified into. */
        DomainDetectionDto domain,

        @JsonProperty("ats_score")
        AtsScoreResponseDto atsScore,

        List<RoleMatchDto> matches,
        List<GapAnalysisDto> gaps,

        /**
         * True when the AI engine could not run for this request:
         * {@link #matches}/{@link #gaps} are then empty by design, and
         * {@link #lockReason} says why ({@code ai_unavailable} or
         * {@code ai_budget_exhausted}).
         */
        @JsonProperty("recommendations_locked")
        boolean recommendationsLocked,

        @JsonProperty("lock_reason")
        String lockReason,

        String explanation,

        /**
         * Which explainer backend actually produced {@link #explanation}:
         * {@code "template"} (deterministic: a locked result, or a fallback
         * if the LLM call failed -- FR-5.4/NFR-3.1) or {@code "llm"} (the AI
         * coaching narrative). Labelling this lets the dashboard show which kind
         * of explanation the candidate received.
         */
        @JsonProperty("explanation_source")
        String explanationSource
) {}

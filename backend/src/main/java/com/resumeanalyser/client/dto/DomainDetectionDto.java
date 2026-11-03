package com.resumeanalyser.client.dto;

/**
 * Mirrors the ML service's {@code DomainDetection} Pydantic model: which job
 * domain the resume was classified into (deterministically, no LLM -- see
 * {@code ml-service/app/services/domain_classifier.py}), an entry of
 * {@code ml-service/app/data/domains.json}.
 *
 * @param domain     stable domain id, e.g. {@code "engineering"}, {@code "healthcare"}
 * @param name       display name, e.g. {@code "Healthcare & Life Sciences"}
 * @param confidence the winner's score relative to the runner-up, 0.5 (coin flip) to 1.0
 */
public record DomainDetectionDto(String domain, String name, double confidence) {}

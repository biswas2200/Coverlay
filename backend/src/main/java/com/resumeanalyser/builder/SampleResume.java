package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The resume a new document starts with: the prototype's {@code SAMPLE_RESUME}, which the template page shows and the person
 * overwrites (frontend/src/js/pages/resume-builder-rules.js). A start from an upload will replace it with the upload's own
 * content once the upload's profile can be mapped to a resume.
 */
final class SampleResume {

    private static final String JSON_TEXT = """
            {
              "name": "Jane Doe",
              "contact": "jane@email.com | +91 98765 43210 | Bengaluru",
              "summary": "Backend developer with 3 years of Java and Spring Boot experience. Built payment APIs used by 2 million people and cut their response time by 40%.",
              "experience": [{ "role": "Software Engineer, Acme Corp", "dates": "2021 - now", "details": "Built and ran the payment APIs: Java, Spring Boot, PostgreSQL." }],
              "education": [{ "degree": "B.Tech Computer Science, VIT", "dates": "2021" }],
              "skills": ["Java", "Spring Boot", "SQL"]
            }
            """;

    private SampleResume() {
    }

    /** A new copy every time, so no caller can change what the next one gets. */
    static JsonNode get() {
        try {
            return new ObjectMapper().readTree(JSON_TEXT);
        } catch (Exception e) {
            throw new IllegalStateException("The built-in sample resume is not valid JSON", e);
        }
    }
}

package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.resumeanalyser.common.BadRequestException;
import java.util.List;

/**
 * The start answers made valid (docs/prototype-spec.md, RB-TPL-01, BE-01): a choice outside its list is replaced by the
 * default, like the format (RB-FMT-01); a role is cleaned like any plain field and refused, never cut, when it is longer
 * than 80 characters.
 */
public final class AnswersNormalizer {

    static final int MAX_ROLE_LENGTH = 80;

    private static final List<String> LEVELS = List.of("student", "fresher", "junior", "senior");
    private static final List<String> STYLES = List.of("simple", "modern", "academic", "classic");

    private AnswersNormalizer() {
    }

    /** @return the answers, always valid; @throws BadRequestException when the role is not text or is too long */
    public static BuilderAnswers normalize(JsonNode input) {
        JsonNode answers = input != null && input.isObject() ? input : null;
        return new BuilderAnswers(
                role(answers == null ? null : answers.get("role")),
                option(answers, "level", LEVELS, "junior"),
                option(answers, "style", STYLES, "simple"),
                answers != null && answers.path("pages").isNumber() && answers.get("pages").asDouble() == 2 ? 2 : 1);
    }

    private static String option(JsonNode answers, String key, List<String> allowed, String fallback) {
        JsonNode value = answers == null ? null : answers.get(key);
        return value != null && value.isTextual() && allowed.contains(value.asText()) ? value.asText() : fallback;
    }

    private static String role(JsonNode value) {
        if (value == null || value.isNull()) {
            return "";
        }
        if (!value.isTextual()) {
            throw new BadRequestException("The target role must be text.");
        }
        String role = PlainText.collapse(value.asText());
        int length = PlainText.length(role);
        if (length > MAX_ROLE_LENGTH) {
            throw new BadRequestException("The target role can be at most " + MAX_ROLE_LENGTH + " characters; this one has " + length + ".");
        }
        return role;
    }
}

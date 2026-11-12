package com.resumeanalyser.builder;

/**
 * The four answers of the start step (docs/prototype-spec.md, RB-TPL-01).
 *
 * @param role  the target role, up to 80 characters, may be empty
 * @param level {@code student}, {@code fresher}, {@code junior} (1 to 3 years) or {@code senior} (3+)
 * @param style {@code simple}, {@code modern}, {@code academic} or {@code classic}
 * @param pages 1 or 2: the page limit
 */
public record BuilderAnswers(String role, String level, String style, int pages) {
}

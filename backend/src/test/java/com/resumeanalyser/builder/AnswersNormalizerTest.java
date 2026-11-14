package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.resumeanalyser.common.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * RB-TPL-01: the four answers of the start step: target role (up to 80 characters), experience, style and pages. A choice
 * outside its list is replaced by the default, as the format is (RB-FMT-01); a role that is too long is refused, never cut.
 * The defaults are the prototype's DEFAULT_ANSWERS.
 */
class AnswersNormalizerTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static BuilderAnswers normalize(String json) throws Exception {
        return AnswersNormalizer.normalize(json == null ? null : JSON.readTree(json));
    }

    @Test
    void noAnswers_areTheDefaults() throws Exception {
        for (BuilderAnswers answers : new BuilderAnswers[] {AnswersNormalizer.normalize(null), normalize("null"), normalize("{}"), normalize("[]"), normalize("\"x\"")}) {
            assertThat(answers).isEqualTo(new BuilderAnswers("", "junior", "simple", 1));
        }
    }

    @Test
    void validAnswers_areKept() throws Exception {
        assertThat(normalize("{\"role\":\"Backend Developer\",\"level\":\"senior\",\"style\":\"academic\",\"pages\":2}"))
                .isEqualTo(new BuilderAnswers("Backend Developer", "senior", "academic", 2));
        for (String level : new String[] {"student", "fresher", "junior", "senior"}) {
            assertThat(normalize("{\"level\":\"" + level + "\"}").level()).isEqualTo(level);
        }
        for (String style : new String[] {"simple", "modern", "academic", "classic"}) {
            assertThat(normalize("{\"style\":\"" + style + "\"}").style()).isEqualTo(style);
        }
    }

    @Test
    void aChoiceThatIsNotOnTheList_isTheDefault() throws Exception {
        assertThat(normalize("{\"level\":\"wizard\",\"style\":\"neon\",\"pages\":3}")).isEqualTo(new BuilderAnswers("", "junior", "simple", 1));
        assertThat(normalize("{\"level\":5,\"style\":null,\"pages\":\"2\"}")).as("only the number 2 is two pages").isEqualTo(new BuilderAnswers("", "junior", "simple", 1));
    }

    @Test
    void theRole_hasItsWhitespaceCollapsed_andControlCharactersRemoved() throws Exception {
        assertThat(normalize("{\"role\":\"  Backend \\n  Dev\\u0000eloper \"}").role()).isEqualTo("Backend Developer");
        assertThat(normalize("{\"role\":\"   \"}").role()).isEmpty();
    }

    @Test
    void theRole_isUpToEightyCharacters_andNeverCut() throws Exception {
        assertThat(normalize("{\"role\":\"" + "a".repeat(80) + "\"}").role()).hasSize(80);
        assertThat(normalize("{\"role\":\"  " + "a".repeat(80) + "  \"}").role()).as("measured after cleaning").hasSize(80);

        assertThatThrownBy(() -> normalize("{\"role\":\"" + "a".repeat(81) + "\"}"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("role")
                .hasMessageContaining("80");
    }

    @Test
    void aRoleThatIsNotText_isRefused() {
        for (String bad : new String[] {"5", "true", "[]", "{}"}) {
            assertThatThrownBy(() -> normalize("{\"role\":" + bad + "}"))
                    .as(bad)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("role");
        }
    }

    @Test
    void normalising_isIdempotent() throws Exception {
        BuilderAnswers once = normalize("{\"role\":\" a  b \",\"level\":\"x\",\"pages\":9}");
        JsonNode again = JSON.valueToTree(once);

        assertThat(AnswersNormalizer.normalize(again)).isEqualTo(once);
    }
}

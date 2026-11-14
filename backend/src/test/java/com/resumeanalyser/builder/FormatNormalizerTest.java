package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * RB-FMT-01: any value outside the format table is replaced by its default, silently, on every write. The cases are the
 * ones in frontend/tests/resume-builder-rules.test.js (normalizeFormat), copied, not reinterpreted (spec section 11).
 */
class FormatNormalizerTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static BuilderFormat normalize(String json) throws Exception {
        return FormatNormalizer.normalize(json == null ? null : JSON.readTree(json));
    }

    @Test
    void noFormat_isTheDefaultFormat() throws Exception {
        for (BuilderFormat format : List.of(FormatNormalizer.normalize(null), normalize("null"), normalize("{}"), normalize("[]"), normalize("\"junk\""))) {
            assertThat(format.font()).isEqualTo("sans");
            assertThat(format.fontSize()).isEqualTo(11.0);
            assertThat(format.spacing()).isEqualTo("normal");
            assertThat(format.align()).isEqualTo("left");
            assertThat(format.bullets()).isFalse();
            assertThat(format.style()).isEqualTo("formal");
            assertThat(format.columns()).isEqualTo(1);
            assertThat(format.page()).isEqualTo("a4");
            assertThat(format.unit()).isEqualTo("cm");
            assertThat(format.rules()).isFalse();
            assertThat(format.hidden()).isEmpty();
            assertThat(List.of(format.marginTop(), format.marginBottom(), format.marginLeft(), format.marginRight()))
                    .containsExactly(19.1, 19.1, 19.1, 19.1);
        }
    }

    @Test
    void knownValues_areKept_andUnknownKeysAreIgnored() throws Exception {
        BuilderFormat format = normalize("{\"font\":\"classic\",\"size\":\"xl\",\"bullets\":true,\"style\":\"friendly\"}");

        assertThat(format.font()).isEqualTo("classic");
        assertThat(format.bullets()).isTrue();
        assertThat(format.style()).isEqualTo("friendly");
        assertThat(format.fontSize()).isEqualTo(11.0);
        assertThat(format.spacing()).isEqualTo("normal");
    }

    @Test
    void aWordThatIsNotOnTheList_isReplacedByTheDefault() throws Exception {
        BuilderFormat format = normalize("{\"font\":\"comic\",\"spacing\":\"huge\",\"align\":\"right\",\"style\":\"rude\",\"page\":\"a0\",\"unit\":\"furlong\"}");

        assertThat(List.of(format.font(), format.spacing(), format.align(), format.style(), format.page(), format.unit()))
                .containsExactly("sans", "normal", "left", "formal", "a4", "cm");
    }

    @Test
    void theFontSize_isKeptInRangeAndToHalfPoints() throws Exception {
        assertThat(normalize("{\"fontSize\":10.7}").fontSize()).isEqualTo(10.5);
        assertThat(normalize("{\"fontSize\":99}").fontSize()).isEqualTo(14.0);
        assertThat(normalize("{\"fontSize\":2}").fontSize()).isEqualTo(8.0);
        assertThat(normalize("{\"fontSize\":8.2}").fontSize()).isEqualTo(8.0);
        assertThat(normalize("{\"fontSize\":12}").fontSize()).isEqualTo(12.0);
        assertThat(normalize("{\"fontSize\":\"12\"}").fontSize()).as("a number written as text is still a number").isEqualTo(12.0);
    }

    @Test
    void aFontSizeThatIsNotANumber_isTheDefault_notTheSmallest() throws Exception {
        for (String value : List.of("\"big\"", "\"\"", "null", "true", "[]", "{}")) {
            assertThat(normalize("{\"fontSize\":" + value + "}").fontSize()).as(value).isEqualTo(11.0);
        }
    }

    @Test
    void columns_page_unit_and_rules_areKept_whenValid() throws Exception {
        BuilderFormat format = normalize("{\"columns\":2,\"page\":\"letter\",\"unit\":\"in\",\"rules\":true}");

        assertThat(format.columns()).isEqualTo(2);
        assertThat(format.page()).isEqualTo("letter");
        assertThat(format.unit()).isEqualTo("in");
        assertThat(format.rules()).isTrue();
    }

    @Test
    void columnsThatAreNotOneOrTwo_areOne() throws Exception {
        assertThat(normalize("{\"columns\":3}").columns()).isEqualTo(1);
        assertThat(normalize("{\"columns\":\"2\"}").columns()).as("only the number 2 counts, as in the prototype").isEqualTo(1);
        assertThat(normalize("{\"columns\":2.5}").columns()).isEqualTo(1);
    }

    @Test
    void aFlagThatIsNotABoolean_isFalse() throws Exception {
        BuilderFormat format = normalize("{\"bullets\":\"true\",\"rules\":1}");

        assertThat(format.bullets()).isFalse();
        assertThat(format.rules()).isFalse();
    }

    @Test
    void margins_areFourSeparateValues_keptInRange_toATenthOfAMillimetre() throws Exception {
        BuilderFormat format = normalize("{\"marginTop\":10,\"marginBottom\":12.34,\"marginLeft\":99,\"marginRight\":1}");

        assertThat(List.of(format.marginTop(), format.marginBottom(), format.marginLeft(), format.marginRight()))
                .containsExactly(10.0, 12.3, 50.0, 5.0);
        assertThat(normalize("{\"marginTop\":0}").marginTop()).isEqualTo(5.0);
    }

    @Test
    void aMarginThatIsNotANumber_isTheDefault() throws Exception {
        assertThat(normalize("{}").marginTop()).isEqualTo(19.1);
        assertThat(normalize("{\"marginTop\":\"wide\"}").marginTop()).isEqualTo(19.1);
        assertThat(normalize("{\"marginTop\":\"\"}").marginTop()).isEqualTo(19.1);
    }

    @Test
    void anOlderSingleMargin_loadsAsTheFourMarginsOfThatPreset() throws Exception {
        BuilderFormat narrow = normalize("{\"margins\":\"narrow\"}");
        BuilderFormat normal = normalize("{\"margins\":\"normal\"}");
        BuilderFormat wide = normalize("{\"margins\":\"wide\"}");

        assertThat(List.of(narrow.marginTop(), narrow.marginBottom(), narrow.marginLeft(), narrow.marginRight())).containsOnly(12.7);
        assertThat(List.of(normal.marginTop(), normal.marginLeft())).containsOnly(19.1);
        assertThat(List.of(wide.marginTop(), wide.marginBottom(), wide.marginLeft(), wide.marginRight())).containsOnly(25.4);
        assertThat(normalize("{\"margins\":\"bogus\"}").marginTop()).isEqualTo(19.1);
    }

    @Test
    void anExplicitMargin_winsOverTheOlderSingleMargin() throws Exception {
        BuilderFormat format = normalize("{\"margins\":\"narrow\",\"marginLeft\":30}");

        assertThat(format.marginLeft()).isEqualTo(30.0);
        assertThat(format.marginTop()).isEqualTo(12.7);
    }

    @Test
    void hiddenSections_areKeptToTheOnesThatCanBeHidden_eachOnce_inTheirOwnOrder() throws Exception {
        assertThat(normalize("{}").hidden()).isEmpty();
        assertThat(normalize("{\"hidden\":[\"skills\",\"experience\",\"skills\",\"bogus\",\"summary\"]}").hidden())
                .containsExactly("summary", "skills");
        assertThat(normalize("{\"hidden\":\"skills\"}").hidden()).as("a word is not a list").isEmpty();
        assertThat(normalize("{\"hidden\":[1,null,\"education\"]}").hidden()).containsExactly("education");
    }

    @Test
    void theNormalisedFormat_isAlwaysTheSameWhenNormalisedAgain() throws Exception {
        BuilderFormat once = normalize("{\"fontSize\":10.7,\"marginTop\":12.34,\"hidden\":[\"skills\",\"bogus\"],\"columns\":9}");
        BuilderFormat twice = FormatNormalizer.normalize(JSON.valueToTree(once));

        assertThat(twice).isEqualTo(once);
    }

    @Test
    void theFormat_isWrittenWithTheKeysOfTheContract() {
        JsonNode node = JSON.valueToTree(FormatNormalizer.normalize(null));

        assertThat(node.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "font", "fontSize", "spacing", "align", "bullets", "style", "columns", "page", "unit", "rules", "hidden",
                "marginTop", "marginBottom", "marginLeft", "marginRight");
        assertThat(node.get("hidden").isArray()).isTrue();
    }
}

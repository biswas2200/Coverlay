package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * RB-ATS-01 and RB-ATS-02: "How an ATS reads this". This is a contract test (docs/prototype-spec.md section 11): the cases come
 * from {@code src/test/resources/contract/reading-order.json}, which the PROTOTYPE writes
 * ({@code frontend/tests/contract/export-reading-order.mjs} runs its own {@code docToPlainText} and {@code readingNotes}), so the
 * backend must produce exactly the text and notes the page shows. Change the prototype, regenerate, and this test says what the
 * backend must now do.
 */
class ReadingOrderTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode cases() {
        try (InputStream in = ReadingOrderTest.class.getResourceAsStream("/contract/reading-order.json")) {
            assertThat(in).as("the contract fixtures are missing: run frontend/tests/contract/export-reading-order.mjs").isNotNull();
            return JSON.readTree(in).get("cases");
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static BuilderFormat formatOf(JsonNode fixture) {
        return FormatNormalizer.normalize(fixture.get("format"));
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(item -> out.add(item.asText()));
        return out;
    }

    // ---------- the fixtures themselves ----------

    @Test
    void thereAreCases_withDistinctNames() {
        JsonNode cases = cases();
        List<String> names = new ArrayList<>();
        cases.forEach(c -> names.add(c.get("name").asText()));

        assertThat(names).hasSizeGreaterThanOrEqualTo(20);
        assertThat(new HashSet<>(names)).as("two cases share a name").hasSameSizeAs(names);
    }

    /**
     * The prototype writes {@code colspan: 1, rowspan: 1, colwidth: null} on every new table cell; RB-BLOCK-02 says those
     * defaults must not matter, and the backend does not store them. Taking them out is the only change allowed.
     */
    private static JsonNode withoutDefaultCellAttributes(JsonNode node) {
        JsonNode copy = node.deepCopy();
        removeDefaultCellAttributes(copy);
        return copy;
    }

    private static void removeDefaultCellAttributes(JsonNode node) {
        if (node.isObject()) {
            com.fasterxml.jackson.databind.node.ObjectNode object = (com.fasterxml.jackson.databind.node.ObjectNode) node;
            JsonNode attrs = object.get("attrs");
            String type = object.path("type").asText("");
            if (attrs != null && attrs.isObject() && (type.equals("tableCell") || type.equals("tableHeader"))) {
                com.fasterxml.jackson.databind.node.ObjectNode cell = (com.fasterxml.jackson.databind.node.ObjectNode) attrs;
                if (cell.path("colspan").asInt(0) == 1) {
                    cell.remove("colspan");
                }
                if (cell.path("rowspan").asInt(0) == 1) {
                    cell.remove("rowspan");
                }
                if (cell.has("colwidth") && cell.get("colwidth").isNull()) {
                    cell.remove("colwidth");
                }
                if (cell.isEmpty()) {
                    object.remove("attrs");
                }
            }
        }
        node.forEach(ReadingOrderTest::removeDefaultCellAttributes);
    }

    @Test
    void everyFixtureResume_isValid_andIsStoredUnchangedExceptForDefaultCellAttributes() {
        // A fixture the backend would refuse, or change in any other way, would make a pass on it prove nothing.
        cases().forEach(c -> assertThat(ResumeNormalizer.normalize(c.get("resume")))
                .as(c.get("name").asText())
                .isEqualTo(withoutDefaultCellAttributes(c.get("resume"))));
    }

    // ---------- the prototype's own results ----------

    @TestFactory
    Stream<DynamicTest> everyCaseGivesTheTextAndNotesThePrototypeGives() {
        List<DynamicTest> tests = new ArrayList<>();
        cases().forEach(c -> tests.add(DynamicTest.dynamicTest(c.get("name").asText(), () -> {
            ReadingOrder result = ReadingOrder.of(c.get("resume"), formatOf(c));

            assertThat(result.text()).isEqualTo(c.get("text").asText());
            assertThat(result.notes()).isEqualTo(strings(c.get("notes")));
        })));
        return tests.stream();
    }

    @TestFactory
    Stream<DynamicTest> theResumeAsTheBackendStoresIt_readsExactlyTheSame() {
        List<DynamicTest> tests = new ArrayList<>();
        cases().forEach(c -> tests.add(DynamicTest.dynamicTest("stored: " + c.get("name").asText(), () -> {
            ReadingOrder result = ReadingOrder.of(ResumeNormalizer.normalize(c.get("resume")), formatOf(c));

            assertThat(result.text()).isEqualTo(c.get("text").asText());
            assertThat(result.notes()).isEqualTo(strings(c.get("notes")));
        })));
        return tests.stream();
    }

    // ---------- properties of the rules ----------

    private static JsonNode fixture(String name) {
        for (JsonNode c : cases()) {
            if (c.get("name").asText().equals(name)) {
                return c;
            }
        }
        throw new AssertionError("no fixture called " + name);
    }

    @Test
    void theResumeIsNeverChanged() {
        JsonNode resume = fixture("a table section, two columns").get("resume");
        JsonNode copy = resume.deepCopy();

        ReadingOrder.of(resume, FormatNormalizer.normalize(JSON.createObjectNode().put("columns", 2)));

        assertThat(resume).isEqualTo(copy);
    }

    @Test
    void aHiddenSection_isGone_whateverItHolds() {
        JsonNode hidden = fixture("every hideable section hidden");
        String text = ReadingOrder.of(hidden.get("resume"), formatOf(hidden)).text();

        assertThat(text).doesNotContain("SUMMARY", "EDUCATION", "SKILLS").doesNotContain("Backend developer", "B.Tech", "Spring Boot, SQL");
        assertThat(text).contains("EXPERIENCE", "PROJECTS");
    }

    @Test
    void theText_hasNoMarkupInIt() {
        JsonNode formatted = fixture("formatting is not in the text");
        String text = ReadingOrder.of(formatted.get("resume"), formatOf(formatted)).text();

        assertThat(text).doesNotContain("<b>", "</b>", "<a ", "<font", "<i>", "<u>", "&amp;", "&lt;");
        assertThat(text).contains("Led payments & notes and more, a < b.");
    }

    @Test
    void oneColumnWithNoTables_saysItIsTheSafestLayout_andNothingElse() {
        JsonNode plain = fixture("the sample resume, one column");

        assertThat(ReadingOrder.of(plain.get("resume"), formatOf(plain)).notes())
                .containsExactly("One column and no tables: the safest layout for applicant tracking systems.");
    }

    @Test
    void twoColumnsAndTwoTables_giveThreeNotes_columnsFirst_thenTablesInPageOrder() {
        JsonNode resume = fixture("two tables, one of them empty").get("resume");

        List<String> notes = ReadingOrder.of(resume, FormatNormalizer.normalize(JSON.createObjectNode().put("columns", 2))).notes();

        assertThat(notes).hasSize(3);
        assertThat(notes.get(0)).startsWith("Two columns:");
        assertThat(notes.get(1)).contains("\"New section\"");
        assertThat(notes.get(2)).contains("\"Skills by area\"");
    }

    @Test
    void theLastLine_hasNoTrailingWhitespace_andThereIsNoBlankRunLongerThanOne() {
        for (JsonNode c : cases()) {
            String text = ReadingOrder.of(c.get("resume"), formatOf(c)).text();

            assertThat(text).as(c.get("name").asText()).doesNotEndWith(" ").doesNotEndWith("\n").doesNotStartWith("\n").doesNotContain("\n\n\n");
        }
    }
}

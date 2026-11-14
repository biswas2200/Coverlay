package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.resumeanalyser.common.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * RB-BLOCK-01, 02, 04 and 06: the blocks of a custom section are validated against exactly the list in the spec. A node
 * type that is not on it is rejected (it cannot be repaired); a mark, an attribute or a key that is not on it is stripped; a
 * table attribute is brought inside its limits. Table cases are the prototype's (frontend/tests/resume-doc.test.js).
 */
class BlockValidatorTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode read(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(json, e);
        }
    }

    private static JsonNode normalize(String body) {
        return BlockValidator.normalize(read(body));
    }

    private static void assertNormalizesTo(String input, String expected) {
        assertThat(normalize(input)).isEqualTo(read(expected));
    }

    private static final String TEXT_P = "{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Hello\"}]}";

    // ---------- paragraphs and lists ----------

    @Test
    void aParagraphWithText_isKept() {
        assertNormalizesTo("[" + TEXT_P + "]", "[" + TEXT_P + "]");
    }

    @Test
    void anEmptyParagraph_hasNoContentKey_however_itWasWritten() {
        assertNormalizesTo("[{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[]},{\"type\":\"paragraph\",\"content\":null}]",
                "[{\"type\":\"paragraph\"},{\"type\":\"paragraph\"},{\"type\":\"paragraph\"}]");
    }

    @Test
    void anEmptyBody_isKeptEmpty() {
        assertThat(normalize("[]")).isEqualTo(read("[]"));
    }

    @Test
    void aBulletList_keepsItsItems() {
        String list = "{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[" + TEXT_P + "]},{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\"}]}]}";

        assertNormalizesTo("[" + list + "]", "[" + list + "]");
    }

    @Test
    void aListItemWithNothingInIt_getsOneEmptyParagraph_asTheEditorsSchemaNeedsOne() {
        assertNormalizesTo("[{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\"}]}]",
                "[{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\"}]}]}]");
    }

    @Test
    void aBulletList_mustHoldListItems_andAListItemOnlyParagraphs() {
        assertThatThrownBy(() -> normalize("[{\"type\":\"bulletList\",\"content\":[" + TEXT_P + "]}]")).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> normalize("[{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"bulletList\",\"content\":[]}]}]}]"))
                .isInstanceOf(BadRequestException.class);
    }

    // ---------- what is not on the list ----------

    @Test
    void aNodeTypeThatIsNotOnTheList_isRejected_withAMessageThePersonCanRead() {
        for (String type : new String[] {"heading", "hardBreak", "image", "script", "codeBlock", "orderedList", "horizontalRule", "summary", "columns"}) {
            assertThatThrownBy(() -> normalize("[{\"type\":\"" + type + "\"}]"))
                    .as(type)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("custom section")
                    .hasMessageContaining(type);
        }
    }

    @Test
    void aBlockThatIsNotAnObjectWithAType_isRejected() {
        for (String body : new String[] {"[1]", "[\"x\"]", "[null]", "[[]]", "[{}]", "[{\"type\":5}]"}) {
            assertThatThrownBy(() -> normalize(body)).as(body).isInstanceOf(BadRequestException.class);
        }
    }

    @Test
    void aBodyThatIsNotAList_isRejected() {
        for (String body : new String[] {"{}", "\"text\"", "5", "null", "true"}) {
            assertThatThrownBy(() -> normalize(body)).as(body).isInstanceOf(BadRequestException.class);
        }
        assertThatThrownBy(() -> BlockValidator.normalize(null)).isInstanceOf(BadRequestException.class);
    }

    @Test
    void aKeyOrAttributeThatIsNotOnTheList_isStripped() {
        assertNormalizesTo("[{\"type\":\"paragraph\",\"foo\":1,\"attrs\":{\"class\":\"x\",\"style\":\"color:red\"},\"content\":[{\"type\":\"text\",\"text\":\"Hi\",\"id\":7}]}]",
                "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Hi\"}]}]");
    }

    // ---------- text and marks (RB-DATA-03, RB-DATA-04, RB-FMT-06) ----------

    @Test
    void anEmptyTextNode_isDropped_andATextThatIsNotText_isRejected() {
        assertNormalizesTo("[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"\"},{\"type\":\"text\",\"text\":\"Hi\"}]}]",
                "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Hi\"}]}]");
        assertThatThrownBy(() -> normalize("[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":5}]}]")).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> normalize("[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\"}]}]")).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> normalize("[{\"type\":\"paragraph\",\"content\":[{\"type\":\"paragraph\"}]}]")).as("a paragraph holds text, not paragraphs").isInstanceOf(BadRequestException.class);
    }

    @Test
    void theMarksOnTheList_areKept_inOneCanonicalOrder() {
        String spelledOneWay = "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"italic\"},{\"type\":\"bold\"},{\"type\":\"underline\"}]}]}]";
        String spelledAnother = "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"underline\"},{\"type\":\"bold\"},{\"type\":\"italic\"}]}]}]";

        assertThat(normalize(spelledOneWay)).isEqualTo(normalize(spelledAnother));
        assertThat(normalize(spelledOneWay).get(0).get("content").get(0).get("marks").toString())
                .isEqualTo("[{\"type\":\"underline\"},{\"type\":\"bold\"},{\"type\":\"italic\"}]");
    }

    @Test
    void aMarkThatIsNotOnTheList_isStripped_andARepeatedOneIsKeptOnce() {
        assertNormalizesTo("[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"code\"},{\"type\":\"strike\"},{\"type\":\"bold\"},{\"type\":\"bold\"},{\"type\":\"highlight\",\"attrs\":{\"color\":\"yellow\"}}]}]}]",
                "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"bold\"}]}]}]");
    }

    @Test
    void aTextColourMark_isKeptOnlyAsAReadableLowerCaseHex() {
        String input = "[{\"type\":\"paragraph\",\"content\":[" +
                "{\"type\":\"text\",\"text\":\"a\",\"marks\":[{\"type\":\"textColor\",\"attrs\":{\"color\":\"#1D4ED8\"}}]}," +
                "{\"type\":\"text\",\"text\":\"b\",\"marks\":[{\"type\":\"textColor\",\"attrs\":{\"color\":\"#fff\"}}]}," +
                "{\"type\":\"text\",\"text\":\"c\",\"marks\":[{\"type\":\"textColor\",\"attrs\":{\"color\":\"red\"}}]}," +
                "{\"type\":\"text\",\"text\":\"d\",\"marks\":[{\"type\":\"textColor\"}]}," +
                "{\"type\":\"text\",\"text\":\"e\",\"marks\":[{\"type\":\"textColor\",\"attrs\":{\"color\":\"#a00\",\"x\":1}}]}]}]";

        assertNormalizesTo(input, "[{\"type\":\"paragraph\",\"content\":[" +
                "{\"type\":\"text\",\"text\":\"a\",\"marks\":[{\"type\":\"textColor\",\"attrs\":{\"color\":\"#1d4ed8\"}}]}," +
                "{\"type\":\"text\",\"text\":\"bcd\"}," +
                "{\"type\":\"text\",\"text\":\"e\",\"marks\":[{\"type\":\"textColor\",\"attrs\":{\"color\":\"#aa0000\"}}]}]}]");
    }

    @Test
    void aLinkMark_keepsOnlyASafeAddress_completedWithHttps() {
        String input = "[{\"type\":\"paragraph\",\"content\":[" +
                "{\"type\":\"text\",\"text\":\"a\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"linkedin.com/in/jane\"}}]}," +
                "{\"type\":\"text\",\"text\":\"b\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"javascript:alert(1)\"}}]}," +
                "{\"type\":\"text\",\"text\":\"c\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"mailto:a@b.co\",\"target\":\"_blank\",\"rel\":\"x\"}}]}," +
                "{\"type\":\"text\",\"text\":\"d\",\"marks\":[{\"type\":\"link\"}]}]}]";

        assertNormalizesTo(input, "[{\"type\":\"paragraph\",\"content\":[" +
                "{\"type\":\"text\",\"text\":\"a\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://linkedin.com/in/jane\"}}]}," +
                "{\"type\":\"text\",\"text\":\"b\"}," +
                "{\"type\":\"text\",\"text\":\"c\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"mailto:a@b.co\"}}]}," +
                "{\"type\":\"text\",\"text\":\"d\"}]}]");
    }

    @Test
    void neighbouringTextWithTheSameMarks_isOneTextNode_andDifferentMarksAreNot() {
        assertNormalizesTo("[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"a\"},{\"type\":\"text\",\"text\":\"b\"},{\"type\":\"text\",\"text\":\"c\",\"marks\":[{\"type\":\"bold\"}]}]}]",
                "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"ab\"},{\"type\":\"text\",\"text\":\"c\",\"marks\":[{\"type\":\"bold\"}]}]}]");
    }

    // ---------- tables (RB-BLOCK-04, RB-BLOCK-06) ----------

    private static String table(String attrs) {
        return "[{\"type\":\"table\"" + attrs + ",\"content\":[{\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\"}]}]}]}]";
    }

    private static JsonNode attrsOf(String attrs) {
        return normalize(table(attrs)).get(0).get("attrs");
    }

    private static final String DEFAULT_ATTRS = "{\"borders\":\"all\",\"borderWidth\":1,\"borderStyle\":\"solid\",\"cellPadding\":4,\"cellGap\":0}";

    @Test
    void aTableAlwaysHasAllFiveAttributes_atTheirDefaultsWhenMissing() {
        assertThat(attrsOf("")).isEqualTo(read(DEFAULT_ATTRS));
        assertThat(attrsOf(",\"attrs\":{}")).isEqualTo(read(DEFAULT_ATTRS));
        assertThat(attrsOf(",\"attrs\":null")).isEqualTo(read(DEFAULT_ATTRS));
        assertThat(attrsOf(",\"attrs\":\"junk\"")).isEqualTo(read(DEFAULT_ATTRS));
    }

    @Test
    void aTableThatHasOnlySomeAttributes_isTheSameTableAsOneWithTheRestAtTheirDefaults() {
        assertThat(normalize(table(",\"attrs\":{\"borderWidth\":2}")))
                .isEqualTo(normalize(table(",\"attrs\":{\"borders\":\"all\",\"borderWidth\":2,\"borderStyle\":\"solid\",\"cellPadding\":4,\"cellGap\":0}")));
    }

    @Test
    void validAttributes_areKept() {
        assertThat(attrsOf(",\"attrs\":{\"borders\":\"rows\",\"borderWidth\":2.5,\"borderStyle\":\"dashed\",\"cellPadding\":8,\"cellGap\":3}"))
                .isEqualTo(read("{\"borders\":\"rows\",\"borderWidth\":2.5,\"borderStyle\":\"dashed\",\"cellPadding\":8,\"cellGap\":3}"));
    }

    @Test
    void anAttributeOutsideItsLimits_isBroughtInside_andRoundedToTheStep() {
        JsonNode loud = attrsOf(",\"attrs\":{\"borderWidth\":99,\"cellPadding\":-3,\"cellGap\":3.3}");

        assertThat(loud.get("borderWidth").asDouble()).isEqualTo(6.0);
        assertThat(loud.get("cellPadding").asDouble()).isEqualTo(0.0);
        assertThat(loud.get("cellGap").asDouble()).as("rounded to the nearest half point").isEqualTo(3.5);
        assertThat(attrsOf(",\"attrs\":{\"borderWidth\":\"0.3\"}").get("borderWidth").asDouble()).as("a typed value is read as a number").isEqualTo(0.25);
    }

    @Test
    void anAttributeThatIsNotANumber_isTheDefault_notZero() {
        assertThat(attrsOf(",\"attrs\":{\"borderWidth\":\"thick\"}").get("borderWidth").asDouble()).isEqualTo(1.0);
        assertThat(attrsOf(",\"attrs\":{\"borderWidth\":\"\"}").get("borderWidth").asDouble()).as("a cleared box is not a zero").isEqualTo(1.0);
        assertThat(attrsOf(",\"attrs\":{\"cellPadding\":null,\"cellGap\":[]}").get("cellPadding").asDouble()).isEqualTo(4.0);
        assertThat(attrsOf(",\"attrs\":{\"cellGap\":{}}").get("cellGap").asDouble()).isEqualTo(0.0);
    }

    @Test
    void aWordThatIsNotOnTheList_isTheDefault_andHostileTextNeverGetsThrough() {
        for (String bad : new String[] {"{\"borders\":\"sideways\"}", "{\"borderStyle\":\"wavy\"}", "{\"borders\":\"<b>\"}", "{\"borders\":\"x;}</style>\",\"borderStyle\":\"red; background:url(x)\",\"borderWidth\":\"1pt; color:red\",\"cellPadding\":\"calc(1px)\"}"}) {
            assertThat(attrsOf(",\"attrs\":" + bad)).as(bad).isEqualTo(read(DEFAULT_ATTRS));
        }
    }

    @Test
    void aBorderWidthOfZero_keepsTheTable_andTheOldNoneBecomesExactlyThat() {
        assertThat(attrsOf(",\"attrs\":{\"borderWidth\":0}")).isEqualTo(read("{\"borders\":\"all\",\"borderWidth\":0,\"borderStyle\":\"solid\",\"cellPadding\":4,\"cellGap\":0}"));
        assertThat(attrsOf(",\"attrs\":{\"borders\":\"none\"}")).isEqualTo(read("{\"borders\":\"all\",\"borderWidth\":0,\"borderStyle\":\"solid\",\"cellPadding\":4,\"cellGap\":0}"));
        assertThat(attrsOf(",\"attrs\":{\"borders\":\"none\",\"borderWidth\":2}")).as("an explicit width wins over the old word")
                .isEqualTo(read("{\"borders\":\"all\",\"borderWidth\":2,\"borderStyle\":\"solid\",\"cellPadding\":4,\"cellGap\":0}"));
    }

    @Test
    void aTableKeepsItsRowsAndCells() {
        String body = "[{\"type\":\"table\",\"attrs\":" + DEFAULT_ATTRS + ",\"content\":[" +
                "{\"type\":\"tableRow\",\"content\":[{\"type\":\"tableHeader\",\"content\":[" + TEXT_P + "]},{\"type\":\"tableHeader\",\"content\":[{\"type\":\"paragraph\"}]}]}," +
                "{\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\",\"content\":[{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\"}]}]}]},{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\"}]}]}]}]";

        assertNormalizesTo(body, body);
    }

    @Test
    void aCellWrittenWithOrWithoutTheDefaultAttributes_isTheSameCell() {
        String withDefaults = "[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\",\"attrs\":{\"colspan\":1,\"rowspan\":1,\"colwidth\":null},\"content\":[{\"type\":\"paragraph\"}]}]}]}]";
        String without = table("");

        assertThat(normalize(withDefaults)).isEqualTo(normalize(without));
        assertThat(normalize(withDefaults).get(0).get("content").get(0).get("content").get(0).has("attrs")).as("a default is not written").isFalse();
    }

    @Test
    void aCellAttributeThatIsNotADefault_isKept_ifItIsValid() {
        String input = "[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[" +
                "{\"type\":\"tableCell\",\"attrs\":{\"colspan\":2,\"rowspan\":3,\"colwidth\":[120,80],\"style\":\"x\"},\"content\":[{\"type\":\"paragraph\"}]}]}]}]";

        JsonNode cell = normalize(input).get(0).get("content").get(0).get("content").get(0);

        assertThat(cell.get("attrs")).isEqualTo(read("{\"colspan\":2,\"rowspan\":3,\"colwidth\":[120,80]}"));
    }

    @Test
    void aCellAttributeThatIsNotValid_isTheDefault() {
        String input = "[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[" +
                "{\"type\":\"tableCell\",\"attrs\":{\"colspan\":0,\"rowspan\":\"2\",\"colwidth\":[-5,\"x\"]},\"content\":[{\"type\":\"paragraph\"}]}," +
                "{\"type\":\"tableCell\",\"attrs\":{\"colspan\":1.5,\"rowspan\":100000,\"colwidth\":\"wide\"},\"content\":[{\"type\":\"paragraph\"}]}]}]}]";

        JsonNode row = normalize(input).get(0).get("content").get(0).get("content");

        assertThat(row.get(0).has("attrs")).isFalse();
        assertThat(row.get(1).get("attrs")).as("a huge span is brought inside the limit").isEqualTo(read("{\"rowspan\":100}"));
    }

    @Test
    void aCellWithNothingInIt_getsOneEmptyParagraph() {
        JsonNode body = normalize("[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\"}]}]}]");

        assertThat(body.get(0).get("content").get(0).get("content").get(0).get("content")).isEqualTo(read("[{\"type\":\"paragraph\"}]"));
    }

    @Test
    void aTableInsideACell_isRejected_noNesting() {
        String nested = "[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\",\"content\":[" + table("").substring(1, table("").length() - 1) + "]}]}]}]";

        assertThatThrownBy(() -> normalize(nested)).isInstanceOf(BadRequestException.class).hasMessageContaining("table");
    }

    @Test
    void aTableThatCannotBeRepaired_isRejected() {
        for (String body : new String[] {
                "[{\"type\":\"table\"}]",
                "[{\"type\":\"table\",\"content\":[]}]",
                "[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\"}]}]",
                "[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[]}]}]",
                "[{\"type\":\"table\",\"content\":[" + TEXT_P + "]}]",
                "[{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[" + TEXT_P + "]}]}]",
                "[{\"type\":\"tableRow\",\"content\":[]}]",
                "[{\"type\":\"tableCell\",\"content\":[]}]"}) {
            assertThatThrownBy(() -> normalize(body)).as(body).isInstanceOf(BadRequestException.class);
        }
    }

    // ---------- a new section, and idempotence ----------

    @Test
    void aNewTableSection_asThePrototypeWritesIt_normalisesToAnEmptyVisibleGrid() {
        String cell = "{\"type\":\"tableCell\",\"attrs\":{\"colspan\":1,\"rowspan\":1,\"colwidth\":null},\"content\":[{\"type\":\"paragraph\"}]}";
        String row = "{\"type\":\"tableRow\",\"content\":[" + cell + "," + cell + "," + cell + "]}";
        String body = "[{\"type\":\"table\",\"attrs\":" + DEFAULT_ATTRS + ",\"content\":[" + row + "," + row + "]}]";

        JsonNode normal = normalize(body);

        assertThat(normal.get(0).get("attrs")).as("visible lines: a full grid, 1 pt, solid").isEqualTo(read(DEFAULT_ATTRS));
        assertThat(normal.get(0).get("content")).hasSize(2);
        assertThat(normal.get(0).get("content").get(0).get("content")).hasSize(3);
        assertThat(normal.toString()).doesNotContain("colspan").doesNotContain("colwidth");
    }

    @Test
    void normalising_isIdempotent() {
        String body = "[" + TEXT_P + ",{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\"}]}," +
                table(",\"attrs\":{\"borders\":\"none\",\"cellGap\":3.3}").substring(1, table(",\"attrs\":{\"borders\":\"none\",\"cellGap\":3.3}").length() - 1) +
                ",{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"italic\"},{\"type\":\"link\",\"attrs\":{\"href\":\"a.co\"}},{\"type\":\"code\"}]}]}]";

        JsonNode once = normalize(body);

        assertThat(BlockValidator.normalize(once)).isEqualTo(once);
    }
}

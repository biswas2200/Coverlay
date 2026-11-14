package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.resumeanalyser.common.BadRequestException;
import com.resumeanalyser.common.PayloadTooLargeException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * RB-DATA-01, RB-DATA-02, RB-DATA-05 and BE-01, BE-02: a whole resume is repaired the way the prototype repairs it
 * (frontend/src/js/pages/resume-builder-rules.js, normalizeText; resume-doc.js, canonical), or refused with a message
 * the person can read. Nothing is truncated silently.
 */
class ResumeNormalizerTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String SPEC_EXAMPLE = """
            {
              "name": "Jane Doe",
              "contact": "jane@email.com | +91 98765 43210 | Bengaluru",
              "summary": "Backend developer with 3 years of <b>Java</b> experience.",
              "experience": [{ "role": "Software Engineer, Acme Corp", "dates": "2021 - now", "details": "Built the payment APIs." }],
              "education": [{ "degree": "B.Tech Computer Science, VIT", "dates": "2021" }],
              "skills": ["Java", "Spring Boot", "SQL"]
            }
            """;

    private static JsonNode read(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(json, e);
        }
    }

    private static ObjectNode normalize(String json) {
        return ResumeNormalizer.normalize(read(json));
    }

    /** The example resume with one top-level field replaced by the given JSON. */
    private static String with(String field, String jsonValue) {
        ObjectNode resume = (ObjectNode) read(SPEC_EXAMPLE);
        resume.set(field, read(jsonValue));
        return resume.toString();
    }

    private static String without(String field) {
        ObjectNode resume = (ObjectNode) read(SPEC_EXAMPLE);
        resume.remove(field);
        return resume.toString();
    }

    // ---------- a good resume ----------

    @Test
    void aResumeThatIsAlreadyCanonical_comesBackExactlyAsItWas() {
        assertThat(normalize(SPEC_EXAMPLE)).isEqualTo(read(SPEC_EXAMPLE));
    }

    @Test
    void normalising_isIdempotent() {
        String messy = with("summary", "\"  <i><b>x</b></i>\\n\\t&  <u>y</u> \"");

        ObjectNode once = normalize(messy);

        assertThat(ResumeNormalizer.normalize(once)).isEqualTo(once);
    }

    @Test
    void theInputIsNeverChanged() {
        JsonNode input = read(with("name", "\"  Jane   Doe \""));
        JsonNode copy = input.deepCopy();

        ResumeNormalizer.normalize(input);

        assertThat(input).isEqualTo(copy);
    }

    @Test
    void fieldsThatAreNotInTheModel_areDropped() {
        ObjectNode resume = (ObjectNode) read(SPEC_EXAMPLE);
        resume.put("photoUrl", "http://evil.example/x.png");
        ((ObjectNode) resume.get("experience").get(0)).put("company", "Acme");
        ((ObjectNode) resume.get("education").get(0)).put("gpa", 9.1);

        assertThat(ResumeNormalizer.normalize(resume)).isEqualTo(read(SPEC_EXAMPLE));
    }

    // ---------- plain and rich text (RB-DATA-02) ----------

    @Test
    void whitespaceInEveryField_isCollapsedToSingleSpaces_andTrimmed() {
        ObjectNode result = normalize("""
                {
                  "name": "  Jane \\n  Doe\\t",
                  "contact": "jane@email.com   |\\n+91 98765 43210",
                  "summary": "  Built\\n\\n APIs.  ",
                  "experience": [{ "role": " Engineer ,\\nAcme ", "dates": " 2021 \\t- now ", "details": "  Did\\r\\nthings.  " }],
                  "education": [{ "degree": "  B.Tech\\nCS ", "dates": "\\n2021\\n" }],
                  "skills": ["  Spring   Boot ", "\\tSQL\\n"]
                }
                """);

        assertThat(result.get("name").asText()).isEqualTo("Jane Doe");
        assertThat(result.get("contact").asText()).isEqualTo("jane@email.com | +91 98765 43210");
        assertThat(result.get("summary").asText()).isEqualTo("Built APIs.");
        assertThat(result.at("/experience/0/role").asText()).isEqualTo("Engineer , Acme");
        assertThat(result.at("/experience/0/dates").asText()).isEqualTo("2021 - now");
        assertThat(result.at("/experience/0/details").asText()).isEqualTo("Did things.");
        assertThat(result.at("/education/0/degree").asText()).isEqualTo("B.Tech CS");
        assertThat(result.at("/education/0/dates").asText()).isEqualTo("2021");
        assertThat(result.get("skills")).isEqualTo(read("[\"Spring Boot\", \"SQL\"]"));
    }

    @Test
    void aNonBreakingSpace_isASpaceToo_asItIsInTheBrowser() {
        assertThat(normalize(with("name", "\"Jane\u00a0\u00a0Doe\u3000\"")).get("name").asText()).isEqualTo("Jane Doe");
    }

    @Test
    void controlCharacters_areRemoved_fromEveryKindOfField() {
        ObjectNode input = (ObjectNode) read(SPEC_EXAMPLE);
        input.put("name", "Ja\u0000ne\u0007 Doe");
        input.put("summary", "Backend\u0001 develo\u007fper with <b>Ja\u0000va</b>");
        ((ObjectNode) input.get("experience").get(0)).put("dates", "20\u000021 - now");
        input.set("skills", read("[\"Ja\\u0000va\", \"\\u0000\"]"));

        ObjectNode result = ResumeNormalizer.normalize(input);

        assertThat(result.get("name").asText()).isEqualTo("Jane Doe");
        assertThat(result.get("summary").asText()).isEqualTo("Backend developer with <b>Java</b>");
        assertThat(result.at("/experience/0/dates").asText()).isEqualTo("2021 - now");
        assertThat(result.get("skills")).as("a skill that was only control characters is an emptied skill").isEqualTo(read("[\"Java\"]"));
    }

    @Test
    void aPlainField_staysPlain_markupCharactersAreJustText() {
        ObjectNode result = normalize(with("name", "\"A <b>&</b> B\""));

        assertThat(result.get("name").asText()).as("a plain field is shown as text, never as markup").isEqualTo("A <b>&</b> B");
    }

    @Test
    void aRichField_isWrittenInTheOneCanonicalForm() {
        ObjectNode result = normalize(with("summary", "\"<i><b>Fast</b></i> and <a href=\\\"linkedin.com/in/jane\\\">me</a>\""));

        assertThat(result.get("summary").asText()).isEqualTo("<b><i>Fast</i></b> and <a href=\"https://linkedin.com/in/jane\">me</a>");
    }

    @Test
    void markupOutsideTheGrammar_isNeverStored() {
        ObjectNode result = normalize(with("summary",
                "\"<script>alert(1)</script><a href=\\\"javascript:alert(1)\\\">x</a><font color=\\\"#ffffff\\\">hidden</font>\""));

        String stored = result.get("summary").asText();
        assertThat(stored).doesNotContain("<script").doesNotContain("javascript:").doesNotContain("#ffffff");
        assertThat(RichText.plainText(stored)).isEqualTo("<script>alert(1)</script>xhidden");
    }

    @Test
    void everyRichFieldIsNormalised_notJustTheSummary() {
        String bad = "<i><b>x</b></i>";
        ObjectNode result = normalize("""
                {
                  "name": "Jane",
                  "contact": "%1$s",
                  "summary": "%1$s",
                  "experience": [{ "role": "%1$s", "dates": "%1$s", "details": "%1$s" }],
                  "education": [{ "degree": "%1$s", "dates": "%1$s" }],
                  "skills": ["%1$s"]
                }
                """.formatted(bad));

        for (String path : new String[] {"/contact", "/summary", "/experience/0/role", "/experience/0/details", "/education/0/degree"}) {
            assertThat(result.at(path).asText()).as(path).isEqualTo("<b><i>x</i></b>");
        }
        for (String path : new String[] {"/experience/0/dates", "/education/0/dates", "/skills/0"}) {
            assertThat(result.at(path).asText()).as(path + " is plain text").isEqualTo(bad);
        }
    }

    // ---------- skills, jobs and schools (RB-DATA-05) ----------

    @Test
    void anEmptiedSkill_isRemoved() {
        ObjectNode result = normalize(with("skills", "[\"Java\", \"\", \"   \", \"\\n\", \"SQL\"]"));

        assertThat(result.get("skills")).isEqualTo(read("[\"Java\", \"SQL\"]"));
    }

    @Test
    void noJobsAndNoSchools_isAnEmptyList() {
        ObjectNode input = (ObjectNode) read(SPEC_EXAMPLE);
        input.set("experience", read("[]"));
        input.set("education", read("[]"));

        ObjectNode result = ResumeNormalizer.normalize(input);

        assertThat(result.get("experience")).isEqualTo(read("[]"));
        assertThat(result.get("education")).isEqualTo(read("[]"));
    }

    @Test
    void aBlankRow_isKeptAsABlankRow_theServerDoesNotDecideWhatIsEmpty() {
        ObjectNode result = normalize(with("experience", "[{\"role\":\"\",\"dates\":\"\",\"details\":\"\"}]"));

        assertThat(result.get("experience")).isEqualTo(read("[{\"role\":\"\",\"dates\":\"\",\"details\":\"\"}]"));
    }

    // ---------- custom sections (RB-DATA-01, RB-BLOCK-01) ----------

    @Test
    void extra_isAbsent_whenTheResumeHasNoCustomSections() {
        assertThat(normalize(SPEC_EXAMPLE).has("extra")).isFalse();
        assertThat(normalize(with("extra", "null")).has("extra")).as("null is the same as absent").isFalse();
    }

    @Test
    void extra_isKeptAsAnEmptyList_whenItWasThere() {
        ObjectNode result = normalize(with("extra", "[]"));

        assertThat(result.has("extra")).isTrue();
        assertThat(result.get("extra")).isEqualTo(read("[]"));
    }

    @Test
    void aCustomSection_hasItsTitleCleaned_andItsBodyChecked() {
        ObjectNode result = normalize(with("extra", """
                [{ "title": "  Skills   by\\narea ", "photo": "x", "body": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Hi", "marks": [{ "type": "bold" }, { "type": "sparkle" }] }] }
                ] }]
                """));

        assertThat(result.get("extra")).isEqualTo(read("""
                [{ "title": "Skills by area", "body": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Hi", "marks": [{ "type": "bold" }] }] }
                ] }]
                """));
    }

    @Test
    void aCustomSectionTitle_isOneToEightyCharacters() {
        String eighty = "a".repeat(80);
        String body = "\"body\": []";

        assertThat(normalize(with("extra", "[{\"title\":\"" + eighty + "\"," + body + "}]")).at("/extra/0/title").asText()).isEqualTo(eighty);
        for (String bad : new String[] {"\"title\":\"" + eighty + "a\"", "\"title\":\"\"", "\"title\":\"  \\n \"", "\"title\":null", "\"title\":5", "\"x\":1"}) {
            assertThatThrownBy(() -> normalize(with("extra", "[{" + bad + "," + body + "}]")))
                    .as(bad)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("title");
        }
    }

    @Test
    void aCustomSectionBody_thatCannotBeRepaired_isRefused_andSaysWhichSection() {
        assertThatThrownBy(() -> normalize(with("extra", "[{\"title\":\"Projects\",\"body\":[{\"type\":\"heading\"}]}]")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("Projects")
                .hasMessageContaining("heading");
        assertThatThrownBy(() -> normalize(with("extra", "[{\"title\":\"Projects\"}]")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("Projects");
    }

    @Test
    void extra_thatIsNotAList_orHoldsSomethingElse_isRefused() {
        for (String bad : new String[] {"{}", "\"x\"", "5", "[1]", "[null]", "[[]]"}) {
            assertThatThrownBy(() -> normalize(with("extra", bad)))
                    .as(bad)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("custom section");
        }
    }

    // ---------- what cannot be repaired (BE-01) ----------

    @Test
    void whatIsNotAResume_isRefused() {
        for (String bad : new String[] {"[]", "\"resume\"", "5", "true", "null"}) {
            assertThatThrownBy(() -> ResumeNormalizer.normalize(read(bad)))
                    .as(bad)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("resume");
        }
        assertThatThrownBy(() -> ResumeNormalizer.normalize(null)).isInstanceOf(BadRequestException.class);
    }

    @Test
    void aMissingOrWrongTypedField_isRefused_andNamed() {
        for (String field : new String[] {"name", "contact", "summary", "experience", "education", "skills"}) {
            assertThatThrownBy(() -> normalize(without(field)))
                    .as("missing " + field)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining(field);
            assertThatThrownBy(() -> normalize(with(field, "null")))
                    .as("null " + field)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining(field);
        }
        assertThatThrownBy(() -> normalize(with("name", "5"))).isInstanceOf(BadRequestException.class).hasMessageContaining("name");
        assertThatThrownBy(() -> normalize(with("skills", "\"Java\""))).isInstanceOf(BadRequestException.class).hasMessageContaining("skills");
        assertThatThrownBy(() -> normalize(with("experience", "{}"))).isInstanceOf(BadRequestException.class).hasMessageContaining("experience");
    }

    @Test
    void aSkillThatIsNotText_isRefused_notQuietlyDropped() {
        for (String bad : new String[] {"[5]", "[null]", "[[\"x\"]]", "[{}]"}) {
            assertThatThrownBy(() -> normalize(with("skills", bad)))
                    .as(bad)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("skill");
        }
    }

    @Test
    void aJobOrSchoolWithAMissingOrWrongTypedField_isRefused_andNamed() {
        for (String bad : new String[] {"[{\"role\":\"x\",\"dates\":\"y\"}]", "[{\"role\":1,\"dates\":\"y\",\"details\":\"z\"}]", "[\"x\"]", "[null]"}) {
            assertThatThrownBy(() -> normalize(with("experience", bad)))
                    .as(bad)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("experience");
        }
        for (String bad : new String[] {"[{\"degree\":\"x\"}]", "[{\"degree\":\"x\",\"dates\":null}]", "[3]"}) {
            assertThatThrownBy(() -> normalize(with("education", bad)))
                    .as(bad)
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("education");
        }
    }

    // ---------- the size limit (BE-02) ----------

    private static final int LIMIT = ResumeNormalizer.MAX_BYTES;

    private static String summaryOfSize(int bytes) {
        ObjectNode resume = (ObjectNode) read(SPEC_EXAMPLE);
        resume.put("summary", "");
        int base = resume.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        // Spaces would be collapsed; letters are not, so the size we ask for is the size we get.
        return resume.put("summary", "a".repeat(bytes - base)).toString();
    }

    @Test
    void theLimit_isTwoHundredKilobytes() {
        assertThat(LIMIT).isEqualTo(200 * 1024);
    }

    private static int bytesOf(String json) {
        return json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
    }

    @Test
    void aResumeAtTheLimit_isAccepted() {
        String atTheLimit = summaryOfSize(LIMIT);

        assertThat(bytesOf(atTheLimit)).as("the helper builds exactly the size asked for").isEqualTo(LIMIT);
        assertThatCode(() -> normalize(atTheLimit)).doesNotThrowAnyException();
    }

    @Test
    void aResumeOneByteOverTheLimit_isRefusedWith413_notTruncated() {
        String overTheLimit = summaryOfSize(LIMIT + 1);

        assertThat(bytesOf(overTheLimit)).isEqualTo(LIMIT + 1);
        assertThatThrownBy(() -> normalize(overTheLimit))
                .isInstanceOf(PayloadTooLargeException.class)
                .hasMessageContaining("200 KB");
    }

    @Test
    void theSizeIsMeasuredInBytes_notCharacters() {
        // Each "é" is two bytes, so half the limit in characters is already over it.
        ObjectNode resume = (ObjectNode) read(SPEC_EXAMPLE);
        resume.put("summary", "é".repeat(LIMIT / 2 + 1));

        assertThatThrownBy(() -> ResumeNormalizer.normalize(resume)).isInstanceOf(PayloadTooLargeException.class);
    }
}

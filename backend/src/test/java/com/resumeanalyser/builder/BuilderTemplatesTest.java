package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.resumeanalyser.common.BadRequestException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * RB-TPL-02 and RB-FMT-05: the fixed catalogue of templates, and what choosing one does to the format. The numbers are the
 * prototype's TEMPLATES (frontend/src/js/pages/resume-builder-rules.js) and chooseTemplate (resume-builder.js).
 */
class BuilderTemplatesTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static BuilderFormat format(String json) throws Exception {
        return FormatNormalizer.normalize(JSON.readTree(json));
    }

    private static List<Double> margins(BuilderFormat format) {
        return List.of(format.marginTop(), format.marginBottom(), format.marginLeft(), format.marginRight());
    }

    // ---------- the catalogue ----------

    @Test
    void theCatalogue_isTheSevenTemplatesInTheirFixedOrder() {
        assertThat(BuilderTemplates.all()).extracting(BuilderTemplate::id)
                .containsExactly("clean", "modern", "compact", "academic", "classic", "sidebar", "executive");
        assertThat(BuilderTemplates.all()).extracting(BuilderTemplate::name)
                .containsExactly("Clean", "Modern", "Compact", "Academic", "Classic", "Sidebar", "Executive");
    }

    @Test
    void everyTemplate_setsASizeAMarginAndColumns_asTheSpecTableSays() {
        assertThat(BuilderTemplates.byId("clean")).extracting(BuilderTemplate::columns, BuilderTemplate::fontSize, BuilderTemplate::margin).containsExactly(1, 11.0, 19.1);
        assertThat(BuilderTemplates.byId("modern")).extracting(BuilderTemplate::columns, BuilderTemplate::fontSize, BuilderTemplate::margin).containsExactly(1, 11.0, 19.1);
        assertThat(BuilderTemplates.byId("compact")).extracting(BuilderTemplate::columns, BuilderTemplate::fontSize, BuilderTemplate::margin).containsExactly(1, 10.0, 12.7);
        assertThat(BuilderTemplates.byId("academic")).extracting(BuilderTemplate::columns, BuilderTemplate::fontSize, BuilderTemplate::margin).containsExactly(1, 11.0, 19.1);
        assertThat(BuilderTemplates.byId("classic")).extracting(BuilderTemplate::columns, BuilderTemplate::fontSize, BuilderTemplate::margin).containsExactly(1, 11.0, 19.1);
        assertThat(BuilderTemplates.byId("sidebar")).extracting(BuilderTemplate::columns, BuilderTemplate::fontSize, BuilderTemplate::margin).containsExactly(2, 10.5, 15.0);
        assertThat(BuilderTemplates.byId("executive")).extracting(BuilderTemplate::columns, BuilderTemplate::fontSize, BuilderTemplate::margin).containsExactly(2, 11.0, 19.1);
    }

    @Test
    void onlyClassic_isPdfOnly() {
        assertThat(BuilderTemplates.all()).filteredOn(BuilderTemplate::pdfOnly).extracting(BuilderTemplate::id).containsExactly("classic");
    }

    @Test
    void everyTemplatesNumbers_areValidInTheFormat() throws Exception {
        for (BuilderTemplate template : BuilderTemplates.all()) {
            BuilderFormat applied = BuilderTemplates.apply(template, FormatNormalizer.normalize(null));

            assertThat(applied.fontSize()).as(template.id()).isEqualTo(template.fontSize());
            assertThat(margins(applied)).as(template.id()).containsOnly(template.margin());
            assertThat(applied.columns()).as(template.id()).isEqualTo(template.columns());
        }
    }

    @Test
    void anUnknownTemplate_isRefused_andTheMessageListsTheOnesThatExist() {
        assertThatThrownBy(() -> BuilderTemplates.byId("fancy"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("fancy")
                .hasMessageContaining("clean")
                .hasMessageContaining("executive");
        for (String bad : new String[] {"", " ", "CLEAN", "Clean"}) {
            assertThatThrownBy(() -> BuilderTemplates.byId(bad)).as("'" + bad + "'").isInstanceOf(BadRequestException.class);
        }
        assertThatThrownBy(() -> BuilderTemplates.byId(null)).isInstanceOf(BadRequestException.class);
    }

    // ---------- choosing one (RB-FMT-05) ----------

    @Test
    void choosingATemplate_setsTheSizeTheFourMarginsAndTheColumns() throws Exception {
        BuilderFormat compact = BuilderTemplates.apply(BuilderTemplates.byId("compact"), FormatNormalizer.normalize(null));
        BuilderFormat sidebar = BuilderTemplates.apply(BuilderTemplates.byId("sidebar"), FormatNormalizer.normalize(null));

        assertThat(compact.fontSize()).isEqualTo(10.0);
        assertThat(margins(compact)).containsOnly(12.7);
        assertThat(compact.columns()).isEqualTo(1);
        assertThat(sidebar.fontSize()).isEqualTo(10.5);
        assertThat(margins(sidebar)).containsOnly(15.0);
        assertThat(sidebar.columns()).isEqualTo(2);
    }

    @Test
    void choosingATemplate_keepsEverythingElseThePersonSet() throws Exception {
        BuilderFormat mine = format("{\"spacing\":\"airy\",\"align\":\"center\",\"bullets\":true,\"style\":\"concise\",\"page\":\"letter\",\"unit\":\"in\",\"rules\":true,\"hidden\":[\"skills\"],\"fontSize\":13,\"marginLeft\":30}");

        BuilderFormat applied = BuilderTemplates.apply(BuilderTemplates.byId("compact"), mine);

        assertThat(applied.spacing()).isEqualTo("airy");
        assertThat(applied.align()).isEqualTo("center");
        assertThat(applied.bullets()).isTrue();
        assertThat(applied.style()).isEqualTo("concise");
        assertThat(applied.page()).isEqualTo("letter");
        assertThat(applied.unit()).isEqualTo("in");
        assertThat(applied.rules()).isTrue();
        assertThat(applied.hidden()).containsExactly("skills");
        assertThat(applied.fontSize()).as("the template's size replaces the person's").isEqualTo(10.0);
        assertThat(applied.marginLeft()).as("and so do the margins").isEqualTo(12.7);
    }

    // ---------- the typeface ----------

    @Test
    void classic_bringsItsTypeface_executiveBringsSerif() throws Exception {
        BuilderFormat base = FormatNormalizer.normalize(null);

        assertThat(BuilderTemplates.apply(BuilderTemplates.byId("classic"), base).font()).isEqualTo("classic");
        assertThat(BuilderTemplates.apply(BuilderTemplates.byId("executive"), base).font()).isEqualTo("serif");
    }

    @Test
    void aTemplateWithNoTypeface_keepsThePersonsFont() throws Exception {
        for (String font : List.of("sans", "serif")) {
            BuilderFormat mine = format("{\"font\":\"" + font + "\"}");

            assertThat(BuilderTemplates.apply(BuilderTemplates.byId("clean"), mine).font()).as(font).isEqualTo(font);
            assertThat(BuilderTemplates.apply(BuilderTemplates.byId("academic"), mine).font()).as(font).isEqualTo(font);
        }
    }

    @Test
    void leavingClassic_goesBackToSans_unlessTheNewTemplateHasItsOwnTypeface() throws Exception {
        BuilderFormat inClassic = BuilderTemplates.apply(BuilderTemplates.byId("classic"), FormatNormalizer.normalize(null));

        assertThat(BuilderTemplates.apply(BuilderTemplates.byId("clean"), inClassic).font()).isEqualTo("sans");
        assertThat(BuilderTemplates.apply(BuilderTemplates.byId("sidebar"), inClassic).font()).isEqualTo("sans");
        assertThat(BuilderTemplates.apply(BuilderTemplates.byId("executive"), inClassic).font()).isEqualTo("serif");
    }

    @Test
    void theResult_isAlwaysAValidFormat() throws Exception {
        JsonNode asJson = JSON.valueToTree(BuilderTemplates.apply(BuilderTemplates.byId("sidebar"), FormatNormalizer.normalize(null)));

        assertThat(FormatNormalizer.normalize(asJson)).isEqualTo(BuilderTemplates.apply(BuilderTemplates.byId("sidebar"), FormatNormalizer.normalize(null)));
    }
}

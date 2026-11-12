package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.resumeanalyser.account.User;
import com.resumeanalyser.builder.dto.DocumentDto;
import com.resumeanalyser.builder.dto.DocumentSummaryDto;
import com.resumeanalyser.builder.dto.VersionDto;
import com.resumeanalyser.common.BadRequestException;
import com.resumeanalyser.common.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Documents and their versions (docs/prototype-spec.md section 9.1, RB-VER, RB-TPL, BE-01..BE-04). Run against an in-memory
 * store, so every case looks at what was really stored.
 */
class BuilderDocumentServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-11-08T10:00:00Z");

    private final InMemoryBuilderStore store = new InMemoryBuilderStore();
    private final User asha = new User();
    private final User ravi = new User();
    private MutableClock clock;
    private BuilderDocumentService service;

    /** A clock the test can move forward. */
    static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advanceSeconds(long seconds) {
            now = now.plusSeconds(seconds);
        }

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @BeforeEach
    void setUp() {
        clock = new MutableClock(NOW);
        service = new BuilderDocumentService(store.documents, store.versions, clock);
    }

    private static JsonNode json(String text) {
        try {
            return JSON.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException(text, e);
        }
    }

    private DocumentDto start(User user, String role, String templateId) {
        return service.create(user, json("{\"role\":\"" + role + "\",\"level\":\"senior\",\"style\":\"modern\",\"pages\":2}"), templateId);
    }

    // ---------- start (POST /builder/documents) ----------

    @Test
    void startingADocument_makesVersionOneFromTheTemplate() {
        DocumentDto document = start(asha, "Backend Developer", "compact");

        assertThat(document.id()).isNotNull();
        assertThat(document.title()).isEqualTo("Backend Developer");
        assertThat(document.answers()).isEqualTo(new BuilderAnswers("Backend Developer", "senior", "modern", 2));
        assertThat(document.templateId()).isEqualTo("compact");
        assertThat(document.current()).isEqualTo(1);
        assertThat(document.versions()).hasSize(1);
        assertThat(document.versions().get(0).number()).isEqualTo(1);
        assertThat(document.versions().get(0).source()).isEqualTo("template");
        assertThat(document.versions().get(0).summary()).isEqualTo("Started from template Compact");
        assertThat(document.versions().get(0).at()).isEqualTo(NOW.toEpochMilli());
    }

    @Test
    void theFirstResume_isTheSampleTheTemplatePageShows_andIsAlreadyCanonical() {
        JsonNode resume = start(asha, "", "clean").versions().get(0).resume();

        assertThat(resume).isEqualTo(json("""
                {
                  "name": "Jane Doe",
                  "contact": "jane@email.com | +91 98765 43210 | Bengaluru",
                  "summary": "Backend developer with 3 years of Java and Spring Boot experience. Built payment APIs used by 2 million people and cut their response time by 40%.",
                  "experience": [{ "role": "Software Engineer, Acme Corp", "dates": "2021 - now", "details": "Built and ran the payment APIs: Java, Spring Boot, PostgreSQL." }],
                  "education": [{ "degree": "B.Tech Computer Science, VIT", "dates": "2021" }],
                  "skills": ["Java", "Spring Boot", "SQL"]
                }
                """));
        assertThat(ResumeNormalizer.normalize(resume)).isEqualTo(resume);
    }

    @Test
    void theTemplate_setsTheFormat() {
        BuilderFormat format = start(asha, "x", "sidebar").format();

        assertThat(format.columns()).isEqualTo(2);
        assertThat(format.fontSize()).isEqualTo(10.5);
        assertThat(List.of(format.marginTop(), format.marginBottom(), format.marginLeft(), format.marginRight())).containsOnly(15.0);
        assertThat(format.page()).isEqualTo("a4");
    }

    @Test
    void whatIsStored_isTheDocumentOwnedByThePerson_withOneVersion() {
        DocumentDto document = start(asha, "Backend Developer", "clean");

        assertThat(store.storedDocuments).hasSize(1);
        ResumeDocument stored = store.storedDocuments.get(0);
        assertThat(stored.getId()).isEqualTo(document.id());
        assertThat(stored.getUser()).isSameAs(asha);
        assertThat(stored.getCurrent()).isEqualTo(1);
        assertThat(stored.getCreatedAt()).isEqualTo(NOW);
        assertThat(stored.getUpdatedAt()).isEqualTo(NOW);
        assertThat(store.numbersOf(stored)).containsExactly(1);
        assertThat(store.storedVersions.get(0).getAt()).isEqualTo(NOW);
    }

    @Test
    void aDocumentWithNoRole_isCalledMyResume() {
        assertThat(start(asha, "", "clean").title()).isEqualTo("My resume");
        assertThat(start(asha, "   ", "clean").title()).isEqualTo("My resume");
    }

    @Test
    void theAnswers_areMadeValid_beforeTheyAreStored() {
        DocumentDto document = service.create(asha, json("{\"role\":\"  Data \\n Analyst \",\"level\":\"wizard\",\"pages\":7}"), "clean");

        assertThat(document.answers()).isEqualTo(new BuilderAnswers("Data Analyst", "junior", "simple", 1));
        assertThat(document.title()).isEqualTo("Data Analyst");
    }

    @Test
    void anUnknownTemplate_orRoleThatIsTooLong_storesNothing() {
        assertThatThrownBy(() -> start(asha, "x", "fancy")).isInstanceOf(BadRequestException.class).hasMessageContaining("fancy");
        assertThatThrownBy(() -> start(asha, "a".repeat(81), "clean")).isInstanceOf(BadRequestException.class).hasMessageContaining("role");
        assertThatThrownBy(() -> service.create(asha, json("{}"), null)).isInstanceOf(BadRequestException.class);

        assertThat(store.storedDocuments).isEmpty();
        assertThat(store.storedVersions).isEmpty();
    }

    // ---------- read (GET /builder/documents/{id}) ----------

    @Test
    void readingADocument_returnsItWithItsVersions() {
        DocumentDto started = start(asha, "Backend Developer", "modern");

        DocumentDto read = service.get(asha, started.id());

        assertThat(read).isEqualTo(started);
    }

    @Test
    void anotherPersonsDocument_isNotFound_exactlyLikeOneThatDoesNotExist() {
        UUID id = start(asha, "x", "clean").id();

        assertThatThrownBy(() -> service.get(ravi, id)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.get(asha, UUID.randomUUID())).isInstanceOf(ResourceNotFoundException.class);
        assertThat(catchMessage(() -> service.get(ravi, id))).isEqualTo(catchMessage(() -> service.get(ravi, UUID.randomUUID())));
    }

    private static String catchMessage(Runnable action) {
        try {
            action.run();
            return null;
        } catch (RuntimeException e) {
            return e.getMessage();
        }
    }

    @Test
    void aStoredFormatFromAnOlderPrototype_isReadAsAValidFormat() {
        UUID id = start(asha, "x", "clean").id();
        store.storedDocuments.get(0).setFormat(json("{\"margins\":\"narrow\",\"fontSize\":99,\"font\":\"comic\"}"));

        BuilderFormat format = service.get(asha, id).format();

        assertThat(format.marginTop()).isEqualTo(12.7);
        assertThat(format.fontSize()).isEqualTo(14.0);
        assertThat(format.font()).isEqualTo("sans");
    }

    // ---------- list (GET /builder/documents) ----------

    @Test
    void theList_isMineOnly_newestFirst_withoutVersions() {
        DocumentDto first = start(asha, "First", "clean");
        clock.advanceSeconds(60);
        DocumentDto second = start(asha, "Second", "compact");
        clock.advanceSeconds(60);
        start(ravi, "Not mine", "clean");

        List<DocumentSummaryDto> list = service.list(asha);

        assertThat(list).extracting(DocumentSummaryDto::id).containsExactly(second.id(), first.id());
        assertThat(list.get(0)).isEqualTo(new DocumentSummaryDto(second.id(), "Second", "compact", 1, NOW.plusSeconds(60).toEpochMilli()));
    }

    @Test
    void aPersonWithNoDocuments_hasAnEmptyList() {
        assertThat(service.list(asha)).isEmpty();
    }

    // ---------- format (PUT /builder/documents/{id}/format) ----------

    @Test
    void theFormat_isMadeValid_stored_andReturned() {
        UUID id = start(asha, "x", "clean").id();

        BuilderFormat saved = service.setFormat(asha, id, json("{\"font\":\"serif\",\"fontSize\":10.7,\"marginTop\":99,\"hidden\":[\"skills\",\"bogus\"],\"columns\":7}"));

        assertThat(saved.font()).isEqualTo("serif");
        assertThat(saved.fontSize()).isEqualTo(10.5);
        assertThat(saved.marginTop()).isEqualTo(50.0);
        assertThat(saved.hidden()).containsExactly("skills");
        assertThat(saved.columns()).isEqualTo(1);
        assertThat(service.get(asha, id).format()).isEqualTo(saved);
    }

    @Test
    void changingTheFormat_doesNotMakeAVersion_butCountsAsTheDocumentBeingChanged() {
        UUID id = start(asha, "x", "clean").id();
        clock.advanceSeconds(90);

        service.setFormat(asha, id, json("{\"fontSize\":12}"));

        ResumeDocument stored = store.storedDocuments.get(0);
        assertThat(store.numbersOf(stored)).containsExactly(1);
        assertThat(stored.getCurrent()).isEqualTo(1);
        assertThat(stored.getUpdatedAt()).isEqualTo(NOW.plusSeconds(90));
    }

    @Test
    void aFormatThatIsNotAnObject_becomesTheDefaultFormat() {
        UUID id = start(asha, "x", "compact").id();

        BuilderFormat saved = service.setFormat(asha, id, json("[]"));

        assertThat(saved).isEqualTo(FormatNormalizer.normalize(null));
    }

    @Test
    void anotherPersonsFormat_cannotBeChanged() {
        UUID id = start(asha, "x", "clean").id();
        JsonNode before = store.storedDocuments.get(0).getFormat().deepCopy();

        assertThatThrownBy(() -> service.setFormat(ravi, id, json("{\"fontSize\":14}"))).isInstanceOf(ResourceNotFoundException.class);

        assertThat(store.storedDocuments.get(0).getFormat()).isEqualTo(before);
    }

    // ---------- template (PUT /builder/documents/{id}/template) ----------

    @Test
    void switchingTemplate_addsAVersionWithTheSameResume_andThatTemplatesFormat() {
        DocumentDto started = start(asha, "x", "clean");
        clock.advanceSeconds(30);

        DocumentDto switched = service.setTemplate(asha, started.id(), "compact");

        assertThat(switched.templateId()).isEqualTo("compact");
        assertThat(switched.current()).isEqualTo(2);
        assertThat(switched.versions()).extracting("number").containsExactly(1, 2);
        assertThat(switched.versions().get(1).source()).isEqualTo("template");
        assertThat(switched.versions().get(1).summary()).isEqualTo("Switched to template Compact");
        assertThat(switched.versions().get(1).at()).isEqualTo(NOW.plusSeconds(30).toEpochMilli());
        assertThat(switched.versions().get(1).resume()).isEqualTo(started.versions().get(0).resume());
        assertThat(switched.format().fontSize()).isEqualTo(10.0);
        assertThat(switched.format().marginLeft()).isEqualTo(12.7);
        assertThat(store.storedDocuments.get(0).getUpdatedAt()).isEqualTo(NOW.plusSeconds(30));
    }

    @Test
    void switchingTemplate_keepsTheOtherFormatSettingsThePersonChose() {
        DocumentDto started = start(asha, "x", "clean");
        service.setFormat(asha, started.id(), json("{\"spacing\":\"airy\",\"hidden\":[\"skills\"],\"rules\":true}"));

        BuilderFormat after = service.setTemplate(asha, started.id(), "sidebar").format();

        assertThat(after.spacing()).isEqualTo("airy");
        assertThat(after.hidden()).containsExactly("skills");
        assertThat(after.rules()).isTrue();
        assertThat(after.columns()).isEqualTo(2);
    }

    @Test
    void choosingTheTemplateTheDocumentAlreadyHas_changesNothing() {
        DocumentDto started = start(asha, "x", "clean");
        service.setFormat(asha, started.id(), json("{\"fontSize\":13}"));
        clock.advanceSeconds(10);

        DocumentDto same = service.setTemplate(asha, started.id(), "clean");

        assertThat(same.current()).isEqualTo(1);
        assertThat(same.versions()).hasSize(1);
        assertThat(same.format().fontSize()).as("the person's own size is not reset").isEqualTo(13.0);
    }

    @Test
    void anUnknownTemplate_changesNothing() {
        DocumentDto started = start(asha, "x", "clean");

        assertThatThrownBy(() -> service.setTemplate(asha, started.id(), "fancy")).isInstanceOf(BadRequestException.class);

        assertThat(service.get(asha, started.id())).isEqualTo(started);
    }

    @Test
    void anotherPersonsTemplate_cannotBeChanged() {
        DocumentDto started = start(asha, "x", "clean");

        assertThatThrownBy(() -> service.setTemplate(ravi, started.id(), "compact")).isInstanceOf(ResourceNotFoundException.class);

        assertThat(service.get(asha, started.id())).isEqualTo(started);
    }

    // ---------- delete (DELETE /builder/documents/{id}) ----------

    @Test
    void deletingADocument_removesItAndEveryVersion() {
        DocumentDto doomed = start(asha, "Doomed", "clean");
        service.setTemplate(asha, doomed.id(), "compact");
        DocumentDto kept = start(asha, "Kept", "clean");

        service.delete(asha, doomed.id());

        assertThat(store.storedDocuments).extracting(ResumeDocument::getId).containsExactly(kept.id());
        assertThat(store.storedVersions).hasSize(1);
        assertThatThrownBy(() -> service.get(asha, doomed.id())).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void anotherPersonsDocument_cannotBeDeleted() {
        DocumentDto started = start(asha, "x", "clean");

        assertThatThrownBy(() -> service.delete(ravi, started.id())).isInstanceOf(ResourceNotFoundException.class);

        assertThat(service.get(asha, started.id())).isEqualTo(started);
    }

    // ---------- writing a version (POST /builder/documents/{id}/versions) ----------

    /** The sample resume with a different name, as a client would send it. */
    private static JsonNode resumeNamed(String name) {
        com.fasterxml.jackson.databind.node.ObjectNode resume = SampleResume.get().deepCopy();
        resume.put("name", name);
        return resume;
    }

    private VersionDto write(UUID id, int base, String name) {
        return service.writeVersion(asha, id, base, resumeNamed(name), "you", "You edited Name");
    }

    @Test
    void aWrite_addsTheNextVersion_onTopOfTheOneItWasBasedOn() {
        UUID id = start(asha, "x", "clean").id();
        clock.advanceSeconds(45);

        VersionDto written = service.writeVersion(asha, id, 1, resumeNamed("Jane D."), "you", "You edited Name");

        assertThat(written.number()).isEqualTo(2);
        assertThat(written.source()).isEqualTo("you");
        assertThat(written.summary()).isEqualTo("You edited Name");
        assertThat(written.at()).isEqualTo(NOW.plusSeconds(45).toEpochMilli());
        assertThat(written.resume().get("name").asText()).isEqualTo("Jane D.");

        DocumentDto document = service.get(asha, id);
        assertThat(document.current()).isEqualTo(2);
        assertThat(document.versions()).extracting(VersionDto::number).containsExactly(1, 2);
        assertThat(store.storedDocuments.get(0).getUpdatedAt()).isEqualTo(NOW.plusSeconds(45));
    }

    @Test
    void aWrite_neverChangesAVersionThatWasAlreadyStored() {
        DocumentDto started = start(asha, "x", "clean");
        VersionDto first = started.versions().get(0);

        write(started.id(), 1, "Changed once");
        write(started.id(), 2, "Changed twice");

        assertThat(service.get(asha, started.id()).versions().get(0)).isEqualTo(first);
    }

    @Test
    void theTimeOfAVersion_comesFromTheServersClock() {
        UUID id = start(asha, "x", "clean").id();
        clock.advanceSeconds(5);

        assertThat(write(id, 1, "A").at()).isEqualTo(NOW.plusSeconds(5).toEpochMilli());
        clock.advanceSeconds(5);
        assertThat(write(id, 2, "B").at()).isEqualTo(NOW.plusSeconds(10).toEpochMilli());
    }

    @Test
    void theResume_isMadeValidBeforeItIsStored() {
        UUID id = start(asha, "x", "clean").id();
        com.fasterxml.jackson.databind.node.ObjectNode messy = SampleResume.get().deepCopy();
        messy.put("name", "  Jane \n  Doe ");
        messy.put("summary", "<i><b>Fast</b></i> <a href=\"javascript:alert(1)\">x</a><font color=\"#ffffff\">hidden</font>");
        messy.put("injected", "x");

        VersionDto written = service.writeVersion(asha, id, 1, messy, "you", "You edited Summary");

        assertThat(written.resume().get("name").asText()).isEqualTo("Jane Doe");
        assertThat(written.resume().get("summary").asText()).isEqualTo("<b><i>Fast</i></b> xhidden");
        assertThat(written.resume().has("injected")).isFalse();
        assertThat(store.storedVersions.get(1).getContent()).isEqualTo(written.resume());
    }

    @Test
    void aResumeThatCannotBeRepaired_isRefused_andNothingIsStored() {
        UUID id = start(asha, "x", "clean").id();

        assertThatThrownBy(() -> service.writeVersion(asha, id, 1, json("{\"name\":\"x\"}"), "you", "You edited Name"))
                .isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> service.writeVersion(asha, id, 1, null, "you", "You edited Name"))
                .isInstanceOf(BadRequestException.class);

        assertThat(store.storedVersions).hasSize(1);
        assertThat(store.storedDocuments.get(0).getCurrent()).isEqualTo(1);
    }

    @Test
    void aResumeThatIsTooLarge_isRefusedWith413_andNothingIsStored() {
        UUID id = start(asha, "x", "clean").id();
        com.fasterxml.jackson.databind.node.ObjectNode huge = SampleResume.get().deepCopy();
        huge.put("summary", "a".repeat(ResumeNormalizer.MAX_BYTES + 1));

        assertThatThrownBy(() -> service.writeVersion(asha, id, 1, huge, "you", "You edited Summary"))
                .isInstanceOf(com.resumeanalyser.common.PayloadTooLargeException.class);

        assertThat(store.storedVersions).hasSize(1);
    }

    // concurrency (RB-VER-07)

    @Test
    void aWriteBasedOnAnOldVersion_isAConflict_andStoresNothing() {
        UUID id = start(asha, "x", "clean").id();
        write(id, 1, "Written from one tab");

        assertThatThrownBy(() -> write(id, 1, "Written from another tab, which never saw version 2"))
                .isInstanceOf(com.resumeanalyser.common.ConflictException.class)
                .hasMessageContaining("version");

        assertThat(store.numbersOf(store.storedDocuments.get(0))).containsExactly(1, 2);
        assertThat(service.get(asha, id).versions().get(1).resume().get("name").asText()).isEqualTo("Written from one tab");
    }

    @Test
    void aWriteBasedOnAVersionThatDoesNotExist_isAConflictToo() {
        UUID id = start(asha, "x", "clean").id();

        for (int base : new int[] {0, 2, 99, -1}) {
            assertThatThrownBy(() -> write(id, base, "x")).as("base " + base).isInstanceOf(com.resumeanalyser.common.ConflictException.class);
        }
    }

    @Test
    void aWriteThatNamesNoBaseVersion_isRefused() {
        UUID id = start(asha, "x", "clean").id();

        assertThatThrownBy(() -> service.writeVersion(asha, id, null, resumeNamed("x"), "you", "You edited Name"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("baseVersion");
    }

    // source and summary (RB-VER-01, BE-01)

    @Test
    void theSourceIsOneOfTheFive() {
        UUID id = start(asha, "x", "clean").id();
        int base = 1;
        for (String source : new String[] {"template", "import", "you", "ai", "restore"}) {
            assertThat(service.writeVersion(asha, id, base, resumeNamed("N" + base), source, "A summary").source()).isEqualTo(source);
            base++;
        }
    }

    @Test
    void aSourceThatIsNotOneOfTheFive_isRefused_andListsTheOnesThatAre() {
        UUID id = start(asha, "x", "clean").id();

        for (String bad : new String[] {"admin", "YOU", "", " ", "you ", "system"}) {
            assertThatThrownBy(() -> service.writeVersion(asha, id, 1, resumeNamed("x"), bad, "A summary"))
                    .as("'" + bad + "'")
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("source")
                    .hasMessageContaining("template, import, you, ai, restore");
        }
        assertThatThrownBy(() -> service.writeVersion(asha, id, 1, resumeNamed("x"), null, "A summary")).isInstanceOf(BadRequestException.class);
        assertThat(store.storedVersions).hasSize(1);
    }

    @Test
    void theSummary_isCleanedLikeAnyPlainText() {
        UUID id = start(asha, "x", "clean").id();

        VersionDto written = service.writeVersion(asha, id, 1, resumeNamed("x"), "you", "  You \n edited\u0000 Name  ");

        assertThat(written.summary()).isEqualTo("You edited Name");
    }

    @Test
    void aSummaryThatIsEmpty_orTooLong_orNotThere_isRefused_notCut() {
        UUID id = start(asha, "x", "clean").id();

        assertThat(service.writeVersion(asha, id, 1, resumeNamed("x"), "you", "a".repeat(200)).summary()).hasSize(200);
        for (String bad : new String[] {"", "   ", "\n", "a".repeat(201)}) {
            assertThatThrownBy(() -> service.writeVersion(asha, id, 2, resumeNamed("y"), "you", bad))
                    .as("'" + bad.length() + " chars'")
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("summary");
        }
        assertThatThrownBy(() -> service.writeVersion(asha, id, 2, resumeNamed("y"), "you", null)).isInstanceOf(BadRequestException.class);
        assertThat(store.storedVersions).hasSize(2);
    }

    @Test
    void anotherPersonsDocument_cannotBeWrittenTo() {
        UUID id = start(asha, "x", "clean").id();

        assertThatThrownBy(() -> service.writeVersion(ravi, id, 1, resumeNamed("x"), "you", "You edited Name"))
                .isInstanceOf(ResourceNotFoundException.class);

        assertThat(store.storedVersions).hasSize(1);
    }

    @Test
    void afterAnEdit_changingTheTemplate_carriesTheEditedResume_notTheFirstOne() {
        UUID id = start(asha, "x", "clean").id();
        write(id, 1, "Jane D.");

        DocumentDto switched = service.setTemplate(asha, id, "compact");

        assertThat(switched.current()).isEqualTo(3);
        assertThat(switched.versions().get(2).resume().get("name").asText()).isEqualTo("Jane D.");
    }

    // the cap (RB-VER-06)

    @Test
    void fiftyVersions_areAllKept() {
        UUID id = start(asha, "x", "clean").id();
        for (int base = 1; base < 50; base++) {
            write(id, base, "Edit " + base);
        }

        assertThat(store.numbersOf(store.storedDocuments.get(0))).hasSize(50).first().isEqualTo(1);
        assertThat(service.get(asha, id).current()).isEqualTo(50);
    }

    @Test
    void theFiftyFirst_dropsTheOldest_andNumbersAreNeverReused() {
        UUID id = start(asha, "x", "clean").id();
        for (int base = 1; base <= 50; base++) {
            write(id, base, "Edit " + base);
        }

        DocumentDto document = service.get(asha, id);
        assertThat(document.versions()).hasSize(50);
        assertThat(document.versions().get(0).number()).isEqualTo(2);
        assertThat(document.current()).isEqualTo(51);

        write(id, 51, "Edit 51");
        assertThat(service.get(asha, id).versions()).extracting(VersionDto::number).first().isEqualTo(3);
        assertThat(service.get(asha, id).current()).isEqualTo(52);
    }

    @Test
    void aTemplateSwitch_andARestore_obeyTheSameCap() {
        UUID id = start(asha, "x", "clean").id();
        for (int base = 1; base < 50; base++) {
            write(id, base, "Edit " + base);
        }

        service.setTemplate(asha, id, "compact");
        assertThat(store.numbersOf(store.storedDocuments.get(0))).hasSize(50).first().isEqualTo(2);

        service.restore(asha, id, 10);
        assertThat(store.numbersOf(store.storedDocuments.get(0))).hasSize(50).first().isEqualTo(3);
    }

    // ---------- restore (POST /builder/documents/{id}/versions/{n}/restore) ----------

    @Test
    void restoring_addsTheOldResumeAsTheNewestVersion_andDeletesNothing() {
        DocumentDto started = start(asha, "x", "clean");
        write(started.id(), 1, "Changed");
        clock.advanceSeconds(20);

        VersionDto restored = service.restore(asha, started.id(), 1);

        assertThat(restored.number()).isEqualTo(3);
        assertThat(restored.source()).isEqualTo("restore");
        assertThat(restored.summary()).isEqualTo("Restored v1");
        assertThat(restored.at()).isEqualTo(NOW.plusSeconds(20).toEpochMilli());
        assertThat(restored.resume()).isEqualTo(started.versions().get(0).resume());

        DocumentDto document = service.get(asha, started.id());
        assertThat(document.current()).isEqualTo(3);
        assertThat(document.versions()).extracting(VersionDto::number).containsExactly(1, 2, 3);
        assertThat(document.versions().get(1).resume().get("name").asText()).isEqualTo("Changed");
    }

    @Test
    void aRestore_canItselfBeUndoneByRestoringAgain() {
        DocumentDto started = start(asha, "x", "clean");
        write(started.id(), 1, "Changed");
        service.restore(asha, started.id(), 1);

        VersionDto undone = service.restore(asha, started.id(), 2);

        assertThat(undone.number()).isEqualTo(4);
        assertThat(undone.summary()).isEqualTo("Restored v2");
        assertThat(undone.resume().get("name").asText()).isEqualTo("Changed");
    }

    @Test
    void restoringTheCurrentVersion_addsNothing_asInThePrototype() {
        DocumentDto started = start(asha, "x", "clean");
        write(started.id(), 1, "Changed");

        VersionDto same = service.restore(asha, started.id(), 2);

        assertThat(same.number()).isEqualTo(2);
        assertThat(same.source()).isEqualTo("you");
        assertThat(store.storedVersions).hasSize(2);
    }

    @Test
    void restoringAVersionThatIsNotThere_isNotFound() {
        UUID id = start(asha, "x", "clean").id();

        for (int number : new int[] {0, 2, 99, -1}) {
            assertThatThrownBy(() -> service.restore(asha, id, number)).as("v" + number).isInstanceOf(ResourceNotFoundException.class);
        }
        assertThat(store.storedVersions).hasSize(1);
    }

    @Test
    void restoringAVersionTheCapDropped_isNotFound() {
        UUID id = start(asha, "x", "clean").id();
        for (int base = 1; base <= 50; base++) {
            write(id, base, "Edit " + base);
        }

        assertThatThrownBy(() -> service.restore(asha, id, 1)).isInstanceOf(ResourceNotFoundException.class);
    }

    // ---------- reading order (GET /builder/documents/{id}/reading-order) ----------

    @Test
    void theReadingOrder_isOfTheCurrentVersion_unlessAnotherIsAsked() {
        DocumentDto started = start(asha, "x", "clean");
        write(started.id(), 1, "Jane D. Changed");

        assertThat(service.readingOrder(asha, started.id(), null).text()).startsWith("Jane D. Changed\n");
        assertThat(service.readingOrder(asha, started.id(), 2).text()).startsWith("Jane D. Changed\n");
        assertThat(service.readingOrder(asha, started.id(), 1).text()).startsWith("Jane Doe\n");
    }

    @Test
    void theReadingOrder_followsTheDocumentsCurrentFormat() {
        UUID id = start(asha, "x", "clean").id();
        assertThat(service.readingOrder(asha, id, null).notes()).hasSize(1).first().asString().startsWith("One column");
        assertThat(service.readingOrder(asha, id, null).text()).contains("SKILLS");

        service.setFormat(asha, id, json("{\"columns\":2,\"hidden\":[\"skills\"]}"));

        ReadingOrder after = service.readingOrder(asha, id, null);
        assertThat(after.notes()).hasSize(1).first().asString().startsWith("Two columns");
        assertThat(after.text()).doesNotContain("SKILLS").doesNotContain("Spring Boot, SQL");
    }

    @Test
    void anOldVersion_isReadWithTheFormatTheDocumentHasNow() {
        // A version holds the resume; the format belongs to the document and is not versioned (RB-FMT).
        UUID id = start(asha, "x", "clean").id();
        write(id, 1, "Changed");
        service.setFormat(asha, id, json("{\"hidden\":[\"education\"]}"));

        assertThat(service.readingOrder(asha, id, 1).text()).doesNotContain("EDUCATION");
    }

    @Test
    void theReadingOrder_matchesTheFunctionTheExportWillUse() {
        UUID id = start(asha, "x", "sidebar").id();

        ReadingOrder fromService = service.readingOrder(asha, id, null);
        DocumentDto document = service.get(asha, id);

        assertThat(fromService).isEqualTo(ReadingOrder.of(document.versions().get(0).resume(), document.format()));
    }

    @Test
    void aVersionThatIsNotThere_isNotFound() {
        UUID id = start(asha, "x", "clean").id();

        for (int number : new int[] {0, 2, 99, -1}) {
            assertThatThrownBy(() -> service.readingOrder(asha, id, number)).as("v" + number).isInstanceOf(ResourceNotFoundException.class);
        }
    }

    @Test
    void anotherPersonsDocument_cannotBeRead_andReadingChangesNothing() {
        DocumentDto started = start(asha, "x", "clean");
        Instant before = store.storedDocuments.get(0).getUpdatedAt();
        clock.advanceSeconds(60);

        assertThatThrownBy(() -> service.readingOrder(ravi, started.id(), null)).isInstanceOf(ResourceNotFoundException.class);
        service.readingOrder(asha, started.id(), null);

        assertThat(store.storedDocuments.get(0).getUpdatedAt()).isEqualTo(before);
        assertThat(store.storedVersions).hasSize(1);
        assertThat(service.get(asha, started.id())).isEqualTo(started);
    }

    @Test
    void anotherPersonsDocument_cannotBeRestored() {
        DocumentDto started = start(asha, "x", "clean");
        write(started.id(), 1, "Changed");

        assertThatThrownBy(() -> service.restore(ravi, started.id(), 1)).isInstanceOf(ResourceNotFoundException.class);

        assertThat(store.storedVersions).hasSize(2);
    }
}

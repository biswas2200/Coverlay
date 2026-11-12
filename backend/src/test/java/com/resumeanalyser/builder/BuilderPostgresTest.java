package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.resumeanalyser.account.User;
import com.resumeanalyser.builder.dto.DocumentDto;
import com.resumeanalyser.builder.dto.VersionDto;
import com.resumeanalyser.common.ConflictException;
import com.resumeanalyser.common.ResourceNotFoundException;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.test.context.TestPropertySource;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The builder against a real PostgreSQL: the Flyway migration, the JPA mapping ({@code ddl-auto: validate}), the JSON columns,
 * the constraints, the cascade and the optimistic lock, none of which a mock can show. The project has no database-backed
 * tests, so this one runs only when {@code BUILDER_TEST_DB_URL} is set; otherwise it is skipped.
 *
 * <p>It migrates the database it is pointed at and rolls its own data back, so point it at a throwaway one:
 * <pre>
 * docker run -d --rm --name coverlay-builder-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
 * BUILDER_TEST_DB_URL=jdbc:postgresql://localhost:55432/postgres mvn test -Dtest=BuilderPostgresTest
 * </pre>
 * {@code BUILDER_TEST_DB_USER} (default {@code postgres}) and {@code BUILDER_TEST_DB_PASSWORD} (default {@code test}) override
 * the login.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=${BUILDER_TEST_DB_URL:jdbc:postgresql://not-set/none}",
        "spring.datasource.username=${BUILDER_TEST_DB_USER:postgres}",
        "spring.datasource.password=${BUILDER_TEST_DB_PASSWORD:test}"})
@EnabledIfEnvironmentVariable(named = "BUILDER_TEST_DB_URL", matches = ".+")
class BuilderPostgresTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-11-08T10:00:00Z");

    @Autowired
    private TestEntityManager testEntities;
    @Autowired
    private EntityManager entities;
    @Autowired
    private ResumeDocumentRepository documents;
    @Autowired
    private ResumeDocumentVersionRepository versions;

    private BuilderDocumentService service;
    private User asha;
    private User ravi;

    @BeforeEach
    void setUp() {
        service = new BuilderDocumentService(documents, versions, Clock.fixed(NOW, ZoneOffset.UTC));
        asha = user("asha-" + UUID.randomUUID() + "@example.com");
        ravi = user("ravi-" + UUID.randomUUID() + "@example.com");
    }

    private User user(String email) {
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash("not-a-real-hash");
        return testEntities.persistAndFlush(user);
    }

    private DocumentDto start(User owner, String role) throws Exception {
        DocumentDto document = service.create(owner, JSON.readTree("{\"role\":\"" + role + "\",\"level\":\"senior\",\"style\":\"modern\",\"pages\":2}"), "sidebar");
        flushAndForget();
        return document;
    }

    /** Writes everything to the database and empties the session, so the next read really comes from PostgreSQL. */
    private void flushAndForget() {
        entities.flush();
        entities.clear();
    }

    private long count(String table, String where, Object... args) {
        var query = entities.createNativeQuery("SELECT count(*) FROM " + table + " WHERE " + where);
        for (int i = 0; i < args.length; i++) {
            query.setParameter(i + 1, args[i]);
        }
        return ((Number) query.getSingleResult()).longValue();
    }

    private JsonNode resumeNamed(String name) {
        ObjectNode resume = SampleResume.get().deepCopy();
        resume.put("name", name);
        return resume;
    }

    // ---------- the mapping ----------

    @Test
    void aDocument_survivesAnExactRoundTripThroughPostgres() throws Exception {
        DocumentDto started = start(asha, "Backend Developer");

        DocumentDto read = service.get(asha, started.id());

        assertThat(read).isEqualTo(started);
        assertThat(read.format().fontSize()).isEqualTo(10.5);
        assertThat(read.format().columns()).isEqualTo(2);
        assertThat(read.versions().get(0).resume().get("experience").get(0).get("role").asText()).isEqualTo("Software Engineer, Acme Corp");
        assertThat(read.versions().get(0).at()).isEqualTo(NOW.toEpochMilli());
    }

    @Test
    void aTableInACustomSection_survivesTheRoundTrip_numbersIncluded() throws Exception {
        DocumentDto started = start(asha, "x");
        ObjectNode resume = SampleResume.get().deepCopy();
        resume.set("extra", JSON.readTree("""
                [{ "title": "Skills by area", "body": [
                  { "type": "table", "attrs": { "borders": "rows", "borderWidth": 2.5, "borderStyle": "dashed", "cellPadding": 8, "cellGap": 3 },
                    "content": [{ "type": "tableRow", "content": [{ "type": "tableCell", "attrs": { "colspan": 2, "colwidth": [120, 80] },
                      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Hi", "marks": [{ "type": "bold" }] }] }] }] }] }
                ] }]
                """));

        VersionDto written = service.writeVersion(asha, started.id(), 1, resume, "you", "You edited Custom section");
        flushAndForget();

        assertThat(service.get(asha, started.id()).versions().get(1).resume()).isEqualTo(written.resume());
    }

    @Test
    void theReadingOrder_isTheSameAfterTheResumeHasBeenThroughJsonb() throws Exception {
        // PostgreSQL's jsonb stores an object's keys in its own order, so the order a parser meets must not depend on key order.
        DocumentDto started = start(asha, "x");
        ObjectNode resume = SampleResume.get().deepCopy();
        resume.set("extra", JSON.readTree("""
                [{ "title": "Skills by area", "body": [
                  { "type": "table", "attrs": { "borders": "all", "borderWidth": 1, "borderStyle": "solid", "cellPadding": 4, "cellGap": 0 },
                    "content": [{ "type": "tableRow", "content": [
                      { "type": "tableCell", "content": [{ "type": "bulletList", "content": [
                        { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Java" }] }] },
                        { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "SQL" }] }] }] }] },
                      { "type": "tableCell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Teamwork" }] }] }] }] },
                  { "type": "paragraph", "content": [{ "type": "text", "text": "After the table." }] }
                ] }]
                """));
        VersionDto written = service.writeVersion(asha, started.id(), 1, resume, "you", "You edited Custom section");
        ReadingOrder expected = ReadingOrder.of(written.resume(), service.get(asha, started.id()).format());
        flushAndForget();

        ReadingOrder fromTheDatabase = service.readingOrder(asha, started.id(), null);

        assertThat(fromTheDatabase).isEqualTo(expected);
        assertThat(fromTheDatabase.text()).contains("SKILLS BY AREA\nJava; SQL | Teamwork\nAfter the table.");
        assertThat(fromTheDatabase.notes()).anyMatch(note -> note.contains("\"Skills by area\""));
    }

    // ---------- the lists ----------

    @Test
    void thePersonsList_isNewestFirst_andIsTheirsOnly() throws Exception {
        start(ravi, "Not mine");
        DocumentDto mine = start(asha, "Mine");

        assertThat(service.list(asha)).extracting("id").containsExactly(mine.id());
    }

    @Test
    void anotherPersonsDocument_isNotFound() throws Exception {
        DocumentDto started = start(asha, "x");

        assertThatThrownBy(() -> service.get(ravi, started.id())).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.delete(ravi, started.id())).isInstanceOf(ResourceNotFoundException.class);
        assertThat(count("resume_documents", "id = ?1", started.id())).isEqualTo(1);
    }

    // ---------- history ----------

    @Test
    void versionsStack_andAConflictStoresNothing() throws Exception {
        DocumentDto started = start(asha, "x");
        service.writeVersion(asha, started.id(), 1, resumeNamed("One"), "you", "You edited Name");
        flushAndForget();

        assertThatThrownBy(() -> service.writeVersion(asha, started.id(), 1, resumeNamed("Stale"), "you", "You edited Name"))
                .isInstanceOf(ConflictException.class);
        flushAndForget();

        DocumentDto read = service.get(asha, started.id());
        assertThat(read.versions()).extracting(VersionDto::number).containsExactly(1, 2);
        assertThat(read.current()).isEqualTo(2);
    }

    @Test
    void theFiftyFirstVersion_deletesTheOldestRow() throws Exception {
        DocumentDto started = start(asha, "x");
        for (int base = 1; base <= 50; base++) {
            service.writeVersion(asha, started.id(), base, resumeNamed("Edit " + base), "you", "You edited Name");
            flushAndForget();
        }

        DocumentDto read = service.get(asha, started.id());
        assertThat(read.versions()).hasSize(50);
        assertThat(read.versions().get(0).number()).isEqualTo(2);
        assertThat(count("resume_document_versions", "document_id = ?1", started.id())).isEqualTo(50);
    }

    @Test
    void restoring_addsARow_anddeletesNone() throws Exception {
        DocumentDto started = start(asha, "x");
        service.writeVersion(asha, started.id(), 1, resumeNamed("Changed"), "you", "You edited Name");
        flushAndForget();

        VersionDto restored = service.restore(asha, started.id(), 1);
        flushAndForget();

        assertThat(restored.number()).isEqualTo(3);
        assertThat(count("resume_document_versions", "document_id = ?1", started.id())).isEqualTo(3);
        assertThat(service.get(asha, started.id()).versions().get(2).resume()).isEqualTo(started.versions().get(0).resume());
    }

    // ---------- what the database itself guarantees ----------

    @Test
    void deletingADocument_takesItsVersionsWithIt_andNothingElse() throws Exception {
        DocumentDto doomed = start(asha, "Doomed");
        service.writeVersion(asha, doomed.id(), 1, resumeNamed("x"), "you", "You edited Name");
        DocumentDto kept = start(asha, "Kept");
        flushAndForget();

        service.delete(asha, doomed.id());
        flushAndForget();

        assertThat(count("resume_document_versions", "document_id = ?1", doomed.id())).isZero();
        assertThat(count("resume_document_versions", "document_id = ?1", kept.id())).isEqualTo(1);
    }

    @Test
    void deletingAPerson_deletesTheirDocumentsAndVersions() throws Exception {
        DocumentDto started = start(asha, "x");
        flushAndForget();

        entities.createNativeQuery("DELETE FROM users WHERE id = ?1").setParameter(1, asha.getId()).executeUpdate();
        flushAndForget();

        assertThat(count("resume_documents", "id = ?1", started.id())).isZero();
        assertThat(count("resume_document_versions", "document_id = ?1", started.id())).isZero();
    }

    @Test
    void aVersionNumber_cannotBeUsedTwice_evenIfTheServiceIsBypassed() throws Exception {
        DocumentDto started = start(asha, "x");
        flushAndForget();
        ResumeDocument document = documents.findByIdAndUser(started.id(), asha).orElseThrow();

        ResumeDocumentVersion duplicate = new ResumeDocumentVersion();
        duplicate.setDocument(document);
        duplicate.setNumber(1);
        duplicate.setSource("you");
        duplicate.setSummary("A second version 1");
        duplicate.setContent(resumeNamed("x"));
        duplicate.setAt(NOW);

        assertThatThrownBy(() -> {
            versions.saveAndFlush(duplicate);
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void aSourceOutsideTheFive_isRefusedByTheDatabase() throws Exception {
        DocumentDto started = start(asha, "x");
        flushAndForget();
        ResumeDocument document = documents.findByIdAndUser(started.id(), asha).orElseThrow();

        ResumeDocumentVersion rogue = new ResumeDocumentVersion();
        rogue.setDocument(document);
        rogue.setNumber(2);
        rogue.setSource("admin");
        rogue.setSummary("Not a real source");
        rogue.setContent(resumeNamed("x"));
        rogue.setAt(NOW);

        assertThatThrownBy(() -> versions.saveAndFlush(rogue)).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void twoWritesThatBothSawTheSameDocument_cannotBothWin() throws Exception {
        DocumentDto started = start(asha, "x");
        flushAndForget();

        ResumeDocument firstTab = documents.findByIdAndUser(started.id(), asha).orElseThrow();
        entities.detach(firstTab);
        ResumeDocument secondTab = documents.findByIdAndUser(started.id(), asha).orElseThrow();

        secondTab.setUpdatedAt(NOW.plusSeconds(1));
        documents.saveAndFlush(secondTab);

        firstTab.setUpdatedAt(NOW.plusSeconds(2));
        assertThatThrownBy(() -> documents.saveAndFlush(firstTab)).isInstanceOf(ObjectOptimisticLockingFailureException.class);
    }
}

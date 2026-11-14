package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.resumeanalyser.account.User;
import com.resumeanalyser.builder.dto.DocumentDto;
import com.resumeanalyser.builder.dto.DocumentSummaryDto;
import com.resumeanalyser.builder.dto.VersionDto;
import com.resumeanalyser.common.BadRequestException;
import com.resumeanalyser.common.ConflictException;
import com.resumeanalyser.common.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The Resume Builder's documents and their versions (docs/prototype-spec.md section 9.1). Every method takes the signed-in
 * person and reaches only their own documents; one that is not theirs is not found (BE-04). Versions are only ever added
 * (RB-VER-07), the server's clock sets their time (BE-03), and everything stored has been through the normalisers (BE-01).
 */
@Service
public class BuilderDocumentService {

    private static final ObjectMapper JSON = new ObjectMapper();

    static final String UNTITLED = "My resume";

    /** RB-VER-06: at most this many versions are kept per document. */
    static final int MAX_VERSIONS = 50;

    /** The longest version summary; the spec gives no limit, so this is ours. */
    static final int MAX_SUMMARY_LENGTH = 200;

    /** RB-VER-01 */
    static final List<String> SOURCES = List.of("template", "import", "you", "ai", "restore");

    private final ResumeDocumentRepository documents;
    private final ResumeDocumentVersionRepository versions;
    private final Clock clock;

    public BuilderDocumentService(ResumeDocumentRepository documents, ResumeDocumentVersionRepository versions, Clock clock) {
        this.documents = documents;
        this.versions = versions;
        this.clock = clock;
    }

    /** Starts a document from a template: version 1 is {@code template} (RB-VER-01) and the template sets the format (RB-FMT-05). */
    @Transactional
    public DocumentDto create(User user, JsonNode answersInput, String templateId) {
        BuilderAnswers answers = AnswersNormalizer.normalize(answersInput);
        BuilderTemplate template = BuilderTemplates.byId(templateId);
        Instant now = clock.instant();

        ResumeDocument document = new ResumeDocument();
        document.setUser(user);
        document.setTitle(answers.role().isEmpty() ? UNTITLED : answers.role());
        document.setAnswers(JSON.valueToTree(answers));
        document.setTemplateId(template.id());
        document.setFormat(JSON.valueToTree(BuilderTemplates.apply(template, FormatNormalizer.normalize(null))));
        document.setCurrent(1);
        document.setCreatedAt(now);
        document.setUpdatedAt(now);
        documents.save(document);

        ResumeDocumentVersion first = version(document, 1, "template", "Started from template " + template.name(),
                ResumeNormalizer.normalize(SampleResume.get()), now);
        versions.save(first);
        return toDto(document, List.of(first));
    }

    @Transactional(readOnly = true)
    public DocumentDto get(User user, UUID id) {
        ResumeDocument document = owned(user, id);
        return toDto(document, versions.findByDocumentOrderByNumberAsc(document));
    }

    /** The person's documents, the most recently changed first, without their versions. */
    @Transactional(readOnly = true)
    public List<DocumentSummaryDto> list(User user) {
        return documents.findByUserOrderByUpdatedAtDesc(user).stream()
                .map(d -> new DocumentSummaryDto(d.getId(), d.getTitle(), d.getTemplateId(), d.getCurrent(), d.getUpdatedAt().toEpochMilli()))
                .toList();
    }

    /** Saves the format, made valid (RB-FMT-01). The format is not versioned (RB-VER-03), so this adds no version. */
    @Transactional
    public BuilderFormat setFormat(User user, UUID id, JsonNode formatInput) {
        ResumeDocument document = owned(user, id);
        BuilderFormat format = FormatNormalizer.normalize(formatInput);
        document.setFormat(JSON.valueToTree(format));
        document.setUpdatedAt(clock.instant());
        documents.save(document);
        return format;
    }

    /**
     * Chooses a template. A different one adds a {@code template} version holding the current resume and sets that template's
     * size, margins, columns and typeface on the person's format (RB-VER-03, RB-FMT-05); the same one changes nothing.
     */
    @Transactional
    public DocumentDto setTemplate(User user, UUID id, String templateId) {
        ResumeDocument document = owned(user, id);
        BuilderTemplate template = BuilderTemplates.byId(templateId);
        List<ResumeDocumentVersion> history = historyOf(document);
        if (template.id().equals(document.getTemplateId())) {
            return toDto(document, history);
        }

        Instant now = clock.instant();
        document.setTemplateId(template.id());
        document.setFormat(JSON.valueToTree(BuilderTemplates.apply(template, FormatNormalizer.normalize(document.getFormat()))));
        append(document, history, "template", "Switched to template " + template.name(), currentResume(document, history), now);
        return toDto(document, history);
    }

    /**
     * Writes a version: append-only, and only on top of the version it was based on (RB-VER-07). The resume, the source and the
     * summary are checked first (BE-01); the time is the server's (BE-03). A write based on anything but the current version is a
     * conflict and stores nothing.
     */
    @Transactional
    public VersionDto writeVersion(User user, UUID id, Integer baseVersion, JsonNode resumeInput, String source, String summaryInput) {
        ResumeDocument document = owned(user, id);
        if (baseVersion == null) {
            throw new BadRequestException("baseVersion is required: the number of the version this change is based on.");
        }
        if (source == null || !SOURCES.contains(source)) {
            throw new BadRequestException("source must be one of " + String.join(", ", SOURCES) + ".");
        }
        String summary = summary(summaryInput);
        JsonNode resume = ResumeNormalizer.normalize(resumeInput);
        if (baseVersion != document.getCurrent()) {
            throw new ConflictException("This resume has moved on: your change is based on version " + baseVersion
                    + " but the current version is " + document.getCurrent() + ". Reload it and try again.");
        }
        return toDto(append(document, historyOf(document), source, summary, resume, clock.instant()));
    }

    /**
     * Brings an earlier version back as the newest one, "Restored vN"; nothing is deleted, so a restore can be undone by
     * restoring again (RB-VER-05). Restoring the current version adds nothing, as in the prototype.
     */
    @Transactional
    public VersionDto restore(User user, UUID id, int number) {
        ResumeDocument document = owned(user, id);
        List<ResumeDocumentVersion> history = historyOf(document);
        ResumeDocumentVersion target = history.stream().filter(v -> v.getNumber() == number).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Version not found"));
        if (number == document.getCurrent()) {
            return toDto(target);
        }
        return toDto(append(document, history, "restore", "Restored v" + number, target.getContent().deepCopy(), clock.instant()));
    }

    /**
     * How an ATS reads a version of the resume (RB-ATS): the current version unless {@code version} names another, set on
     * the page the way the document's format sets it now (the format is not versioned). Nothing is stored or changed. The same
     * {@link ReadingOrder} will be the text layer of the export (BE-07).
     */
    @Transactional(readOnly = true)
    public ReadingOrder readingOrder(User user, UUID id, Integer version) {
        ResumeDocument document = owned(user, id);
        int number = version != null ? version : document.getCurrent();
        ResumeDocumentVersion chosen = versions.findByDocumentOrderByNumberAsc(document).stream()
                .filter(v -> v.getNumber() == number).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Version not found"));
        return ReadingOrder.of(chosen.getContent(), FormatNormalizer.normalize(document.getFormat()));
    }

    /** Deletes the document; its versions go with it. */
    @Transactional
    public void delete(User user, UUID id) {
        documents.delete(owned(user, id));
    }

    // ---------- helpers ----------

    /** A version summary: plain text like any other, 1 to {@value #MAX_SUMMARY_LENGTH} characters, refused (never cut) otherwise. */
    private static String summary(String given) {
        String summary = PlainText.collapse(given);
        if (summary.isEmpty()) {
            throw new BadRequestException("A version needs a summary, for example \"You edited Summary\".");
        }
        int length = PlainText.length(summary);
        if (length > MAX_SUMMARY_LENGTH) {
            throw new BadRequestException("A version summary can be at most " + MAX_SUMMARY_LENGTH + " characters; this one has " + length + ".");
        }
        return summary;
    }

    /** The document's versions, oldest first, in a list this service may add to. */
    private List<ResumeDocumentVersion> historyOf(ResumeDocument document) {
        return new ArrayList<>(versions.findByDocumentOrderByNumberAsc(document));
    }

    /** The resume of the current version. */
    private static JsonNode currentResume(ResumeDocument document, List<ResumeDocumentVersion> history) {
        return history.stream().filter(v -> v.getNumber() == document.getCurrent()).findFirst()
                .orElseThrow(() -> new IllegalStateException("Document " + document.getId() + " has no version " + document.getCurrent()))
                .getContent();
    }

    /**
     * Adds a version on top of the history and makes it current. {@code history} (oldest first) is updated to match: past
     * {@value #MAX_VERSIONS} versions the oldest are dropped (RB-VER-06), and a number is never used twice. Nothing already
     * stored is changed.
     */
    private ResumeDocumentVersion append(ResumeDocument document, List<ResumeDocumentVersion> history, String source,
                                         String summary, JsonNode resume, Instant now) {
        int number = history.stream().mapToInt(ResumeDocumentVersion::getNumber).max().orElse(0) + 1;
        ResumeDocumentVersion added = version(document, number, source, summary, resume, now);
        versions.save(added);
        history.add(added);
        while (history.size() > MAX_VERSIONS) {
            versions.delete(history.remove(0));
        }
        document.setCurrent(number);
        document.setUpdatedAt(now);
        documents.save(document);
        return added;
    }

    /** The same answer for a document that does not exist and one that is someone else's, so ids cannot be probed (BE-04). */
    private ResumeDocument owned(User user, UUID id) {
        return documents.findByIdAndUser(id, user).orElseThrow(() -> new ResourceNotFoundException("Resume document not found"));
    }

    private static ResumeDocumentVersion version(ResumeDocument document, int number, String source, String summary, JsonNode resume, Instant at) {
        ResumeDocumentVersion version = new ResumeDocumentVersion();
        version.setDocument(document);
        version.setNumber(number);
        version.setSource(source);
        version.setSummary(summary);
        version.setContent(resume);
        version.setAt(at);
        return version;
    }

    private static VersionDto toDto(ResumeDocumentVersion version) {
        return new VersionDto(version.getNumber(), version.getSource(), version.getSummary(), version.getAt().toEpochMilli(), version.getContent());
    }

    private static DocumentDto toDto(ResumeDocument document, List<ResumeDocumentVersion> versionList) {
        return new DocumentDto(
                document.getId(),
                document.getTitle(),
                AnswersNormalizer.normalize(document.getAnswers()),
                document.getTemplateId(),
                FormatNormalizer.normalize(document.getFormat()),
                versionList.stream().map(BuilderDocumentService::toDto).toList(),
                document.getCurrent());
    }
}

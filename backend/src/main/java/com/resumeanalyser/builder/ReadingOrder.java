package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * How an applicant tracking system reads a resume (docs/prototype-spec.md, RB-ATS-01, RB-ATS-02): the resume as plain text in
 * the order a parser meets it, and one plain note for each layout choice that parsers can trip over. The PDF's text layer MUST
 * be this same text (RB-EXP-02, BE-07), so export and the reading-order endpoint both come from here.
 *
 * <p>This is the prototype's {@code resumeToDoc} + {@code docToPlainText} + {@code readingNotes}
 * (frontend/src/js/pages/resume-doc.js) worked out directly on the stored resume. {@code ReadingOrderTest} runs the cases the
 * prototype itself produces, so the two cannot drift apart unnoticed.
 *
 * @param text  the plain text, lines separated by {@code \n}
 * @param notes at least one note: the two-column warning, one per table, or the "safest layout" sentence
 */
public record ReadingOrder(String text, List<String> notes) {

    private static final String TWO_COLUMNS = "Two columns: the main column (summary, experience) is read first, then the side column "
            + "(education, skills). Some parsers read straight across both columns instead and mix them up.";
    private static final String SAFEST = "One column and no tables: the safest layout for applicant tracking systems.";

    /** Where a job's text breaks into bullets: after . ! or ? and a space, before a capital, a digit or a tag. */
    private static final Pattern SENTENCE_BREAK = Pattern.compile("(?<=[.!?])[\\s\\p{Z}\\uFEFF]+(?=[A-Z0-9<])", Pattern.UNICODE_CHARACTER_CLASS);

    public ReadingOrder {
        notes = List.copyOf(notes);
    }

    /**
     * @param resume a stored (canonical) resume
     * @param format the document's format: {@code columns}, {@code bullets} and {@code hidden} change what a parser meets
     */
    public static ReadingOrder of(JsonNode resume, BuilderFormat format) {
        return new ReadingOrder(new Reader(resume, format).text(), notes(resume, format));
    }

    // ---------- the notes ----------

    private static List<String> notes(JsonNode resume, BuilderFormat format) {
        List<String> notes = new ArrayList<>();
        if (format.columns() == 2) {
            notes.add(TWO_COLUMNS);
        }
        for (JsonNode section : resume.path("extra")) {
            for (JsonNode block : section.path("body")) {
                if ("table".equals(block.path("type").asText())) {
                    notes.add("The table in \"" + section.path("title").asText("") + "\" is read cell by cell, row by row. "
                            + "Some parsers scramble tables, so keep job titles, dates and employers out of them.");
                    break; // one note for each section with a table, however many tables it holds
                }
            }
        }
        if (notes.isEmpty()) {
            notes.add(SAFEST);
        }
        return notes;
    }

    // ---------- the text ----------

    /** Builds the lines of one resume. */
    private static final class Reader {

        private final JsonNode resume;
        private final BuilderFormat format;
        private final Set<String> hidden;
        private final List<String> lines = new ArrayList<>();

        Reader(JsonNode resume, BuilderFormat format) {
            this.resume = resume;
            this.format = format;
            this.hidden = new HashSet<>(format.hidden());
        }

        String text() {
            lines.add(resume.path("name").asText(""));
            lines.add(rich(resume.path("contact")));
            if (format.columns() == 2) { // the main column before the side column; custom sections stay in the main one
                summary();
                experience();
                custom();
                education();
                skills();
            } else {
                summary();
                experience();
                education();
                skills();
                custom();
            }
            return PlainText.stripEnd(String.join("\n", lines).replaceFirst("^\\n+", "").replaceAll("\\n{3,}", "\n\n"));
        }

        private void heading(String title) {
            lines.add("");
            lines.add(title.toUpperCase(Locale.ROOT));
        }

        private static String rich(JsonNode markup) {
            return RichText.plainText(markup.asText(""));
        }

        private static String joined(String role, String dates) {
            List<String> parts = new ArrayList<>();
            for (String part : new String[] {role, dates}) {
                if (!part.isEmpty()) {
                    parts.add(part);
                }
            }
            return String.join(" | ", parts);
        }

        /** The listed items, or one blank item when there are none: the editor keeps one empty row. */
        private static List<JsonNode> itemsOrBlank(JsonNode list) {
            List<JsonNode> items = new ArrayList<>();
            list.forEach(items::add);
            if (items.isEmpty()) {
                items.add(com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode());
            }
            return items;
        }

        private void summary() {
            if (!hidden.contains("summary")) {
                heading("Summary");
                lines.add(rich(resume.path("summary")));
            }
        }

        private void experience() {
            heading("Experience");
            for (JsonNode job : itemsOrBlank(resume.path("experience"))) {
                lines.add(joined(rich(job.path("role")), job.path("dates").asText("")));
                if (format.bullets()) {
                    for (String sentence : sentences(job.path("details").asText(""))) {
                        lines.add("- " + RichText.plainText(sentence));
                    }
                } else {
                    lines.add(rich(job.path("details")));
                }
            }
        }

        private void education() {
            if (!hidden.contains("education")) {
                heading("Education");
                for (JsonNode school : itemsOrBlank(resume.path("education"))) {
                    lines.add(joined(rich(school.path("degree")), school.path("dates").asText("")));
                }
            }
        }

        private void skills() {
            if (!hidden.contains("skills")) {
                heading("Skills");
                List<String> skills = new ArrayList<>();
                resume.path("skills").forEach(skill -> {
                    if (!skill.asText("").isEmpty()) {
                        skills.add(skill.asText(""));
                    }
                });
                lines.add(String.join(", ", skills));
            }
        }

        private void custom() {
            for (JsonNode section : resume.path("extra")) {
                heading(section.path("title").asText(""));
                // A section with no body is a title and nothing else. (The prototype adds an empty line for its one empty
                // paragraph; every section is followed by a heading's blank line and blank runs collapse, so it never shows.)
                blocks(section.path("body"));
            }
        }

        private void blocks(JsonNode body) {
            for (JsonNode block : body) {
                switch (block.path("type").asText("")) {
                    case "paragraph" -> lines.add(textOf(block));
                    case "bulletList" -> block.path("content").forEach(item -> lines.add("- " + listItemText(item)));
                    case "table" -> block.path("content").forEach(row -> {
                        List<String> cells = new ArrayList<>();
                        row.path("content").forEach(cell -> cells.add(cellText(cell)));
                        if (cells.stream().anyMatch(cell -> !cell.isEmpty())) { // an empty row has no text for a parser to read
                            lines.add(String.join(" | ", cells));
                        }
                    });
                    default -> {
                        // Nothing else can be in a custom section (RB-BLOCK-01).
                    }
                }
            }
        }

        /** The text nodes of a paragraph, joined, with no formatting. */
        private static String textOf(JsonNode node) {
            StringBuilder out = new StringBuilder();
            node.path("content").forEach(child -> out.append(child.path("text").asText("")));
            return out.toString();
        }

        private static String listItemText(JsonNode item) {
            List<String> parts = new ArrayList<>();
            item.path("content").forEach(paragraph -> parts.add(textOf(paragraph)));
            return String.join(" ", parts);
        }

        /** One table cell as a single line: its paragraphs and its bullets one after another, joined by "; ". */
        private static String cellText(JsonNode cell) {
            List<String> parts = new ArrayList<>();
            for (JsonNode block : cell.path("content")) {
                if ("bulletList".equals(block.path("type").asText())) {
                    block.path("content").forEach(item -> parts.add(listItemText(item)));
                } else {
                    parts.add(textOf(block));
                }
            }
            return String.join("; ", parts.stream().filter(part -> !part.isEmpty()).toList());
        }

        /** A job's markup as sentences, one bullet each; a job with no text still has one empty bullet. */
        private static List<String> sentences(String markup) {
            List<String> sentences = new ArrayList<>();
            for (String part : SENTENCE_BREAK.split(markup, -1)) {
                String trimmed = PlainText.strip(part);
                if (!trimmed.isEmpty()) {
                    sentences.add(trimmed);
                }
            }
            if (sentences.isEmpty()) {
                sentences.add("");
            }
            return sentences;
        }
    }
}

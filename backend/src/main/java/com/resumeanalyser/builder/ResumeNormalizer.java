package com.resumeanalyser.builder;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.resumeanalyser.common.BadRequestException;
import com.resumeanalyser.common.PayloadTooLargeException;

/**
 * The backend's copy of "what a saved resume is" (docs/prototype-spec.md, RB-DATA-01, RB-DATA-02, RB-DATA-05, BE-01, BE-02).
 * It repairs what the prototype repairs: whitespace is collapsed and trimmed in every field, control characters go, a rich
 * field is written in its one canonical form, an emptied skill is removed, and a key that is not in the model is dropped. It
 * refuses what cannot be repaired (a field missing or of the wrong type, a custom section without a title) with a message
 * the person can read, and a resume over 200 KB with a 413. Nothing is ever truncated silently.
 *
 * <p>The result is always a new object in the one canonical form, so a resume can be stored, compared and normalised again
 * with no change.
 */
public final class ResumeNormalizer {

    /** The most a resume may be, as the JSON it arrives in (BE-02 says SHOULD be 200 KB). */
    public static final int MAX_BYTES = 200 * 1024;

    static final int MAX_TITLE_LENGTH = 80;

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final ObjectMapper JSON = new ObjectMapper();

    private ResumeNormalizer() {
    }

    /** @return the resume in its canonical form; @throws BadRequestException when it cannot be repaired */
    public static ObjectNode normalize(JsonNode resume) {
        if (resume == null || !resume.isObject()) {
            throw bad("A resume must be a JSON object with a name, contact, summary, experience, education and skills.");
        }
        requireSize(resume);

        ObjectNode out = NODES.objectNode();
        out.put("name", plain(text(resume, "name")));
        out.put("contact", rich(text(resume, "contact")));
        out.put("summary", rich(text(resume, "summary")));
        out.set("experience", experience(list(resume, "experience")));
        out.set("education", education(list(resume, "education")));
        out.set("skills", skills(list(resume, "skills")));
        JsonNode extra = resume.get("extra");
        if (extra != null && !extra.isNull()) {
            out.set("extra", sections(extra));
        }
        return out;
    }

    private static BadRequestException bad(String message) {
        return new BadRequestException(message);
    }

    private static void requireSize(JsonNode resume) {
        int size;
        try {
            size = JSON.writeValueAsBytes(resume).length;
        } catch (JsonProcessingException e) {
            throw bad("The resume could not be read.");
        }
        if (size > MAX_BYTES) {
            throw new PayloadTooLargeException("A resume can be at most " + MAX_BYTES / 1024 + " KB.");
        }
    }

    // ---------- text ----------

    private static String plain(String value) {
        return PlainText.collapse(value);
    }

    /** The canonical markup, then the whitespace rule, in the prototype's order ({@code canonical} in resume-doc.js). */
    private static String rich(String value) {
        return PlainText.collapse(RichText.normalize(PlainText.stripControl(value)));
    }

    private static String text(JsonNode owner, String field) {
        JsonNode value = owner.get(field);
        if (value == null || !value.isTextual()) {
            throw bad("The resume needs its " + field + " as text.");
        }
        return value.asText();
    }

    private static ArrayNode list(JsonNode owner, String field) {
        JsonNode value = owner.get(field);
        if (value == null || !value.isArray()) {
            throw bad("The resume needs its " + field + " as a list.");
        }
        return (ArrayNode) value;
    }

    /** A text field of a job or a school, named in the message when it is wrong. */
    private static String itemText(JsonNode item, String section, int index, String field) {
        JsonNode value = item.get(field);
        if (value == null || !value.isTextual()) {
            throw bad("Item " + (index + 1) + " of " + section + " needs its " + field + " as text.");
        }
        return value.asText();
    }

    private static JsonNode requireItem(JsonNode item, String section, int index) {
        if (item == null || !item.isObject()) {
            throw bad("Item " + (index + 1) + " of " + section + " must be an object.");
        }
        return item;
    }

    // ---------- the lists ----------

    private static ArrayNode experience(ArrayNode jobs) {
        ArrayNode out = NODES.arrayNode();
        for (int i = 0; i < jobs.size(); i++) {
            JsonNode job = requireItem(jobs.get(i), "experience", i);
            ObjectNode kept = NODES.objectNode();
            kept.put("role", rich(itemText(job, "experience", i, "role")));
            kept.put("dates", plain(itemText(job, "experience", i, "dates")));
            kept.put("details", rich(itemText(job, "experience", i, "details")));
            out.add(kept);
        }
        return out;
    }

    private static ArrayNode education(ArrayNode schools) {
        ArrayNode out = NODES.arrayNode();
        for (int i = 0; i < schools.size(); i++) {
            JsonNode school = requireItem(schools.get(i), "education", i);
            ObjectNode kept = NODES.objectNode();
            kept.put("degree", rich(itemText(school, "education", i, "degree")));
            kept.put("dates", plain(itemText(school, "education", i, "dates")));
            out.add(kept);
        }
        return out;
    }

    private static ArrayNode skills(ArrayNode given) {
        ArrayNode out = NODES.arrayNode();
        for (JsonNode skill : given) {
            if (skill == null || !skill.isTextual()) {
                throw bad("Every skill must be text.");
            }
            String cleaned = plain(skill.asText());
            if (!cleaned.isEmpty()) {
                out.add(cleaned);
            }
        }
        return out;
    }

    // ---------- custom sections ----------

    private static ArrayNode sections(JsonNode extra) {
        if (!extra.isArray()) {
            throw bad("The custom sections must be a list of sections, each with a title and a body.");
        }
        ArrayNode out = NODES.arrayNode();
        for (JsonNode section : extra) {
            if (section == null || !section.isObject()) {
                throw bad("Each custom section must be an object with a title and a body.");
            }
            String title = title(section.get("title"));
            ObjectNode kept = NODES.objectNode();
            kept.put("title", title);
            try {
                kept.set("body", BlockValidator.normalize(section.get("body")));
            } catch (BadRequestException e) {
                throw bad("Custom section \"" + title + "\": " + e.getMessage());
            }
            out.add(kept);
        }
        return out;
    }

    private static String title(JsonNode given) {
        if (given == null || !given.isTextual()) {
            throw bad("Every custom section needs a title, as text.");
        }
        String title = plain(given.asText());
        if (title.isEmpty()) {
            throw bad("Every custom section needs a title: it is empty.");
        }
        int length = PlainText.length(title);
        if (length > MAX_TITLE_LENGTH) {
            throw bad("A custom section title can be at most " + MAX_TITLE_LENGTH + " characters; this one has " + length + ".");
        }
        return title;
    }
}

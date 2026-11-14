package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.resumeanalyser.common.BadRequestException;
import java.util.ArrayList;
import java.util.List;

/**
 * Validates the blocks of a custom section against exactly the list in docs/prototype-spec.md section 2.2 (RB-BLOCK-01):
 * paragraphs, bullet lists and tables, with text and these marks: bold, italic, underline, textColor, link.
 *
 * <p>A node type that is not on the list cannot be repaired, so it is rejected with a message the person can read. A mark,
 * a key or an attribute that is not on the list is stripped; a table attribute is brought inside its limits (RB-BLOCK-06);
 * a colour that cannot be read on white paper and a link that is not http, https, mailto or tel lose the mark but keep their
 * text. The result is the one canonical form, so two spellings of the same content are the same JSON and normalising twice
 * changes nothing. The rules are the prototype's ({@code resume-doc.js}, {@code normalizeTableAttrs}).
 */
public final class BlockValidator {

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    /** The order marks are written in: the same as the nesting of the markup (RB-DATA-03). */
    private static final List<String> MARK_ORDER = List.of("link", "textColor", "underline", "bold", "italic");

    private static final List<String> BORDERS = List.of("all", "light", "rows");
    private static final List<String> BORDER_STYLES = List.of("solid", "dashed", "dotted");

    private static final int MAX_SPAN = 100;

    private BlockValidator() {
    }

    /** @return the blocks in their canonical form; @throws BadRequestException when one cannot be repaired */
    public static ArrayNode normalize(JsonNode body) {
        if (body == null || !body.isArray()) {
            throw bad("A custom section's body must be a list of blocks.");
        }
        ArrayNode blocks = NODES.arrayNode();
        for (JsonNode block : body) {
            blocks.add(block(block, true));
        }
        return blocks;
    }

    private static BadRequestException bad(String message) {
        return new BadRequestException(message);
    }

    // ---------- blocks ----------

    private static String typeOf(JsonNode node) {
        if (node == null || !node.isObject() || !node.has("type") || !node.get("type").isTextual()) {
            throw bad("Every block in a custom section needs a type.");
        }
        return node.get("type").asText();
    }

    /** A paragraph, a bullet list or (when {@code tablesAllowed}) a table. */
    private static ObjectNode block(JsonNode node, boolean tablesAllowed) {
        String type = typeOf(node);
        return switch (type) {
            case "paragraph" -> paragraph(node);
            case "bulletList" -> bulletList(node);
            case "table" -> {
                if (!tablesAllowed) {
                    throw bad("A table cell can hold paragraphs and bullet lists, not another table.");
                }
                yield table(node);
            }
            default -> throw bad("A custom section can only hold paragraphs, bullet lists and tables: '" + type + "' is not allowed.");
        };
    }

    private static ArrayNode children(JsonNode node, String what) {
        JsonNode content = node.get("content");
        if (content == null || content.isNull()) {
            return NODES.arrayNode();
        }
        if (!content.isArray()) {
            throw bad("The content of " + what + " must be a list.");
        }
        return (ArrayNode) content;
    }

    private static ObjectNode paragraph(JsonNode node) {
        ObjectNode out = NODES.objectNode();
        out.put("type", "paragraph");
        ArrayNode content = inline(children(node, "a paragraph"));
        if (!content.isEmpty()) {
            out.set("content", content);
        }
        return out;
    }

    private static ObjectNode emptyParagraph() {
        ObjectNode paragraph = NODES.objectNode();
        paragraph.put("type", "paragraph");
        return paragraph;
    }

    private static ObjectNode bulletList(JsonNode node) {
        ArrayNode items = children(node, "a bullet list");
        if (items.isEmpty()) {
            throw bad("A bullet list needs at least one item.");
        }
        ArrayNode content = NODES.arrayNode();
        for (JsonNode item : items) {
            if (!"listItem".equals(typeOf(item))) {
                throw bad("A bullet list can only hold list items.");
            }
            ArrayNode paragraphs = NODES.arrayNode();
            for (JsonNode child : children(item, "a list item")) {
                if (!"paragraph".equals(typeOf(child))) {
                    throw bad("A list item can only hold paragraphs.");
                }
                paragraphs.add(paragraph(child));
            }
            if (paragraphs.isEmpty()) {
                paragraphs.add(emptyParagraph());
            }
            ObjectNode listItem = NODES.objectNode();
            listItem.put("type", "listItem");
            listItem.set("content", paragraphs);
            content.add(listItem);
        }
        ObjectNode out = NODES.objectNode();
        out.put("type", "bulletList");
        out.set("content", content);
        return out;
    }

    // ---------- text and marks ----------

    /** The text of a paragraph: only text nodes, empty ones dropped, marks canonical, neighbours with the same marks joined. */
    private static ArrayNode inline(ArrayNode nodes) {
        List<String> texts = new ArrayList<>();
        List<ArrayNode> markSets = new ArrayList<>();
        for (JsonNode node : nodes) {
            if (!"text".equals(typeOf(node))) {
                throw bad("A paragraph can only hold text.");
            }
            JsonNode text = node.get("text");
            if (text == null || !text.isTextual()) {
                throw bad("A piece of text in a custom section needs its words.");
            }
            if (text.asText().isEmpty()) {
                continue;
            }
            ArrayNode marks = marks(node.get("marks"));
            int last = texts.size() - 1;
            if (last >= 0 && markSets.get(last).equals(marks)) {
                texts.set(last, texts.get(last) + text.asText());
            } else {
                texts.add(text.asText());
                markSets.add(marks);
            }
        }
        ArrayNode out = NODES.arrayNode();
        for (int i = 0; i < texts.size(); i++) {
            ObjectNode text = NODES.objectNode();
            text.put("type", "text");
            text.put("text", texts.get(i));
            if (!markSets.get(i).isEmpty()) {
                text.set("marks", markSets.get(i));
            }
            out.add(text);
        }
        return out;
    }

    private static ArrayNode marks(JsonNode given) {
        ObjectNode byType = NODES.objectNode();
        if (given != null && given.isArray()) {
            for (JsonNode mark : given) {
                if (mark == null || !mark.isObject() || !mark.hasNonNull("type") || !mark.get("type").isTextual()) {
                    continue;
                }
                String type = mark.get("type").asText();
                if (byType.has(type)) {
                    continue; // each mark once; the first valid one wins
                }
                ObjectNode kept = NODES.objectNode();
                kept.put("type", type);
                switch (type) {
                    case "bold", "italic", "underline" -> byType.set(type, kept);
                    case "textColor" -> {
                        String color = RichText.safeColor(attribute(mark, "color"));
                        if (color != null) {
                            kept.set("attrs", NODES.objectNode().put("color", color));
                            byType.set(type, kept);
                        }
                    }
                    case "link" -> {
                        String href = RichText.safeHref(attribute(mark, "href"));
                        if (href != null) {
                            kept.set("attrs", NODES.objectNode().put("href", href));
                            byType.set(type, kept);
                        }
                    }
                    default -> {
                        // Not on the list: stripped.
                    }
                }
            }
        }
        ArrayNode ordered = NODES.arrayNode();
        for (String type : MARK_ORDER) {
            if (byType.has(type)) {
                ordered.add(byType.get(type));
            }
        }
        return ordered;
    }

    private static String attribute(JsonNode mark, String name) {
        JsonNode attrs = mark.get("attrs");
        JsonNode value = attrs != null && attrs.isObject() ? attrs.get(name) : null;
        return value != null && value.isTextual() ? value.asText() : null;
    }

    // ---------- tables ----------

    private static ObjectNode table(JsonNode node) {
        ArrayNode rows = children(node, "a table");
        if (rows.isEmpty()) {
            throw bad("A table needs at least one row.");
        }
        ArrayNode content = NODES.arrayNode();
        for (JsonNode row : rows) {
            if (!"tableRow".equals(typeOf(row))) {
                throw bad("A table can only hold rows.");
            }
            ArrayNode cells = children(row, "a table row");
            if (cells.isEmpty()) {
                throw bad("A table row needs at least one cell.");
            }
            ArrayNode rowContent = NODES.arrayNode();
            for (JsonNode cell : cells) {
                rowContent.add(cell(cell));
            }
            ObjectNode tableRow = NODES.objectNode();
            tableRow.put("type", "tableRow");
            tableRow.set("content", rowContent);
            content.add(tableRow);
        }
        ObjectNode out = NODES.objectNode();
        out.put("type", "table");
        out.set("attrs", tableAttributes(node.get("attrs")));
        out.set("content", content);
        return out;
    }

    private static ObjectNode cell(JsonNode node) {
        String type = typeOf(node);
        if (!type.equals("tableCell") && !type.equals("tableHeader")) {
            throw bad("A table row can only hold cells.");
        }
        ArrayNode content = NODES.arrayNode();
        for (JsonNode child : children(node, "a table cell")) {
            content.add(block(child, false));
        }
        if (content.isEmpty()) {
            content.add(emptyParagraph());
        }
        ObjectNode out = NODES.objectNode();
        out.put("type", type);
        // A cell attribute that is only a default is not written, so two spellings of one table compare equal (RB-BLOCK-02).
        ObjectNode attrs = cellAttributes(node.get("attrs"));
        if (!attrs.isEmpty()) {
            out.set("attrs", attrs);
        }
        out.set("content", content);
        return out;
    }

    private static ObjectNode cellAttributes(JsonNode given) {
        ObjectNode attrs = NODES.objectNode();
        if (given == null || !given.isObject()) {
            return attrs;
        }
        for (String span : List.of("colspan", "rowspan")) {
            JsonNode value = given.get(span);
            if (value != null && value.isNumber() && value.asDouble() == Math.rint(value.asDouble())) {
                int clamped = (int) Math.min(MAX_SPAN, Math.max(1, value.asDouble()));
                if (clamped != 1) {
                    attrs.put(span, clamped);
                }
            }
        }
        JsonNode widths = given.get("colwidth");
        if (widths != null && widths.isArray() && !widths.isEmpty()) {
            ArrayNode kept = NODES.arrayNode();
            for (JsonNode width : widths) {
                if (!width.isNumber() || width.asDouble() != Math.rint(width.asDouble()) || width.asDouble() < 1) {
                    return attrs; // one bad width and the whole list is the default (not set)
                }
                kept.add(number(width.asDouble()));
            }
            attrs.set("colwidth", kept);
        }
        return attrs;
    }

    /**
     * The five attributes of a table, each valid (RB-BLOCK-04, RB-BLOCK-06): a word not on the list is the default, a number
     * outside its limits is brought inside and rounded to its step, and an empty or non-numeric one is the default, not 0. A
     * table saved with the old {@code borders: "none"} reads as a full grid of width 0; an explicit width wins over it.
     */
    private static ObjectNode tableAttributes(JsonNode given) {
        JsonNode in = given != null && given.isObject() ? given : NODES.objectNode();
        String borders = in.hasNonNull("borders") && in.get("borders").isTextual() ? in.get("borders").asText() : null;
        boolean oldNone = "none".equals(borders);
        double width = oldNone && !in.has("borderWidth") ? 0 : clampStep(in.get("borderWidth"), 0, 6, 0.25, 1);

        ObjectNode out = NODES.objectNode();
        out.put("borders", borders != null && BORDERS.contains(borders) ? borders : "all");
        out.set("borderWidth", number(width));
        String style = in.hasNonNull("borderStyle") && in.get("borderStyle").isTextual() ? in.get("borderStyle").asText() : null;
        out.put("borderStyle", style != null && BORDER_STYLES.contains(style) ? style : "solid");
        out.set("cellPadding", number(clampStep(in.get("cellPadding"), 0, 12, 0.5, 4)));
        out.set("cellGap", number(clampStep(in.get("cellGap"), 0, 12, 0.5, 0)));
        return out;
    }

    private static double clampStep(JsonNode value, double min, double max, double step, double fallback) {
        Double parsed = null;
        if (value != null && value.isNumber()) {
            parsed = value.asDouble();
        } else if (value != null && value.isTextual() && !value.asText().isBlank()) {
            try {
                parsed = Double.parseDouble(value.asText().trim());
            } catch (NumberFormatException notANumber) {
                return fallback;
            }
        }
        if (parsed == null || !Double.isFinite(parsed)) {
            return fallback;
        }
        double stepped = Math.round(Math.min(max, Math.max(min, parsed)) / step) * step;
        return Math.round(stepped * 100) / 100.0;
    }

    /**
     * A whole number is written as one (1, not 1.0), as the editor and the prototype write it, and as an int, which is what
     * a stored document parses to (Jackson does not treat an int and a long of the same value as equal).
     */
    private static JsonNode number(double value) {
        if (value == Math.rint(value) && Math.abs(value) <= Integer.MAX_VALUE) {
            return NODES.numberNode((int) value);
        }
        return NODES.numberNode(value);
    }
}

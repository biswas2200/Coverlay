package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Brings any format a client sends inside the table of RB-FMT: a value that is not allowed is replaced by its default,
 * silently, on every write (RB-FMT-01). It never throws, and normalising a normalised format changes nothing.
 * The rules are the prototype's {@code normalizeFormat} (frontend/src/js/pages/resume-builder-rules.js).
 */
public final class FormatNormalizer {

    private static final List<String> FONTS = List.of("sans", "serif", "classic");
    private static final List<String> SPACINGS = List.of("tight", "normal", "airy");
    private static final List<String> ALIGNS = List.of("left", "center");
    private static final List<String> STYLES = List.of("formal", "concise", "friendly", "beginner");
    private static final List<String> PAGES = List.of("a4", "letter");
    private static final List<String> UNITS = List.of("cm", "in");
    /** The built-in sections that can be hidden; Experience and the header cannot (RB-FMT-04). */
    private static final List<String> HIDEABLE = List.of("summary", "education", "skills");

    private static final double FONT_DEFAULT = 11;
    private static final double FONT_MIN = 8;
    private static final double FONT_MAX = 14;
    private static final double FONT_STEP = 0.5;

    private static final double MARGIN_DEFAULT = 19.1;
    private static final double MARGIN_MIN = 5;
    private static final double MARGIN_MAX = 50;

    /** An older save kept one named margin for all four sides (RB-FMT-01, RB-FMT-02). */
    private static final Map<String, Double> LEGACY_MARGINS = Map.of("narrow", 12.7, "normal", 19.1, "wide", 25.4);

    private FormatNormalizer() {
    }

    public static BuilderFormat normalize(JsonNode input) {
        JsonNode in = input != null && input.isObject() ? input : null;

        double top = MARGIN_DEFAULT;
        double bottom = MARGIN_DEFAULT;
        double left = MARGIN_DEFAULT;
        double right = MARGIN_DEFAULT;
        String legacy = text(in, "margins");
        if (legacy != null && LEGACY_MARGINS.containsKey(legacy)) {
            top = bottom = left = right = LEGACY_MARGINS.get(legacy);
        }
        // An explicit margin wins over the older single one.
        top = margin(in, "marginTop", top);
        bottom = margin(in, "marginBottom", bottom);
        left = margin(in, "marginLeft", left);
        right = margin(in, "marginRight", right);

        return new BuilderFormat(
                option(in, "font", FONTS, "sans"),
                fontSize(in),
                option(in, "spacing", SPACINGS, "normal"),
                option(in, "align", ALIGNS, "left"),
                flag(in, "bullets"),
                option(in, "style", STYLES, "formal"),
                columns(in),
                option(in, "page", PAGES, "a4"),
                option(in, "unit", UNITS, "cm"),
                flag(in, "rules"),
                hidden(in),
                top, bottom, left, right);
    }

    /** The text value of a key, or null when the key is missing or not text. */
    private static String text(JsonNode in, String key) {
        JsonNode value = in == null ? null : in.get(key);
        return value != null && value.isTextual() ? value.asText() : null;
    }

    private static String option(JsonNode in, String key, List<String> allowed, String fallback) {
        String value = text(in, key);
        return value != null && allowed.contains(value) ? value : fallback;
    }

    private static boolean flag(JsonNode in, String key) {
        JsonNode value = in == null ? null : in.get(key);
        return value != null && value.isBoolean() && value.asBoolean();
    }

    /** Only the number 1 or the number 2 (not the text "2"), as in the prototype. */
    private static int columns(JsonNode in) {
        JsonNode value = in == null ? null : in.get("columns");
        if (value != null && value.isNumber() && value.asDouble() == 2) {
            return 2;
        }
        return 1;
    }

    private static List<String> hidden(JsonNode in) {
        JsonNode value = in == null ? null : in.get("hidden");
        if (value == null || !value.isArray()) {
            return List.of();
        }
        List<String> kept = new ArrayList<>();
        for (String name : HIDEABLE) {
            for (JsonNode item : value) {
                if (item.isTextual() && item.asText().equals(name)) {
                    kept.add(name);
                    break;
                }
            }
        }
        return kept;
    }

    private static double fontSize(JsonNode in) {
        Double size = number(in, "fontSize");
        if (size == null) {
            return FONT_DEFAULT;
        }
        double rounded = Math.round(size / FONT_STEP) * FONT_STEP;
        return Math.min(FONT_MAX, Math.max(FONT_MIN, rounded));
    }

    private static double margin(JsonNode in, String key, double fallback) {
        Double mm = number(in, key);
        if (mm == null) {
            return fallback;
        }
        return Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, Math.round(mm * 10) / 10.0));
    }

    /** A finite number given as a number or as text; anything else (text that is not a number, "", null, a flag) is null. */
    private static Double number(JsonNode in, String key) {
        JsonNode value = in == null ? null : in.get(key);
        if (value == null) {
            return null;
        }
        Double parsed = null;
        if (value.isNumber()) {
            parsed = value.asDouble();
        } else if (value.isTextual() && !value.asText().isBlank()) {
            try {
                parsed = Double.parseDouble(value.asText().trim());
            } catch (NumberFormatException notANumber) {
                return null;
            }
        }
        return parsed != null && Double.isFinite(parsed) ? parsed : null;
    }
}

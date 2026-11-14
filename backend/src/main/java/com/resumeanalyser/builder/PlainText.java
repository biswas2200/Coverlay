package com.resumeanalyser.builder;

import java.util.regex.Pattern;

/**
 * The cleaning every text field goes through (docs/prototype-spec.md, RB-DATA-02): whitespace collapsed to single spaces and
 * trimmed, like the prototype's {@code normalizeText}, and control characters removed.
 */
final class PlainText {

    /** Control characters other than the whitespace ones, which {@link #collapse} handles instead. */
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cc}&&[^\\t\\n\\r]]");

    /** What the browser's {@code \s} matches: all Unicode spaces, the byte-order mark included. */
    private static final Pattern WHITESPACE = Pattern.compile("[\\s\\p{Z}\\uFEFF]+", Pattern.UNICODE_CHARACTER_CLASS);

    private PlainText() {
    }

    /** Control characters removed; whitespace untouched. Null is empty. */
    static String stripControl(String value) {
        return value == null ? "" : CONTROL.matcher(value).replaceAll("");
    }

    /** Control characters removed, whitespace collapsed to single spaces, trimmed. Null is empty. */
    static String collapse(String value) {
        return WHITESPACE.matcher(stripControl(value)).replaceAll(" ").strip();
    }

    /** One whitespace character, by the same definition as {@link #WHITESPACE}. */
    private static final Pattern SPACE = Pattern.compile("[\\s\\p{Z}\\uFEFF]", Pattern.UNICODE_CHARACTER_CLASS);

    private static boolean isSpace(char c) {
        return SPACE.matcher(Character.toString(c)).matches();
    }

    /** Whitespace removed from the end, as JavaScript's {@code trimEnd} does (a non-breaking space counts). */
    static String stripEnd(String value) {
        int end = value.length();
        while (end > 0 && isSpace(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(0, end);
    }

    /** Whitespace removed from both ends, as JavaScript's {@code trim} does (a non-breaking space counts). */
    static String strip(String value) {
        int start = 0;
        while (start < value.length() && isSpace(value.charAt(start))) {
            start++;
        }
        return stripEnd(value.substring(start));
    }

    /** The length a person counts: characters, not UTF-16 units (an emoji is one). */
    static int length(String value) {
        return value.codePointCount(0, value.length());
    }
}

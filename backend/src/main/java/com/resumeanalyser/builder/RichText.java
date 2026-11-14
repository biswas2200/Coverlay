package com.resumeanalyser.builder;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What rich text may contain (docs/prototype-spec.md, RB-DATA-03, RB-DATA-04, RB-FMT-06). A rich field is a string that
 * uses only {@code <b> <i> <u> <a href="…"> <font color="#rrggbb">}, with {@code & < >} in the text escaped. The backend
 * never trusts the client's markup: {@link #normalize} reads it the way the prototype does and writes it back in the one
 * canonical form, so unknown tags and attributes become harmless escaped text, an unsafe link loses its link, and a colour
 * that is not a readable {@code #rrggbb} loses its colour (text made white or pale would be hidden text).
 * The rules are the prototype's {@code parseInline}, {@code serializeSegments} and {@code mergeSegments}
 * (frontend/src/js/pages/resume-builder-rules.js).
 */
public final class RichText {

    /** The least contrast against white a text colour may have (WCAG AA for body text). */
    static final double MIN_TEXT_CONTRAST = 4.5;

    private static final Pattern TAG = Pattern.compile("<(/?)(b|i|u|a|font)(?:\\s+(?:href|color)=\"([^\"<>]*)\")?>", Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern ENTITY = Pattern.compile("&(?:amp|lt|gt|quot);");
    private static final Pattern URL_BAD = Pattern.compile("[\\s\"'<>`]", Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern URL_SCHEME = Pattern.compile("^(?:https?://|mailto:|tel:)", Pattern.CASE_INSENSITIVE);
    private static final Pattern URL_WEB = Pattern.compile("^https?://[^/]", Pattern.CASE_INSENSITIVE);
    private static final Pattern URL_MAIL_OR_TEL = Pattern.compile("^(?:mailto|tel):.", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern URL_BARE_DOMAIN = Pattern.compile("^[a-z0-9-]+(?:\\.[a-z0-9-]+)+(?:[/?#].*)?$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern HEX3 = Pattern.compile("^#[0-9a-f]{3}$");
    private static final Pattern HEX6 = Pattern.compile("^#[0-9a-f]{6}$");

    private RichText() {
    }

    /**
     * A run of text and how it is formatted. {@code color} and {@code href} are null when there is none; build one with
     * {@link #of} and the {@code with…} methods, which return a changed copy.
     */
    public record Segment(String text, boolean bold, boolean italic, boolean underline, String color, String href) {

        public static Segment of(String text) {
            return new Segment(text, false, false, false, null, null);
        }

        public Segment withBold() {
            return new Segment(text, true, italic, underline, color, href);
        }

        public Segment withItalic() {
            return new Segment(text, bold, true, underline, color, href);
        }

        public Segment withUnderline() {
            return new Segment(text, bold, italic, true, color, href);
        }

        public Segment withColor(String hex) {
            return new Segment(text, bold, italic, underline, hex, href);
        }

        public Segment withHref(String url) {
            return new Segment(text, bold, italic, underline, color, url);
        }

        Segment withText(String other) {
            return new Segment(other, bold, italic, underline, color, href);
        }

        boolean sameFormatting(Segment other) {
            return bold == other.bold && italic == other.italic && underline == other.underline
                    && Objects.equals(color, other.color) && Objects.equals(href, other.href);
        }
    }

    /** Escapes text so it can sit inside the markup: &amp;, &lt; and &gt;. */
    public static String escape(String text) {
        if (text == null) {
            return "";
        }
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String unescape(String text) {
        Matcher matcher = ENTITY.matcher(text);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            String replacement = switch (matcher.group()) {
                case "&amp;" -> "&";
                case "&lt;" -> "<";
                case "&gt;" -> ">";
                default -> "\"";
            };
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    /**
     * A link target that is safe to store: http(s), mailto or tel; a bare {@code linkedin.com/in/x} or {@code www.x.com} gets
     * {@code https://}. Anything else (including {@code javascript:} and {@code data:}) is null (RB-DATA-04).
     */
    public static String safeHref(String raw) {
        String url = raw == null ? "" : raw.strip();
        if (url.isEmpty() || URL_BAD.matcher(url).find()) {
            return null;
        }
        if (URL_SCHEME.matcher(url).find()) {
            return URL_WEB.matcher(url).find() || URL_MAIL_OR_TEL.matcher(url).find() ? url : null;
        }
        if (URL_BARE_DOMAIN.matcher(url).matches()) {
            return "https://" + url;
        }
        return null;
    }

    /** How well {@code #rrggbb} reads on white paper: 1 (invisible) to 21 (black). Not a colour: 0. */
    public static double contrastOnWhite(String hex) {
        String text = hex == null ? "" : hex.strip().toLowerCase(Locale.ROOT);
        if (!HEX6.matcher(text).matches()) {
            return 0;
        }
        double[] channel = new double[3];
        for (int i = 0; i < 3; i++) {
            double value = Integer.parseInt(text.substring(1 + 2 * i, 3 + 2 * i), 16) / 255.0;
            channel[i] = value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        }
        return 1.05 / (0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2] + 0.05);
    }

    /**
     * A text colour that is safe to store: {@code #rgb} or {@code #rrggbb}, written as lower-case {@code #rrggbb}, and dark
     * enough to read on white paper (RB-FMT-06). Anything else is null.
     */
    public static String safeColor(String raw) {
        String text = raw == null ? "" : raw.strip().toLowerCase(Locale.ROOT);
        if (HEX3.matcher(text).matches()) {
            StringBuilder spelled = new StringBuilder("#");
            for (char digit : text.substring(1).toCharArray()) {
                spelled.append(digit).append(digit);
            }
            text = spelled.toString();
        }
        return HEX6.matcher(text).matches() && contrastOnWhite(text) >= MIN_TEXT_CONTRAST ? text : null;
    }

    /** The markup as segments (not yet merged), with every unsafe link and colour already dropped. */
    public static List<Segment> parse(String markup) {
        String source = markup == null ? "" : markup;
        List<Segment> segments = new ArrayList<>();
        List<String[]> open = new ArrayList<>(); // [tag, value]: a link's address or a colour
        Matcher matcher = TAG.matcher(source);
        int last = 0;
        while (matcher.find()) {
            push(segments, open, source.substring(last, matcher.start()));
            last = matcher.end();
            String closing = matcher.group(1);
            String tag = matcher.group(2);
            if (!closing.isEmpty()) {
                for (int i = open.size() - 1; i >= 0; i--) {
                    if (open.get(i)[0].equals(tag)) {
                        open.remove(i);
                        break;
                    }
                }
            } else {
                String attribute = unescape(matcher.group(3) == null ? "" : matcher.group(3));
                String value = tag.equals("a") ? safeHref(attribute) : tag.equals("font") ? safeColor(attribute) : null;
                open.add(new String[] {tag, value});
            }
        }
        push(segments, open, source.substring(last));
        return segments;
    }

    private static void push(List<Segment> segments, List<String[]> open, String raw) {
        if (raw.isEmpty()) {
            return;
        }
        Segment segment = Segment.of(unescape(raw));
        for (String[] item : open) {
            switch (item[0]) {
                case "a" -> {
                    if (item[1] != null) {
                        segment = segment.withHref(item[1]);
                    }
                }
                case "font" -> {
                    if (item[1] != null) {
                        segment = segment.withColor(item[1]);
                    }
                }
                case "b" -> segment = segment.withBold();
                case "i" -> segment = segment.withItalic();
                default -> segment = segment.withUnderline();
            }
        }
        segments.add(segment);
    }

    /** The text without its formatting, e.g. for word counts and the analyzer. */
    public static String plainText(String markup) {
        StringBuilder out = new StringBuilder();
        for (Segment segment : parse(markup)) {
            out.append(segment.text());
        }
        return out.toString();
    }

    /** Segments back to markup in the canonical nesting order {@code <a><font><u><b><i>text</i></b></u></font></a>}. */
    public static String serialize(List<Segment> segments) {
        StringBuilder all = new StringBuilder();
        for (Segment segment : segments) {
            String out = escape(segment.text());
            if (out.isEmpty()) {
                continue;
            }
            if (segment.italic()) {
                out = "<i>" + out + "</i>";
            }
            if (segment.bold()) {
                out = "<b>" + out + "</b>";
            }
            if (segment.underline()) {
                out = "<u>" + out + "</u>";
            }
            String color = segment.color() == null ? null : safeColor(segment.color());
            if (color != null) {
                out = "<font color=\"" + color + "\">" + out + "</font>";
            }
            String href = segment.href() == null ? null : safeHref(segment.href());
            if (href != null) {
                out = "<a href=\"" + escape(href) + "\">" + out + "</a>";
            }
            all.append(out);
        }
        return all.toString();
    }

    /** Joins neighbouring segments that carry the same formatting, and drops empty ones. */
    public static List<Segment> merge(List<Segment> segments) {
        List<Segment> out = new ArrayList<>();
        for (Segment segment : segments) {
            Segment last = out.isEmpty() ? null : out.get(out.size() - 1);
            if (last != null && last.sameFormatting(segment)) {
                out.set(out.size() - 1, last.withText(last.text() + segment.text()));
            } else if (!segment.text().isEmpty()) {
                out.add(segment);
            }
        }
        return out;
    }

    /**
     * The one stored form of a rich field: read the way the prototype reads it, merged, and written canonically. A field
     * that is already canonical comes back exactly as it was, and normalising twice changes nothing.
     */
    public static String normalize(String markup) {
        return serialize(merge(parse(markup)));
    }
}

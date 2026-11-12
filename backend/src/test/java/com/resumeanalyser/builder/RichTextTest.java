package com.resumeanalyser.builder;

import com.resumeanalyser.builder.RichText.Segment;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * RB-DATA-03, RB-DATA-04 and RB-FMT-06: what rich text may contain. The backend never trusts the client's markup, so every
 * case is one the prototype's own tests pin (frontend/tests/resume-builder-rules.test.js), run against the Java rules.
 */
class RichTextTest {

    private static Segment plain(String text) {
        return Segment.of(text);
    }

    // ---------- markup and segments ----------

    @Test
    void formatting_roundTripsThroughTheMarkup_andTypedCharactersStayLiteral() {
        List<Segment> segments = List.of(
                plain("Hi "),
                plain("both").withBold().withItalic(),
                plain(" C++ 5* snake_case a<b & R&D "),
                plain("me").withHref("https://linkedin.com/in/jane").withUnderline());

        String markup = RichText.serialize(segments);

        assertThat(markup).isEqualTo("Hi <b><i>both</i></b> C++ 5* snake_case a&lt;b &amp; R&amp;D <a href=\"https://linkedin.com/in/jane\"><u>me</u></a>");
        assertThat(RichText.parse(markup)).isEqualTo(segments);
        assertThat(RichText.plainText(markup)).isEqualTo("Hi both C++ 5* snake_case a<b & R&D me");
    }

    @Test
    void anUnsafeLink_isDropped_andBrokenMarkupSurvives() {
        assertThat(RichText.parse("<a href=\"javascript:alert(1)\">x</a>")).containsExactly(plain("x"));
        assertThat(RichText.parse("<b>unclosed")).containsExactly(plain("unclosed").withBold());
        assertThat(RichText.parse("stray</b> text")).containsExactly(plain("stray"), plain(" text"));
        assertThat(RichText.parse("")).isEmpty();
        assertThat(RichText.parse(null)).isEmpty();
    }

    @Test
    void anUnknownTag_isJustText_andIsWrittenEscaped() {
        assertThat(RichText.parse("<script>x</script>")).containsExactly(plain("<script>x</script>"));
        assertThat(RichText.normalize("<script>alert(1)</script>")).isEqualTo("&lt;script&gt;alert(1)&lt;/script&gt;");
        assertThat(RichText.normalize("<img src=x onerror=alert(1)>")).isEqualTo("&lt;img src=x onerror=alert(1)&gt;");
        assertThat(RichText.normalize("<b onclick=\"x\">hi</b>")).as("an attribute the grammar does not allow").isEqualTo("&lt;b onclick=\"x\"&gt;hi");
    }

    @Test
    void entities_areReadOnceOnly() {
        assertThat(RichText.plainText("a &amp;lt; b")).as("&amp;lt; is the text &lt;, not a second unescape").isEqualTo("a &lt; b");
        assertThat(RichText.plainText("&lt;b&gt; &quot;q&quot;")).isEqualTo("<b> \"q\"");
    }

    @Test
    void aTextColour_isStoredAsFontColour_andComesBackAsTheSameColour() {
        List<Segment> segments = List.of(
                plain("Led "),
                plain("payments").withColor("#1d4ed8").withBold(),
                plain(" and "),
                plain("a site").withColor("#b91c1c").withHref("https://example.com"));

        String markup = RichText.serialize(segments);

        assertThat(markup).isEqualTo("Led <font color=\"#1d4ed8\"><b>payments</b></font> and <a href=\"https://example.com\"><font color=\"#b91c1c\">a site</font></a>");
        assertThat(RichText.parse(markup)).isEqualTo(segments);
        assertThat(RichText.plainText(markup)).isEqualTo("Led payments and a site");
    }

    @Test
    void neighboursWithTheSameFormattingJoin_differentColoursDoNot() {
        assertThat(RichText.merge(List.of(plain("a").withColor("#1d4ed8"), plain("b").withColor("#1d4ed8"), plain("c").withColor("#b91c1c"))))
                .containsExactly(plain("ab").withColor("#1d4ed8"), plain("c").withColor("#b91c1c"));
        assertThat(RichText.merge(List.of(plain("a"), plain("b"), plain("c").withBold(), plain(""))))
                .containsExactly(plain("ab"), plain("c").withBold());
    }

    @Test
    void escape_writesTheThreeCharactersTheMarkupNeeds() {
        assertThat(RichText.escape("<b> & ")).isEqualTo("&lt;b&gt; &amp; ");
        assertThat(RichText.escape(null)).isEmpty();
    }

    // ---------- links (RB-DATA-04) ----------

    @Test
    void aLinkAllowsHttp_mailto_andTel_andCompletesBareDomains() {
        assertThat(RichText.safeHref("linkedin.com/in/jane")).isEqualTo("https://linkedin.com/in/jane");
        assertThat(RichText.safeHref("www.example.com")).isEqualTo("https://www.example.com");
        assertThat(RichText.safeHref("mailto:a@b.co")).isEqualTo("mailto:a@b.co");
        assertThat(RichText.safeHref("tel:+919876543210")).isEqualTo("tel:+919876543210");
        assertThat(RichText.safeHref("https://x.y/z?q=1")).isEqualTo("https://x.y/z?q=1");
        assertThat(RichText.safeHref("  HTTP://Example.com  ")).as("trimmed, the scheme in any case").isEqualTo("HTTP://Example.com");
    }

    @Test
    void aLinkThatIsNotSafe_isNull() {
        for (String bad : new String[] {"javascript:alert(1)", "JaVaScRiPt:alert(1)", "https://", "data:text/html,x", "a b.com", "\"x\".com", "", "   ",
                "vbscript:x", "file:///etc/passwd", "https://x.y/\"onmouseover=\"x", "https://x.y/<script>", "mailto:", "tel:", "ftp://x.y", "//evil.example"}) {
            assertThat(RichText.safeHref(bad)).as(bad).isNull();
        }
        assertThat(RichText.safeHref(null)).isNull();
    }

    // ---------- colours (RB-FMT-06) ----------

    @Test
    void safeColour_keepsOnlyHexThatCanBeReadOnWhitePaper() {
        assertThat(RichText.safeColor("#1D4ED8")).as("lower-cased").isEqualTo("#1d4ed8");
        assertThat(RichText.safeColor("#a00")).as("a short form is spelled out").isEqualTo("#aa0000");
        assertThat(RichText.safeColor(" #000000 ")).isEqualTo("#000000");
        for (String refused : new String[] {"#ffffff", "#fff", "#eeeeee", "#cccccc", "#ffff00", "red", "rgb(0,0,0)", "#12345", "#1234567", "url(x)", "\"><b>", "", null}) {
            assertThat(RichText.safeColor(refused)).as(String.valueOf(refused)).isNull();
        }
    }

    @Test
    void contrast_isOneForWhite_twentyOneForBlack_andZeroForANonColour() {
        assertThat(RichText.contrastOnWhite("#ffffff")).isEqualTo(1.0);
        assertThat(RichText.contrastOnWhite("#000000")).isCloseTo(21.0, org.assertj.core.data.Offset.offset(0.01));
        assertThat(RichText.contrastOnWhite("blue")).isZero();
        assertThat(RichText.contrastOnWhite(null)).isZero();
    }

    @Test
    void everyColourTheToolbarOffers_isAccepted() {
        for (String hex : Arrays.asList("#4b5563", "#1e3a8a", "#1d4ed8", "#0f766e", "#15803d", "#6d28d9", "#b91c1c", "#c2410c", "#78350f")) {
            assertThat(RichText.safeColor(hex)).as(hex).isEqualTo(hex);
        }
    }

    @Test
    void markupCannotHideText_aWhiteOrPaleColour_orOneThatIsNotAHex_isDropped() {
        assertThat(RichText.parse("<font color=\"#ffffff\">hidden</font>")).containsExactly(plain("hidden"));
        assertThat(RichText.parse("<font color=\"#fefefe\"><b>pale</b></font>")).containsExactly(plain("pale").withBold());
        assertThat(RichText.parse("<font color=\"red\">named</font>")).containsExactly(plain("named"));
        assertThat(RichText.parse("<font color=\"#ffffff\"><font color=\"#1d4ed8\">x</font></font>")).containsExactly(plain("x").withColor("#1d4ed8"));
        assertThat(RichText.serialize(List.of(plain("x").withColor("#ffffff")))).as("saving drops an unreadable colour too").isEqualTo("x");
        assertThat(RichText.serialize(List.of(plain("x").withColor("javascript:1")))).isEqualTo("x");
        assertThat(RichText.normalize("<font color=\"#ffffff\">white on white</font>")).isEqualTo("white on white");
    }

    // ---------- the canonical form (RB-DATA-03) ----------

    @Test
    void twoSpellingsOfTheSameFormatting_areTheSameStoredString() {
        String a = RichText.normalize("<b><i>x</i></b>");
        String b = RichText.normalize("<i><b>x</b></i>");
        String c = RichText.normalize("<u><b><i>x</i></b></u>");
        String d = RichText.normalize("<b><u><i>x</i></u></b>");

        assertThat(a).isEqualTo(b).isEqualTo("<b><i>x</i></b>");
        assertThat(c).isEqualTo(d).isEqualTo("<u><b><i>x</i></b></u>");
    }

    @Test
    void theCanonicalNestingOrder_isLinkThenColourThenUnderlineThenBoldThenItalic() {
        String canonical = "<a href=\"https://x.y\"><font color=\"#1d4ed8\"><u><b><i>text</i></b></u></font></a>";

        assertThat(RichText.normalize(canonical)).isEqualTo(canonical);
        assertThat(RichText.normalize("<i><b><u><font color=\"#1D4ED8\"><a href=\"x.y\">text</a></font></u></b></i>")).isEqualTo(canonical);
    }

    @Test
    void aFieldThatIsAlreadyCanonical_isKeptExactly() {
        for (String markup : List.of("Plain text", "Built <b>fast</b> APIs.", "a &amp; b &lt; c", "Led <font color=\"#1d4ed8\"><b>payments</b></font> and <a href=\"https://example.com\"><font color=\"#b91c1c\">a site</font></a>")) {
            assertThat(RichText.normalize(markup)).as(markup).isEqualTo(markup);
        }
    }

    @Test
    void normalising_isIdempotent_forAnyInput() {
        for (String messy : new String[] {"<b>unclosed", "stray</b> text", "<a href=\"javascript:1\">x</a>", "<i><b>x</b></i> & <u>y</u>", "<<b>>", "&amp;amp;", "a<b>b</i>c</b>d"}) {
            String once = RichText.normalize(messy);
            assertThat(RichText.normalize(once)).as(messy).isEqualTo(once);
        }
    }

    @Test
    void normalising_neverLeavesMarkupOutsideTheGrammar() {
        String stored = RichText.normalize("<b>ok</b><iframe src=\"x\"></iframe><a href=\"javascript:1\" onclick=\"y\">z</a><font size=\"9\">q</font>");

        // What the grammar does not know stays as harmless escaped text; no tag but the five is left, and no attribute but href and color.
        assertThat(stored).doesNotContain("<iframe").doesNotContain("<a href=\"javascript").doesNotContain("<font size");
        assertThat(stored.replaceAll("</?(?:b|i|u|a|font)(?: (?:href|color)=\"[^\"<>]*\")?>", "")).doesNotContain("<").doesNotContain(">");
        assertThat(RichText.plainText(stored)).isEqualTo("ok<iframe src=\"x\"></iframe><a href=\"javascript:1\" onclick=\"y\">z<font size=\"9\">q");
    }

    @Test
    void nothing_isLostButTheMarkup_whenTheTextIsNormalised() {
        String markup = "Cut costs by <b>20%</b> & <i>R&amp;D</i> for 3 &lt; 5 teams";

        assertThat(RichText.plainText(RichText.normalize(markup))).isEqualTo(RichText.plainText(markup));
    }
}

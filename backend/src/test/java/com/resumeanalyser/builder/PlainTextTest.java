package com.resumeanalyser.builder;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** RB-DATA-02: whitespace in every field is collapsed to single spaces and trimmed; control characters never get in. */
class PlainTextTest {

    @Test
    void runsOfWhitespace_becomeOneSpace_andTheEndsAreTrimmed() {
        assertThat(PlainText.collapse("  Jane \n\t  Doe\r\n ")).isEqualTo("Jane Doe");
        assertThat(PlainText.collapse("a b")).isEqualTo("a b");
        assertThat(PlainText.collapse("   ")).isEmpty();
        assertThat(PlainText.collapse("")).isEmpty();
    }

    @Test
    void everyKindOfSpace_countsAsWhitespace_asInTheBrowser() {
        assertThat(PlainText.collapse("a  b c　d﻿e")).isEqualTo("a b c d e");
    }

    @Test
    void controlCharacters_areRemoved_notTurnedIntoSpaces() {
        assertThat(PlainText.collapse("Ja\u0000ne\u0007 Do\u007fe")).isEqualTo("Jane Doe");
        assertThat(PlainText.collapse("\u0000")).isEmpty();
    }

    @Test
    void stripControl_removesControlCharacters_butLeavesWhitespaceForCollapseToHandle() {
        assertThat(PlainText.stripControl("a\u0000b\u0007 \n\tc\u007f")).isEqualTo("ab \n\tc");
    }

    @Test
    void strip_andStripEnd_treatEverySpaceAsWhitespace_asJavaScriptsTrimDoes() {
        assertThat(PlainText.strip("  a b \n﻿")).isEqualTo("a b");
        assertThat(PlainText.stripEnd("  a b \n﻿　")).isEqualTo("  a b");
        assertThat(PlainText.stripEnd("  ")).isEmpty();
        assertThat(PlainText.strip("")).isEmpty();
        assertThat(PlainText.stripEnd("a\n\nb")).as("only the end").isEqualTo("a\n\nb");
    }

    @Test
    void nothing_isNothing() {
        assertThat(PlainText.collapse(null)).isEmpty();
    }

    @Test
    void lengthIsWhatAPersonCounts_notUtf16Units() {
        assertThat(PlainText.length("abc")).isEqualTo(3);
        assertThat(PlainText.length("a😀b")).as("an emoji is one character").isEqualTo(3);
        assertThat(PlainText.length("")).isZero();
    }
}

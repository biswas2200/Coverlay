package com.resumeanalyser.builder;

import java.util.List;

/**
 * How a resume is set on the page (docs/prototype-spec.md, RB-FMT). It belongs to the document, is saved with it and is not
 * versioned. Build one with {@link FormatNormalizer#normalize}, which brings any input inside the table of allowed values.
 */
public record BuilderFormat(
        String font,
        double fontSize,
        String spacing,
        String align,
        boolean bullets,
        String style,
        int columns,
        String page,
        String unit,
        boolean rules,
        List<String> hidden,
        double marginTop,
        double marginBottom,
        double marginLeft,
        double marginRight) {

    public BuilderFormat {
        hidden = List.copyOf(hidden);
    }
}

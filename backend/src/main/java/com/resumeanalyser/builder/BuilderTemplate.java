package com.resumeanalyser.builder;

/**
 * One template of the fixed catalogue (docs/prototype-spec.md, RB-TPL-02).
 *
 * @param id       the stable id the API uses
 * @param name     what the person sees, and what version summaries say ("Switched to template Clean")
 * @param fontSize text size in points, set when the template is chosen (RB-FMT-05)
 * @param margin   all four margins in millimetres, set when the template is chosen
 * @param columns  1 or 2
 * @param font     the typeface the template brings, or null to keep the person's (Classic and Executive bring one)
 * @param pdfOnly  true when it cannot be downloaded as DOCX (Classic, the LaTeX look)
 */
public record BuilderTemplate(String id, String name, double fontSize, double margin, int columns, String font, boolean pdfOnly) {
}
